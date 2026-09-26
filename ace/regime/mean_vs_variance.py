"""Is a macro regime about the LEVEL a factor reverts to, or about how noisy it is?

WP3 answered "not the level" on a 14-series panel covering labor, growth,
consumption, housing starts and prices — with no liquidity, credit, financial
conditions or housing-finance block in it at all. That was a fair finding on
that panel and an unfair one about macro data, and the objection was obvious:
the blocks that would carry a level regime were missing.

This module is the re-test, and it is stricter than the original in the one
place the original was loose.

WHY "BEATS A ONE-STATE MODEL" IS NOT THE TEST

`fit_axis` compares a two-state switching-mean-AND-variance model against a
single Gaussian. Nearly every macro factor wins that comparison by a wide
margin — growth by 935 BIC points, credit by 3,179 — and it proves almost
nothing, because the winning model has TWO things the baseline lacks. Read the
fits and it is plain which one is doing the work: credit's states separate by
0.00 standard deviations in mean and by a factor of 10,180 in variance. That is
a volatility regime, and calling it a level regime because it beat a one-state
model is the error this module exists to prevent.

So the decisive comparison is not against one state. It is:

    switching mean AND variance     vs     switching VARIANCE ALONE

Both models have two states. Both let volatility change. The only difference is
whether the mean is allowed to move with the state. If the richer model cannot
pay for that one extra parameter per state on BIC, then the factor has no level
regime — whatever its two-state fit looked like next to a single Gaussian.

AND A PERSISTENCE FLOOR

A state with an expected duration near one month is not a regime, it is an
outlier bucket: the filter has found April 2020 and given it its own state.
Growth on the full panel separates its means by 1.11 SD and holds the low state
for 1.1 months against 35.5 for the high one, with a 143x variance ratio —
which is exactly what a one-month collapse looks like when a two-state model is
asked to describe it. `MIN_REGIME_MONTHS` refuses to call that a regime.

Run: `python -m ace.regime.mean_vs_variance`
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd
from statsmodels.tsa.regime_switching.markov_regression import MarkovRegression

from ace.config import ROOT
from ace.regime.macro_regime import (
    MIN_OBS,
    MIN_REGIME_MONTHS,
    SEARCH_REPS,
    _best_of_many,
    _one_state_bic,
)
from ace.regime.markov import regime_params

#: How far apart the two state means must sit, in pooled standard deviations,
#: before the difference is worth calling a level. Carried over from
#: `macro_regime.TAXONOMY_SEPARATION` so the two tests agree on the word.
MIN_MEAN_SEPARATION = 0.50

#: A state variance below this FRACTION of the series' own variance is a
#: likelihood spike, not an estimate. A Gaussian mixture's likelihood is
#: unbounded: drive one component's variance to zero on a point it passes
#: exactly and the density there goes to infinity. The optimiser will take that
#: deal, and the resulting BIC is arbitrarily good and completely meaningless.
#:
#: Measured, not assumed: the manufacturing factor's low-state variance
#: optimised to 1.9e-33 against a series variance of order one — a ratio of
#: 1e-33 — and reported BIC -11,808 against a one-state baseline of 1,162. Read
#: naively that is the strongest result in the table. It is a broken fit, and
#: the comparison built on it says nothing in either direction. 1e-8 sits a
#: very long way below any real macro factor and a very long way above a spike.
MIN_STATE_VARIANCE_FRACTION = 1e-8

#: BIC points by which the mean-switching model must beat the variance-only
#: one. Zero would let a coin-flip difference decide; two is the conventional
#: "positive evidence" step on the Kass-Raftery scale and costs nothing to
#: require.
MIN_BIC_GAIN = 2.0


@dataclass(frozen=True)
class SpecTest:
    """One factor, three specifications, and what separates them."""

    factor: str
    n_obs: int

    #: BIC of a single Gaussian — the floor every two-state model clears easily.
    bic_one_state: float
    #: BIC with the variance switching and the mean held constant.
    bic_switching_variance: float
    #: BIC with both switching. This is what `fit_axis` fits.
    bic_switching_mean: float

    #: The decisive number: how much the mean buys once variance already switches.
    mean_gain: float
    #: How much of the total gain over one state came from variance alone.
    variance_share: float

    means: list[float]
    variances: list[float]
    mean_separation: float
    #: max/min of the two state variances. NaN when a variance optimised to
    #: zero, which is a failed fit rather than an infinite ratio.
    variance_ratio: float
    expected_duration: list[float]
    converged: bool
    #: True when a fitted state variance collapsed toward zero. The BIC numbers
    #: on this row are then artefacts of an unbounded likelihood and must not be
    #: read as evidence for or against anything.
    variance_degenerate: bool = False

    @property
    def mean_pays(self) -> bool:
        return bool(np.isfinite(self.mean_gain) and self.mean_gain >= MIN_BIC_GAIN)

    @property
    def separated(self) -> bool:
        return bool(
            np.isfinite(self.mean_separation)
            and self.mean_separation >= MIN_MEAN_SEPARATION
        )

    @property
    def persistent(self) -> bool:
        return bool(
            self.expected_duration
            and min(self.expected_duration) >= MIN_REGIME_MONTHS
        )

    @property
    def level_regime(self) -> bool:
        """All three, because each alone is satisfiable by something else.

        A degenerate fit cannot establish one either. It cannot rule one out
        either — the honest reading is "unknown", and `verdict` says that rather
        than letting a False here read as "tested and rejected".
        """
        if self.variance_degenerate:
            return False
        return self.mean_pays and self.separated and self.persistent

    @property
    def verdict(self) -> str:
        if self.variance_degenerate:
            return (
                "INCONCLUSIVE — a state variance collapsed toward zero, so the "
                "likelihood spiked and both BIC figures are artefacts"
            )
        if self.level_regime:
            return "LEVEL REGIME"
        reasons = []
        if not self.mean_pays:
            reasons.append("mean buys nothing over switching variance")
        if not self.separated:
            reasons.append(f"means {self.mean_separation:.2f} SD apart")
        if not self.persistent:
            reasons.append(f"shortest state {min(self.expected_duration):.1f} months")
        return "; ".join(reasons)


def _fit(y: pd.Series, *, switching_trend: bool, seed: int):
    model = MarkovRegression(
        y.to_numpy(dtype=float),
        k_regimes=2,
        trend="c",
        switching_trend=switching_trend,
        switching_variance=True,
    )
    res, _ = _best_of_many(model, seed=seed, reps=SEARCH_REPS)
    return res


def assess_factor(factor: pd.Series, name: str, *, seed: int = 17) -> SpecTest:
    """Fit all three specifications on one factor and compare them."""
    y = pd.Series(factor).dropna()
    if len(y) < MIN_OBS:
        raise ValueError(f"{name}: {len(y)} observations, need >= {MIN_OBS}")

    bic_one = _one_state_bic(y)
    var_only = _fit(y, switching_trend=False, seed=seed)
    both = _fit(y, switching_trend=True, seed=seed)

    means, variances = regime_params(both, 2)
    # Compare against the SERIES' own variance, not an absolute floor: a factor
    # scaled in thousandths would trip an absolute one for no reason.
    scale = float(np.var(y.to_numpy(dtype=float), ddof=0))
    degenerate_variance = bool(
        variances
        and np.isfinite(scale)
        and scale > 0
        and min(variances) < MIN_STATE_VARIANCE_FRACTION * scale
    )
    pooled = float(np.sqrt(np.mean(variances))) if variances else float("nan")
    separation = (
        abs(max(means) - min(means)) / pooled
        if np.isfinite(pooled) and pooled > 0 else float("nan")
    )
    # A variance that optimised to zero (or below) makes the ratio meaningless
    # rather than infinite, and `float("inf")` would serialise as a bare
    # `Infinity` that strict JSON parsers reject. Report the absence instead.
    ratio = (
        max(variances) / min(variances)
        if variances and min(variances) > 0 else float("nan")
    )
    # statsmodels returns P[i, j] = P(next = i | current = j); transpose so a
    # row reads "from this state".
    P = np.asarray(both.regime_transition).reshape(2, 2).T
    durations = [float(1.0 / max(1e-9, 1.0 - P[i, i])) for i in range(2)]

    bic_var = float(var_only.bic)
    bic_both = float(both.bic)
    total_gain = bic_one - bic_both
    return SpecTest(
        factor=name,
        n_obs=int(len(y)),
        bic_one_state=round(float(bic_one), 4),
        bic_switching_variance=round(bic_var, 4),
        bic_switching_mean=round(bic_both, 4),
        mean_gain=round(bic_var - bic_both, 4),
        variance_share=(
            round(float((bic_one - bic_var) / total_gain), 4)
            if np.isfinite(total_gain) and abs(total_gain) > 1e-9 else float("nan")
        ),
        means=[_sig(m) for m in means],
        variances=[_sig(v) for v in variances],
        mean_separation=round(float(separation), 4) if np.isfinite(separation) else float("nan"),
        variance_ratio=_sig(ratio, 4) if np.isfinite(ratio) else float("nan"),
        expected_duration=[round(d, 2) for d in durations],
        converged=bool(both.mle_retvals.get("converged", False)),
        variance_degenerate=degenerate_variance,
    )


def assess_factors(factors: pd.DataFrame, *, seed: int = 17) -> list[SpecTest]:
    out = []
    for column in factors.columns:
        try:
            out.append(assess_factor(factors[column], str(column), seed=seed))
        except Exception as exc:  # noqa: BLE001 — an unfittable factor is a result
            print(f"  {column}: skipped — {exc}")
    return out


#: The panel WP3 was decided on, by series id. Kept so the re-test is the same
#: code on the same as-of date with ONLY the panel different — otherwise
#: "the finding changed" cannot be separated from "the code changed".
LEGACY_PANEL_IDS: tuple[str, ...] = (
    "PAYEMS", "UNRATE", "AWHMAN", "MANEMP", "INDPRO", "TCU", "RRSFS",
    "PCEC96", "DSPIC96", "HOUST", "CPIAUCSL", "CPILFESL", "PPIACO",
    "CES0500000003",
)


def _sig(value: float, digits: int = 6) -> float:
    """Round to significant figures rather than decimal places.

    `round(1.9e-33, 8)` is `0.0`, which is how the manufacturing row came to
    report `variances: [0.0, 0.517]` beside `variance_ratio: 2.67e32` — two
    fields that cannot both be true, in the same record. A collapsed variance is
    the finding on that row, so it has to survive being written down.
    """
    number = float(value)
    if not np.isfinite(number) or number == 0.0:
        return number
    return float(f"{number:.{digits}g}")


def _jsonable(value):
    """Recursively replace every non-finite number with null.

    `json.dumps` writes NaN and Infinity as bare tokens, which are not valid
    JSON and which strict parsers refuse outright. `default=` does not help:
    a Python float NaN serialises without ever reaching it, so the payload has
    to be cleaned before it is dumped. A missing measurement should read as
    null, not as a token a consumer may or may not accept.
    """
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, (bool, str)) or value is None:
        return value
    if isinstance(value, (int, float, np.integer, np.floating)):
        number = float(value)
        return number if np.isfinite(number) else None
    return value


def _report(results: list[SpecTest]) -> None:
    header = (f"{'factor':<14}{'BIC 1st':>10}{'BIC var':>10}{'BIC mean':>10}"
              f"{'mean buys':>11}{'sep':>7}{'varratio':>11}{'durations':>16}  verdict")
    print(header)
    print("-" * len(header))
    for r in sorted(results, key=lambda x: -x.mean_gain):
        dur = "/".join(f"{d:.1f}" for d in r.expected_duration)
        # `:>11.1f` on a ratio of 1e32 writes 33 characters and runs into the
        # next column, which is how the degenerate manufacturing fit first
        # looked like a formatting bug rather than a broken model.
        ratio = (
            "  degenerate" if r.variance_degenerate
            else f"{r.variance_ratio:>11.1f}" if r.variance_ratio < 1e6
            else f"{r.variance_ratio:>11.1e}"
        )
        print(f"{r.factor:<14}{r.bic_one_state:>10.1f}{r.bic_switching_variance:>10.1f}"
              f"{r.bic_switching_mean:>10.1f}{r.mean_gain:>11.1f}"
              f"{r.mean_separation:>7.2f}{ratio}{dur:>16}  {r.verdict}")
    level = [r.factor for r in results if r.level_regime]
    print(f"Level regimes: {', '.join(level) if level else 'NONE'}\n")


def _run_panel(build, label: str) -> dict:
    from ace.state.factors import fit_factors

    print(f"\n=== {label} ===")
    print(build.describe())
    fit = fit_factors(build, maxiter=120)
    print(fit.describe())
    results = assess_factors(fit.factors)
    _report(results)
    return {
        "panel": label,
        "n_series": build.n_series,
        "n_monthly": build.n_monthly,
        "n_quarterly": build.n_quarterly,
        "blocks": {k: list(v) for k, v in build.groups.items()},
        "n_factors": fit.n_factors,
        "converged": fit.converged,
        "level_regimes": [r.factor for r in results if r.level_regime],
        "factors": [
            {**asdict(r), "verdict": r.verdict, "level_regime": r.level_regime,
             "mean_pays": r.mean_pays, "separated": r.separated,
             "persistent": r.persistent}
            for r in results
        ],
    }


def main() -> None:
    from ace.state.panel import PANEL_BY_ID, build_asof, load_vintages

    as_of = pd.Timestamp.now(tz="UTC")
    vintages = load_vintages()
    legacy = build_asof(
        as_of, vintages, specs=tuple(PANEL_BY_ID[i] for i in LEGACY_PANEL_IDS)
    )
    full = build_asof(as_of, vintages)

    panels = [
        _run_panel(legacy, f"{len(LEGACY_PANEL_IDS)}-series (the panel WP3 was decided on)"),
        _run_panel(full, f"{full.n_series}-series (all nine blocks)"),
    ]

    report = ROOT / "artifacts" / "reports" / "macro_regime_mean_vs_variance.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(_jsonable({
        "generated": str(as_of.date()),
        "question": (
            "Does allowing the MEAN to switch buy anything, once the variance "
            "already switches? Beating a one-state Gaussian does not answer "
            "this, because a volatility regime beats it too."
        ),
        "why_two_panels": (
            "WP3 concluded there is no level regime in monthly macro data. It "
            "was decided on a panel with no liquidity, credit, financial-"
            "conditions or housing-finance block. Both panels are built here "
            "on the same as-of date through the same code, so the only "
            "difference is coverage."
        ),
        "thresholds": {
            "min_bic_gain": MIN_BIC_GAIN,
            "min_mean_separation": MIN_MEAN_SEPARATION,
            "min_regime_months": MIN_REGIME_MONTHS,
        },
        "panels": panels,
    }), indent=2, sort_keys=True, allow_nan=False))
    print(f"wrote {report}")


if __name__ == "__main__":
    main()
