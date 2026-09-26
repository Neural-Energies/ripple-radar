# Slice schemas

These are the objects the first US slice must be able to emit. Fields with no estimator stay absent. Do not put `null` where a reader might treat it as zero, and do not invent a fill.

## Provenance (required on every object)

```text
model_name
model_version
training_start
training_end
as_of_date
features
target
forecast_horizon
training_method
validation_method
performance_metrics
calibration_metrics
data_version
code_version
last_fit_time
```

## Macro state

One block each for `growth`, `inflation`, `labor`.

```text
level
momentum
acceleration
percentile
uncertainty
direction
last_update
drivers[{series, contribution}]
freshness
```

`direction` is the sign of momentum, not a hand label.

## Regime

```text
as_of_date
probabilities[{name, previous, current, delta}]
drivers[{name, contribution}]
filtered: true
```

`filtered` must be true. Smoothed probabilities are a diagnostic and cannot be the emitted vector.

## Surprise

```text
release
vintage_time
actual
consensus
previous
raw_surprise
surprise_std
standardized_surprise
```

`standardized_surprise` is omitted when fewer than the predeclared minimum of past surprises exist. Do not use a default std.

## Transmission and distribution

One block per market (`us2y`, `us10y`, `nq`, `es`, `dxy`, `gold`) and horizon (`1d`, `5d`, `20d`).

```text
coef
se
ci_low
ci_high
pretrend_ok
probability_positive
expected_return
median
q10
q90
```

`pretrend_ok` is false when the negative-horizon placebo moves. A failed placebo is reported; it is not dropped silently.

## What changed

```text
previous_run_id
current_run_id
deltas[{field, previous, current}]
contributors[{observation, contribution}]
```

If `previous_run_id` does not exist, the block is `{status: "no_prior_run"}`. That is the whole story.

## ACE input

The narration function accepts only:

```text
macro_state
regime_probabilities
expectations
economic_surprises
transmission
market_forecasts
attribution
validation
```

It returns text plus the list of JSON pointers it quoted. A test fails if a number in the text is not one of those pointers.
