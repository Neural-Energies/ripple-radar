"""Regime detection with Markov switching (§18).

Why ACE needs this, empirically rather than theoretically: the transmission
validation found that 17% of significant cross-market edges FLIP SIGN between
2010-2019 and 2020-2026. SP500 -> UST10Y runs +0.37 in the first period and
-0.08 in the second; VIX -> UST10Y reverses the same way. That is the
stock-bond correlation regime change, and it means an edge estimated on one
period can point the wrong way in another. A model that does not know which
regime it is in will confidently draw the wrong arrow.

THE LOOK-AHEAD TRAP, stated because it is the single easiest way to fake this:
statsmodels reports both `smoothed_marginal_probabilities` and
`filtered_marginal_probabilities`. Smoothed probabilities condition on the
ENTIRE sample, including the future. They look dramatically better and they
are unusable in real time. Everything here that claims a real-time regime uses
FILTERED probabilities only, and a test asserts the two differ.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd
from statsmodels.tsa.regime_switching.markov_regression import MarkovRegression


@dataclass
class RegimeFit:
    n_regimes: int
    n_obs: int
    converged: bool
    log_likelihood: float
    aic: float
    bic: float
    regime_variance: list[float]
    regime_mean: list[float]
    transition_matrix: list[list[float]]
    expected_duration: list[float]
    labels: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


def _label_regimes(variances: list[float]) -> list[str]:
    """Name states AFTER estimating them (§18), by their realized variance.

    The model has no idea what "calm" means; it finds states. Ordering those
    states by variance and naming them is interpretation applied afterwards,
    which is the correct direction. Hardcoding a label into the estimator would
    be assuming the answer.
    """
    order = np.argsort(variances)
    names = (
        ["calm", "stressed"] if len(variances) == 2
        else ["calm", "transitional", "stressed"] if len(variances) == 3
        else [f"state_{i}" for i in range(len(variances))]
    )
    out = [""] * len(variances)
    for rank, idx in enumerate(order):
        out[int(idx)] = names[rank]
    return out


def regime_params(res, k: int) -> tuple[list[float], list[float]]:
    """Pull per-regime constants and variances BY NAME, never by position.

    statsmodels lays the parameter vector out as

        ['p[0->0]', 'p[1->0]', 'const[0]', 'const[1]', 'sigma2[0]', 'sigma2[1]']

    so `params[:k]` is the TRANSITION BLOCK, not the means. Reading the first k
    entries as regime means returns the transition probabilities instead — a
    defect that hides well, because the numbers are plausible, in [0, 1], and
    differ across regimes exactly as means would.

    It was caught with a synthetic series whose means were known to be -2.0 and
    +2.0: the "means" came back as 0.957 and 0.044, which were p[0->0] and
    p[1->0]. `ace/tests/test_macro_regime.py` pins that ground truth so the
    same mistake cannot return.

    Reading by name also survives a future statsmodels reordering, which
    positional indexing would not.
    """
    import numpy as _np

    names = list(getattr(res.model, "param_names", []) or [])
    values = _np.asarray(res.params, dtype=float)

    def _by(prefix: str) -> list[float]:
        out: list[float] = []
        for i in range(k):
            key = f"{prefix}[{i}]"
            if key in names:
                out.append(float(values[names.index(key)]))
            else:
                out.append(float("nan"))
        return out

    means = _by("const")
    variances = _by("sigma2")
    # With `switching_variance=False` the variance is shared and statsmodels
    # names it `sigma2` with no index. Spread that one value across the regimes
    # rather than reporting NaN — it is genuinely the variance of every state.
    if all(_np.isnan(variances)) and "sigma2" in names:
        shared = float(values[names.index("sigma2")])
        variances = [shared] * k
    if any(_np.isnan(means)) or any(_np.isnan(variances)):
        raise ValueError(
            "could not locate const[] / sigma2[] in the parameter vector; "
            f"names were {names!r} — refusing to guess by position"
        )
    return means, variances


def fit_regimes(returns: pd.Series, *, n_regimes: int = 2, seed: int = 17) -> tuple[MarkovRegression, RegimeFit]:
    """Markov-switching variance model on a return series.

    Switching variance with a constant mean is the standard volatility-regime
    specification: financial returns have little persistent mean structure but
    very persistent variance structure.
    """
    y = pd.Series(returns).dropna()
    if len(y) < 500:
        raise ValueError(f"need >=500 observations for a {n_regimes}-state fit, got {len(y)}")
    np.random.seed(seed)
    model = MarkovRegression(y.values, k_regimes=n_regimes, trend="c", switching_variance=True)
    res = model.fit(disp=False)

    # Read by NAME. `res.params[:k]` is the transition block, not the means —
    # see `regime_params`. This read the transition probabilities as regime
    # means until a synthetic ground-truth test caught it.
    means, variances = regime_params(res, n_regimes)
    P = np.asarray(res.regime_transition).reshape(n_regimes, n_regimes)
    # statsmodels returns P[i, j] = P(next=i | current=j); transpose to row-stochastic
    P = P.T
    durations = [float(1.0 / max(1e-9, 1.0 - P[i, i])) for i in range(n_regimes)]

    fit = RegimeFit(
        n_regimes=n_regimes,
        n_obs=int(len(y)),
        converged=bool(res.mle_retvals.get("converged", False)),
        log_likelihood=round(float(res.llf), 3),
        aic=round(float(res.aic), 3),
        bic=round(float(res.bic), 3),
        regime_variance=[round(v, 10) for v in variances],
        regime_mean=[round(m, 8) for m in means],
        transition_matrix=[[round(float(P[i, j]), 6) for j in range(n_regimes)] for i in range(n_regimes)],
        expected_duration=[round(d, 2) for d in durations],
        labels=_label_regimes(variances),
    )
    return res, fit


def filtered_probabilities(res) -> np.ndarray:
    """Real-time regime probabilities: P(state at t | data up to t).

    This is the only series that may drive a live regime readout.
    """
    return np.asarray(res.filtered_marginal_probabilities)


def smoothed_probabilities(res) -> np.ndarray:
    """P(state at t | the WHOLE sample). Research and labelling only.

    Never surface this as a current regime — it has seen the future.
    """
    return np.asarray(res.smoothed_marginal_probabilities)


def current_regime(res, fit: RegimeFit) -> dict:
    """Latest real-time regime estimate, from filtered probabilities only."""
    probs = filtered_probabilities(res)
    last = probs[-1] if probs.ndim == 2 else probs[:, -1]
    last = np.asarray(last).ravel()
    idx = int(np.argmax(last))
    P = np.asarray(fit.transition_matrix)
    return {
        "regime": fit.labels[idx],
        "regime_index": idx,
        "probability": round(float(last[idx]), 4),
        "all_probabilities": {fit.labels[i]: round(float(last[i]), 4) for i in range(len(last))},
        "expected_duration_days": fit.expected_duration[idx],
        "transition_probabilities": {fit.labels[j]: round(float(P[idx, j]), 4) for j in range(len(last))},
        "basis": "filtered (information available at t only)",
    }
