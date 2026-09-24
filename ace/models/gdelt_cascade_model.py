"""Does a conflict escalation make the next one more likely?

The ripple thesis, finally on its home ground.

Every previous attempt to measure ripple propagation ran on PRICE series, and
every one reached the same negative result: cross-market transmission in liquid
macro is a same-day repricing with no lag that survives out of sample, by two
independent methods. That is a real finding about markets, and it is also a
statement that the price tape was the wrong substrate for a cascade model.

Conflict events are the right one. A strike invites a retaliation; a
retaliation invites an escalation. If self-excitation exists anywhere in ACE's
world it exists here, and a Hawkes process measures exactly that: the branching
ratio is the expected number of further events one event triggers.

SUBSTRATE

10.2M GDELT events, 2022-01 onward, filtered to CAMEO quad class 4 (MATERIAL
conflict — assaults, fights, mass violence, not merely verbal disapproval),
grouped by the country the action occurred in. Sixteen countries carry enough
spike days to fit. Global daily volume is deliberately NOT used: at that
aggregation the series tracks GDELT's own news-ingestion volume rather than
real-world intensity, and it produces five spikes in three years.

A CONSERVATIVE EVENT DEFINITION, STATED

A spike day is one whose log event count is 2 sigma above its own TRAILING
60-day norm. Standardizing by a trailing window partially removes the very
clustering the model is looking for: a burst raises the bar for the days that
follow it. The bias runs against finding excitation, so a positive result here
is understated rather than flattered. The same definition is used everywhere
else in ACE, and consistency is worth more than a threshold tuned to be
generous.

THE GATE, unchanged from the market and earthquake runs

  1. likelihood-ratio test against a homogeneous Poisson process
  2. OUT-OF-SAMPLE log-likelihood gain on a held-out period
  3. Ogata time-rescaling residuals: iid Exp(1) or the intensity is misspecified
  4. branching ratio below 1, or the process is explosive and not a model

All four, or the country is not promoted.
"""
from __future__ import annotations

import argparse
import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
warnings.filterwarnings("ignore")

from scipy import stats

from ace.cascade.hawkes import (
    expected_offspring,
    fit_hawkes,
    goodness_of_fit,
    hawkes_log_likelihood,
    poisson_log_likelihood,
    rescaled_times,
)
from ace.config import RANDOM_SEED, REPORTS
from ace.feeds.gdelt_store import daily_series, event_times, load_events, spike_days
from ace.registry.registry import ModelRecord, dataframe_hash, promote, register, utcnow

MODEL_ID = "ace_gdelt_cascade"
MODEL_VERSION = "v1"
QUAD_MATERIAL = 4
SIGMA = 2.0
WINDOW = 60
MIN_EVENTS = 30          # the fitter's own floor
MIN_TRAIN, MIN_TEST = 22, 12
TEST_FRAC = 0.30
HORIZON_DAYS = 14

# FIPS 10-4, which is what GDELT emits. Spelled out so a scorecard is readable
# without a codebook.
FIPS = {
    "GZ": "Gaza Strip", "IR": "Iran", "LE": "Lebanon", "IS": "Israel",
    "PK": "Pakistan", "WE": "West Bank", "SY": "Syria", "TU": "Turkey",
    "BG": "Bangladesh", "TW": "Taiwan", "BR": "Brazil", "AF": "Afghanistan",
    "RW": "Rwanda", "SO": "Somalia", "KN": "Korea, North", "CU": "Cuba",
    "UP": "Ukraine", "RS": "Russia", "US": "United States", "CH": "China",
    "ES": "El Salvador", "HA": "Haiti", "KS": "Korea, South", "GR": "Greece",
    "FR": "France", "MX": "Mexico", "CO": "Colombia", "VE": "Venezuela",
    "IN": "India", "NI": "Nigeria", "SU": "Sudan", "ET": "Ethiopia",
    "YM": "Yemen", "EG": "Egypt", "ML": "Mali", "CG": "DR Congo",
}


MIN_POOLED_RESIDUALS = 50


def pooled_specification(residual_sets: list[list[float]]) -> dict:
    """Is the fitted intensity correctly specified, judged on pooled residuals?

    Ogata's time-rescaling theorem says a correctly specified point process has
    iid Exp(1) rescaled inter-event times. A KS test on that needs roughly 50
    points and no single country here has half of it, so the per-country check
    cannot run at all -- and a gate that passes a check which never executed is
    worse than one that admits it cannot look.

    Correct specification PER COUNTRY implies Exp(1) residuals in each, so the
    union is Exp(1) too. Pooling turns several untestable samples into one
    testable one. It tests the shared kernel FORM rather than any one country's
    parameters, which is precisely the question: does exponential decay
    describe how conflict excitation fades?
    """
    tau = (
        np.concatenate([np.asarray(r, dtype=float) for r in residual_sets])
        if residual_sets
        else np.array([])
    )
    tau = tau[np.isfinite(tau) & (tau >= 0)]
    if len(tau) < MIN_POOLED_RESIDUALS:
        return {"available": False, "n": int(len(tau)),
                "reason": f"only {len(tau)} pooled residuals"}
    ks_stat, ks_p = stats.kstest(tau, "expon", args=(0, 1))
    return {
        "available": True, "n": int(len(tau)),
        "ks_stat": round(float(ks_stat), 5), "ks_p_value": round(float(ks_p), 6),
        "exponential_by_ks": bool(ks_p > 0.05),
        "mean": round(float(tau.mean()), 4), "expected_mean": 1.0,
    }


def oos_log_likelihood(t_test: np.ndarray, fit) -> tuple[float, float, float]:
    """Score the held-out events under the TRAINED parameters, vs Poisson."""
    if len(t_test) < 2:
        return float("nan"), float("nan"), float("nan")
    T = float(t_test[-1] - t_test[0]) * 1.001
    t = t_test - t_test[0]
    ll_hawkes = -hawkes_log_likelihood(np.array([fit.mu, fit.alpha, fit.beta]), t, T)
    ll_pois, _ = poisson_log_likelihood(t, T)
    return float(ll_hawkes), float(ll_pois), float(ll_hawkes - ll_pois)


def run_country(code: str, series: pd.Series, seed: int) -> dict | None:
    flags = spike_days(series, window=WINDOW, sigma=SIGMA)
    t_all, dates = event_times(flags)
    name = FIPS.get(code, code)
    if len(t_all) < MIN_EVENTS:
        return {"code": code, "name": name, "skipped": f"only {len(t_all)} spike days"}

    cut = t_all[int(len(t_all) * (1 - TEST_FRAC))]
    t_tr = t_all[t_all < cut]
    t_te = t_all[t_all >= cut] - cut
    if len(t_tr) < MIN_TRAIN or len(t_te) < MIN_TEST:
        return {"code": code, "name": name,
                "skipped": f"split leaves {len(t_tr)}/{len(t_te)} events"}

    try:
        fit = fit_hawkes(t_tr)
    except (ValueError, RuntimeError) as exc:
        return {"code": code, "name": name, "skipped": f"fit failed: {exc}"}

    gof_in = goodness_of_fit(t_tr, fit)
    gof_out = goodness_of_fit(t_te, fit)
    ll_h, ll_p, gain = oos_log_likelihood(t_te, fit)
    offspring = expected_offspring(fit, HORIZON_DAYS)

    # Three checks are verifiable per country. The fourth -- Ogata
    # time-rescaling -- needs ~50 residuals and these countries have 12-17
    # held-out events, so it CANNOT run here. Passing a check that never
    # executed would be the worst kind of gate, so it is tracked separately and
    # tested on the pooled residuals across countries instead.
    spec_testable = bool(gof_out.get("available"))
    spec_ok = gof_out.get("exponential_by_ks")
    passes = bool(
        fit.converged
        and fit.beats_poisson
        and fit.stationary
        and 0 < fit.alpha < 1
        and np.isfinite(gain) and gain > 0
        and (spec_ok is not False)
    )

    return {
        "code": code, "name": name, "skipped": None,
        "n_events": int(len(t_all)), "n_train": int(len(t_tr)), "n_test": int(len(t_te)),
        "first_event": str(dates.min().date()), "last_event": str(dates.max().date()),
        "mean_per_day": round(float(np.nanmean(series)), 2),
        "fit": fit.to_dict(),
        "gof_train": gof_in, "gof_test": gof_out,
        "oos_loglik_hawkes": round(ll_h, 3), "oos_loglik_poisson": round(ll_p, 3),
        "oos_gain": round(gain, 3),
        "cascade": offspring,
        "passes": passes,
        "spec_testable": spec_testable,
        "spec_note": (
            "Ogata KS ran per country"
            if spec_testable
            else "too few held-out events for a per-country KS; see the pooled test"
        ),
        "_tau_train": rescaled_times(t_tr, fit).tolist(),
        "_tau_test": rescaled_times(t_te, fit).tolist(),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-mean", type=float, default=5.0,
                    help="skip countries averaging fewer material events a day")
    ap.add_argument("--seed", type=int, default=RANDOM_SEED)
    args = ap.parse_args()

    print("=" * 92)
    print("ACE conflict cascade :: does one material escalation make the next more likely?")
    print("=" * 92)

    events = load_events()
    material = events[events["quad_class"] == QUAD_MATERIAL]
    print(f"\n{len(events):,} events, {len(material):,} material (CAMEO quad {QUAD_MATERIAL})")
    print(f"{events.index.min().date()} -> {events.index.max().date()}, on the observation clock")

    by_country = daily_series(material, by="action_geo_country")
    results: list[dict] = []
    for code in by_country.columns:
        s = by_country[code]
        if s.notna().sum() < 500 or float(np.nanmean(s)) < args.min_mean:
            continue
        out = run_country(str(code), s, args.seed)
        if out:
            results.append(out)

    fitted = [r for r in results if not r["skipped"]]
    fitted.sort(key=lambda r: -r["oos_gain"])
    print(f"\n{len(fitted)} countries fitted, {len(results) - len(fitted)} skipped\n")
    print(f"{'country':<16}{'n':>5}{'alpha':>8}{'half-life':>11}{'LR p':>10}"
          f"{'OOS gain':>10}{'Ogata p':>9}{'x':>7}  verdict")
    for r in fitted:
        f, c = r["fit"], r["cascade"]
        ks = r["gof_test"].get("ks_p_value")
        print(f"{r['name'][:15]:<16}{r['n_events']:>5}{f['alpha']:>8.3f}"
              f"{c.get('excitation_half_life', float('nan')):>10.1f}d"
              f"{f['lr_p_value']:>10.2g}{r['oos_gain']:>+10.1f}"
              f"{(ks if ks is not None else float('nan')):>9.3f}"
              f"{c.get('cascade_multiplier', float('nan')):>6.2f}x"
              f"  {'PASSES' if r['passes'] else ''}")

    passing = [r for r in fitted if r["passes"]]

    spec_train = pooled_specification([r["_tau_train"] for r in passing])
    spec_test = pooled_specification([r["_tau_test"] for r in passing])

    print(f"\n{len(passing)}/{len(fitted)} countries clear the three per-country checks")
    print("\nOgata time-rescaling — POOLED, because no single country has the ~50")
    print("residuals a KS test needs. Correct specification per country implies")
    print("Exp(1) residuals, so their union is testable where none of them is.")
    for label, spec in (("train", spec_train), ("holdout", spec_test)):
        if spec.get("available"):
            verdict = "consistent with Exp(1)" if spec["exponential_by_ks"] else "REJECTED — intensity misspecified"
            print(f"  {label:<8} n={spec['n']:<4} KS p={spec['ks_p_value']:.4f}  "
                  f"mean={spec['mean']:.3f} (expect 1.000)  {verdict}")
        else:
            print(f"  {label:<8} not testable — {spec.get('reason')}")
    if passing:
        a = np.mean([r["fit"]["alpha"] for r in passing])
        m = np.mean([r["cascade"]["cascade_multiplier"] for r in passing])
        print(f"mean branching ratio among them: {a:.3f}  (mean multiplier {m:.2f}x)")
        print("Read: for every 100 escalations arriving on their own, "
              f"{(m - 1) * 100:.0f} more follow as offspring.")

    # Selection is by SAMPLE SIZE, not by result: the fitted countries are the
    # ones with the most spike days. Stated so four passes out of seventy-four
    # cannot be read as a search for four that worked.
    near = [r for r in results if r["skipped"] and "split leaves" in r["skipped"]]
    thin = [r for r in results if r["skipped"] and "spike days" in r["skipped"]]
    print(f"\nselection: {len(fitted)} fitted, {len(near)} excluded by the holdout-size floor, "
          f"{len(thin)} with too few spike days to fit at all.")
    print("The fitted set is the top of the sample-size ranking, not of the result ranking.")

    # The TRAIN pool is the more powerful test (n=128 against n=56), so the
    # verdict reads it. Keying on the holdout alone because it happens to pass
    # would be choosing the weaker test for its answer.
    spec_primary = spec_train if spec_train.get("available") else spec_test
    spec_ok = spec_primary.get("exponential_by_ks")
    excitation_real = len(passing) >= max(3, len(fitted) // 3)

    print("\n" + "=" * 92)
    if excitation_real and spec_ok:
        print("VERDICT: PASSES — conflict escalation is self-exciting out of sample, and the")
        print("         pooled Ogata residuals do not reject the exponential kernel.")
        print("         The ripple the price tape does not show, the event stream does.")
    elif excitation_real:
        print("VERDICT: SELF-EXCITATION YES, KERNEL SHAPE NO.")
        print(f"         The excitation is real: likelihood-ratio p at or below "
              f"{max(r['fit']['lr_p_value'] for r in passing):.3g} on every passing country,")
        print("         and every one gains out of sample against a Poisson process. That is")
        print("         the ripple the price tape does not show.")
        print("")
        print(f"         But the pooled Ogata residuals REJECT the exponential kernel "
              f"(KS p={spec_primary.get('ks_p_value')}, n={spec_primary.get('n')}).")
        print("         The decay is not exponential, which is the same thing seismology")
        print("         found before adopting Omori's power law. So the branching ratio is")
        print("         an APPROXIMATION of how much one escalation breeds, not an estimate")
        print("         to quote to three digits, and these are registered CANDIDATE rather")
        print("         than promoted.")
    elif passing:
        print(f"VERDICT: PARTIAL — {len(passing)} of {len(fitted)} countries clear the gate.")
        print("         Promoted individually; the rest are not.")
    else:
        print("VERDICT: FAILS — no country shows self-excitation that survives the gate.")
    print("=" * 92)

    # A misspecified kernel does not get promoted, however good its likelihood.
    promotable = bool(passing and spec_ok)
    status = ("CANDIDATE" if passing else "FAILED")
    scorecard = {
        "n_events": int(len(events)), "n_material": int(len(material)),
        "sigma": SIGMA, "window": WINDOW, "test_frac": TEST_FRAC,
        "countries": [{k: v for k, v in r.items() if not k.startswith("_")} for r in results],
        "n_passing": len(passing), "n_fitted": len(fitted),
        "pooled_specification": {"train": spec_train, "holdout": spec_test},
        "selection": {"fitted": len(fitted), "excluded_holdout_size": len(near),
                      "excluded_too_few_spikes": len(thin),
                      "basis": "sample size, not result"},
    }

    from ace.registry.registry import all_records, retire

    live = {rec["model_id"] for rec in all_records()
            if rec["production_status"] == "PRODUCTION" and rec["model_id"].startswith(MODEL_ID)}
    still_passing = {f"{MODEL_ID}_{r['code']}" for r in passing}

    # A model that STOPS qualifying must come out of production. Retiring only
    # the ones being replaced leaves a country that failed this run sitting in
    # PRODUCTION on the strength of a previous one -- the same silent staleness
    # the register() guard exists to prevent, arriving from the other side.
    for mid in sorted(live - still_passing):
        retire(mid, MODEL_VERSION,
               reason=f"no longer clears the gate on the {utcnow()[:10]} re-run")
        print(f"registry: RETIRED {mid} — it no longer passes")

    for r in passing:
        mid = f"{MODEL_ID}_{r['code']}"
        # A re-run supersedes its predecessor ON THE RECORD rather than by
        # quietly overwriting it; register() refuses the silent path.
        if mid in live:
            retire(mid, MODEL_VERSION, reason=f"superseded by re-run {utcnow()[:10]}")
        register(
            ModelRecord(
                model_id=f"{MODEL_ID}_{r['code']}", model_family="hawkes_exponential",
                model_version=MODEL_VERSION, analysis_type="event_cascade",
                target_variable=f"material-conflict escalation spikes in {r['name']}",
                feature_schema=["daily material conflict count", "trailing 60d log z-score"],
                training_start=r["first_event"], training_end=r["last_event"],
                validation_periods=[{"scheme": "chronological holdout",
                                     "n_train": r["n_train"], "n_test": r["n_test"]}],
                holdout_period={"n": r["n_test"], "oos_gain": r["oos_gain"]},
                training_dataset_hash=dataframe_hash(by_country[[r["code"]]].dropna()),
                hyperparameters={"sigma": SIGMA, "window": WINDOW, "quad_class": QUAD_MATERIAL},
                random_seed=args.seed,
                performance_metrics={"fit": r["fit"], "oos_gain": r["oos_gain"]},
                calibration_metrics={"gof_train": r["gof_train"], "gof_test": r["gof_test"]},
                benchmark_metrics={"poisson_loglik": r["oos_loglik_poisson"],
                                   "hawkes_loglik": r["oos_loglik_hawkes"],
                                   "cascade": r["cascade"]},
                model_artifact_path="", creation_timestamp=utcnow(),
                production_status="CANDIDATE",
                notes="GDELT material conflict, observation clock. The trailing-z spike "
                      "definition is conservative and understates excitation. Pooled Ogata "
                      f"residuals {'accept' if spec_ok else 'REJECT'} the exponential kernel "
                      f"(KS p={spec_primary.get('ks_p_value')}), so the branching ratio is "
                      "approximate.",
            ),
            artifact={"alpha": r["fit"]["alpha"], "beta": r["fit"]["beta"], "mu": r["fit"]["mu"]},
        )
        if promotable:
            promote(mid, MODEL_VERSION,
                    reason=f"OOS log-lik gain {r['oos_gain']:+.1f} over Poisson, "
                           f"alpha {r['fit']['alpha']:.3f}, pooled Ogata KS p "
                           f"{spec_primary.get('ks_p_value')}")
    if passing and not promotable:
        print("\nregistry: CANDIDATE, not promoted — the excitation is real but the "
              "kernel shape is rejected.")

    out = REPORTS / f"{MODEL_ID}_{MODEL_VERSION}_scorecard.json"
    out.write_text(json.dumps(scorecard, indent=2, default=str))
    print(f"\nscorecard {out}   (status {status})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
