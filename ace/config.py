"""Paths and universe for the ACE quantitative stack.

Everything here is deliberately file-based. The app deploys as a Node bundle,
so a heavyweight tracking server (MLflow) is not available at inference time;
the registry in `ace.registry` implements the §4 metadata contract on top of
JSON + hashed artifacts instead, which is portable and reproducible without a
service to keep alive.
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = Path(os.environ.get("ACE_ARTIFACTS", ROOT / "artifacts"))
CACHE = ARTIFACTS / "cache"
MODELS = ARTIFACTS / "models"
REGISTRY_PATH = ARTIFACTS / "registry.json"
REPORTS = ARTIFACTS / "reports"

for _p in (ARTIFACTS, CACHE, MODELS, REPORTS):
    _p.mkdir(parents=True, exist_ok=True)

# Liquid, long-history instruments spanning the transmission channels the desk
# reasons about. Kept deliberately small and liquid: a survivorship-free, fully
# quoted universe matters more than breadth for a first honest model.
UNIVERSE: tuple[str, ...] = (
    "SPY", "QQQ", "IWM", "DIA",          # broad equity
    "XLE", "XLF", "XLI", "XLK", "XLV", "XLP", "XLU", "XLB",  # sectors
    "USO", "UNG", "GLD", "SLV", "DBA",   # commodities
    "TLT", "IEF", "SHY", "HYG", "LQD",   # rates / credit
    "UUP", "FXE", "FXY",                 # FX
    "EEM", "EFA", "FXI",                 # international
    "VIXY",                              # volatility
)

RANDOM_SEED = 17
