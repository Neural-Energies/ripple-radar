"""Mandatory baselines (§6). Nothing is promoted without beating these."""
from __future__ import annotations

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


class BaseRate:
    """Always predict the training base rate. The bar everything must clear."""

    def __init__(self) -> None:
        self.p = 0.5

    def fit(self, X, y):
        self.p = float(np.mean(y))
        return self

    def predict_proba(self, X):
        p = np.full(len(X), self.p)
        return np.column_stack([1 - p, p])


class MomentumPersistence:
    """Domain baseline: a shock continues iff recent momentum agrees with it.

    This is the rule a trader would apply without any model, so it is the
    honest thing for a learned model to have to beat — not just the base rate.
    """

    def __init__(self, feature_names: list[str]) -> None:
        self.names = feature_names
        self.rate_agree = 0.5
        self.rate_disagree = 0.5

    def fit(self, X, y):
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=float)
        i_shock = self.names.index("shock_z")
        i_mom = self.names.index("mom_20d")
        agree = np.sign(X[:, i_shock]) == np.sign(X[:, i_mom])
        self.rate_agree = float(y[agree].mean()) if agree.any() else float(y.mean())
        self.rate_disagree = float(y[~agree].mean()) if (~agree).any() else float(y.mean())
        return self

    def predict_proba(self, X):
        X = np.asarray(X, dtype=float)
        i_shock = self.names.index("shock_z")
        i_mom = self.names.index("mom_20d")
        agree = np.sign(X[:, i_shock]) == np.sign(X[:, i_mom])
        p = np.where(agree, self.rate_agree, self.rate_disagree)
        return np.column_stack([1 - p, p])


def logistic_baseline(seed: int) -> Pipeline:
    """Regularized logistic regression on standardized features."""
    return Pipeline(
        [
            ("scale", StandardScaler()),
            ("clf", LogisticRegression(C=0.1, max_iter=2000, solver="lbfgs", random_state=seed)),
        ]
    )
