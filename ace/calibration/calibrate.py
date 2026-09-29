"""Out-of-sample probability calibration (§8).

The rule that makes this honest: a calibrator is fit on predictions the
underlying estimator did NOT train on. Fitting Platt/isotonic on in-sample
scores produces a calibration curve that looks perfect in development and
falls apart in production, because the estimator's training-set confidence is
not the confidence it will have on new data.

So the caller passes out-of-fold predictions — produced by the walk-forward
loop, where every prediction came from a model blind to that row.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression

from ace.metrics.classification import evaluate


@dataclass
class Calibrator:
    method: str
    model: object

    def transform(self, p: np.ndarray) -> np.ndarray:
        p = np.clip(np.asarray(p, dtype=float).ravel(), 1e-6, 1 - 1e-6)
        if self.method == "identity":
            return p
        if self.method == "isotonic":
            return np.clip(self.model.predict(p), 1e-6, 1 - 1e-6)  # type: ignore[union-attr]
        # Platt: logistic on the log-odds of the raw score
        z = np.log(p / (1 - p)).reshape(-1, 1)
        return np.clip(self.model.predict_proba(z)[:, 1], 1e-6, 1 - 1e-6)  # type: ignore[union-attr]


#: Simplest first: on a tie the transform that adds least variance wins.
METHODS = ("identity", "platt", "isotonic")

#: Rows a calibrator must be fitted on before its predictions are trusted,
#: and cross-fitted rows needed before a non-identity choice is allowed.
MIN_FIT_ROWS = 50
MIN_SELECT_ROWS = 100


def _fit_method(method: str, y: np.ndarray, p: np.ndarray) -> Calibrator:
    p = np.clip(np.asarray(p, dtype=float).ravel(), 1e-6, 1 - 1e-6)
    if method == "identity":
        return Calibrator("identity", None)
    if method == "platt":
        platt = LogisticRegression(C=1e6, solver="lbfgs", max_iter=1000)
        platt.fit(np.log(p / (1 - p)).reshape(-1, 1), y)
        return Calibrator("platt", platt)
    if method == "isotonic":
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
        iso.fit(p, y)
        return Calibrator("isotonic", iso)
    raise ValueError(f"unknown calibration method {method!r}")


def cross_fit(y: np.ndarray, p: np.ndarray, groups: np.ndarray, method: str) -> np.ndarray:
    """Calibrated predictions, each from a calibrator that never saw its row.

    `groups` orders the rows in time (the walk-forward fold each out-of-fold
    prediction came from). Every row in group g is transformed by a `method`
    fitted only on rows from groups before g — forward, so no calibrated value
    depends on its own label or on a later one. The first group has nothing
    before it and is NaN, as is any group whose past is too small to fit on;
    identity needs no fit and is defined everywhere.
    """
    y = np.asarray(y, dtype=float).ravel()
    p = np.asarray(p, dtype=float).ravel()
    groups = np.asarray(groups).ravel()
    out = np.full(len(p), np.nan)
    if method == "identity":
        return np.clip(p, 1e-6, 1 - 1e-6)
    for g in np.unique(groups):
        past, now = groups < g, groups == g
        if past.sum() < MIN_FIT_ROWS or len(np.unique(y[past])) < 2:
            continue
        try:
            out[now] = _fit_method(method, y[past], p[past]).transform(p[now])
        except Exception:
            continue
    return out


def fit_calibrator(
    y_oof: np.ndarray, p_oof: np.ndarray, *, base_rate: float, groups: np.ndarray
) -> tuple[Calibrator, str]:
    """Choose identity / Platt / isotonic, then refit the choice on every row.

    Selection is by Brier score on FORWARD CROSS-FITTED predictions
    (`cross_fit`), compared on the rows every candidate covers. An earlier
    version fitted each candidate on the out-of-fold rows and scored it on
    those same rows, which rewards flexibility: on a correctly calibrated
    synthetic sample (n=80) isotonic "won" with training Brier .1510 against
    identity's .1774, while its expected Brier on new data was .1930 against
    .1825. Identity is a real candidate: if the raw estimator is already
    calibrated, adding a transform only adds variance.

    `groups` is required — the chronological fold of each row — so no caller
    can fall back to scoring a calibrator on its own training rows.
    """
    y = np.asarray(y_oof, dtype=float).ravel()
    p = np.clip(np.asarray(p_oof, dtype=float).ravel(), 1e-6, 1 - 1e-6)
    groups = np.asarray(groups).ravel()
    if len(groups) != len(y):
        raise ValueError(f"groups has {len(groups)} rows, predictions have {len(y)}")

    preds = {m: cross_fit(y, p, groups, m) for m in METHODS}
    common = np.all([np.isfinite(v) for v in preds.values()], axis=0)
    if common.sum() < MIN_SELECT_ROWS:
        return Calibrator("identity", None), (
            f"selected identity: only {int(common.sum())} cross-fitted rows, "
            f"fewer than {MIN_SELECT_ROWS} needed to prefer a fitted transform"
        )

    scored = sorted(
        ((evaluate(y[common], preds[m][common], base_rate=base_rate).brier, i, m)
         for i, m in enumerate(METHODS)),
    )
    best_brier, _, best = scored[0]
    note = " | ".join(f"{m}={b:.5f}" for b, _, m in scored)
    return _fit_method(best, y, p), (
        f"selected {best} (cross-fitted brier {best_brier:.5f} on {int(common.sum())} rows); "
        f"candidates: {note}"
    )


def calibrate_members(
    y: np.ndarray, P: np.ndarray, groups: np.ndarray, *, base_rate: float
) -> tuple[list[Calibrator], np.ndarray]:
    """Calibrate each column of `P` for a stack.

    Returns one calibrator per column (chosen by `fit_calibrator` and refitted
    on every row — what later data is transformed with) and the matrix a stack
    may be trained on: each column's forward cross-fitted values under the
    method chosen for it, NaN where that method had no past to fit on. Training
    the stack on `cal.transform(P)` instead would hand it values each row's own
    label helped shape.
    """
    P = np.asarray(P, dtype=float)
    cals, cols = [], []
    for j in range(P.shape[1]):
        cal, _ = fit_calibrator(y, P[:, j], base_rate=base_rate, groups=groups)
        cals.append(cal)
        cols.append(cross_fit(y, P[:, j], groups, cal.method))
    return cals, np.column_stack(cols)
