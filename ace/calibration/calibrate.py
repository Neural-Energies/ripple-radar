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


def fit_calibrator(y_oof: np.ndarray, p_oof: np.ndarray, *, base_rate: float) -> tuple[Calibrator, str]:
    """Choose between identity / Platt / isotonic on out-of-fold predictions.

    Selection is by Brier score on those same out-of-fold rows. Identity is a
    real candidate: if the raw estimator is already calibrated, adding a
    transform only adds variance.
    """
    y = np.asarray(y_oof, dtype=float).ravel()
    p = np.clip(np.asarray(p_oof, dtype=float).ravel(), 1e-6, 1 - 1e-6)

    candidates: list[Calibrator] = [Calibrator("identity", None)]
    try:
        platt = LogisticRegression(C=1e6, solver="lbfgs", max_iter=1000)
        platt.fit(np.log(p / (1 - p)).reshape(-1, 1), y)
        candidates.append(Calibrator("platt", platt))
    except Exception:
        pass
    try:
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
        iso.fit(p, y)
        candidates.append(Calibrator("isotonic", iso))
    except Exception:
        pass

    scored = []
    for c in candidates:
        rep = evaluate(y, c.transform(p), base_rate=base_rate)
        scored.append((rep.brier, c, rep))
    scored.sort(key=lambda t: t[0])
    best_brier, best, best_rep = scored[0]
    note = " | ".join(f"{c.method}={b:.5f}" for b, c, _ in scored)
    return best, f"selected {best.method} (brier {best_brier:.5f}); candidates: {note}"
