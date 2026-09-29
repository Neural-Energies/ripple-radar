"""WP3's exit condition: does a level-regime model forecast an observable
event better than climatology? (PR #5 B04; also Phase 10's DFM-vs-PCA
comparison, asked of the same machinery.)

WHAT THE PREVIOUS VERSION GOT WRONG

1. Wrong event. It scored P(the factor is in its high-mean state NOW) against
   "the factor rises over the next six months". Those are different events;
   a well-calibrated state probability can score badly against the second
   for no fault of its own.
2. Wrong date. The outcome was the first reference observation on or AFTER
   the target date, so a missing month silently became a later one.
3. Unidentified sign. Each anchor's factor was refit from scratch, and a
   principal component's or DFM factor's sign is arbitrary per fit, so "rise"
   could mean opposite things at two anchors.
4. Too little evidence. Three anchors, and a scorer that would call one
   favourable anchor significant.

THE PROTOCOL, FIXED BEFORE ANY SCORE IS SEEN (`PROTOCOL`, `TARGETS`)

- Target: an OBSERVABLE per block — housing starts (HOUST) for housing, the
  VIX for financial conditions (see `TARGETS`). At an anchor whose data end in
  month m, the event is "the observable in month m+6 is higher than in month
  m", read from the final vintage. Both months must exist exactly; otherwise
  the anchor is unavailable, never re-dated.
- Forecast of that event: the anchor's factor is oriented to correlate
  positively with the observable using only data published by the anchor.
  The switching-mean-and-variance model gives, from filtered state
  probabilities and its transition matrix, P(factor in m+6 > factor in m).
  That raw probability is mapped onto the observable event by a logistic
  calibration fitted only on earlier anchors whose labels had been
  PUBLISHED by this anchor (label availability read from the vintage
  archive, with the values as then published). Until enough such pairs
  exist the anchor is burn-in, not a forecast.
- Climatology: the observable's six-month up-share over every realised pair
  in the anchor's own vintage.
- The current latent-state probability is recorded beside each reading as a
  description. It is not scored as a forecast of anything.
- Anchors every six months, so outcome windows do not overlap. Scored
  anchors are split in time order; the verdict is read on the later,
  untouched confirmation share only, with the sample floor from
  `ace.regime.climatology.Sufficiency`, a moving-block bootstrap, and the
  family-wise level divided across every (block, source) comparison run.
- Every run writes a manifest: protocol, targets, anchors, splits, seed,
  per-series input hashes, code revision, and its own hash.

Run: `python -m ace.regime.level_regime_validation`
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from typing import Callable

import numpy as np
import pandas as pd
from scipy.stats import norm

from ace.factors.pca import domain_panels, fit as fit_pca
from ace.regime.climatology import AnchorReading, Sufficiency, skill_report
from ace.regime.macro_regime import MIN_OBS
from ace.regime.markov import filtered_probabilities, regime_params
from ace.regime.mean_vs_variance import _fit as _fit_switching_model
from ace.state.factors import fit_factors
from ace.state.panel import PANEL, build_asof


@dataclass(frozen=True)
class Protocol:
    version: str = "wp3-v2"
    horizon_months: int = 6
    anchor_step_months: int = 6
    first_anchor: str = "1995-01-01"
    #: Earlier anchors with published labels needed before a calibrated forecast.
    calibration_min_pairs: int = 12
    calibration_min_each_class: int = 3
    #: The later share of scored anchors, held out for the verdict.
    confirmation_share: float = 0.4
    sufficiency: Sufficiency = field(default_factory=lambda: Sufficiency(min_n=20, min_events=6, min_non_events=6))
    #: Family-wise; divided by the number of comparisons in a run.
    family_alpha: float = 0.05
    #: |corr| below this leaves the factor's sign undetermined: the anchor is skipped.
    min_orientation_corr: float = 0.1
    seed: int = 17


@dataclass(frozen=True)
class Target:
    block: str
    domain: str
    observable: str
    description: str


PROTOCOL = Protocol()

TARGETS = (
    Target("housing", "housing", "HOUST",
           "Housing starts in month m+6 above month m, where m is the last month in the anchor's data; final vintage."),
    # Not NFCI: it was first published in 2011, so no anchor before then could
    # have seen it, and its archive here starts in 2005. VIX is a market quote,
    # never revised, observed in real time since 1990. Chosen on data
    # availability before any score was computed.
    Target("financial", "financial_conditions", "VIXCLS",
           "VIX monthly average in month m+6 above month m (more stress); never revised."),
)

#: A factor source returns the factor as it could have been estimated at `as_of`.
FactorSource = Callable[[pd.Timestamp], pd.Series]


# ------------------------------------------------------------- sources --

def production_dfm_factor_source(block: str, vintages: dict, specs=PANEL, *, maxiter: int = 80,
                                 memo: dict | None = None) -> FactorSource:
    """The production DFM's block factor, refit as of each anchor.

    One DFM fit estimates every block, so fits are memoised per anchor and
    shared across blocks. `maxiter` is lower than `fit_factors`'s default:
    each anchor needs a serviceable factor, not the last digit of likelihood.
    """
    memo = {} if memo is None else memo

    def _source(as_of: pd.Timestamp) -> pd.Series:
        key = str(as_of)
        if key not in memo:
            build = build_asof(as_of, vintages, specs=specs)
            memo[key] = None if build.frame.empty else fit_factors(build, maxiter=maxiter).factors
        factors = memo[key]
        if factors is None:
            return pd.Series(dtype=float)
        col = next((c for c in factors.columns if str(c).split(".")[0] == block), None)
        return factors[col].dropna() if col else pd.Series(dtype=float)
    return _source


def domain_pca_factor_source(label: str, vintages: dict, specs) -> FactorSource:
    """A Phase 6/7 domain's PC1, refit as of each anchor."""
    def _source(as_of: pd.Timestamp) -> pd.Series:
        build = build_asof(as_of, vintages, specs=specs)
        frame = domain_panels(build.frame, build.groups).get(label)
        if frame is None:
            return pd.Series(dtype=float)
        try:
            return fit_pca(frame, as_of=build.as_of, label=label, k=1).scores["PC1"]
        except ValueError:
            return pd.Series(dtype=float)
    return _source


def observable_source(series_id: str, vintages: dict, specs=PANEL):
    """The observable as published at `as_of`: (transformed, levels), monthly."""
    def _source(as_of: pd.Timestamp) -> tuple[pd.Series, pd.Series]:
        build = build_asof(as_of, vintages, specs=specs)
        if series_id not in build.levels:
            return pd.Series(dtype=float), pd.Series(dtype=float)
        levels = build.levels[series_id].dropna()
        transformed = build.frame[series_id].dropna() if series_id in build.frame else levels
        return transformed, levels
    return _source


# ------------------------------------------------------------ the model --

def orient(factor: pd.Series, observable: pd.Series, *, min_corr: float) -> tuple[pd.Series, float] | None:
    """Sign the factor to move with the observable, from the anchor's own data."""
    both = pd.concat([factor, observable], axis=1, join="inner").dropna()
    if len(both) < 24:
        return None
    corr = float(np.corrcoef(both.iloc[:, 0], both.iloc[:, 1])[0, 1])
    if not np.isfinite(corr) or abs(corr) < min_corr:
        return None
    return (factor if corr > 0 else -factor), corr


def _fit(y: pd.Series, seed: int):
    return _fit_switching_model(y, switching_trend=True, seed=seed)


def regime_forecast(res, y_last: float, horizon: int) -> dict:
    """The switching model's own forecast for `horizon` steps ahead.

    y_t = mu_s + e_t with e_t ~ N(0, sigma_s^2), states Markov. From the
    filtered state at t and the transition matrix, the state distribution at
    t+h is C^h pi_t (statsmodels' C[i, j] = P(next=i | now=j)), and
    P(y_{t+h} > y_t) = sum_s pi_{t+h}(s) * (1 - Phi((y_t - mu_s) / sigma_s)).
    """
    means, variances = regime_params(res, 2)
    C = np.asarray(res.regime_transition).reshape(2, 2)
    pi_t = np.asarray(filtered_probabilities(res))[-1].ravel()
    pi_h = np.linalg.matrix_power(C, horizon) @ pi_t
    sd = np.sqrt(np.maximum(np.asarray(variances, dtype=float), 1e-12))
    p_rise = float(np.sum(pi_h * (1 - norm.cdf((y_last - np.asarray(means)) / sd))))
    high = int(np.argmax(means))
    return {"p_rise": float(np.clip(p_rise, 1e-6, 1 - 1e-6)), "p_high_state_now": float(pi_t[high])}


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def calibrate(raw_history: list[float], labels: list[float], raw_now: float) -> float:
    """Logistic calibration on earlier (raw, label) pairs only, lightly
    regularised so a short history cannot produce a certainty."""
    from sklearn.linear_model import LogisticRegression

    x = _logit(np.asarray(raw_history, dtype=float)).reshape(-1, 1)
    model = LogisticRegression(C=1.0).fit(x, np.asarray(labels, dtype=int))
    return float(model.predict_proba(_logit(np.array([raw_now])).reshape(-1, 1))[0, 1])


# ------------------------------------------------------------ the event --

def _month(ts) -> pd.Timestamp:
    t = pd.Timestamp(ts)
    if t.tzinfo is not None:
        t = t.tz_convert(None)
    return t.to_period("M").to_timestamp()


def _monthly(levels: pd.Series) -> pd.Series:
    s = levels.copy()
    s.index = [_month(i) for i in s.index]
    return s[~s.index.duplicated(keep="last")].sort_index()


def exact_event(levels: pd.Series, month: pd.Timestamp, horizon: int) -> float | None:
    """1.0 if the level in month+horizon exceeds month's, else 0.0; None
    unless BOTH months are observed exactly. Never substitutes a later month."""
    s = _monthly(levels)
    m0 = _month(month)
    m1 = m0 + pd.DateOffset(months=horizon)
    if m0 not in s.index or m1 not in s.index:
        return None
    a, b = float(s.loc[m0]), float(s.loc[m1])
    if not (np.isfinite(a) and np.isfinite(b)):
        return None
    return 1.0 if b > a else 0.0


def climatology_at(levels: pd.Series, horizon: int) -> float | None:
    """Share of realised month-to-month+h rises in the vintage the anchor had."""
    s = _monthly(levels).dropna()
    if s.empty:
        return None
    full = s.reindex(pd.date_range(s.index.min(), s.index.max(), freq="MS"))
    future = full.shift(-horizon)
    ok = full.notna() & future.notna()
    if not ok.any():
        return None
    return float((future[ok] > full[ok]).mean())


# ------------------------------------------------------------ the run --

@dataclass
class AnchorRow:
    anchor: str
    month: str
    raw: float
    p_high_state_now: float
    orientation_corr: float
    climatology: float
    outcome: float
    #: Labels of earlier anchors as published by this anchor: (anchor, label).
    known_labels: list[tuple[str, float]]
    calibrated: float | None = None


def anchors_for(protocol: Protocol, last_label_month: pd.Timestamp) -> pd.DatetimeIndex:
    """Every anchor whose target month can already have been observed."""
    last = _month(last_label_month) - pd.DateOffset(months=protocol.horizon_months)
    return pd.date_range(protocol.first_anchor, last, freq=f"{protocol.anchor_step_months}MS", tz="UTC")


def collect(
    source: FactorSource,
    observable_at: Callable[[pd.Timestamp], tuple[pd.Series, pd.Series]],
    final_levels: pd.Series,
    anchors: pd.DatetimeIndex,
    protocol: Protocol = PROTOCOL,
) -> tuple[list[AnchorRow], dict[str, str]]:
    """One raw reading per usable anchor, and why each other anchor was not usable."""
    rows: list[AnchorRow] = []
    skipped: dict[str, str] = {}
    months: dict[str, pd.Timestamp] = {}
    h = protocol.horizon_months
    for anchor in anchors:
        key = str(anchor.date())
        factor = source(anchor).dropna()
        if len(factor) < MIN_OBS:
            skipped[key] = f"factor has {len(factor)} observations, need {MIN_OBS}"
            continue
        transformed, levels_then = observable_at(anchor)
        oriented = orient(factor, transformed, min_corr=protocol.min_orientation_corr)
        if oriented is None:
            skipped[key] = "factor sign undetermined against the observable"
            continue
        factor, corr = oriented
        month = _month(factor.index.max())
        outcome = exact_event(final_levels, month, h)
        if outcome is None:
            skipped[key] = f"observable not published for both {month.date()} and +{h}m in the final vintage"
            continue
        clim = climatology_at(levels_then, h)
        if clim is None:
            skipped[key] = "no realised pairs for climatology in the anchor's vintage"
            continue
        try:
            res = _fit(factor, protocol.seed)
            fc = regime_forecast(res, float(factor.iloc[-1]), h)
        except Exception as err:  # noqa: BLE001 — an unfittable anchor is skipped, and says why
            skipped[key] = f"switching fit failed: {type(err).__name__}"
            continue
        # Earlier anchors' labels as published by THIS anchor (values as then published).
        known = []
        for prev in rows:
            label = exact_event(levels_then, months[prev.anchor], h)
            if label is not None:
                known.append((prev.anchor, label))
        months[key] = month
        rows.append(AnchorRow(key, str(month.date()), fc["p_rise"], fc["p_high_state_now"], round(corr, 4),
                              clim, outcome, known))
    return rows, skipped


def calibrate_rows(rows: list[AnchorRow], protocol: Protocol = PROTOCOL) -> tuple[list[AnchorRow], dict[str, str]]:
    """Attach the forward-chained calibrated probability; burn-in anchors are dropped."""
    raw = {r.anchor: r.raw for r in rows}
    scored: list[AnchorRow] = []
    burn: dict[str, str] = {}
    for r in rows:
        pairs = [(raw[a], y) for a, y in r.known_labels]
        ys = [y for _, y in pairs]
        if len(pairs) < protocol.calibration_min_pairs or min(ys.count(0.0), ys.count(1.0)) < protocol.calibration_min_each_class:
            burn[r.anchor] = f"calibration burn-in: {len(pairs)} published earlier labels"
            continue
        r.calibrated = calibrate([p for p, _ in pairs], ys, r.raw)
        scored.append(r)
    return scored, burn


def evaluate(scored: list[AnchorRow], *, comparisons: int, protocol: Protocol = PROTOCOL) -> dict:
    """Development and confirmation reports; the verdict is the confirmation one."""
    n_conf = int(np.ceil(len(scored) * protocol.confirmation_share))
    dev, conf = scored[: len(scored) - n_conf], scored[len(scored) - n_conf:]
    alpha = protocol.family_alpha / max(1, comparisons)

    def readings(rs):
        return [AnchorReading(r.anchor, r.calibrated, r.climatology, r.outcome) for r in rs]

    confirmation = skill_report(readings(conf), sufficiency=protocol.sufficiency, alpha=alpha, seed=protocol.seed)
    development = skill_report(readings(dev), sufficiency=protocol.sufficiency, alpha=alpha, seed=protocol.seed)
    return {
        "verdict": confirmation["verdict"],
        "alpha_per_comparison": round(alpha, 6),
        "split": {
            "development": [dev[0].anchor, dev[-1].anchor] if dev else None,
            "confirmation": [conf[0].anchor, conf[-1].anchor] if conf else None,
        },
        "confirmation": confirmation,
        "development": development,
        "rows": [asdict(r) | {"known_labels": len(r.known_labels)} for r in scored],
    }


# ------------------------------------------------------------ manifest --

def series_hash(frame: pd.DataFrame | pd.Series) -> str:
    return hashlib.sha256(pd.util.hash_pandas_object(frame, index=True).values.tobytes()).hexdigest()[:16]


def input_hashes(vintages: dict, ids) -> dict[str, str]:
    return {sid: series_hash(vintages[sid]) for sid in sorted(ids) if sid in vintages}


def seal(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def main() -> None:
    import subprocess

    from ace.config import ROOT
    from ace.factors.universe_panel import default_panel
    from ace.jsonutil import to_json_safe
    from ace.state.panel import load_vintages

    now = pd.Timestamp.now(tz="UTC")
    protocol = PROTOCOL
    production_vintages = load_vintages(PANEL)
    comprehensive_specs, _ = default_panel()
    comprehensive_vintages = load_vintages(comprehensive_specs)
    dfm_memo: dict = {}

    plans = []
    for target in TARGETS:
        obs_at = observable_source(target.observable, production_vintages)
        _, final_levels = obs_at(now)
        if final_levels.empty:
            print(f"{target.observable}: not in the production panel — skipping {target.block}")
            continue
        anchors = anchors_for(protocol, final_levels.index.max())
        plans.append((target, "dfm", production_dfm_factor_source(target.block, production_vintages, memo=dfm_memo),
                      obs_at, final_levels, anchors))
        plans.append((target, "domain_pca",
                      domain_pca_factor_source(target.domain, comprehensive_vintages, comprehensive_specs),
                      obs_at, final_levels, anchors))

    results: dict[str, dict] = {}
    for target, name, source, obs_at, final_levels, anchors in plans:
        print(f"=== {target.block} · {name}: {len(anchors)} anchors", flush=True)
        rows, skipped = collect(source, obs_at, final_levels, anchors, protocol)
        scored, burn = calibrate_rows(rows, protocol)
        report = evaluate(scored, comparisons=len(plans), protocol=protocol)
        report["skipped"] = skipped
        report["burn_in"] = burn
        report["anchors_considered"] = len(anchors)
        results.setdefault(target.block, {})[name] = report
        c = report["confirmation"]
        print(f"    {report['verdict']} (confirmation n={c['n_anchors']}, skill={c.get('skill')})", flush=True)

    try:
        git_sha = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    except Exception:  # noqa: BLE001
        git_sha = "unknown"
    manifest = {
        "protocol": asdict(protocol),
        "targets": [asdict(t) for t in TARGETS],
        "comparisons": [[p[0].block, p[1]] for p in plans],
        "anchors": {p[0].block: [str(a.date()) for a in p[5]] for p in plans},
        "code": {"git_sha": git_sha, "module": __name__},
        "inputs": {
            "production_panel": input_hashes(production_vintages, {s.series_id for s in PANEL}),
            "comprehensive_panel": input_hashes(comprehensive_vintages, {s.series_id for s in comprehensive_specs}),
        },
        "results_sha256": seal(results),
    }
    manifest["manifest_sha256"] = seal(manifest)
    out = {
        "generated": str(now.date()),
        "question": ("Does a level-regime model's probability of a pre-registered observable event "
                     "beat point-in-time climatology on untouched chronological confirmation, and does "
                     "the comprehensive-panel domain PCA factor do better or worse than the production DFM's?"),
        "manifest": manifest,
        "results": results,
    }
    path = ROOT / "artifacts" / "reports" / "macro_level_regime_validation.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(to_json_safe(out), indent=2, sort_keys=True, default=str, allow_nan=False))
    print(f"\nwrote {path}\nmanifest {manifest['manifest_sha256']}")


if __name__ == "__main__":
    main()
