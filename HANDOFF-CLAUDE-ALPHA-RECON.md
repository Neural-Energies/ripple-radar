# Alpha Recon — Claude handoff

**Date:** 2026-09-21
**From:** Grok Bot Chief of Staff (Joshua Dawson / Neural-Energies)
**Stop state:** Specialist bots frozen. Need write access for full local WIP dump.

## Product
Working name was Ripple Radar. Next repo name: **alpha-recon**.
Event-agnostic market intelligence desk. Discover world events → full research object (scenarios, probs, game theory, causal graph, exposures, crowding≠confirmation, invalidation, lifecycle).
Slogan: Don't trade the headline. Trade what the headline causes next.

## Non-negotiables
1. Zero hardcoded production events
2. Causal graph before tickers
3. Importance ≠ probability
4. Family-appropriate scenarios
5. Unknown events must still build complete object
6. No fake tickers / fake AUM / costume metrics
7. Crowding ≠ confirmation
8. LLM labels ≠ calibrated probability
9. Never rewrite historical forecasts (freeze-at-T)
10. Free/delayed data policy

## Already on main
- FRED+ALFRED delayed macro @ 4782bce
- RSS dual-clock cleanup @ 73b75f3

## Still local-only on CoS box (not in this PR yet)
UX fidelity cut, ML routing thin wire (RIPPLE_MODEL_ROUTING default-off), docs bible, GTM packs. CoS will push those when write PAT available.

## Holds
As-of step 2, other free adapters (Treasury/EIA/EDGAR/BLS), GTM publish, FinEng kernels.

## Claude first steps
1. Reconcile any remaining local WIP onto main
2. Create/own alpha-recon repo if not created
3. Keep invariants; ask Joshua for FRED_API_KEY + phone pass
