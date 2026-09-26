# Validation

Use `ace/validation/walkforward.py` and `ace/validation/leakage.py`. Add a test next to the estimator. Do not add a score the model cannot compute yet.

## Every forecast

- Expanding window. The fit at date T uses observations available at T only.
- A baseline sits beside it. State for the factor model is the single best series it claims to summarize (payrolls for labor, CPI for inflation) in the same transform. Transmission baseline is the unconditional mean return at that horizon. Surprise baseline is "consensus equals the outcome."
- Report MAE or RMSE against that baseline. A model that does not beat it stays out of the production registry.
- Record the window, the metric, and the baseline name on the provenance block.

## Regime probabilities

- Brier score and a reliability table on the filtered probabilities.
- AUROC only if the label is a binary event defined without the future of the same series (NBER dates are allowed because they are an external label; the revised quad is not).
- Assert filtered probabilities differ from smoothed ones on a sample that is long enough to show it. `ace/regime/markov.py` already has this rule.

## Transmission

- Newey-West SE with bandwidth at least the horizon.
- Negative horizons estimated and stored. If they are not flat, `pretrend_ok` is false.
- Coverage of the interval on the walk-forward, not just in-sample.

## What changed

- A fixture vintage where one new observation is revealed. The attribution to that observation is stable across two runs. Other contributions stay put.
- No attribution test that starts from a hand-written delta.

## ACE

- Feed a payload with one known number. The paragraph may contain that number.
- Feed a payload missing `expected_return`. The paragraph must not contain a return.

## Commands

From the repo root, after the slice exists:

```text
python -m pytest ace/tests/test_macro.py ace/tests/test_quads.py ace/tests/test_causal.py
```

Add the new test module to that list in the same change. TypeScript desk tests that already cover FRED parsing and monitors stay green: `macro-regime.test.ts`, `macro-monitors.test.ts`, `macro-hlw.test.ts`.
