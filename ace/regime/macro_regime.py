"""Module 2 — probabilistic macro regimes from the Module 1 factors.

A REGIME ENGINE THAT OUTPUTS ONE LABEL IS NOT A REGIME ENGINE

The quad work already ships a deterministic label, and measuring it was
instructive: 190 of 302 readings sat close enough to the boundary that a
revision flipped them, and the median spell lasted two months. A single label
on data that marginal is a coin flip presented as a state. This module answers
with probabilities instead, and with a transition matrix that says how long a
state has historically lasted.

THE SPECIFICATION, AND THE ASSUMPTION IN IT

statsmodels' Markov switching is univariate, so the joint growth/inflation
regime is built from two univariate fits whose filtered probabilities are
multiplied:

    P(growth state g AND inflation state i)  =  P(g) x P(i)

That is an INDEPENDENCE ASSUMPTION and it is almost certainly false —
stagflation exists precisely because the two processes interact.
`independence_check()` measures how false: it compares the implied joint
against the empirical joint frequency of the fitted states and reports the
largest deviation. A caller that ignores that number is quoting a joint
probability whose error nobody looked at.

The honest alternative is a multivariate Markov-switching model, which
statsmodels does not provide and which this module does not hand-roll. That is
recorded in the plan as a known limitation rather than hidden.

LABELS COME AFTER ESTIMATION, NEVER BEFORE

The model finds states; it has no idea what "reflation" means. Each state is
named by where its ESTIMATED MEAN sits, which is interpretation applied to a
fitted parameter — the same direction `ace/regime/markov.py` established for
volatility regimes. Hardcoding a taxonomy into the estimator would be assuming
the answer, which the brief forbids and which would make the output unfalsifiable.

FILTERED ONLY, FOR ANYTHING LIVE

`smoothed_marginal_probabilities` conditions on the entire sample including the
future. It looks dramatically better and it is unusable in real time. Every
live-facing figure here comes from filtered probabilities; the smoothed series
is exposed for research and for labelling, and is named so nobody confuses them.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd
from statsmodels.tsa.regime_switching.markov_regression import MarkovRegression

from ace.regime.markov import regime_params

#: Monthly macro factors are far shorter than daily returns. Two states over
#: this many months is already thin; below it the transition matrix is
#: estimated from a handful of switches.
MIN_OBS = 120

#: Restarts for the likelihood search. Markov-switching MLE is badly
#: multi-modal and a single start collapses often: on a synthetic series with
#: true means -2.0 and +2.0 it returned two states with means 0.068 and 0.020,
#: variances 4.22 and 4.23, a near-uniform transition matrix — and
#: `converged: True`. That is one state wearing two labels, and nothing in the
#: result object says so.
SEARCH_REPS = 24

#: Log-likelihood window within which two optima count as the same one. Used to
#: report how many restarts actually found the best mode.
LLF_TIE = 1e-4

#: A macro taxonomy ("reflation", "inflationary slowdown") is a claim about
#: the LEVEL of growth and inflation. Applying those names to states that
#: differ only in variance is mislabelling, so the taxonomy is gated on the
#: states being mean-separated by at least this much.
#:
#: Measured on these factors, neither axis clears it: growth's states differ by
#: 0.17 pooled standard deviations and inflation's by 0.04, while their
#: variances differ by 400x and 5x. The regimes in this data are calm versus
#: turbulent, not fast versus slow.
TAXONOMY_SEPARATION = 0.50

#: Separation below this many pooled standard deviations is reported as thin.
#: It is a DIAGNOSTIC, not the degeneracy test — pure Gaussian noise fits to a
#: separation of about 0.73 here, because the search happily splits a single
#: distribution into a low-mean/low-variance state and a high-mean/high-variance
#: one. Any fixed threshold that called that degenerate would have been chosen
#: to make one example come out right.
THIN_SEPARATION = 0.75

#: A state must last this long, in expectation, to be a regime rather than an
#: outlier bucket. Six months is one quad cycle in the existing macro stack.
#:
#: Not hypothetical. On the full 89-series panel the growth factor separates its
#: two state means by 1.11 pooled standard deviations — comfortably past
#: TAXONOMY_SEPARATION — and holds the low state for 1.1 months against 35.5 for
#: the high one, with a 143x variance ratio. That is not a growth regime; it is
#: April 2020 given a state of its own. Without this floor the taxonomy gate
#: would have passed it and named a quad off it.
MIN_REGIME_MONTHS = 6.0

#: The joint taxonomy, keyed by (growth state is high, inflation state is high).
#: These are the brief's candidate names, assigned to sign combinations rather
#: than to anything the estimator was told in advance.
TAXONOMY: dict[tuple[bool, bool], str] = {
    (True, False): "disinflationary_expansion",   # the brief's "soft landing"
    (True, True): "reflation",
    (False, True): "inflationary_slowdown",
    (False, False): "disinflationary_slowdown",   # the brief's "contraction"
}

TAXONOMY_NOTE: dict[str, str] = {
    "disinflationary_expansion": "Growth in its higher state while inflation is in its lower one.",
    "reflation": "Both growth and inflation in their higher states.",
    "inflationary_slowdown": "Inflation in its higher state while growth is in its lower one.",
    "disinflationary_slowdown": "Both growth and inflation in their lower states.",
}


@dataclass
class AxisFit:
    """One univariate Markov-switching fit — growth, or inflation."""

    axis: str
    n_states: int
    n_obs: int
    converged: bool
    llf: float
    aic: float
    bic: float
    #: Estimated state means, in factor standard deviations.
    means: list[float]
    variances: list[float]
    #: Row-stochastic: P[i][j] = P(next = j | current = i).
    transition: list[list[float]]
    #: Expected months in each state, 1 / (1 - P_ii).
    expected_duration: list[float]
    #: Which state index is the HIGH-mean one. Derived, not assumed.
    high_state: int
    labels: list[str]
    #: |mean difference| in pooled standard deviations. The single number that
    #: says whether this is a regime model or a one-state model in disguise.
    separation: float = float("nan")
    #: True when separation is thin. A diagnostic, not a verdict.
    thin: bool = False
    #: Does the SHORTER-lived state last at least `MIN_REGIME_MONTHS`? A
    #: one-month state is a single observation wearing a regime's clothes.
    #: Defaults False so an AxisFit built without it is treated as unproven
    #: rather than as persistent.
    persistent: bool = False
    #: True when the states differ enough in MEAN to carry a level-based name.
    #: False means the fit found volatility regimes, and any growth_high /
    #: growth_low label on it would be describing something it did not estimate.
    mean_separated: bool = False
    #: BIC of a one-state (constant mean and variance) baseline on the same data.
    bic_one_state: float = float("nan")
    #: Restarts attempted, and how many reached the best optimum. One-of-many is
    #: a warning: the likelihood surface has a narrow global mode and a small
    #: change in the data may land the fit somewhere else entirely.
    n_starts: int = 0
    n_at_best: int = 0
    #: True when the two-state model does NOT beat that baseline on BIC — the
    #: model cannot pay for its extra parameters, so it is describing one
    #: distribution. `build_regime_state` says so rather than rendering it.
    degenerate: bool = False
    #: P(state | data up to t). The only series that may drive a live readout.
    filtered: pd.DataFrame = field(default_factory=pd.DataFrame, repr=False)
    #: P(state | the whole sample). Research and labelling only.
    smoothed: pd.DataFrame = field(default_factory=pd.DataFrame, repr=False)

    def to_dict(self) -> dict:
        d = asdict(self)
        d.pop("filtered", None)
        d.pop("smoothed", None)
        return d


def _label_by_mean(means: list[float], axis: str) -> tuple[list[str], int]:
    """Name states by their estimated mean, and say which one is high.

    Interpretation applied to a fitted parameter, after the fact. The estimator
    was never told which state should be which.
    """
    high = int(np.argmax(means))
    if axis == "growth":
        names = ["growth_low", "growth_high"]
    elif axis == "inflation":
        names = ["inflation_low", "inflation_high"]
    else:
        names = [f"{axis}_low", f"{axis}_high"]
    out = [names[0]] * len(means)
    out[high] = names[1]
    return out, high


def fit_axis(
    factor: pd.Series, *, axis: str, n_states: int = 2, seed: int = 17
) -> AxisFit:
    """Markov switching in MEAN on one macro factor.

    Switching mean rather than switching variance: a macro factor's regime is
    about the level it reverts to, not about how noisy it is. Variance is left
    switching too, because a contraction is both lower and more volatile and
    forcing equal variances would make the fit attribute that to the mean.
    """
    y = pd.Series(factor).dropna()
    if len(y) < MIN_OBS:
        raise ValueError(
            f"{axis}: need >={MIN_OBS} monthly observations for a {n_states}-state fit, got {len(y)}"
        )
    model = MarkovRegression(
        y.to_numpy(dtype=float), k_regimes=n_states, trend="c", switching_variance=True
    )
    res, n_best = _best_of_many(model, seed=seed, reps=SEARCH_REPS)

    # By name, never by position: `res.params[:k]` is the transition block.
    means, variances = regime_params(res, n_states)
    # statsmodels returns P[i, j] = P(next = i | current = j); transpose so the
    # matrix reads row = current, column = next, as every consumer expects.
    P = np.asarray(res.regime_transition).reshape(n_states, n_states).T
    durations = [float(1.0 / max(1e-9, 1.0 - P[i, i])) for i in range(n_states)]
    labels, high = _label_by_mean(means, axis)

    # Separation, in pooled standard deviations — reported as a diagnostic.
    pooled = float(np.sqrt(np.mean(variances))) if variances else float("nan")
    separation = (
        abs(max(means) - min(means)) / pooled
        if pooled and np.isfinite(pooled) and pooled > 0 else float("nan")
    )

    # The actual degeneracy test: does the switching model beat a ONE-STATE
    # baseline on BIC? That is the comparison the brief demands of every model,
    # and it answers the right question — a two-state fit that cannot pay for
    # its extra parameters is describing one distribution, whatever its state
    # means look like. A fixed separation threshold cannot do this, because the
    # search splits pure noise into two plausible-looking states.
    bic_one = _one_state_bic(y)
    degenerate = not np.isfinite(bic_one) or float(res.bic) >= bic_one

    filtered = _prob_frame(res.filtered_marginal_probabilities, y.index, labels)
    smoothed = _prob_frame(res.smoothed_marginal_probabilities, y.index, labels)

    return AxisFit(
        axis=axis,
        n_states=n_states,
        n_obs=int(len(y)),
        converged=bool(res.mle_retvals.get("converged", False)),
        llf=round(float(res.llf), 4),
        aic=round(float(res.aic), 4),
        bic=round(float(res.bic), 4),
        means=[round(m, 6) for m in means],
        variances=[round(v, 8) for v in variances],
        transition=[[round(float(P[i, j]), 6) for j in range(n_states)] for i in range(n_states)],
        expected_duration=[round(d, 2) for d in durations],
        high_state=high,
        labels=labels,
        separation=round(float(separation), 4) if np.isfinite(separation) else float("nan"),
        thin=bool(not np.isfinite(separation) or separation < THIN_SEPARATION),
        persistent=bool(durations and min(durations) >= MIN_REGIME_MONTHS),
        mean_separated=bool(np.isfinite(separation) and separation >= TAXONOMY_SEPARATION),
        bic_one_state=round(float(bic_one), 4) if np.isfinite(bic_one) else float("nan"),
        n_starts=SEARCH_REPS,
        n_at_best=int(n_best),
        degenerate=bool(degenerate),
        filtered=filtered,
        smoothed=smoothed,
    )


def _best_of_many(model, *, seed: int, reps: int):
    """Deterministic multi-start MLE, keeping the highest likelihood.

    statsmodels' own `search_reps` is not reproducible here: the same data gave
    three different optima across three calls, and perturbing the ambient
    `np.random` state changed the answer again — so test ORDER could change a
    fitted model. The brief requires reproducibility, so the search is owned
    here instead.

    Starting values are drawn from a seeded `Generator` and perturb the model's
    own default start, which keeps every draw valid for the parameter space
    without hand-constructing transition probabilities. Each candidate is fitted
    with the random search switched off, so the only randomness in the whole
    procedure is the seeded draw.

    Returns the best result and how many starts reached it — one-of-many means
    the global mode is narrow and the fit is fragile.
    """
    rng = np.random.default_rng(seed)
    base = np.asarray(model.start_params, dtype=float)

    best = None
    best_llf = -np.inf
    at_best = 0
    for rep in range(max(1, reps)):
        start = base if rep == 0 else base * (1.0 + rng.normal(0.0, 0.25, base.shape))
        try:
            candidate = model.fit(start_params=start, disp=False, search_reps=0)
        except Exception:  # noqa: BLE001 — a bad start is a bad start, not a failure
            continue
        llf = float(candidate.llf)
        if not np.isfinite(llf):
            continue
        if llf > best_llf + LLF_TIE:
            best, best_llf, at_best = candidate, llf, 1
        elif abs(llf - best_llf) <= LLF_TIE:
            at_best += 1

    if best is None:
        # Every start failed. Fall back to the plain fit so the caller gets a
        # real error from statsmodels rather than a None.
        return model.fit(disp=False, search_reps=0), 0
    return best, at_best


def _one_state_bic(y: pd.Series) -> float:
    """BIC of a single Gaussian with a constant mean and variance.

    The baseline every switching fit must beat. Two free parameters, and the
    maximised log-likelihood of an iid normal has a closed form, so this needs
    no optimiser and cannot itself fail to converge.
    """
    values = np.asarray(pd.Series(y).dropna(), dtype=float)
    n = values.size
    if n < 3:
        return float("nan")
    sigma2 = float(np.var(values, ddof=0))
    if sigma2 <= 0:
        return float("nan")
    llf = -0.5 * n * (np.log(2.0 * np.pi * sigma2) + 1.0)
    k = 2  # mean and variance
    return float(k * np.log(n) - 2.0 * llf)


def _prob_frame(raw, index: pd.Index, labels: list[str]) -> pd.DataFrame:
    """Normalise statsmodels' probability output to (time x state)."""
    arr = np.asarray(raw)
    if arr.ndim == 1:
        arr = arr.reshape(-1, 1)
    if arr.shape[0] == len(labels) and arr.shape[1] == len(index):
        arr = arr.T
    n = min(len(index), arr.shape[0])
    return pd.DataFrame(arr[:n], index=index[:n], columns=labels)


def joint_probabilities(growth: AxisFit, inflation: AxisFit, *, use: str = "filtered") -> pd.DataFrame:
    """P(regime) over the four-name taxonomy, on the common months.

    `use="filtered"` is the only setting valid for anything live. `use="smoothed"`
    is for research and is named so the choice is visible at the call site.
    """
    if use not in {"filtered", "smoothed"}:
        raise ValueError("use must be 'filtered' or 'smoothed'")
    g = getattr(growth, use)
    i = getattr(inflation, use)
    if g.empty or i.empty:
        return pd.DataFrame()
    idx = g.index.intersection(i.index)
    if len(idx) == 0:
        return pd.DataFrame()

    g_high = g.loc[idx, growth.labels[growth.high_state]]
    i_high = i.loc[idx, inflation.labels[inflation.high_state]]
    out = pd.DataFrame(index=idx)
    for (gh, ih), name in TAXONOMY.items():
        pg = g_high if gh else (1.0 - g_high)
        pi = i_high if ih else (1.0 - i_high)
        out[name] = (pg * pi).astype(float)
    # Rows sum to one by construction; normalise anyway so float error cannot
    # put a probability distribution off by 1e-12 on screen. Guard the divide:
    # when every cell underflows to exactly zero the sum is zero, and dividing
    # would turn a whole row into NaN — a row of NaN is not a distribution and
    # would fail silently downstream as "not >= 0".
    totals = out.sum(axis=1)
    safe = totals.where(totals > 0)
    normalised = out.div(safe, axis=0).fillna(0.0)
    # Clip at zero. Multiplying two probabilities and renormalising can land a
    # cell at -2.2e-16, which is float noise but is still a negative number in
    # something the caller is entitled to treat as a distribution.
    return normalised.clip(lower=0.0)


def independence_check(growth: AxisFit, inflation: AxisFit) -> dict:
    """How wrong the independence assumption is, measured rather than assumed.

    Compares the joint implied by multiplying the two marginals against the
    empirical joint frequency of the hard-assigned states. A large deviation
    does not invalidate the marginals — it means the JOINT probabilities are
    biased, most likely understating the two off-diagonal regimes where growth
    and inflation move oppositely.
    """
    g, i = growth.smoothed, inflation.smoothed
    if g.empty or i.empty:
        return {"available": False, "reason": "no smoothed probabilities"}
    idx = g.index.intersection(i.index)
    if len(idx) < 24:
        return {"available": False, "reason": f"only {len(idx)} common months"}

    g_state = (g.loc[idx].to_numpy().argmax(axis=1) == growth.high_state)
    i_state = (i.loc[idx].to_numpy().argmax(axis=1) == inflation.high_state)
    n = len(idx)

    empirical, implied = {}, {}
    p_g = float(g_state.mean())
    p_i = float(i_state.mean())
    for (gh, ih), name in TAXONOMY.items():
        empirical[name] = float(((g_state == gh) & (i_state == ih)).mean())
        implied[name] = float((p_g if gh else 1 - p_g) * (p_i if ih else 1 - p_i))

    deviations = {k: round(empirical[k] - implied[k], 4) for k in empirical}
    worst = max(deviations, key=lambda k: abs(deviations[k]))
    # Chi-square on the 2x2 of hard assignments — a direct test of whether the
    # two state processes are independent at all.
    table = np.array([
        [((~g_state) & (~i_state)).sum(), ((~g_state) & i_state).sum()],
        [(g_state & (~i_state)).sum(), (g_state & i_state).sum()],
    ], dtype=float)
    # Regime states are highly autocorrelated, so the nominal month count
    # overstates how much independent evidence there is. A chi-square run on
    # the raw counts over-rejects badly — two independently generated series
    # were flagged dependent purely because each was persistent. Scale the
    # statistic by an effective sample size instead.
    n_eff = _effective_n(g_state, i_state)
    chi2, p_value = _chi2_independence(table * (n_eff / max(n, 1)))

    return {
        "available": True,
        "n_months": int(n),
        "empirical": {k: round(v, 4) for k, v in empirical.items()},
        "implied_by_independence": {k: round(v, 4) for k, v in implied.items()},
        "deviation": deviations,
        "worst_regime": worst,
        "max_abs_deviation": round(abs(deviations[worst]), 4),
        "chi2": round(float(chi2), 4),
        "p_value": round(float(p_value), 6),
        "n_effective": round(float(n_eff), 1),
        "independent_at_5pct": bool(p_value > 0.05),
        "note": (
            "The joint probabilities multiply two univariate fits. Where this "
            "deviation is large the joint is biased even though each marginal "
            "is not."
        ),
    }


def _effective_n(a: np.ndarray, b: np.ndarray) -> float:
    """Sample size adjusted for the persistence of two state indicators.

    The standard correction for autocorrelated series:

        n_eff = n x (1 - r_a x r_b) / (1 + r_a x r_b)

    with r the lag-1 autocorrelation of each indicator. Regime states persist
    for years, so r is near one and n_eff is a small fraction of n. Testing on
    the nominal count treats every month as fresh evidence and rejects
    independence on two unrelated series.
    """
    def _rho(x: np.ndarray) -> float:
        z = np.asarray(x, dtype=float)
        if z.size < 3:
            return 0.0
        z = z - z.mean()
        denom = float((z * z).sum())
        if denom <= 0:
            return 0.0
        return float((z[:-1] * z[1:]).sum() / denom)

    n = float(min(len(a), len(b)))
    prod = _rho(a) * _rho(b)
    prod = max(-0.99, min(0.99, prod))
    return max(4.0, n * (1.0 - prod) / (1.0 + prod))


def _chi2_independence(table: np.ndarray) -> tuple[float, float]:
    """Pearson chi-square for a 2x2 contingency table, 1 degree of freedom."""
    total = table.sum()
    if total <= 0:
        return float("nan"), float("nan")
    rows = table.sum(axis=1, keepdims=True)
    cols = table.sum(axis=0, keepdims=True)
    expected = rows @ cols / total
    if (expected <= 0).any():
        return float("nan"), float("nan")
    chi2 = float(((table - expected) ** 2 / expected).sum())
    # Survival function of chi-square with 1 df, without importing scipy.stats
    # for a single call: P(X > x) = erfc(sqrt(x/2)).
    from math import erfc, sqrt

    return chi2, float(erfc(sqrt(chi2 / 2.0)))


@dataclass
class MacroRegimeState:
    """The Module 2 output contract."""

    as_of: str
    #: Current probability per regime, from FILTERED probabilities.
    probabilities: dict[str, float]
    #: The same, one month earlier — the brief's "previous probability".
    previous: dict[str, float]
    change: dict[str, float]
    leading: str
    leading_probability: float
    #: Months the leading regime has historically lasted, from the transition
    #: matrices of the two axes.
    expected_duration_months: float | None
    basis: str = "filtered (information available at t only)"
    taxonomy_note: dict[str, str] = field(default_factory=lambda: dict(TAXONOMY_NOTE))
    independence: dict = field(default_factory=dict)
    axes: dict[str, dict] = field(default_factory=dict)
    drivers: list[dict] = field(default_factory=list)
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        return asdict(self)


def _axis_notes(*fits: AxisFit) -> list[str]:
    """Per-axis warnings, computed once so BOTH return paths carry them.

    These used to be built only on the path that renders a taxonomy, which meant
    withholding the taxonomy also swallowed them. A fit of pure Gaussian noise
    then reported "the states do not persist" and said nothing about the more
    fundamental problem — that the two-state model does not beat a one-state
    baseline at all. The weaker finding hid the stronger one.
    """
    notes: list[str] = []
    for f in fits:
        if f.degenerate:
            notes.append(
                f"the {f.axis} axis is DEGENERATE — its two-state fit (BIC {f.bic:.1f}) "
                f"does not beat a one-state baseline (BIC {f.bic_one_state:.1f}). "
                "It is describing one distribution, and nothing derived from it "
                "should drive anything."
            )
        elif f.n_at_best <= 1 and f.n_starts > 1:
            notes.append(
                f"the {f.axis} axis found its best optimum from only "
                f"{f.n_at_best} of {f.n_starts} starts — the likelihood surface "
                "is multi-modal here and the fit is fragile to small data changes."
            )
        elif f.thin:
            notes.append(
                f"the {f.axis} axis is THIN — its states differ by only "
                f"{f.separation:.2f} pooled standard deviations, so the two are "
                "close enough that month-to-month assignment will be unstable."
            )
        if not f.converged:
            notes.append(
                f"the {f.axis} axis did not converge; treat its states as provisional"
            )
    return notes


def build_regime_state(
    growth: AxisFit,
    inflation: AxisFit,
    *,
    drivers: list[dict] | None = None,
) -> MacroRegimeState:
    """Assemble the current regime reading from two fitted axes."""
    joint = joint_probabilities(growth, inflation, use="filtered")
    if joint.empty:
        return MacroRegimeState(
            as_of="", probabilities={}, previous={}, change={}, leading="",
            leading_probability=float("nan"), expected_duration_months=None,
            notes=("no overlapping filtered probabilities",),
        )

    # The taxonomy names LEVELS. If the fitted states are not mean-separated,
    # the model found volatility regimes and these names do not describe it.
    # Refusing here is the difference between reporting a result and dressing
    # one up: the probabilities are real, but "reflation" would not be.
    # Two ways an axis fails to describe a LEVEL regime, and both have to be
    # checked: states that are not mean-separated (a volatility regime), and
    # states that are mean-separated but last a month (an outlier bucket).
    unsupported = [
        f.axis for f in (growth, inflation)
        if not f.mean_separated or not f.persistent
    ]
    if unsupported:
        return MacroRegimeState(
            as_of=str(pd.Timestamp(joint.index.max()).date()),
            probabilities={}, previous={}, change={},
            leading="", leading_probability=float("nan"),
            expected_duration_months=None,
            independence=independence_check(growth, inflation),
            axes={"growth": growth.to_dict(), "inflation": inflation.to_dict()},
            drivers=list(drivers or []),
            notes=tuple(
                _axis_notes(growth, inflation)
                + [
                    "TAXONOMY WITHHELD. "
                    + "; ".join(
                        (
                            f"the {f.axis} axis separates its states by only "
                            f"{f.separation:.2f} pooled standard deviations in MEAN "
                            f"(variances {min(f.variances):.2f} vs "
                            f"{max(f.variances):.2f}), which is a volatility regime "
                            f"rather than a level one"
                        )
                        if not f.mean_separated else (
                            f"the {f.axis} axis separates its means by "
                            f"{f.separation:.2f} SD but its shorter state lasts "
                            f"{min(f.expected_duration):.1f} months, which is an "
                            f"outlier given a state of its own rather than a regime"
                        )
                        for f in (growth, inflation)
                        if not f.mean_separated or not f.persistent
                    )
                    + f". The floors are {TAXONOMY_SEPARATION} pooled SD of mean "
                    f"separation and {MIN_REGIME_MONTHS} months of expected "
                    "duration; names like 'reflation' would describe something "
                    "the model did not estimate."
                ]
            ),
        )

    current = joint.iloc[-1]
    prior = joint.iloc[-2] if len(joint) >= 2 else current
    leading = str(current.idxmax())
    gh, ih = next(k for k, v in TAXONOMY.items() if v == leading)

    # Expected duration of the joint state under independence: the two axes
    # must BOTH persist, so the joint survival is the product of the diagonals.
    pg = growth.transition[growth.high_state if gh else 1 - growth.high_state][
        growth.high_state if gh else 1 - growth.high_state
    ]
    pi = inflation.transition[inflation.high_state if ih else 1 - inflation.high_state][
        inflation.high_state if ih else 1 - inflation.high_state
    ]
    stay = float(pg) * float(pi)
    duration = float(1.0 / max(1e-9, 1.0 - stay))

    notes: list[str] = _axis_notes(growth, inflation)
    check = independence_check(growth, inflation)
    if check.get("available") and not check.get("independent_at_5pct", True):
        notes.append(
            f"growth and inflation states are NOT independent (chi2 p={check['p_value']}); "
            f"the joint understates {check['worst_regime']} by "
            f"{abs(check['deviation'][check['worst_regime']]):.3f}"
        )

    return MacroRegimeState(
        as_of=str(pd.Timestamp(joint.index.max()).date()),
        probabilities={k: round(float(v), 4) for k, v in current.items()},
        previous={k: round(float(v), 4) for k, v in prior.items()},
        change={k: round(float(current[k] - prior[k]), 4) for k in current.index},
        leading=leading,
        leading_probability=round(float(current[leading]), 4),
        expected_duration_months=round(duration, 2),
        independence=check,
        axes={"growth": growth.to_dict(), "inflation": inflation.to_dict()},
        drivers=list(drivers or []),
        notes=tuple(notes),
    )
