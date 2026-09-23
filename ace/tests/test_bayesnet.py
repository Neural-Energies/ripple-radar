"""Dynamic Bayesian Network tests.

Two defects these exist to prevent, both of which produce a model that looks
excellent and is worthless.

The first is a leaked threshold. "Volatility was high on 2018-02-05" is a
statement about a cutoff; if that cutoff was computed from the full sample it
knows about 2020, and the state label carries the future inside it. The test
for this is exact rather than statistical: truncate the series at t and the
label at t must not move.

The second is an off-by-one in the two-slice stacking. If slice 0 holds
tomorrow and slice 1 holds today, every metric improves and the model is
predicting the past.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.bayesnet.dbn import DBNSpec, fit_cpt, fit_dbn, flatten, predict_proba
from ace.bayesnet.states import (
    build_state_frame,
    expanding_median_split,
    expanding_tercile,
    to_two_slice,
)


def _series(n=900, seed=0):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2015-01-01", periods=n, freq="B")
    return pd.Series(rng.normal(size=n), index=idx)


# ---------------------------------------------------------------- state labels


def test_expanding_tercile_cannot_see_past_the_row_it_labels():
    """Truncating the input must not change any label that survives."""
    s = _series()
    full = expanding_tercile(s, min_history=200)
    for cut in (400, 600, 750):
        partial = expanding_tercile(s.iloc[:cut], min_history=200)
        assert partial.tolist() == full.iloc[:cut].tolist(), f"label moved at cut={cut}"


def test_expanding_median_split_cannot_see_past_the_row_it_labels():
    s = _series(seed=3)
    full = expanding_median_split(s, min_history=200)
    partial = expanding_median_split(s.iloc[:500], min_history=200)
    assert partial.tolist() == full.iloc[:500].tolist()


def test_warmup_rows_are_unlabelled_rather_than_guessed():
    s = _series()
    out = expanding_tercile(s, min_history=200)
    assert out.iloc[:200].isna().all()
    assert out.iloc[200:].notna().all()


def test_stress_is_standardized_by_the_instruments_own_volatility():
    """The same 1% move is a stress day in a calm tape and noise in a wild one."""
    rng = np.random.default_rng(1)
    n = 800
    idx = pd.date_range("2015-01-01", periods=n, freq="B")
    calm = pd.Series(rng.normal(scale=0.002, size=n), index=idx)
    wild = pd.Series(rng.normal(scale=0.020, size=n), index=idx)
    calm.iloc[700] = 0.01
    wild.iloc[700] = 0.01
    assert build_state_frame(calm)["stress"].iloc[700] == "yes"
    assert build_state_frame(wild)["stress"].iloc[700] == "no"


# ------------------------------------------------------------------ two slices


def test_two_slice_puts_today_in_slice_zero_and_tomorrow_in_slice_one():
    frame = pd.DataFrame(
        {"a": list("abcabcabc") * 30, "b": list("xyzxyzxyz") * 30},
        index=pd.date_range("2015-01-01", periods=270, freq="B"),
    )
    two = to_two_slice(frame, ["a", "b"])
    assert len(two) == len(frame) - 1
    assert two[("a", 0)].tolist() == frame["a"].iloc[:-1].tolist()
    assert two[("a", 1)].tolist() == frame["a"].iloc[1:].tolist()
    # slice 1 is strictly later than slice 0, row by row
    assert (two[("a", 1)].to_numpy()[:-1] == two[("a", 0)].to_numpy()[1:]).all()


def test_two_slice_refuses_a_frame_too_short_to_estimate_from():
    frame = pd.DataFrame({"a": list("ab") * 20}, index=pd.date_range("2015-01-01", periods=40))
    with pytest.raises(ValueError, match="need >=200"):
        to_two_slice(frame, ["a"])


# -------------------------------------------------------------- CPT estimation


def _from_known_cpt(n=40000, seed=0):
    """P(y=yes | p) for a known table, so the fit has a ground truth."""
    truth = {("low",): 0.05, ("mid",): 0.20, ("high",): 0.60}
    rng = np.random.default_rng(seed)
    parent = rng.choice(["low", "mid", "high"], size=n)
    y = np.where(rng.random(n) < np.array([truth[(p,)] for p in parent]), "yes", "no")
    return pd.DataFrame({"p": parent, "y": y}), truth


def test_fit_cpt_recovers_a_known_conditional_table():
    data, truth = _from_known_cpt()
    cpt = fit_cpt(data, "y", ["p"])
    for key, p_yes in truth.items():
        assert abs(cpt.predict(key)["yes"] - p_yes) < 0.02, key


def test_every_cpt_row_is_a_proper_distribution():
    data, _ = _from_known_cpt()
    cpt = fit_cpt(data, "y", ["p"])
    for key, row in cpt.table.items():
        assert abs(sum(row.values()) - 1.0) < 1e-9, key
        assert all(0.0 < v < 1.0 for v in row.values()), key


def test_an_unseen_configuration_falls_back_to_the_marginal_not_to_zero():
    """A combination that has not occurred is not a combination that cannot."""
    data, _ = _from_known_cpt(n=4000)
    cpt = fit_cpt(data, "y", ["p"])
    fallback = cpt.predict(("never_observed",))
    assert fallback == cpt.table["__prior__"]
    assert fallback["yes"] > 0.0
    assert abs(fallback["yes"] - (data["y"] == "yes").mean()) < 1e-9


def test_dirichlet_smoothing_pulls_a_one_observation_cell_off_the_boundary():
    """Maximum likelihood would call this cell certain. It is not."""
    data = pd.DataFrame({"p": ["rare"] + ["common"] * 999,
                         "y": ["yes"] + ["no"] * 999})
    cpt = fit_cpt(data, "y", ["p"], prior_strength=4.0)
    rare = cpt.predict(("rare",))["yes"]
    assert 0.0 < rare < 1.0
    assert rare < 0.5, "one observation should not carry a majority forecast"
    assert cpt.counts[("rare",)] == 1


def test_unseen_count_reports_the_configurations_the_table_never_saw():
    data = pd.DataFrame({
        "a": ["x", "x", "y", "y"] * 250,
        "b": ["p", "q", "p", "p"] * 250,   # (y, q) never occurs
        "y": ["yes", "no"] * 500,
    })
    cpt = fit_cpt(data, "y", ["a", "b"])
    assert cpt.n_configurations == 4
    assert cpt.n_unseen == 1


def test_fit_cpt_refuses_a_target_that_never_varies():
    data = pd.DataFrame({"p": ["a"] * 100, "y": ["yes"] * 100})
    with pytest.raises(ValueError, match="need >=2"):
        fit_cpt(data, "y", ["p"])


def test_fit_cpt_names_a_parent_that_is_not_in_the_data():
    data, _ = _from_known_cpt(n=1000)
    with pytest.raises(KeyError, match="ghost"):
        fit_cpt(data, "y", ["p", "ghost"])


# --------------------------------------------------------------- network + use


def test_a_parentless_table_predicts_the_base_rate_for_every_row():
    data, _ = _from_known_cpt(n=5000)
    cpt = fit_cpt(data, "y", [])
    p = predict_proba(cpt, data, "yes")
    assert cpt.n_configurations == 1
    assert len(np.unique(p)) == 1
    assert abs(p[0] - (data["y"] == "yes").mean()) < 1e-9


def test_predict_proba_reads_each_rows_own_parent_configuration():
    data, truth = _from_known_cpt()
    cpt = fit_cpt(data, "y", ["p"])
    p = predict_proba(cpt, data, "yes")
    for parent, p_yes in (("low", 0.05), ("high", 0.60)):
        assert abs(p[data["p"].to_numpy() == parent].mean() - p_yes) < 0.02


def test_fit_dbn_conditions_slice_one_on_slice_zero():
    frame = pd.DataFrame(
        {"vol": list("abc") * 200, "stress": ["yes", "no", "no"] * 200},
        index=pd.date_range("2015-01-01", periods=600, freq="B"),
    )
    two = to_two_slice(frame, ["vol", "stress"])
    cpts = fit_dbn(two, DBNSpec({"stress": ["vol", "stress"]}))
    cpt = cpts["stress"]
    assert cpt.target == "stress_t1"
    assert cpt.parents == ["vol_t0", "stress_t0"]
    assert set(flatten(two).columns) == {"vol_t0", "vol_t1", "stress_t0", "stress_t1"}
