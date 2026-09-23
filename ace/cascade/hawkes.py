"""Hawkes self-exciting point process — the ripple, stated mathematically.

A Hawkes process is the formal version of "one event raises the chance of the
next". Its conditional intensity is

    lambda(t) = mu + sum_{t_i < t} alpha * beta * exp(-beta * (t - t_i))

where `mu` is the background rate events arrive at anyway, `alpha` is the
expected number of direct offspring each event triggers (the BRANCHING RATIO),
and `1/beta` is how long that excitement lasts. A cascade is exactly alpha
approaching 1; above 1 the process explodes and is not stationary.

Fitted by maximum likelihood, in the recursive form so the likelihood is O(n)
rather than O(n^2).

Validation is the part that matters, and there are two independent checks:

  likelihood ratio   against a homogeneous Poisson null. Poisson is Hawkes
                     with alpha = 0, so the models are nested and the LR
                     statistic is chi-squared with 2 degrees of freedom.

  time rescaling     Ogata's residual analysis. If the intensity is correct,
                     the compensator transforms event times into a unit-rate
                     Poisson process, so the rescaled inter-event times are
                     iid Exp(1). This catches a model that beats Poisson while
                     still being wrong, which a likelihood ratio alone cannot.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from scipy import stats
from scipy.optimize import minimize


@dataclass(frozen=True)
class HawkesFit:
    mu: float
    alpha: float
    beta: float
    log_likelihood: float
    poisson_log_likelihood: float
    lr_statistic: float
    lr_p_value: float
    beats_poisson: bool
    branching_ratio: float
    stationary: bool
    mean_excitation_life: float
    n_events: int
    horizon: float
    converged: bool

    def to_dict(self) -> dict:
        return asdict(self)


def _recursive_A(t: np.ndarray, beta: float) -> np.ndarray:
    """A_i = sum_{j<i} exp(-beta (t_i - t_j)), computed in one pass."""
    A = np.zeros(len(t))
    for i in range(1, len(t)):
        A[i] = np.exp(-beta * (t[i] - t[i - 1])) * (1.0 + A[i - 1])
    return A


def hawkes_log_likelihood(params: np.ndarray, t: np.ndarray, T: float) -> float:
    mu, alpha, beta = params
    if mu <= 0 or alpha < 0 or beta <= 0:
        return 1e10
    A = _recursive_A(t, beta)
    intensity = mu + alpha * beta * A
    if np.any(intensity <= 0):
        return 1e10
    compensator = mu * T + alpha * np.sum(1.0 - np.exp(-beta * (T - t)))
    ll = float(np.sum(np.log(intensity)) - compensator)
    return -ll if np.isfinite(ll) else 1e10


def poisson_log_likelihood(t: np.ndarray, T: float) -> tuple[float, float]:
    """Homogeneous Poisson MLE: rate = n/T."""
    n = len(t)
    rate = n / T if T > 0 else 0.0
    if rate <= 0:
        return float("-inf"), 0.0
    return float(n * np.log(rate) - rate * T), float(rate)


def fit_hawkes(event_times: np.ndarray, T: float | None = None) -> HawkesFit:
    """Fit an exponential-kernel Hawkes process by maximum likelihood."""
    t = np.sort(np.asarray(event_times, dtype=float))
    t = t[np.isfinite(t)]
    if len(t) < 30:
        raise ValueError(f"need >=30 events to fit, got {len(t)}")
    t = t - t[0]
    T = float(T if T is not None else t[-1] * 1.001)
    n = len(t)

    ll_pois, rate = poisson_log_likelihood(t, T)

    best = None
    # Several starts: the Hawkes likelihood is not convex and a single start
    # can settle on alpha ~ 0, which would understate excitation.
    for a0 in (0.2, 0.5, 0.8):
        for b0 in (0.5, 2.0, 10.0):
            x0 = np.array([max(rate * (1 - a0), 1e-6), a0, b0])
            try:
                res = minimize(
                    hawkes_log_likelihood, x0, args=(t, T), method="L-BFGS-B",
                    bounds=[(1e-9, None), (0.0, 0.999), (1e-6, None)],
                )
            except Exception:
                continue
            if res.success and np.isfinite(res.fun) and (best is None or res.fun < best.fun):
                best = res
    if best is None:
        raise RuntimeError("Hawkes optimisation failed from every start")

    mu, alpha, beta = (float(v) for v in best.x)
    ll_hawkes = float(-best.fun)
    lr = 2.0 * (ll_hawkes - ll_pois)
    p = float(stats.chi2.sf(max(lr, 0.0), df=2))

    return HawkesFit(
        mu=round(mu, 8), alpha=round(alpha, 6), beta=round(beta, 6),
        log_likelihood=round(ll_hawkes, 3), poisson_log_likelihood=round(ll_pois, 3),
        lr_statistic=round(lr, 3), lr_p_value=round(p, 8), beats_poisson=bool(p < 0.01),
        branching_ratio=round(alpha, 6), stationary=bool(alpha < 1.0),
        mean_excitation_life=round(1.0 / beta if beta > 0 else float("inf"), 4),
        n_events=int(n), horizon=round(T, 4), converged=bool(best.success),
    )


def rescaled_times(event_times: np.ndarray, fit: HawkesFit) -> np.ndarray:
    """Ogata residuals: compensator increments between consecutive events.

    Under a correct model these are iid Exp(1).
    """
    t = np.sort(np.asarray(event_times, dtype=float))
    t = t - t[0]
    mu, alpha, beta = fit.mu, fit.alpha, fit.beta

    def compensator(x: float, upto: np.ndarray) -> float:
        return mu * x + alpha * float(np.sum(1.0 - np.exp(-beta * (x - upto))))

    out = np.zeros(len(t) - 1)
    for i in range(1, len(t)):
        prior = t[:i]
        out[i - 1] = compensator(t[i], prior) - compensator(t[i - 1], t[:i - 1] if i > 1 else np.array([]))
    return out


def goodness_of_fit(event_times: np.ndarray, fit: HawkesFit) -> dict:
    """Time-rescaling test: are the Ogata residuals Exp(1)?"""
    tau = rescaled_times(event_times, fit)
    tau = tau[np.isfinite(tau) & (tau >= 0)]
    if len(tau) < 50:
        return {"available": False, "reason": f"only {len(tau)} residuals"}
    ks_stat, ks_p = stats.kstest(tau, "expon", args=(0, 1))
    return {
        "available": True, "n": int(len(tau)),
        "ks_stat": round(float(ks_stat), 5), "ks_p_value": round(float(ks_p), 6),
        "exponential_by_ks": bool(ks_p > 0.05),
        "mean": round(float(tau.mean()), 4), "expected_mean": 1.0,
        "note": "iid Exp(1) residuals => the fitted intensity is correctly specified",
    }


def expected_offspring(fit: HawkesFit, horizon: float) -> dict:
    """Expected additional events triggered by one event within `horizon`.

    Direct offspring only decay as exp(-beta t); the total across all
    generations is the geometric sum alpha/(1-alpha), which is the quantity
    that matters for a cascade.
    """
    if not fit.stationary:
        return {"available": False, "reason": "branching ratio >= 1; process is explosive"}
    direct = fit.alpha * (1.0 - float(np.exp(-fit.beta * horizon)))
    return {
        "available": True,
        "direct_offspring_within_horizon": round(float(direct), 4),
        "total_offspring_all_generations": round(fit.alpha / (1.0 - fit.alpha), 4),
        "cascade_multiplier": round(1.0 / (1.0 - fit.alpha), 4),
        "excitation_half_life": round(float(np.log(2) / fit.beta), 4) if fit.beta > 0 else None,
    }
