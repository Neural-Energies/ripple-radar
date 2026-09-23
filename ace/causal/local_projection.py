"""Local projections — the impulse response ACE actually asks for (§3).

"This event happened; what happens to the market over the next h days" is a
dynamic causal question, and the cross-sectional ATE machinery answers the
wrong version of it. Jordà (2005) local projections answer it directly: for
each horizon h, regress the outcome at t+h on the shock at t plus controls,
and read the coefficient. One regression per horizon, no VAR to be
mis-specified, and the whole response comes with its own standard errors.

Two details that decide whether the numbers mean anything.

OVERLAPPING WINDOWS. The h-step response at consecutive dates shares h-1 days
of outcome, so the residuals are autocorrelated by construction. OLS standard
errors under that are too small — often by a factor of two or three — and an
impulse response that "excludes zero" on OLS errors routinely does not on
correct ones. Newey-West with a bandwidth of at least h is the standard fix
and is applied here by default.

PRE-TREATMENT HORIZONS. Negative horizons are estimated too. The response at
h = -5 should be flat: a shock at t cannot move the market five days before it
happened. If it does, the "shock" is anticipated or the controls are leaking,
and the positive horizons are not causal either. This is the time-series
analogue of a placebo test and it is cheap.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import statsmodels.api as sm


@dataclass
class ImpulseResponse:
    horizons: list[int]
    coef: list[float]
    se: list[float]
    ci_low: list[float]
    ci_high: list[float]
    n: list[int]
    cumulative: list[float]
    se_kind: str
    pretrend_ok: bool
    pretrend_note: str

    def p_values(self) -> dict[int, float]:
        """Two-sided normal p-value per forward horizon."""
        from scipy import stats
        out = {}
        for h, b, e in zip(self.horizons, self.coef, self.se):
            if h < 0 or not np.isfinite(b) or not np.isfinite(e) or e <= 0:
                continue
            out[h] = float(2 * (1 - stats.norm.cdf(abs(b / e))))
        return out

    def holm_significant(self, alpha: float = 0.05) -> list[int]:
        """Horizons surviving a Holm-Bonferroni correction across all of them.

        One impulse response is eleven hypothesis tests. At 5% each, the chance
        of at least one spurious horizon is about 43% — which is exactly what an
        isolated "significant" horizon with nulls on both sides looks like. Holm
        controls the family-wise error rate without assuming the tests are
        independent in any particular way, and it is uniformly more powerful
        than plain Bonferroni.
        """
        pv = sorted(self.p_values().items(), key=lambda kv: kv[1])
        m = len(pv)
        kept = []
        for i, (h, p) in enumerate(pv):
            if p <= alpha / (m - i):
                kept.append(h)
            else:
                break  # Holm stops at the first failure
        return sorted(kept)

    def contiguous_from_zero(self, alpha: float = 0.05) -> list[int]:
        """The run of significant horizons starting at h=0, if any.

        A response that decays has significance at 0, 1, 2 ... A response that
        is significant only at h=6 is noise wearing the shape of a finding.
        """
        sig = set(self.holm_significant(alpha))
        run = []
        h = 0
        while h in sig:
            run.append(h)
            h += 1
        return run

    def at(self, horizon: int) -> dict:
        i = self.horizons.index(horizon)
        return {"horizon": horizon, "coef": self.coef[i], "se": self.se[i],
                "ci": [self.ci_low[i], self.ci_high[i]], "n": self.n[i]}

    def significant_horizons(self) -> list[int]:
        """Uncorrected — every forward horizon whose 95% interval misses zero."""
        return [h for h, lo, hi in zip(self.horizons, self.ci_low, self.ci_high)
                if h >= 0 and (lo > 0 or hi < 0)]

    def to_dict(self) -> dict:
        return {
            "horizons": self.horizons,
            "coef": [round(c, 6) for c in self.coef],
            "se": [round(s, 6) for s in self.se],
            "ci_low": [round(c, 6) for c in self.ci_low],
            "ci_high": [round(c, 6) for c in self.ci_high],
            "cumulative": [round(c, 6) for c in self.cumulative],
            "n": self.n, "se_kind": self.se_kind,
            "pretrend_ok": self.pretrend_ok, "pretrend_note": self.pretrend_note,
            "significant_horizons": self.significant_horizons(),
            "holm_significant": self.holm_significant(),
            "contiguous_from_zero": self.contiguous_from_zero(),
            "p_values": {h: round(p, 6) for h, p in self.p_values().items()},
        }


def local_projection(
    outcome: pd.Series,
    shock: pd.Series,
    *,
    controls: pd.DataFrame | None = None,
    horizons: range | list[int] = range(0, 11),
    lags: int = 5,
    pre_horizons: list[int] | None = None,
    hac: bool = True,
) -> ImpulseResponse:
    """Response of `outcome` at t+h to `shock` at t, one regression per h.

    Controls are dated strictly before the dependent variable and never after
    the shock, so the coefficient is the response to the *unpredictable* part
    of the shock rather than to whatever the outcome's own momentum already
    implied. For a pre-treatment horizon the control block moves back with the
    dependent variable: regressing y(t-5) on its own lag 5 would otherwise put
    the dependent variable on both sides and return a coefficient of exactly
    zero with no standard error — a pre-trend test that can never fail.
    """
    y = pd.Series(outcome).astype(float)
    s = pd.Series(shock).astype(float).reindex(y.index)
    ctrl = None if controls is None else pd.DataFrame(controls).astype(float).reindex(y.index)

    hs = sorted(set(list(pre_horizons or []) + list(horizons)))

    coef, se, lo, hi, ns = [], [], [], [], []
    for h in hs:
        # Controls are anchored one step before whichever comes first, the
        # shock or the outcome being explained.
        anchor = min(0, h)
        d = pd.DataFrame({"shock": s, "_y": y.shift(-h)}, index=y.index)
        for L in range(1, lags + 1):
            d[f"y_lag{L}"] = y.shift(L - anchor)
            d[f"shock_lag{L}"] = s.shift(L - anchor)
        if ctrl is not None:
            for c in ctrl.columns:
                d[f"ctrl_{c}"] = ctrl[c].shift(1 - anchor)
        d = d.dropna()
        if len(d) < 50 or d["shock"].std() == 0:
            coef.append(np.nan); se.append(np.nan)
            lo.append(np.nan); hi.append(np.nan); ns.append(len(d))
            continue
        X = sm.add_constant(d.drop(columns=["_y"]), has_constant="add")
        model = sm.OLS(d["_y"], X)
        if hac:
            # Bandwidth must cover the overlap the h-step outcome induces;
            # |h|+1 is the minimum that does.
            res = model.fit(cov_type="HAC", cov_kwds={"maxlags": max(1, abs(h) + 1)})
        else:
            res = model.fit()
        b = float(res.params["shock"])
        e = float(res.bse["shock"])
        coef.append(b); se.append(e)
        lo.append(b - 1.96 * e); hi.append(b + 1.96 * e); ns.append(len(d))

    pre = [i for i, h in enumerate(hs) if h < 0]
    if pre:
        violated = [hs[i] for i in pre
                    if np.isfinite(lo[i]) and (lo[i] > 0 or hi[i] < 0)]
        pretrend_ok = not violated
        note = ("no pre-treatment response — the shock does not move the outcome "
                "before it happens" if pretrend_ok else
                f"pre-treatment response at horizons {violated}: the shock is "
                "anticipated or a control is leaking; later horizons are not causal")
    else:
        pretrend_ok = True
        note = "no pre-treatment horizons requested"

    # The cumulative response is only defined forward; pre-horizons stay blank.
    cum: list[float] = []
    running = 0.0
    for h, c in zip(hs, coef):
        if h < 0:
            cum.append(float("nan"))
            continue
        running += 0.0 if not np.isfinite(c) else float(c)
        cum.append(running)

    return ImpulseResponse(hs, coef, se, lo, hi, ns, cum,
                           "Newey-West HAC" if hac else "OLS", pretrend_ok, note)
