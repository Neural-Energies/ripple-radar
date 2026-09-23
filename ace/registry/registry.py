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
    if artifact is not None:
        path = MODELS / f"{record.model_id}_{record.model_version}.joblib"
        joblib.dump(artifact, path)
        record.model_artifact_path = str(path.relative_to(Path(MODELS).parent.parent))
    rows = [r for r in _load() if not (r["model_id"] == record.model_id and r["model_version"] == record.model_version)]
    rows.append(record.to_dict())
    _save(rows)
    return record


def promote(model_id: str, version: str, *, reason: str) -> dict:
    """Move a CANDIDATE to PRODUCTION and retire the incumbent champion (§49)."""
    rows = _load()
    target = next((r for r in rows if r["model_id"] == model_id and r["model_version"] == version), None)
    if target is None:
        raise KeyError(f"{model_id}:{version} not registered")
    if target["production_status"] != "CANDIDATE":
        raise ValueError(f"only a CANDIDATE can be promoted; {model_id}:{version} is {target['production_status']}")
    for r in rows:
        if r["model_id"] == model_id and r["production_status"] == "PRODUCTION":
            r["production_status"] = "RETIRED"
            r["notes"] = (r.get("notes", "") + f" | retired by {version}: {reason}").strip(" |")
    target["production_status"] = "PRODUCTION"
    target["notes"] = (target.get("notes", "") + f" | promoted: {reason}").strip(" |")
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
