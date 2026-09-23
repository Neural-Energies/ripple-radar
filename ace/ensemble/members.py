"""Ensemble members: every engine, asked the same question.

ACE's engines forecast different things — a volatility level, an event
intensity, a cumulative incidence — and averaging quantities in different
units is meaningless. So each is adapted to answer one question:

    P(at least one material move in this channel within the next h sessions)

where "material" is the |return| >= 2 sigma definition the cascade and DBN
engines already use, standardized by trailing volatility so it means the same
thing in 2013 and 2020.

Each member returns a probability per day, from information available that
day. What they disagree about is then a real disagreement rather than a units
problem, and the ensemble has something to weigh.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ace.cascade.hawkes import HawkesFit


def event_flags(returns: pd.Series, *, window: int = 60, sigma: float = 2.0) -> pd.Series:
    """1 on a material-move day, 0 otherwise, on the observed calendar."""
    from ace.data.series import standardize
    z = standardize(returns, window)
    return (z.abs() >= sigma).astype(float).where(z.notna())


def forward_any_event(flags: pd.Series, horizon: int) -> pd.Series:
    """The label: was there at least one event in the next `horizon` sessions?

    Reversed rolling so the window at t covers t+1..t+h and never t itself —
    an off-by-one here would let the label include the day it is forecast from.
    """
    rev = flags[::-1]
    fwd = rev.rolling(horizon, min_periods=horizon).max()[::-1].shift(-1)
    return fwd


def base_rate_probability(index: pd.Index, rate: float) -> pd.Series:
    """The number to beat. Constant, and surprisingly hard to improve on."""
    return pd.Series(float(rate), index=index)


def markov_probability(flags: pd.Series, index: pd.Index, *,
                       p_after_event: float, p_after_calm: float) -> pd.Series:
    """Persistence only: did an event happen today?"""
    today = flags.reindex(index)
    return pd.Series(np.where(today > 0, p_after_event, p_after_calm), index=index)


def hawkes_intensity_now(fit: HawkesFit, history: np.ndarray, s: np.ndarray) -> np.ndarray:
    """Conditional intensity at each time in `s`, given events strictly before.

    lambda(s) = mu + alpha*beta*sum_{t_i < s} exp(-beta*(s - t_i))
    """
    history = np.sort(np.asarray(history, dtype=float))
    s = np.asarray(s, dtype=float)
    out = np.full(len(s), fit.mu, dtype=float)
    if len(history) == 0:
        return out
    idx = np.searchsorted(history, s, side="left")
    for k, (si, upto) in enumerate(zip(s, idx)):
        if upto == 0:
            continue
        past = history[:upto]
        out[k] = fit.mu + fit.alpha * fit.beta * float(np.sum(np.exp(-fit.beta * (si - past))))
    return out


def hawkes_event_probability(fit: HawkesFit, history: np.ndarray, s: np.ndarray,
                             horizon: float) -> np.ndarray:
    """P(at least one event in (s, s+h]) from the fitted cascade.

    For an exponential-kernel Hawkes process the expected intensity ahead has a
    closed form that already includes every generation of offspring:

        E[lambda(s+u) | F_s] = m + (lambda(s) - m) * exp(-beta(1-alpha) u)
        m = mu / (1 - alpha)

    Integrating over the horizon gives the expected count. Converting that to
    P(N >= 1) via 1 - exp(-Lambda) is the Poisson step, and it is an
    approximation here: a clustered process puts more mass on "several at once"
    and so slightly more on "none at all". It understates the probability, in
    a direction that calibration corrects and that never flatters the model.
    """
    if not (0 <= fit.alpha < 1):
        raise ValueError(f"branching ratio {fit.alpha} outside [0, 1) — not stationary")
    lam = hawkes_intensity_now(fit, history, s)
    m = fit.mu / (1.0 - fit.alpha)
    decay = fit.beta * (1.0 - fit.alpha)
    if decay <= 0:
        raise ValueError("degenerate decay; the fit is not usable for forecasting")
    compensator = m * horizon + (lam - m) * (1.0 - np.exp(-decay * horizon)) / decay
    compensator = np.clip(compensator, 0.0, None)
    return 1.0 - np.exp(-compensator)


def volatility_event_probability(sigma_ahead: np.ndarray, residuals: np.ndarray,
                                 *, threshold_sigma: float = 2.0,
                                 horizon: int = 5) -> np.ndarray:
    """P(at least one |move| >= threshold) from a volatility forecast.

    The threshold is defined against *trailing* volatility, so a forecast of
    higher volatility ahead than behind raises the chance of crossing it. The
    daily crossing probability comes from the empirical standardized residual
    distribution — the same filtered-historical-simulation step the scenario
    engine uses — rather than from a normal assumption, which understates
    tails by a factor of several at this threshold.
    """
    r = np.asarray(residuals, dtype=float)
    r = r[np.isfinite(r)]
    if len(r) < 100:
        raise ValueError(f"need >=100 standardized residuals, got {len(r)}")
    sigma_ahead = np.asarray(sigma_ahead, dtype=float)

    out = np.empty(len(sigma_ahead))
    for i, s in enumerate(sigma_ahead):
        if not np.isfinite(s) or s <= 0:
            out[i] = np.nan
            continue
        # A move is material when |forecast sigma * residual| >= threshold *
        # trailing sigma; trailing sigma is the unit sigma_ahead is expressed in.
        p_day = float(np.mean(np.abs(r * s) >= threshold_sigma))
        out[i] = 1.0 - (1.0 - p_day) ** horizon
    return out


def regime_event_probability(regime: pd.Series, index: pd.Index,
                             rates: dict[int, float], fallback: float) -> pd.Series:
    """P(event) conditional on the filtered volatility regime."""
    r = regime.reindex(index)
    return pd.Series([rates.get(int(v), fallback) if pd.notna(v) else fallback
                      for v in r], index=index)
