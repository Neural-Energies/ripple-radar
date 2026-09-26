"""Stationarity transforms, on the FRED-MD convention.

McCracken and Ng publish FRED-MD with a transform code per series, because a
factor model fitted to a mix of levels and growth rates does not estimate what
anyone thinks it estimates: the levels dominate the covariance and the factors
become a slow trend plus noise. The codes are the standard answer, and the
codes themselves are a published convention rather than anyone's code:

    1  x                     already stationary
    2  Δx                    first difference
    3  Δ²x                   second difference
    4  log x                 level of a log
    5  Δ log x               log growth — the common one
    6  Δ² log x              log growth of a growth rate
    7  Δ(x_t / x_{t-1} − 1)  change in a simple growth rate

REIMPLEMENTED FROM THE PUBLISHED METHODOLOGY, not copied. `joe5saia/FredMD`
(MIT) implements the same table; this module was written from the definitions
so that Ripple owns the behaviour it ships, and so the leakage properties below
are ours to guarantee.

THE PROPERTY THAT MATTERS HERE

Every transform is CAUSAL: the value at t uses only observations at or before
t. No centred differences, no filters that peek forward, no interpolation
across a gap. A transform that used x[t+1] would leak a future observation into
a historical feature and nothing downstream could detect it, because the series
would still look perfectly ordinary.

Differencing shortens the series from the front, never the back. That is why
each function returns a series of the same index with leading NaN rather than a
shorter one: the caller aligns on the index, and a silently shortened series is
how two panels end up misaligned by one month.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

#: The published FRED-MD codes. Keys are the codes; values are what they mean.
TRANSFORM_NAMES: dict[int, str] = {
    1: "level",
    2: "first difference",
    3: "second difference",
    4: "log level",
    5: "log difference",
    6: "second log difference",
    7: "change in simple growth rate",
}

#: Codes that require strictly positive input, because they take a logarithm.
LOG_CODES = frozenset({4, 5, 6})


class TransformError(ValueError):
    """A series cannot carry the transform it was assigned.

    Raised rather than warned, and never substituted with a fallback: a series
    that silently falls back to a different transform than its code says is a
    series whose factor loading means something other than the label on it.
    """


def apply_code(series: pd.Series, code: int) -> pd.Series:
    """Apply one FRED-MD transform code.

    Returns a series on the SAME index, with leading NaN where the transform
    consumed observations. Non-positive values under a log code raise rather
    than producing `-inf` or silently dropping to NaN.
    """
    if code not in TRANSFORM_NAMES:
        raise TransformError(f"unknown transform code {code!r}")
    s = pd.to_numeric(series, errors="coerce").astype(float)

    if code in LOG_CODES:
        # A single zero or negative print turns log into -inf or NaN and the
        # factor model then fits a series with a hole in it. Say so instead.
        bad = s.dropna()
        if (bad <= 0).any():
            first = bad[bad <= 0].index[0]
            raise TransformError(
                f"transform {code} ({TRANSFORM_NAMES[code]}) needs positive values; "
                f"{series.name or 'series'} is {bad.loc[first]} at {first}"
            )

    if code == 1:
        return s
    if code == 2:
        return s.diff()
    if code == 3:
        return s.diff().diff()
    if code == 4:
        return np.log(s)
    if code == 5:
        return np.log(s).diff()
    if code == 6:
        return np.log(s).diff().diff()
    # code 7
    return (s / s.shift(1) - 1.0).diff()


def lags_consumed(code: int) -> int:
    """How many leading observations a code turns into NaN.

    The caller needs this to know how much history a series must have before it
    can contribute at all — and `panel.py` uses it to refuse a series that
    would join the panel with no usable observations.
    """
    return {1: 0, 2: 1, 3: 2, 4: 0, 5: 1, 6: 2, 7: 2}[code]


def apply_panel(frame: pd.DataFrame, codes: dict[str, int]) -> pd.DataFrame:
    """Transform every column by its own code.

    A column with no code is dropped rather than passed through untransformed:
    an unlabelled series in a factor panel is one whose stationarity nobody
    checked, and it would load on the factors regardless.
    """
    out: dict[str, pd.Series] = {}
    for column in frame.columns:
        code = codes.get(str(column))
        if code is None:
            continue
        out[str(column)] = apply_code(frame[column], code)
    if not out:
        return pd.DataFrame(index=frame.index)
    return pd.DataFrame(out, index=frame.index)


def standardize(
    frame: pd.DataFrame, *, mean: pd.Series | None = None, std: pd.Series | None = None
) -> tuple[pd.DataFrame, pd.Series, pd.Series]:
    """Z-score each column, returning the moments used.

    The moments are RETURNED so the caller can reuse them. A factor model
    fitted on a training window and then applied to a holdout must standardize
    the holdout with the TRAINING moments; recomputing them on the full sample
    leaks the holdout's mean and variance into the fit, which is the quiet
    version of training on the test set.
    """
    mu = frame.mean() if mean is None else mean
    sigma = frame.std(ddof=1) if std is None else std
    # A constant column has zero variance. Dividing by it gives inf, and a
    # column of inf silently dominates the first principal factor.
    safe = sigma.replace(0.0, np.nan)
    return frame.sub(mu, axis=1).div(safe, axis=1), mu, sigma
