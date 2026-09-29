"""Calibrator selection and stacking must never score a transform on its own labels (A09).

The defect this guards: each candidate calibrator was fitted on the
out-of-fold rows and scored on those same rows, and the stack was trained on
the fitted values. Isotonic minimises training Brier over every monotone map —
identity included — so in-sample selection picks it whether or not it helps.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.calibration.calibrate import (
    METHODS,
    _fit_method,
    calibrate_members,
    cross_fit,
    fit_calibrator,
)

GRID = np.linspace(0.05, 0.95, 2000)


def _calibrated(seed: int, n: int) -> tuple[np.ndarray, np.ndarray]:
    """y ~ Bernoulli(p): the raw forecast is correct by construction."""
    rng = np.random.default_rng(seed)
    p = rng.uniform(0.05, 0.95, n)
    return rng.binomial(1, p).astype(float), p


def _overconfident(seed: int, n: int) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    z = rng.normal(size=n)
    y = (rng.uniform(size=n) < 1 / (1 + np.exp(-0.4 * z))).astype(float)
    return y, np.clip(1 / (1 + np.exp(-2.0 * z)), 0.01, 0.99)


def _expected_brier(cal, grid=GRID) -> float:
    """Brier on new data from the calibrated generator, integrated over p."""
    q = cal.transform(grid)
    return float(np.mean(grid * (1 - q) ** 2 + (1 - grid) * q**2))


def _in_sample_choice(y, p) -> str:
    """The pre-fix rule, kept here only to show what it did."""
    return min(METHODS, key=lambda m: (np.mean((_fit_method(m, y, p).transform(p) - y) ** 2),
                                       METHODS.index(m)))


# ------------------------------------------------------------ the interface ---
def test_groups_are_required():
    y, p = _calibrated(1, 200)
    with pytest.raises(TypeError):
        fit_calibrator(y, p, base_rate=0.5)  # type: ignore[call-arg]


def test_groups_must_align_with_predictions():
    y, p = _calibrated(1, 200)
    with pytest.raises(ValueError, match="groups has 199 rows"):
        fit_calibrator(y, p, base_rate=0.5, groups=np.zeros(199))


# ----------------------------------------------------------- index isolation ---
@pytest.mark.parametrize("method", ["platt", "isotonic"])
def test_cross_fit_values_depend_only_on_earlier_groups(method):
    y, p = _overconfident(3, 1000)
    groups = np.repeat(np.arange(5), 200)
    base = cross_fit(y, p, groups, method)
    for g in range(1, 5):
        flipped = y.copy()
        flipped[groups >= g] = 1 - flipped[groups >= g]
        again = cross_fit(flipped, p, groups, method)
        # Group g is transformed by a fit on groups < g, so rewriting every
        # label from g onward cannot move it; later groups do move.
        np.testing.assert_array_equal(again[groups <= g], base[groups <= g])
        if g < 4:
            assert not np.allclose(again[groups > g], base[groups > g])


@pytest.mark.parametrize("method", METHODS)
def test_no_row_label_reaches_its_own_cross_fitted_value(method):
    y, p = _calibrated(4, 500)
    groups = np.repeat(np.arange(5), 100)
    base = cross_fit(y, p, groups, method)
    for i in np.random.default_rng(0).choice(len(y), 25, replace=False):
        flipped = y.copy()
        flipped[i] = 1 - flipped[i]
        np.testing.assert_array_equal(cross_fit(flipped, p, groups, method)[i], base[i])


def test_first_group_has_no_fitted_calibration():
    y, p = _calibrated(5, 500)
    groups = np.repeat(np.arange(5), 100)
    for method in ("platt", "isotonic"):
        out = cross_fit(y, p, groups, method)
        assert np.isnan(out[groups == 0]).all()
        assert np.isfinite(out[groups > 0]).all()
    assert np.isfinite(cross_fit(y, p, groups, "identity")).all()


def test_selection_scores_only_rows_every_candidate_predicted_forward():
    # Group 0 has no past, so no candidate is scored there; the Brier each
    # candidate is chosen on comes from exactly the cross-fitted values.
    y, p = _overconfident(6, 1000)
    groups = np.repeat(np.arange(5), 200)
    cal, note = fit_calibrator(y, p, base_rate=float(y.mean()), groups=groups)
    assert "on 800 rows" in note
    rows = groups > 0
    for m in METHODS:
        b = float(np.mean((cross_fit(y, p, groups, m)[rows] - y[rows]) ** 2))
        assert f"{m}={b:.5f}" in note


# ------------------------------------------------------------------ stacking ---
def test_stack_inputs_are_cross_fitted_not_in_sample():
    y, raw = _overconfident(7, 1000)
    _, good = _calibrated(8, 1000)
    P = np.column_stack([raw, good])
    groups = np.repeat(np.arange(5), 200)
    cals, P_cross = calibrate_members(y, P, groups, base_rate=float(y.mean()))
    assert [c.method for c in cals][0] != "identity"
    for j, cal in enumerate(cals):
        np.testing.assert_array_equal(P_cross[:, j], cross_fit(y, P[:, j], groups, cal.method))
    # A row's own label never reaches the value the stack is trained on.
    for i in (250, 555, 999):
        flipped = y.copy()
        flipped[i] = 1 - flipped[i]
        _, again = calibrate_members(flipped, P, groups, base_rate=float(y.mean()))
        np.testing.assert_array_equal(again[i], P_cross[i])


# ------------------------------------------------ the audit's worked example ---
def test_audit_example_in_sample_rule_prefers_isotonic_that_generalises_worse():
    # seed 17, n=80: identity is correct by construction.
    y, p = _calibrated(17, 80)
    fits = {m: _fit_method(m, y, p) for m in METHODS}
    train = {m: float(np.mean((fits[m].transform(p) - y) ** 2)) for m in METHODS}
    assert train["isotonic"] == pytest.approx(0.15097, abs=5e-6)
    assert train["identity"] == pytest.approx(0.17736, abs=5e-6)
    assert _in_sample_choice(y, p) == "isotonic"
    grid = np.linspace(0.05, 0.95, 10000)
    assert _expected_brier(fits["isotonic"], grid) == pytest.approx(0.1930258, abs=1e-7)
    assert _expected_brier(fits["identity"], grid) == pytest.approx(0.1824865, abs=1e-7)

    cal, note = fit_calibrator(y, p, base_rate=float(y.mean()), groups=np.repeat(np.arange(4), 20))
    assert cal.method == "identity"
    assert "only 20 cross-fitted rows" in note


# ------------------------------------------------- repeated / generalisation ---
def test_calibrated_generator_repeated_selection_generalises():
    # Identity need not win every finite sample; across many it should
    # dominate, and the chosen transforms should generalise better than the
    # ones in-sample selection picks.
    old, new, e_old, e_new = [], [], [], []
    for seed in range(100):
        y, p = _calibrated(seed, 300)
        m_old = _in_sample_choice(y, p)
        cal, _ = fit_calibrator(y, p, base_rate=float(y.mean()), groups=np.repeat(np.arange(5), 60))
        old.append(m_old)
        new.append(cal.method)
        e_old.append(_expected_brier(_fit_method(m_old, y, p)))
        e_new.append(_expected_brier(cal))
    assert old.count("isotonic") >= 95
    assert new.count("isotonic") <= 15
    assert new.count("identity") >= 70
    assert np.mean(e_new) < np.mean(e_old)
    identity = _expected_brier(_fit_method("identity", *_calibrated(0, 300)))
    assert np.mean(e_new) < identity + 0.002


def test_miscalibrated_generator_still_gets_a_transform():
    rng = np.random.default_rng(999)
    z = rng.normal(size=20000)
    truth = 1 / (1 + np.exp(-0.4 * z))
    raw_new = np.clip(1 / (1 + np.exp(-2.0 * z)), 0.01, 0.99)

    def brier(q):
        return float(np.mean(truth * (1 - q) ** 2 + (1 - truth) * q**2))

    for seed in range(5):
        y, raw = _overconfident(seed, 2000)
        cal, _ = fit_calibrator(y, raw, base_rate=float(y.mean()), groups=np.repeat(np.arange(5), 400))
        assert cal.method != "identity"
        assert brier(cal.transform(raw_new)) < brier(raw_new) - 0.03
