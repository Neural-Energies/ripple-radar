"""Scenario probabilities from a forecast conditional distribution (§7, §8, §21).

This is the piece ACE actually needs, and it is a different problem from the
ones that failed earlier. "Will SPX rise tomorrow" is a trading signal and is
arbitraged away — the models correctly found nothing. "Given the current state,
what is the probability distribution of the move over the next 20 sessions" is
conditional distribution estimation, and that is tractable because the SCALE of
the distribution (volatility) is forecastable even when its sign is not.

Construction:
  1. forecast conditional volatility  (ace.volatility.har, validated)
  2. model standardized returns as Student-t, because financial returns have
     fat tails and a Gaussian would badly understate the probability of the
     large moves scenarios are mostly about
  3. read scenario probabilities off that distribution

The degrees-of-freedom parameter is fitted on past standardized returns only,
never on the window being scored.

What makes this checkable rather than plausible: the probability integral
transform. If the forecast distribution is right, PIT values are uniform on
[0,1]. That single test validates every probability derived from it at once,
which is why it is the gate here rather than R2.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from scipy import stats


@dataclass(frozen=True)
class ScenarioBands:
    horizon_days: int
    forecast_vol_daily: float
    forecast_vol_horizon: float
    df: float
    drift: float
    quantiles: dict[str, float]
    probabilities: dict[str, float]

    def to_dict(self) -> dict:
        return asdict(self)


def fit_tail_df(standardized: np.ndarray, *, lo: float = 2.5, hi: float = 30.0) -> float:
    """Student-t degrees of freedom from past standardized returns.

    Low df = fat tails. Equity index returns typically land around 3-6, which
    is far from Gaussian (df -> infinity) and is exactly why a normal
    assumption understates tail scenarios.
    """
    z = np.asarray(standardized, dtype=float)
    z = z[np.isfinite(z)]
    if len(z) < 100:
        return 5.0
    try:
        df, _, _ = stats.t.fit(z, floc=0.0)
    except Exception:
        return 5.0
    return float(np.clip(df, lo, hi))


def scenario_bands(
    forecast_vol_daily: float,
    *,
    horizon_days: int,
    df: float,
    drift: float = 0.0,
    thresholds: tuple[float, ...] = (0.02, 0.05, 0.10),
) -> ScenarioBands:
    """Quantiles and threshold probabilities for the horizon move.

    Scaling: a t-distribution with `df` degrees of freedom has unit variance
    only after dividing by sqrt(df/(df-2)); that correction is applied so the
    forecast volatility means what it says.
    """
    if not np.isfinite(forecast_vol_daily) or forecast_vol_daily <= 0:
        raise ValueError("forecast volatility must be positive and finite")
    if df <= 2:
        raise ValueError("Student-t variance is undefined for df <= 2")

    sigma_h = float(forecast_vol_daily * np.sqrt(horizon_days))
    unit = np.sqrt(df / (df - 2.0))
    scale = sigma_h / unit

    q = {f"p{int(p*100):02d}": round(float(stats.t.ppf(p, df, loc=drift, scale=scale)), 6)
         for p in (0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95)}

    probs: dict[str, float] = {}
    for th in thresholds:
        probs[f"P(move > +{th:.0%})"] = round(float(stats.t.sf(th, df, loc=drift, scale=scale)), 6)
        probs[f"P(move < -{th:.0%})"] = round(float(stats.t.cdf(-th, df, loc=drift, scale=scale)), 6)
        probs[f"P(|move| > {th:.0%})"] = round(
            float(stats.t.sf(th, df, loc=drift, scale=scale) + stats.t.cdf(-th, df, loc=drift, scale=scale)), 6
        )
    return ScenarioBands(
        horizon_days=int(horizon_days),
        forecast_vol_daily=round(float(forecast_vol_daily), 8),
        forecast_vol_horizon=round(sigma_h, 8),
        df=round(float(df), 3),
        drift=round(float(drift), 8),
        quantiles=q,
        probabilities=probs,
    )


def pit_values(actual: np.ndarray, sigma_h: np.ndarray, df: float, drift: np.ndarray | float = 0.0) -> np.ndarray:
    """Probability integral transform of realized moves under the forecast.

    Uniform PIT means the forecast distribution is correctly specified.
    """
    actual = np.asarray(actual, dtype=float)
    sigma_h = np.asarray(sigma_h, dtype=float)
    unit = np.sqrt(df / (df - 2.0))
    scale = np.maximum(sigma_h / unit, 1e-12)
    return stats.t.cdf((actual - np.asarray(drift, dtype=float)) / scale, df)


def pit_diagnostics(pit: np.ndarray, *, n_bins: int = 10) -> dict:
    """Test PIT uniformity — Kolmogorov-Smirnov plus a bin histogram."""
    u = np.asarray(pit, dtype=float)
    u = u[np.isfinite(u)]
    if len(u) < 50:
        return {"available": False, "reason": f"only {len(u)} values"}
    ks_stat, ks_p = stats.kstest(u, "uniform")
    counts, _ = np.histogram(u, bins=n_bins, range=(0, 1))
    expected = len(u) / n_bins
    chi2 = float(np.sum((counts - expected) ** 2 / expected))
    chi2_p = float(1 - stats.chi2.cdf(chi2, n_bins - 1))
    return {
        "available": True,
        "n": int(len(u)),
        "ks_stat": round(float(ks_stat), 5),
        "ks_p_value": round(float(ks_p), 5),
        "uniform_by_ks": bool(ks_p > 0.05),
        "chi2": round(chi2, 3),
        "chi2_p_value": round(chi2_p, 5),
        "uniform_by_chi2": bool(chi2_p > 0.05),
        "bin_counts": [int(c) for c in counts],
        "expected_per_bin": round(float(expected), 2),
        "mean": round(float(u.mean()), 4),
        "note": "uniform PIT => the forecast distribution is correctly specified",
    }


def coverage(actual: np.ndarray, sigma_h: np.ndarray, df: float, drift: np.ndarray | float = 0.0,
             levels=(0.50, 0.80, 0.90, 0.95)) -> list[dict]:
    """Do the stated intervals contain the realized move that often? (§21)"""
    actual = np.asarray(actual, dtype=float)
    sigma_h = np.asarray(sigma_h, dtype=float)
    unit = np.sqrt(df / (df - 2.0))
    scale = np.maximum(sigma_h / unit, 1e-12)
    rows = []
    for lv in levels:
        crit = stats.t.ppf(0.5 + lv / 2, df)
        inside = np.abs((actual - np.asarray(drift, dtype=float)) / scale) <= crit
        rows.append({
            "nominal": lv,
            "empirical": round(float(np.mean(inside)), 4),
            "n": int(len(actual)),
            "miss": round(float(np.mean(inside) - lv), 4),
        })
    return rows


# ---------------------------------------------------------------------------
# Filtered Historical Simulation
# ---------------------------------------------------------------------------
# Forcing a Student-t onto standardized residuals mis-shapes them here: error
# in the volatility forecast inflates their apparent kurtosis, which drags the
# fitted degrees of freedom down, which squeezes the centre of the
# distribution. The symptom was a 50% interval covering 34-43% while the 90%
# and 95% intervals were close to nominal — the tails were fine, the shape was
# not.
#
# FHS drops the parametric assumption. Standardize past returns by the
# volatility that was FORECAST for them, keep the empirical distribution of
# those residuals, and rescale it by today's forecast. The shape is then
# whatever the data's shape actually is — skew, fat tails, and all — and it is
# self-correcting as the residual history accumulates. This is standard
# practice in production VaR systems for the same reason.


def fhs_quantiles(
    residuals: np.ndarray,
    sigma_h: float,
    *,
    drift: float = 0.0,
    levels: tuple[float, ...] = (0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95),
) -> dict[str, float]:
    """Horizon-move quantiles from the empirical residual distribution."""
    z = np.asarray(residuals, dtype=float)
    z = z[np.isfinite(z)]
    if len(z) < 50:
        raise ValueError(f"need >=50 standardized residuals, got {len(z)}")
    return {
        f"p{int(lv * 100):02d}": round(float(drift + sigma_h * np.quantile(z, lv)), 6)
        for lv in levels
    }


def fhs_probabilities(
    residuals: np.ndarray,
    sigma_h: float,
    *,
    drift: float = 0.0,
    thresholds: tuple[float, ...] = (0.02, 0.05, 0.10),
) -> dict[str, float]:
    """Threshold probabilities by counting empirical residuals.

    P(move > x) is the share of past standardized residuals that, rescaled by
    today's forecast volatility, would have produced a move beyond x.
    """
    z = np.asarray(residuals, dtype=float)
    z = z[np.isfinite(z)]
    if len(z) < 50:
        raise ValueError(f"need >=50 standardized residuals, got {len(z)}")
    sims = drift + sigma_h * z
    out: dict[str, float] = {}
    for th in thresholds:
        out[f"P(move > +{th:.0%})"] = round(float(np.mean(sims > th)), 6)
        out[f"P(move < -{th:.0%})"] = round(float(np.mean(sims < -th)), 6)
        out[f"P(|move| > {th:.0%})"] = round(float(np.mean(np.abs(sims) > th)), 6)
    return out


def fhs_pit(actual: np.ndarray, sigma_h: np.ndarray, drift: np.ndarray, residual_sets: list[np.ndarray]) -> np.ndarray:
    """PIT under FHS: the empirical rank of each realized move.

    `residual_sets[i]` must contain only residuals available before
    observation i, so the forecast distribution never sees its own outcome.
    """
    actual = np.asarray(actual, dtype=float)
    sigma_h = np.asarray(sigma_h, dtype=float)
    drift = np.asarray(drift, dtype=float)
    out = np.full(len(actual), np.nan)
    for i, (a, s, dft, z) in enumerate(zip(actual, sigma_h, drift, residual_sets)):
        z = np.asarray(z, dtype=float)
        z = z[np.isfinite(z)]
        if len(z) < 50 or not np.isfinite(s) or s <= 0:
            continue
        out[i] = float(np.mean(dft + s * z <= a))
    return out


def fhs_coverage(
    actual: np.ndarray, sigma_h: np.ndarray, drift: np.ndarray,
    residual_sets: list[np.ndarray], levels=(0.50, 0.80, 0.90, 0.95),
) -> list[dict]:
    """Empirical coverage of FHS intervals against their nominal level."""
    rows = []
    for lv in levels:
        lo_q, hi_q = (1 - lv) / 2, 1 - (1 - lv) / 2
        inside = []
        for a, s, dft, z in zip(actual, sigma_h, drift, residual_sets):
            z = np.asarray(z, dtype=float)
            z = z[np.isfinite(z)]
            if len(z) < 50 or not np.isfinite(s) or s <= 0:
                continue
            lo = dft + s * np.quantile(z, lo_q)
            hi = dft + s * np.quantile(z, hi_q)
            inside.append(bool(lo <= a <= hi))
        if not inside:
            continue
        emp = float(np.mean(inside))
        rows.append({"nominal": lv, "empirical": round(emp, 4), "n": len(inside), "miss": round(emp - lv, 4)})
    return rows
