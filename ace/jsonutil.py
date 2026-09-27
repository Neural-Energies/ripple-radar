"""Shared JSON safety: NaN and Infinity are not valid JSON.

Python's `json.dumps` writes a bare Python float NaN/inf as the literal
tokens `NaN` / `Infinity` by default — valid Python, not valid JSON (RFC
8259 has no such tokens), and a strict external parser refuses the file
outright. `ace.regime.mean_vs_variance` already hit this and fixed it
locally (`_jsonable`, plus `allow_nan=False` on the dump to make a missed
spot raise instead of writing bad JSON again); this is that same fix,
shared, for the factor-engine modules that report a value as NaN on purpose
(`ace.factors.factor_state`'s `uncertainty`, `ace.factors.news`'s grouped-
revision `weight`) rather than duplicating it per module.
"""
from __future__ import annotations

import numpy as np


def to_json_safe(value):
    """Recursively replace every non-finite float with `None`.

    A missing or undefined measurement should read as `null` on the wire,
    not as a token a consumer may or may not accept.
    """
    if isinstance(value, dict):
        return {k: to_json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_json_safe(v) for v in value]
    if isinstance(value, (bool, str)) or value is None:
        return value
    if isinstance(value, (int, float, np.integer, np.floating)):
        number = float(value)
        return number if np.isfinite(number) else None
    return value
