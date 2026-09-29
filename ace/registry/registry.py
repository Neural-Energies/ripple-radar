"""File-backed model registry implementing the §4 metadata contract.

MLflow is the directive's suggestion; this is the "equivalent robust
architecture" it allows. The reason for the substitution is deployment: the
application ships as a Node bundle with no Python tracking server alongside it,
so a registry that needs a running service would not be readable at inference
time. A JSON index plus hashed artifacts is portable, diffable, survives a
container rebuild, and answers the question that actually matters — which exact
model produced this forecast, and from what data.
"""
from __future__ import annotations

import hashlib
import json
import platform
import subprocess
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib

from ace.config import MODELS, REGISTRY_PATH

STATUSES = ("RESEARCH", "VALIDATING", "CANDIDATE", "PRODUCTION", "DEGRADED", "RETIRED", "FAILED")


def _git_sha() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception:
        return "unknown"


def sha256_of(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()[:16]


def dataframe_hash(df) -> str:
    """Stable fingerprint of a training frame, for reproducibility checks."""
    import pandas as pd  # local import keeps the registry importable without pandas

    h = hashlib.sha256()
    h.update(str(df.shape).encode())
    h.update(",".join(map(str, df.columns)).encode())
    vals = pd.util.hash_pandas_object(df, index=True).values
    h.update(vals.tobytes())
    return h.hexdigest()[:16]


@dataclass
class ModelRecord:
    model_id: str
    model_family: str
    model_version: str
    analysis_type: str
    target_variable: str
    feature_schema: list[str]
    training_start: str
    training_end: str
    validation_periods: list[dict]
    holdout_period: dict
    training_dataset_hash: str
    hyperparameters: dict
    random_seed: int
    performance_metrics: dict
    calibration_metrics: dict
    benchmark_metrics: dict
    model_artifact_path: str
    creation_timestamp: str
    production_status: str
    notes: str = ""
    git_sha: str = field(default_factory=_git_sha)
    python_version: str = field(default_factory=lambda: platform.python_version())

    def to_dict(self) -> dict:
        return asdict(self)


def _load() -> list[dict]:
    if not REGISTRY_PATH.exists():
        return []
    return json.loads(REGISTRY_PATH.read_text())


def _save(rows: list[dict]) -> None:
    REGISTRY_PATH.write_text(json.dumps(rows, indent=2, default=str))


def register(record: ModelRecord, artifact: Any | None = None) -> ModelRecord:
    """Persist the artifact and its metadata. Status is never PRODUCTION here.

    Promotion is a separate, explicit decision (§41) so a freshly trained model
    cannot deploy itself by existing.
    """
    if record.production_status not in STATUSES:
        raise ValueError(f"unknown status {record.production_status}")
    if record.production_status == "PRODUCTION":
        raise ValueError("register() cannot mint PRODUCTION; use promote() after the gates pass")
    rows = _load()
    incumbent = next(
        (r for r in rows
         if r["model_id"] == record.model_id and r["model_version"] == record.model_version),
        None,
    )
    # Re-registering the same id:version replaces the row. If that row is the
    # live champion, the replacement is a silent demotion -- a re-run on a
    # different channel or a worse seed would quietly take a PRODUCTION model
    # out of production with no retire event and no reason recorded. Promotion
    # is explicit (§41), so demotion is too.
    if incumbent is not None and incumbent["production_status"] == "PRODUCTION":
        raise ValueError(
            f"{record.model_id}:{record.model_version} is in PRODUCTION; "
            "re-registering would silently demote it. Retire it first, or "
            "register under a new version. If this is a per-channel model, "
            "give each channel its own model_id."
        )
    if artifact is not None:
        path = MODELS / f"{record.model_id}_{record.model_version}.joblib"
        joblib.dump(artifact, path)
        record.model_artifact_path = str(path.relative_to(Path(MODELS).parent.parent))
    rows = [r for r in rows
            if not (r["model_id"] == record.model_id and r["model_version"] == record.model_version)]
    rows.append(record.to_dict())
    _save(rows)
    return record


#: Floors every promotion's evidence must clear, whatever the model's own gate
#: says (PR #5 B04). A CI computed from a handful of rows is not evidence.
MIN_SCORED = 30
MIN_CLASS = 10


@dataclass(frozen=True)
class Evidence:
    """What a promotion rests on: the exact claim, the sample, and where it came from.

    Built by the script that ran the gate (`evidence_for`), checked by
    `promote`, and stored with the promoted row so the claim stays auditable.
    """

    model_id: str
    model_version: str
    #: Must equal the registered row's: evidence from other data promotes nothing.
    training_dataset_hash: str
    target: str
    horizon: str
    metric: str
    baseline: str
    value: float
    ci: tuple[float, float] | None
    #: Out-of-sample observations the gate statistic was computed on.
    n_scored: int
    #: For event targets: both classes must be represented.
    n_events: int | None
    n_non_events: int | None
    splits: dict
    seed: int | None
    input_hashes: dict
    passed: bool
    criteria: str


def evidence_for(
    record: "ModelRecord | dict",
    *,
    target: str,
    horizon: str,
    metric: str,
    baseline: str,
    value: float,
    n_scored: int,
    passed: bool,
    criteria: str,
    ci: tuple[float, float] | list[float] | None = None,
    n_events: int | None = None,
    n_non_events: int | None = None,
    input_hashes: dict | None = None,
) -> Evidence:
    """Evidence for a registered record, with its identity, splits and seed filled in."""
    row = record.to_dict() if isinstance(record, ModelRecord) else dict(record)
    return Evidence(
        model_id=row["model_id"],
        model_version=row["model_version"],
        training_dataset_hash=row["training_dataset_hash"],
        target=target,
        horizon=str(horizon),
        metric=metric,
        baseline=baseline,
        value=float(value),
        ci=(float(ci[0]), float(ci[1])) if ci is not None else None,
        n_scored=int(n_scored),
        n_events=None if n_events is None else int(n_events),
        n_non_events=None if n_non_events is None else int(n_non_events),
        splits={"validation": row.get("validation_periods"), "holdout": row.get("holdout_period")},
        seed=row.get("random_seed"),
        input_hashes=input_hashes or {"training": row["training_dataset_hash"]},
        passed=bool(passed),
        criteria=criteria,
    )


def check_evidence(row: dict, evidence: Evidence | None) -> list[str]:
    """Why `evidence` cannot promote `row`. Empty when it can."""
    import math

    if not isinstance(evidence, Evidence):
        return ["no evidence manifest"]
    problems: list[str] = []
    if (evidence.model_id, evidence.model_version) != (row["model_id"], row["model_version"]):
        problems.append(f"evidence is for {evidence.model_id}:{evidence.model_version}")
    if evidence.training_dataset_hash != row.get("training_dataset_hash"):
        problems.append("evidence was produced on different training data")
    if not evidence.passed:
        problems.append("the evidence's own gate did not pass")
    for name in ("target", "horizon", "metric", "baseline", "criteria"):
        if not str(getattr(evidence, name) or "").strip():
            problems.append(f"no {name} stated")
    if not math.isfinite(evidence.value):
        problems.append("gate statistic is not finite")
    if evidence.n_scored < MIN_SCORED:
        problems.append(f"{evidence.n_scored} scored observations < {MIN_SCORED}")
    if evidence.n_events is not None or evidence.n_non_events is not None:
        if (evidence.n_events or 0) < MIN_CLASS or (evidence.n_non_events or 0) < MIN_CLASS:
            problems.append(f"events/non-events {evidence.n_events}/{evidence.n_non_events}, need {MIN_CLASS} each")
    if not evidence.input_hashes:
        problems.append("no input hashes")
    if evidence.seed is None:
        problems.append("no seed")
    return problems


def promote(model_id: str, version: str, *, reason: str, evidence: Evidence | None) -> dict:
    """Move a CANDIDATE to PRODUCTION and retire the incumbent champion (§49).

    Fails closed: without evidence that names this exact model, version and
    training data, states its target, horizon, metric and baseline, clears the
    sample floors and passed its own gate, nothing is promoted.
    """
    rows = _load()
    target = next((r for r in rows if r["model_id"] == model_id and r["model_version"] == version), None)
    if target is None:
        raise KeyError(f"{model_id}:{version} not registered")
    if target["production_status"] != "CANDIDATE":
        raise ValueError(f"only a CANDIDATE can be promoted; {model_id}:{version} is {target['production_status']}")
    problems = check_evidence(target, evidence)
    if problems:
        raise ValueError(f"promotion of {model_id}:{version} refused: " + "; ".join(problems))
    target["evidence"] = asdict(evidence)
    target["evidence_sha256"] = sha256_of(asdict(evidence))
    for r in rows:
        if r["model_id"] == model_id and r["production_status"] == "PRODUCTION":
            r["production_status"] = "RETIRED"
            r["notes"] = (r.get("notes", "") + f" | retired by {version}: {reason}").strip(" |")
    target["production_status"] = "PRODUCTION"
    target["notes"] = (target.get("notes", "") + f" | promoted: {reason}").strip(" |")
    _save(rows)
    return target


def try_promote(model_id: str, version: str, *, reason: str, evidence: Evidence | None) -> tuple[bool, list[str]]:
    """`promote`, reporting a refusal instead of raising, for training scripts
    that should finish (and write their scorecard) either way."""
    rows = _load()
    row = next((r for r in rows if r["model_id"] == model_id and r["model_version"] == version), None)
    problems = check_evidence(row, evidence) if row else [f"{model_id}:{version} not registered"]
    if problems:
        return False, problems
    promote(model_id, version, reason=reason, evidence=evidence)
    return True, []


def retire(model_id: str, version: str, *, reason: str) -> dict:
    """Take a model out of production, on the record.

    The counterpart to promote(). Retiring is a decision with a reason
    attached, not something that happens because a script was re-run.
    """
    rows = _load()
    target = next(
        (r for r in rows if r["model_id"] == model_id and r["model_version"] == version), None
    )
    if target is None:
        raise KeyError(f"{model_id}:{version} not registered")
    if target["production_status"] != "PRODUCTION":
        raise ValueError(
            f"only a PRODUCTION model can be retired; {model_id}:{version} "
            f"is {target['production_status']}"
        )
    target["production_status"] = "RETIRED"
    target["notes"] = (target.get("notes", "") + f" | retired: {reason}").strip(" |")
    _save(rows)
    return target


def production_model(model_id: str) -> dict | None:
    return next(
        (r for r in _load() if r["model_id"] == model_id and r["production_status"] == "PRODUCTION"), None
    )


def load_artifact(record: dict) -> Any:
    return joblib.load(Path(record["model_artifact_path"]))


def all_records() -> list[dict]:
    return _load()


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()
