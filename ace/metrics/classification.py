"""Probability-forecast metrics (§36, §38).

Accuracy is deliberately not the headline number. ACE sells probabilities, so
what matters is whether a stated 70% happens about 70% of the time, and whether
the forecast beats the base rate a coin-flip-free baseline would have given.

Brier Skill Score is the load-bearing metric: it is the Brier score expressed
as improvement over always predicting the historical base rate. BSS <= 0 means
the model adds nothing, no matter how good its accuracy looks.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from sklearn.metrics import average_precision_score, brier_score_loss, log_loss, roc_auc_score


@dataclass(frozen=True)
class ClassificationReport:
    n: int
    base_rate: float
    brier: float
    brier_baseline: float
    brier_skill_score: float
    log_loss: float
    log_loss_baseline: float
    roc_auc: float | None
    pr_auc: float
    pr_auc_baseline: float
    ece: float
    calibration_slope: float
    calibration_intercept: float
    accuracy: float
    accuracy_baseline: float

    def to_dict(self) -> dict:
        return asdict(self)

    def beats_baseline(self) -> bool:
        """Production gate (§37): better Brier AND better log loss than base rate."""
        return self.brier_skill_score > 0 and self.log_loss < self.log_loss_baseline


def expected_calibration_error(y: np.ndarray, p: np.ndarray, n_bins: int = 10) -> float:
    """Mean |confidence - realized frequency|, weighted by bin population."""
    y = np.asarray(y, dtype=float)
    p = np.asarray(p, dtype=float)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    idx = np.clip(np.digitize(p, edges[1:-1], right=True), 0, n_bins - 1)
    total = 0.0
    for b in range(n_bins):
        m = idx == b
        if not m.any():
            continue
        total += (m.sum() / len(p)) * abs(p[m].mean() - y[m].mean())
    return float(total)


def calibration_line(y: np.ndarray, p: np.ndarray) -> tuple[float, float]:
    """Slope and intercept of realized outcome regressed on forecast.

    A perfectly calibrated forecaster gives slope 1, intercept 0. Slope < 1 is
    the classic overconfident model: its extremes are too extreme.
    """
    y = np.asarray(y, dtype=float)
    p = np.asarray(p, dtype=float)
    if len(np.unique(p)) < 2:
        return float("nan"), float("nan")
    slope, intercept = np.polyfit(p, y, 1)
    return float(slope), float(intercept)


def reliability_table(y: np.ndarray, p: np.ndarray, edges: list[float] | None = None) -> list[dict]:
    """Forecast bucket vs realized frequency — the §8 evidence table."""
    y = np.asarray(y, dtype=float)
    p = np.asarray(p, dtype=float)
    edges = edges or [0.0, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 1.0]
    rows: list[dict] = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (p >= lo) & (p < hi) if hi < 1.0 else (p >= lo) & (p <= hi)
        if not m.any():
            continue
        rows.append(
            {
                "bucket": f"{lo:.0%}-{hi:.0%}",
                "n": int(m.sum()),
                "mean_forecast": round(float(p[m].mean()), 4),
                "realized_frequency": round(float(y[m].mean()), 4),
            }
        )
    return rows


def evaluate(y: np.ndarray, p: np.ndarray, *, base_rate: float | None = None) -> ClassificationReport:
    """Score a probability forecast against the base-rate baseline.

    `base_rate` should come from the TRAINING window, not from `y` — using the
    evaluation set's own rate gives the baseline information the model never
    had, which flatters the model.
    """
    y = np.asarray(y, dtype=float).ravel()
    p = np.clip(np.asarray(p, dtype=float).ravel(), 1e-6, 1 - 1e-6)
    if len(y) != len(p):
        raise ValueError(f"length mismatch: y={len(y)} p={len(p)}")
    if len(y) == 0:
        raise ValueError("empty evaluation set")

    br = float(np.mean(y)) if base_rate is None else float(base_rate)
    br = min(max(br, 1e-6), 1 - 1e-6)
    const = np.full_like(p, br)

    brier = float(brier_score_loss(y, p))
    brier_base = float(brier_score_loss(y, const))
    bss = 1.0 - brier / brier_base if brier_base > 0 else 0.0

    try:
        auc = float(roc_auc_score(y, p)) if len(np.unique(y)) > 1 else None
    except ValueError:
        auc = None

    prevalence = float(np.mean(y))
    slope, intercept = calibration_line(y, p)
    return ClassificationReport(
        n=len(y),
        base_rate=round(br, 6),
        brier=round(brier, 6),
        brier_baseline=round(brier_base, 6),
        brier_skill_score=round(bss, 6),
        log_loss=round(float(log_loss(y, p, labels=[0, 1])), 6),
        log_loss_baseline=round(float(log_loss(y, const, labels=[0, 1])), 6),
        roc_auc=None if auc is None else round(auc, 6),
        pr_auc=round(float(average_precision_score(y, p)), 6) if len(np.unique(y)) > 1 else float("nan"),
        pr_auc_baseline=round(prevalence, 6),
        ece=round(expected_calibration_error(y, p), 6),
        calibration_slope=round(slope, 6),
        calibration_intercept=round(intercept, 6),
        accuracy=round(float(np.mean((p >= 0.5) == (y == 1))), 6),
        accuracy_baseline=round(max(prevalence, 1 - prevalence), 6),
    )
