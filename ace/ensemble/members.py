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


def hawkes_intensity_now(fit: HawkesFit, history: np.ndarray, s: np.ndarray,
                         *, include_origin: bool = False) -> np.ndarray:
    """Conditional intensity at each time in `s`, given events strictly before.

    lambda(s) = mu + alpha*beta*sum_{t_i < s} exp(-beta*(s - t_i))

    `include_origin=True` also counts events AT s — the right limit, which is
    the state a forecast of (s, s+h] made at the close of s starts from.
    """
    history = np.sort(np.asarray(history, dtype=float))
    s = np.asarray(s, dtype=float)
    out = np.full(len(s), fit.mu, dtype=float)
    if len(history) == 0:
        return out
    idx = np.searchsorted(history, s, side="right" if include_origin else "left")
    for k, (si, upto) in enumerate(zip(s, idx)):
        if upto == 0:
            continue
        past = history[:upto]
        out[k] = fit.mu + fit.alpha * fit.beta * float(np.sum(np.exp(-fit.beta * (si - past))))
    return out


def hawkes_event_probability(fit: HawkesFit, history: np.ndarray, s: np.ndarray,
                             horizon: float) -> np.ndarray:
    """P(at least one event in (s, s+h]) from the fitted cascade — exact.

    The FIRST arrival after s can only be driven by what is already known:
    until it happens, no new event exists to excite anything, so along the
    no-arrival path the intensity simply decays from its value just after s,

        lambda(s+u) = mu + (lambda(s+) - mu) * exp(-beta u),

    and P(no event in (s, s+h]) = exp(-Lambda0) with

        Lambda0 = mu h + (lambda(s+) - mu) (1 - exp(-beta h)) / beta.

    An earlier version integrated the EXPECTED intensity including every
    generation of offspring and used that expected count as the compensator,
    which is not the first-arrival probability of a self-exciting process: with
    no history and mu=.05, alpha=.8, beta=1, h=5 it gave 0.4609 where the
    answer is 1 - exp(-.05*5) = 0.2212 (the first event must be an immigrant).

    Conditioning: events AT s are included. The forecast is made at the close
    of s and the window it answers for starts after s.
    """
    if not (0 <= fit.alpha < 1):
        raise ValueError(f"branching ratio {fit.alpha} outside [0, 1) — not stationary")
    if fit.beta <= 0:
        raise ValueError("degenerate decay; the fit is not usable for forecasting")
    lam = hawkes_intensity_now(fit, history, s, include_origin=True)
    compensator = fit.mu * horizon + (lam - fit.mu) * (1.0 - np.exp(-fit.beta * horizon)) / fit.beta
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
