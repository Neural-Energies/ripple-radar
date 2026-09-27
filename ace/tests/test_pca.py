"""Static PCA: does it recover a known factor structure, and does it fail
honestly when there isn't one to recover?

Every fixture here has a KNOWN answer, so a wrong sign, a wrong variance split
or a mislabelled component is unambiguous rather than merely surprising — the
same discipline `ace.tests.test_macro_regime` applies to the Markov switching
work.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ace.factors.pca import fit, domain_panels


def _panel(n_series: int, n_obs: int, factors: np.ndarray, loadings: np.ndarray,
           noise: float, seed: int) -> pd.DataFrame:
    """`factors` is (n_obs, k), `loadings` is (n_series, k). y = loadings @ factors.T + noise."""
    rng = np.random.default_rng(seed)
    signal = factors @ loadings.T
    values = signal + rng.normal(scale=noise, size=signal.shape)
    idx = pd.date_range("2000-01-01", periods=n_obs, freq="MS", tz="UTC")
    return pd.DataFrame(values, index=idx, columns=[f"S{i}" for i in range(n_series)])


def test_a_single_common_factor_is_recovered_with_correct_sign_split():
    rng = np.random.default_rng(1)
    n_obs, n_series = 240, 24
    common = np.cumsum(rng.normal(size=n_obs)).reshape(-1, 1)
    loadings = np.concatenate([np.ones(12), -np.ones(12)]).reshape(-1, 1)
    frame = _panel(n_series, n_obs, common, loadings, noise=0.5, seed=2)

    result = fit(frame, as_of="2020-01-01", label="test")
    assert result.factor_count.k == 1
    pc1 = result.components[0]
    assert pc1.explained_variance_ratio > 0.85

    signs = np.sign(pc1.loadings.reindex([f"S{i}" for i in range(n_series)]))
    # The first 12 must share one sign and the last 12 the opposite, whichever
    # way PCA's own sign convention landed (fixed by `_orient_component` to
    # majority-positive, but "majority" here is exactly half-half plus noise).
    assert len(set(signs.iloc[:12])) == 1
    assert len(set(signs.iloc[12:])) == 1
    assert signs.iloc[0] != signs.iloc[-1]


def test_two_orthogonal_factors_are_both_recovered():
    """Two independent random-walk factors, each loading on its own block of
    series. PCA is only promised to recover the SPAN of the true factors when
    their eigenvalues are close — not their individual axes, and not a clean
    membership split of which series belongs to which recovered component.

    An earlier version of this test asserted the stronger, axis-aligned claim
    and it was wrong to: with finite, correlated random-walk factors the
    recovered components came back MIXED (PC1 loaded on both blocks at 0.233
    and 0.199 respectively, not a clean split), which is a real property of
    PCA under near-degenerate eigenvalues, not a defect in `ace.factors.pca`.
    The claim PCA actually makes — and the one tested here — is that the
    2-DIMENSIONAL SUBSPACE spanned by the top two components recovers each
    true factor: regressing either f1 or f2 on [PC1, PC2] should have a high
    R^2, whichever rotation PCA happened to land on.
    """
    rng = np.random.default_rng(3)
    n_obs, n_series = 240, 20
    f1 = np.cumsum(rng.normal(size=n_obs))
    f2 = np.cumsum(rng.normal(size=n_obs))
    factors = np.column_stack([f1, f2])
    loadings = np.zeros((n_series, 2))
    loadings[:10, 0] = 1.0
    loadings[10:, 1] = 1.0
    frame = _panel(n_series, n_obs, factors, loadings, noise=0.3, seed=4)

    result = fit(frame, as_of="2020-01-01", label="test", k=2)
    assert len(result.components) == 2

    design = np.column_stack([np.ones(n_obs), result.scores["PC1"], result.scores["PC2"]])
    for true_factor in (f1, f2):
        coeffs, residuals, *_ = np.linalg.lstsq(design, true_factor, rcond=None)
        fitted = design @ coeffs
        ss_res = float(np.sum((true_factor - fitted) ** 2))
        ss_tot = float(np.sum((true_factor - true_factor.mean()) ** 2))
        r2 = 1.0 - ss_res / ss_tot
        assert r2 > 0.85, f"factor not recovered in the PC1/PC2 span: R^2={r2:.3f}"


def test_pure_noise_yields_a_low_first_eigenvalue_share():
    """No common factor at all: PC1 should not dominate the way it does when
    one exists — the negative control for the two tests above."""
    rng = np.random.default_rng(5)
    n_obs, n_series = 200, 20
    frame = pd.DataFrame(
        rng.normal(size=(n_obs, n_series)),
        index=pd.date_range("2000-01-01", periods=n_obs, freq="MS", tz="UTC"),
        columns=[f"S{i}" for i in range(n_series)],
    )
    result = fit(frame, as_of="2020-01-01", label="noise", k=1)
    pc1 = result.components[0]
    # With no structure, PC1 of a 20-series panel should explain a modest
    # share — well under half, unlike the >85% in the single-factor test.
    assert pc1.explained_variance_ratio < 0.35


def test_scores_reconstruct_the_standardised_panel_approximately():
    """loadings @ scores.T should approximate z for the retained components —
    this is what 'loadings' MEANS, and a units mismatch would break it."""
    rng = np.random.default_rng(6)
    n_obs, n_series = 200, 15
    common = np.cumsum(rng.normal(size=n_obs)).reshape(-1, 1)
    loadings_true = rng.normal(size=(n_series, 1))
    frame = _panel(n_series, n_obs, common, loadings_true, noise=0.2, seed=7)

    result = fit(frame, as_of="2020-01-01", label="test", k=1)
    from ace.state.transforms import standardize
    z, _, _ = standardize(frame)
    z = z.loc[result.dates, list(result.series)]

    loading_vec = result.components[0].loadings.reindex(result.series).to_numpy()
    score_vec = result.scores["PC1"].to_numpy()
    reconstructed = np.outer(score_vec, loading_vec)
    # Correlation, not exact equality — noise and dropped components mean this
    # is an approximation, but a units bug would show up as near-zero correlation.
    flat_a, flat_b = reconstructed.flatten(), z.to_numpy().flatten()
    corr = np.corrcoef(flat_a, flat_b)[0, 1]
    assert corr > 0.9


def test_too_few_series_after_standardising_raises():
    idx = pd.date_range("2000-01-01", periods=100, freq="MS", tz="UTC")
    frame = pd.DataFrame({"A": np.arange(100.0)}, index=idx)
    with pytest.raises(ValueError, match="usable series"):
        fit(frame, as_of="2020-01-01")


def test_domain_panels_drops_groups_below_the_minimum_size():
    idx = pd.date_range("2000-01-01", periods=50, freq="MS", tz="UTC")
    frame = pd.DataFrame(
        {f"S{i}": np.random.default_rng(i).normal(size=50) for i in range(6)},
        index=idx,
    )
    groups = {"big": tuple(f"S{i}" for i in range(5)), "small": ("S5",)}
    result = domain_panels(frame, groups)
    assert "big" in result and "small" not in result
    assert list(result["big"].columns) == [f"S{i}" for i in range(5)]


def test_domain_panels_only_includes_columns_present_in_the_frame():
    idx = pd.date_range("2000-01-01", periods=50, freq="MS", tz="UTC")
    frame = pd.DataFrame({"A": np.zeros(50), "B": np.zeros(50)}, index=idx)
    groups = {"g": ("A", "B", "MISSING", "ALSO_MISSING")}
    # Only 2 of 4 members present -> below the size-4 floor -> dropped.
    assert domain_panels(frame, groups) == {}


def test_cumulative_variance_is_monotonic_and_bounded():
    rng = np.random.default_rng(9)
    n_obs, n_series = 200, 15
    frame = pd.DataFrame(
        rng.normal(size=(n_obs, n_series)),
        index=pd.date_range("2000-01-01", periods=n_obs, freq="MS", tz="UTC"),
        columns=[f"S{i}" for i in range(n_series)],
    )
    result = fit(frame, as_of="2020-01-01", label="test", k=5)
    cumulative = [c.cumulative_variance_ratio for c in result.components]
    assert cumulative == sorted(cumulative)
    assert cumulative[-1] <= 1.0 + 1e-9


def test_a_component_is_sign_oriented_to_majority_positive():
    from ace.factors.pca import _orient_component

    loading = pd.Series({"A": -1.0, "B": -0.9, "C": 0.1})
    score = pd.Series([1.0, 2.0, -3.0])
    out_loading, out_score = _orient_component(loading, score)
    assert out_loading.sum() > 0
    pd.testing.assert_series_equal(out_score, -score)


# --- the balanced-matrix construction: coverage floor + overlap trim --------

def test_a_column_with_internal_gaps_is_dropped_and_reported():
    """A column that is patchy WITHIN its own active range — real values, then
    holes, scattered throughout, the signature of a genuinely broken feed —
    must be dropped and named, not allowed to veto every other column's data
    via a naive full-panel listwise deletion (see the module docstring for the
    measured 166-of-167-columns failure this replaced)."""
    from ace.factors.pca import _balanced_matrix

    idx = pd.date_range("2000-01-01", periods=200, freq="MS", tz="UTC")
    rng = np.random.default_rng(1)
    frame = pd.DataFrame({f"S{i}": rng.normal(size=200) for i in range(10)}, index=idx)
    # Active the whole window, but only 40% of months inside it are non-null —
    # scattered, not a late start, so this must fail the WITHIN-RANGE coverage
    # measure rather than surviving via a late-start exemption.
    patchy = rng.normal(size=200)
    mask = rng.random(200) < 0.6
    patchy[mask] = np.nan
    frame["PATCHY"] = patchy

    result = _balanced_matrix(frame)
    assert "PATCHY" in result.dropped_columns
    assert result.dropped_columns["PATCHY"] < 0.90
    assert "PATCHY" not in result.frame.columns
    assert len(result.frame) > 0
    assert len(result.frame.columns) == 10


def test_a_column_that_simply_started_late_is_NOT_dropped_for_coverage():
    """The regression this guards directly: on the live comprehensive panel, a
    coverage measure taken against the FULL panel window (rather than each
    column's own active range) starved four entire domain blocks — banking,
    commodities, manufacturing, trade_external — to zero surviving columns.
    A commodity index starting in 2015 inside a panel that starts in 1980 is
    perfectly dense once it exists; it must clear the coverage floor and be
    handled by the overlap-trim step, not be treated as low-quality data."""
    from ace.factors.pca import _balanced_matrix

    idx = pd.date_range("1980-01-01", periods=561, freq="MS", tz="UTC")
    rng = np.random.default_rng(2)
    frame = pd.DataFrame({f"S{i}": rng.normal(size=561) for i in range(5)}, index=idx)
    late = np.full(561, np.nan)
    late[500:] = rng.normal(size=61)  # starts in month 501 of 561 (~11% of the window)
    frame["LATE_START"] = late

    result = _balanced_matrix(frame)
    assert "LATE_START" not in result.dropped_columns, (
        "a late-starting but internally dense column must not be dropped for coverage"
    )
    assert "LATE_START" in result.frame.columns


def test_survivors_are_trimmed_to_their_overlap_not_the_union():
    """A column starting late must not just be admitted with leading NaN —
    the balanced frame must contain no NaN at all, on the overlap of every
    surviving column's own valid range. The gap is 9 of 100 months (91%
    coverage): enough to clear the coverage floor, so this exercises the
    OVERLAP TRIM specifically rather than the coverage drop the next test
    covers."""
    from ace.factors.pca import _balanced_matrix

    idx = pd.date_range("2000-01-01", periods=100, freq="MS", tz="UTC")
    rng = np.random.default_rng(2)
    early = pd.Series(rng.normal(size=100), index=idx)
    late = pd.Series(rng.normal(size=100), index=idx)
    late.iloc[:9] = np.nan  # starts 9 months later; 91% coverage clears the floor
    frame = pd.DataFrame({"EARLY": early, "LATE": late})

    result = _balanced_matrix(frame)
    assert result.dropped_columns == {}
    assert not result.frame.isna().any().any()
    assert result.frame.index.min() == idx[9]
    assert result.frame.index.max() == idx[-1]


def test_an_empty_balanced_matrix_raises_a_clear_error_not_a_crash():
    """The original defect, reproduced directly: a panel where no column
    clears the coverage floor must fail with a message naming the columns and
    their coverage, never with an unrelated ZeroDivisionError three calls away
    from the actual cause. Each column is scattered-patchy throughout its own
    active range (not merely late-starting, which the coverage floor now
    correctly tolerates — see the test above), so it genuinely fails the 90%
    WITHIN-RANGE floor rather than being exempted by a late start."""
    from ace.factors.pca import fit

    idx = pd.date_range("2000-01-01", periods=100, freq="MS", tz="UTC")
    rng = np.random.default_rng(9)
    frame = pd.DataFrame(index=idx)
    for i in range(5):
        col = rng.normal(size=100)
        mask = rng.random(100) < 0.4  # ~60% coverage, scattered, under the floor
        col[mask] = np.nan
        frame[f"S{i}"] = col

    with pytest.raises(ValueError, match="no balanced window survives"):
        fit(frame, as_of="2020-01-01", label="test")


def test_a_fully_dense_panel_drops_nothing_for_coverage():
    rng = np.random.default_rng(3)
    idx = pd.date_range("2000-01-01", periods=150, freq="MS", tz="UTC")
    frame = pd.DataFrame(
        {f"S{i}": rng.normal(size=150) for i in range(10)}, index=idx
    )
    result = fit(frame, as_of="2020-01-01", label="test", k=1)
    assert result.dropped_for_coverage == {}
    assert result.n_series == 10


def test_dropped_for_coverage_reaches_the_serialised_dict():
    """SPARSE is scattered-patchy across its whole active range (86.7% of 150
    months present, at random positions) rather than merely late-starting —
    the case the coverage floor is actually meant to catch."""
    idx = pd.date_range("2000-01-01", periods=150, freq="MS", tz="UTC")
    rng = np.random.default_rng(4)
    frame = pd.DataFrame({f"S{i}": rng.normal(size=150) for i in range(10)}, index=idx)
    sparse = rng.normal(size=150)
    mask = rng.random(150) < 0.133  # ~86.7% coverage, scattered, below the floor
    sparse[mask] = np.nan
    frame["SPARSE"] = sparse

    result = fit(frame, as_of="2020-01-01", label="test", k=1)
    assert "SPARSE" in result.dropped_for_coverage
    assert "SPARSE" in result.to_dict()["dropped_for_coverage"]
    assert "SPARSE" not in result.series
