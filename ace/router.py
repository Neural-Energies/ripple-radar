"""ACE model router and output contract (§3, §42, §51).

Routes an analysis request to the engines that are actually validated for it,
and returns one structured response. Two rules govern everything here:

1. An engine that failed validation is not routed to. The registry decides —
   a model is reachable only at PRODUCTION status, so a FAILED model cannot
   serve a forecast even if its artifact is on disk.
2. When no validated engine covers a request, the response says so. It never
   degrades to a heuristic or an LLM estimate to fill the shape the caller
   expected (§51).

The LLM sits strictly after this: it may narrate `ACEResponse`, never populate
it.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

from ace.registry.registry import production_model


@dataclass
class ACEResponse:
    analysis_id: str
    timestamp: str
    as_of: str
    target: str
    horizon: str
    prediction: dict = field(default_factory=dict)
    scenario_probabilities: dict = field(default_factory=dict)
    expected_impact: dict = field(default_factory=dict)
    uncertainty: dict = field(default_factory=dict)
    model_agreement: dict = field(default_factory=dict)
    regime: dict = field(default_factory=dict)
    drivers: list = field(default_factory=list)
    historical_analogs: list = field(default_factory=list)
    model_metadata: dict = field(default_factory=dict)
    data_quality: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    available: bool = True
    unavailable_reason: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2, default=str)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def unavailable(analysis_id: str, target: str, reason: str) -> ACEResponse:
    """The honest empty response (§51).

    Returned instead of a number whenever the data or a validated model is
    missing. Callers render the reason; nothing downstream invents a value.
    """
    return ACEResponse(
        analysis_id=analysis_id, timestamp=_now(), as_of=_now(),
        target=target, horizon="", available=False, unavailable_reason=reason,
        warnings=[f"ACE FORECAST UNAVAILABLE: {reason}"],
    )


# Which engines are validated for which analysis, and at what strength.
# `forecast` means the output may be presented as a prediction; `descriptive`
# means it may only label the present. This table is the gate between research
# and anything user-facing.
CAPABILITIES: dict[str, dict[str, Any]] = {
    "regime": {"engine": "ace.regime.markov", "strength": "descriptive",
               "note": "labels the current volatility environment; NOT a volatility forecast "
                       "(incremental R2 +0.015, CI [-0.571, +0.230] out of sample)"},
    "game_equilibrium": {"engine": "ace.game.solver", "strength": "exact",
                         "note": "equilibria are computed and verified; the PAYOFFS remain an assumption"},
    "historical_analogs": {"engine": "ace.analogs.historical", "strength": "descriptive",
                           "note": "retrieval over past states; reports an outcome distribution, not a forecast"},
    "transmission": {"engine": "ace.ripple.transmission", "strength": "descriptive",
                     "note": "contemporaneous co-movement is stable (72% out-of-sample survival); "
                             "NO stable lead-lag structure was found, so no tradeable lag is claimed"},
    "scenario_probability": {"engine": None, "strength": "none",
                             "note": "ace_shock_persistence v1 FAILED out-of-sample validation"},
    "event_impact": {"engine": None, "strength": "none",
                     "note": "ace_macro_impact v1 FAILED on both direction and magnitude"},
}


def capability(analysis_type: str) -> dict:
    """What ACE may honestly claim for an analysis type."""
    return CAPABILITIES.get(analysis_type, {"engine": None, "strength": "none", "note": "no engine built"})


def route(analysis_type: str, analysis_id: str, target: str) -> ACEResponse | None:
    """Return an unavailable response when nothing validated covers the request.

    Returns None when the caller MAY proceed to invoke the engine itself.
    """
    cap = capability(analysis_type)
    if cap["strength"] == "none":
        return unavailable(analysis_id, target, cap["note"])
    return None


def model_is_servable(model_id: str) -> bool:
    """A model may serve only at PRODUCTION status — never FAILED or CANDIDATE."""
    return production_model(model_id) is not None
