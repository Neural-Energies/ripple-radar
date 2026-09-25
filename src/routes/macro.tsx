import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Axis, QuadGrid, QuadStrip } from "@/components/macro-quad-panel";
import { QUAD_TINT, monthLabel, ordinal, pct, signed } from "@/lib/ace/macro-format";
import { Panel, SectionLabel } from "@/components/ui";
import { getMacroDetail } from "@/lib/ace/macro-detail";
import {
  AGREEMENT,
  CURRENT_QUAD,
  DURATIONS,
  MARGIN_CALIBRATION,
  OCCUPANCY,
  POSITIONING_VALIDATED,
  PUBLICATION_LAGS,
  QUADS,
  QUAD_RUN,
  QUAD_TRANSITIONS,
  RETURNS_BY_CHANNEL,
  RETURNS_TEST,
  REVISION,
  REVISION_CONFUSION,
  SELECTION,
  SPECS,
  VOL_BY_CHANNEL,
  VOL_FORECAST_VALIDATED,
  VOL_TEST,
  confidenceOf,
  likelyNextQuads,
  specCalls,
  type Quad,
} from "@/lib/ace/macro-quads";

export const Route = createFileRoute("/macro")({ component: MacroPage });

const QUAD_LIST: Quad[] = [1, 2, 3, 4];

/**
 * The macro regime engine, with its uncertainty in front rather than in a
 * footnote.
 *
 * The classification is honest work — every reading built from first-release
 * vintages filtered to what had been published by its own date. Everything
 * else on this page exists because that alone would be misleading:
 *
 *   - A quarter of real-time labels did not survive revision, and almost
 *     three quarters of the failures flipped the GROWTH axis.
 *   - Under every specification tested, the median regime lasts two months.
 *   - Two forecasting claims built on the quad failed against their baselines.
 *
 * None of that makes the classification worthless. It makes it a LABEL, with
 * a stated shelf life and a stated error rate, which is a different and much
 * more defensible product than a regime signal.
 */
function MacroPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["macro-detail"],
    queryFn: () => getMacroDetail(),
    staleTime: 60 * 60 * 1000,
  });
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h1 className="text-title text-foreground">Macro regime</h1>
        <p className="max-w-3xl text-caption text-muted">
          The growth/inflation quad, classified from first-release data vintages filtered to what
          had actually been published on each date. {QUAD_RUN.nClassified} month-ends,{" "}
          {QUAD_RUN.first} to {QUAD_RUN.last}. What follows is the label and, in equal measure, how
          much it is worth.
        </p>
      </header>

      <LiveReading />

      <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
        <RevisionPanel />
        <AgreementPanel />
      </div>

      <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
        <PersistencePanel detail={data?.available ? data : null} />
        <TransitionPanel />
      </div>

      <SpecPanel detail={data?.available ? data : null} isLoading={isLoading} />

      <HistoryPanel detail={data?.available ? data : null} isLoading={isLoading} />

      <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
        <ReturnsTestPanel />
        <VolTestPanel />
      </div>

      <InputsPanel />

      <p className="pb-6 text-center text-micro text-subtle">
        Everything above is measured on this sample and re-measured on every run. The two gates —{" "}
        <span className="font-mono">POSITIONING_VALIDATED={String(POSITIONING_VALIDATED)}</span> and{" "}
        <span className="font-mono">VOL_FORECAST_VALIDATED={String(VOL_FORECAST_VALIDATED)}</span> —
        are written by the generator from those runs, never by hand. If a future run passes, this
        page changes on its own. Confidence grades are a rendering convention over measured numbers,
        not probabilities.
      </p>
    </div>
  );
}

function LiveReading() {
  const r = CURRENT_QUAD;
  const conf = confidenceOf(r);
  const growthDisagrees =
    r.growthYoy != null && r.growthRoc != null && r.growthYoy < 0 && r.growthRoc >= 0;
  const inflationDisagrees =
    r.inflationYoy != null && r.inflationRoc != null && r.inflationYoy > 0 && r.inflationRoc < 0;

  return (
    <Panel
      title="Where we are"
      action={
        <span className="font-mono text-micro text-subtle" title={SELECTION.rationale}>
          {SELECTION.chosen} · {SELECTION.lookback}-month rate of change
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[auto_1fr]">
        <div className="flex flex-col gap-1.5">
          <QuadGrid active={r.quad} />
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-title text-foreground">Q{r.quad}</span>
            <span className="text-body text-foreground">{r.name}</span>
          </div>
          <p className="max-w-[16rem] text-micro text-subtle">{r.description}</p>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Axis
            label="Growth"
            yoy={r.growthYoy}
            roc={r.growthRoc}
            through={r.growthThrough}
            lookback={SELECTION.lookback}
          />
          <Axis
            label="Inflation"
            yoy={r.inflationYoy}
            roc={r.inflationRoc}
            through={r.inflationThrough}
            lookback={SELECTION.lookback}
          />

          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-caption sm:grid-cols-3">
            <Stat label="Margin" value={r.margin?.toFixed(3) ?? "—"} hint={conf.marginBin ?? ""} />
            <Stat
              label="Held after revision"
              value={conf.marginUsable ? pct(conf.marginSurvival) : "—"}
              hint={
                conf.marginUsable ? `n=${REVISION.live.n} readings this close` : "too few to quote"
              }
            />
            <Stat
              label="Specs agreeing"
              value={`${conf.specAgreeing}/${conf.specTotal}`}
              hint={`median ${pct(AGREEMENT.historical.median)}`}
            />
            <Stat
              label="Data through"
              value={monthLabel(r.growthThrough)}
              hint={`${r.monthsBehind} month(s) behind`}
            />
            <Stat
              label="Spell so far"
              value={`${DURATIONS.current.elapsedMonths} mo`}
              hint={`since ${monthLabel(DURATIONS.current.start)}`}
            />
            <Stat
              label="Ends within 3mo"
              value={pct(DURATIONS.current.exitWithin["3"])}
              hint={DURATIONS.current.basis}
            />
          </dl>

          <p className="mt-1 text-caption text-muted">
            <span
              className={
                conf.grade === "firm"
                  ? "text-up"
                  : conf.grade === "mixed"
                    ? "text-warn"
                    : "text-core"
              }
            >
              {conf.grade === "firm"
                ? "Firm call"
                : conf.grade === "mixed"
                  ? "Mixed call"
                  : "Fragile call"}
            </span>{" "}
            — {conf.basis}.
          </p>

          {(growthDisagrees || inflationDisagrees) && (
            <p className="text-caption text-warn">
              Direction and level disagree.{" "}
              {growthDisagrees
                ? `Growth is ${signed(r.growthYoy)}% year-on-year — negative in level, but less negative than ${SELECTION.lookback} months ago. `
                : ""}
              {inflationDisagrees
                ? `Inflation is ${signed(r.inflationYoy)}% year-on-year and decelerating. `
                : ""}
              The quad reads the second derivative, so &ldquo;{r.name}&rdquo; describes the change,
              not the level.
            </p>
          )}
        </div>
      </div>

      {Object.keys(r.contributions).length > 0 && (
        <div className="mt-2">
          <SectionLabel>Inputs behind this reading</SectionLabel>
          <ul className="mt-1 grid gap-1 sm:grid-cols-2">
            {Object.entries(r.contributions).map(([sid, c]) => {
              const meta = PUBLICATION_LAGS[sid];
              const isGrowth = r.growthUsed.includes(sid);
              return (
                <li
                  key={sid}
                  className="flex items-baseline justify-between gap-2 rounded-md bg-card-2 px-2 py-1.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-caption text-foreground">
                      {meta?.label ?? sid}
                    </span>
                    <span className="text-micro text-subtle">
                      {isGrowth ? "growth" : "inflation"} · publishes ~{meta?.medianDays ?? "?"}d
                      late
                    </span>
                  </span>
                  <span className="shrink-0 text-right font-mono text-caption tabular-nums">
                    <span className="block text-subtle">{signed(c.yoy)}%</span>
                    <span className={c.roc >= 0 ? "block text-up" : "block text-down"}>
                      {signed(c.roc)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-micro text-subtle">{label}</dt>
      <dd className="font-mono text-caption tabular-nums text-foreground">{value}</dd>
      {hint ? <dd className="truncate text-micro text-subtle">{hint}</dd> : null}
    </div>
  );
}

function RevisionPanel() {
  const bins = Object.values(MARGIN_CALIBRATION);
  const maxN = Math.max(...bins.map((b) => b.n), 1);
  return (
    <Panel
      title="What revision costs"
      action={
        <span className="font-mono text-micro text-subtle">
          {pct(REVISION.pooledSurvival)} survived · n={REVISION.measuredOver.n}
        </span>
      }
    >
      <p className="text-micro text-subtle">
        Each historical reading was re-run on today&rsquo;s revised data, cut to the same months.
        The gap is revision risk. Readings from the last {REVISION.settlingMonths} months are
        excluded — the data has not had time to revise, so they would score as survivors by default.
      </p>

      <ul className="mt-1.5 flex flex-col gap-1">
        {bins.map((b) => (
          <li key={b.label} className="text-caption">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-muted">
                {b.label}{" "}
                <span className="text-micro text-subtle">
                  {b.lo.toFixed(2)}–{b.hi == null ? "∞" : b.hi.toFixed(2)}
                </span>
              </span>
              <span className="font-mono tabular-nums text-foreground">
                {b.usable ? pct(b.survival) : "—"}{" "}
                <span className="text-micro text-subtle">n={b.n}</span>
              </span>
            </div>
            <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-card-2">
              <div
                className={b.usable ? "h-full bg-primary/70" : "h-full bg-subtle/40"}
                style={{ width: `${((b.survival ?? 0) * 100).toFixed(1)}%` }}
              />
            </div>
            <div className="mt-0.5 h-0.5 w-full overflow-hidden rounded-full bg-card-2">
              <div
                className="h-full bg-muted/50"
                style={{ width: `${((b.n / maxN) * 100).toFixed(1)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-micro text-subtle">
        The bottom bar is how many readings fell in each bin. Most of them are in the thinnest one,
        which is the finding: the rates of change usually sit close to zero, so the quad is usually
        a near-tie that revision can overturn.
      </p>

      {REVISION.flipAxis.total > 0 && (
        <p className="mt-1.5 text-micro text-subtle">
          <span className="text-muted">
            {pct(REVISION.flipAxis.growthShare)} of the failures flipped the growth axis
          </span>{" "}
          ({REVISION.flipAxis.growth} of {REVISION.flipAxis.total}), against{" "}
          {REVISION.flipAxis.inflation} on inflation. Growth data revises far more than price data
          does, so the top row of the 2×2 is where a real-time quad is most likely to be wrong.
        </p>
      )}

      <div className="mt-2">
        <SectionLabel>Where a real-time label ended up</SectionLabel>
        <table className="mt-1 w-full text-caption">
          <thead>
            <tr className="text-micro text-subtle">
              <th className="text-left font-normal">real-time</th>
              {QUAD_LIST.map((q) => (
                <th key={q} className="text-right font-normal">
                  →Q{q}
                </th>
              ))}
              <th className="text-right font-normal">n</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {QUAD_LIST.map((q) => {
              const row = REVISION_CONFUSION[q];
              if (!row) return null;
              return (
                <tr key={q}>
                  <td className="text-left text-muted">
                    Q{q} {row.name}
                  </td>
                  {QUAD_LIST.map((c) => (
                    <td
                      key={c}
                      className={c === q ? "text-right text-foreground" : "text-right text-subtle"}
                    >
                      {(row.to[c] ?? 0).toFixed(2)}
                    </td>
                  ))}
                  <td className="text-right text-subtle">{row.n}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function AgreementPanel() {
  const calls = specCalls();
  const modal = AGREEMENT.modalQuad;
  return (
    <Panel
      title="How contingent the label is"
      action={
        <span className="font-mono text-micro text-subtle">
          {AGREEMENT.counts[String(modal)] ?? 0}/{AGREEMENT.nClassified} agree
        </span>
      }
    >
      <p className="text-micro text-subtle">
        One composite gives one answer and no sense of how much it depended on the choice. All{" "}
        {AGREEMENT.nSpecs} candidate specifications are run at export time, so the label comes with
        a vote rather than an assertion. Today sits at the{" "}
        {AGREEMENT.percentileToday != null
          ? `${ordinal(AGREEMENT.percentileToday * 100)} percentile`
          : "an unknown percentile"}{" "}
        of historical agreement (median {pct(AGREEMENT.historical.median)}, p25–p75{" "}
        {pct(AGREEMENT.historical.p25)}–{pct(AGREEMENT.historical.p75)}).
      </p>

      <ul className="mt-1.5 flex flex-col gap-0.5">
        {calls.map((s) => {
          const agrees = s.quadNow === modal;
          return (
            <li
              key={s.name}
              className="grid grid-cols-[minmax(0,6rem)_auto_1fr] items-baseline gap-2 text-caption"
              title={s.rationale}
            >
              <span className={agrees ? "truncate text-muted" : "truncate text-foreground"}>
                {s.name}
              </span>
              <span className="flex items-center gap-1 font-mono tabular-nums">
                {s.quadNow != null ? (
                  <>
                    <span
                      className={`inline-block size-1.5 rounded-full ${QUAD_TINT[s.quadNow as Quad]}`}
                    />
                    <span className={agrees ? "text-subtle" : "text-foreground"}>Q{s.quadNow}</span>
                  </>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </span>
              <span className="truncate text-micro text-subtle">
                {s.eligible ? (
                  <>
                    holdout survival {pct(s.survivalHoldout)} · median spell{" "}
                    {s.medianSpellMonths ?? "—"}mo
                  </>
                ) : (
                  <span className="text-core">disqualified — {s.disqualifiedBecause}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-micro text-subtle">
        Specifications that disagree with the majority are listed first. The chosen one is{" "}
        <span className="font-mono text-muted">{SELECTION.chosen}</span>, picked on the training
        window by {SELECTION.criterion.toLowerCase()} — it ranked {SELECTION.holdoutRank} of{" "}
        {SELECTION.nCandidatesRanked} on the holdout, which is the check on choosing the best of
        several on one sample.
      </p>
    </Panel>
  );
}

function PersistencePanel({
  detail,
}: {
  detail: { durationCurves: { pooled: { t: number; survival: number }[] } } | null;
}) {
  const curve = detail?.durationCurves?.pooled ?? [];
  return (
    <Panel
      title="How long a regime lasts"
      action={
        <span className="font-mono text-micro text-subtle">
          median {DURATIONS.pooled.medianMonths} mo · {DURATIONS.pooled.nSpells} spells
        </span>
      }
    >
      <p className="text-micro text-subtle">
        Kaplan-Meier, so the spell still running counts toward the risk set without being recorded
        as a short completed one. Treating it as finished — or dropping it — would bias every number
        here downward.
      </p>

      {curve.length > 0 && (
        <div className="mt-2">
          <div className="flex h-16 items-end gap-px">
            {curve.slice(0, 24).map((p) => (
              <div
                key={p.t}
                className="min-w-0 flex-1 bg-primary/50"
                style={{ height: `${Math.max(2, p.survival * 100)}%` }}
                title={`${p.t} months: ${pct(p.survival, 1)} of spells still running`}
              />
            ))}
          </div>
          <p className="mt-0.5 text-micro text-subtle">
            Share of spells still running after N months, 1 → {Math.min(24, curve.length)}.
          </p>
        </div>
      )}

      <ul className="mt-2 grid grid-cols-2 gap-1 text-caption sm:grid-cols-4">
        {QUAD_LIST.map((q) => {
          const d = DURATIONS.byQuad[q];
          return (
            <li key={q} className="rounded-md bg-card-2 px-2 py-1.5">
              <div className="flex items-center gap-1">
                <span className={`inline-block size-1.5 rounded-full ${QUAD_TINT[q]}`} />
                <span className="text-micro text-subtle">Q{q}</span>
              </div>
              <div className="font-mono text-caption tabular-nums text-foreground">
                {d?.usable ? `${d.medianMonths} mo` : "—"}
              </div>
              <div className="text-micro text-subtle">{d?.nCompleted ?? 0} completed</div>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-caption text-warn">
        The median spell is {DURATIONS.pooled.medianMonths} months — and it is{" "}
        {DURATIONS.pooled.medianMonths} months under every specification tested, including the
        broadest and the slowest. A framework presented as quarterly regimes produces, on honest
        point-in-time monthly data, a label that changes about every two months.
      </p>

      <div className="mt-2">
        <SectionLabel>Where the last two years were actually spent</SectionLabel>
        <ul className="mt-1 flex flex-col gap-1">
          {[24, 12, 6, 3].map((w) => {
            const o = OCCUPANCY[w];
            if (!o) return null;
            return (
              <li key={w} className="flex items-center gap-2 text-caption">
                <span className="w-10 shrink-0 text-micro text-subtle">{w}mo</span>
                <span className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-sm">
                  {QUAD_LIST.map((q) => {
                    const share = o.shares[String(q)] ?? 0;
                    if (!share) return null;
                    return (
                      <span
                        key={q}
                        className={QUAD_TINT[q]}
                        style={{ width: `${share * 100}%` }}
                        title={`Q${q} ${QUADS[q]?.name} — ${pct(share)}`}
                      />
                    );
                  })}
                </span>
                <span className="w-28 shrink-0 text-right font-mono text-micro tabular-nums text-subtle">
                  {o.switches} {o.switches === 1 ? "switch" : "switches"}
                  {o.tied ? <span className="ml-1 text-warn">tied</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-1 text-micro text-subtle">
          The window is the steadier read; the point call at the top of this page is the fresher
          one. They disagree often, and when they do it is the point call that is more likely to
          move.
        </p>
      </div>
    </Panel>
  );
}

function TransitionPanel() {
  const r = CURRENT_QUAD;
  const next = likelyNextQuads(r.quad);
  return (
    <Panel title="Where it has gone next">
      <p className="text-micro text-subtle">
        Run-collapsed, so this counts regime CHANGES rather than how long each regime happened to
        last — otherwise the diagonal swamps everything and every quad appears to mostly stay put.
        Descriptive: how it has moved, not how it will.
      </p>

      <table className="mt-1.5 w-full text-caption">
        <thead>
          <tr className="text-micro text-subtle">
            <th className="text-left font-normal">from</th>
            {QUAD_LIST.map((q) => (
              <th key={q} className="text-right font-normal">
                →Q{q}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {QUAD_LIST.map((from) => (
            <tr key={from} className={from === r.quad ? "text-foreground" : "text-subtle"}>
              <td className="flex items-center gap-1 text-left">
                <span className={`inline-block size-1.5 rounded-full ${QUAD_TINT[from]}`} />Q{from}{" "}
                {QUADS[from]?.name}
              </td>
              {QUAD_LIST.map((to) => {
                const p = QUAD_TRANSITIONS[from]?.[to] ?? 0;
                return (
                  <td key={to} className="text-right">
                    {p > 0 ? p.toFixed(2) : "·"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {next.length > 0 && (
        <p className="mt-2 text-caption text-muted">
          Out of Q{r.quad} the regime has gone to{" "}
          {next.map((n, i) => (
            <span key={n.quad}>
              {i > 0 ? ", " : ""}Q{n.quad} {QUADS[n.quad]?.name} {pct(n.p)}
            </span>
          ))}
          .
        </p>
      )}

      <p className="mt-1.5 text-micro text-subtle">
        Note which moves dominate. Q1↔Q4 and Q2↔Q3 hold inflation fixed and flip growth — the same
        pairs revision flips most often. The framework&rsquo;s transitions and its errors travel the
        same axis, because both are driven by how noisy growth data is.
      </p>
    </Panel>
  );
}

function SpecPanel({
  detail,
  isLoading,
}: {
  detail: {
    selection: {
      scores: Record<
        string,
        { survival_train: number; survival_holdout: number; n: number; median_lag_days: number }
      >;
      persistence: Record<
        string,
        {
          median_months: number | null;
          share_ge_quarter: number | null;
          n_completed: number | null;
        }
      >;
    };
  } | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Panel title="Choosing the composite">
        <p className="py-3 text-center text-caption text-muted">Loading…</p>
      </Panel>
    );
  }
  if (!detail) {
    return (
      <Panel title="Choosing the composite">
        <p className="py-3 text-center text-caption text-muted">
          Specification scores are unavailable. Nothing is shown rather than a table the run did not
          produce.
        </p>
      </Panel>
    );
  }
  const rows = Object.entries(SPECS).sort(
    (a, b) => (b[1].survivalTrain ?? 0) - (a[1].survivalTrain ?? 0),
  );
  return (
    <Panel
      title="Choosing the composite"
      action={
        <span className="font-mono text-micro text-subtle">
          floor {SELECTION.persistenceFloorMonths} mo · train {pct(SELECTION.trainFrac)}
        </span>
      }
    >
      <p className="text-micro text-subtle">
        &ldquo;Industrial production and payrolls&rdquo; is a convention, not a result. Eight
        candidates were scored on {SELECTION.criterion.toLowerCase()}. A candidate whose median
        spell falls below the {SELECTION.persistenceFloorMonths}-month floor is disqualified
        outright rather than traded off against survival — it is labelling months, not regimes.
      </p>

      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-caption">
          <thead>
            <tr className="text-micro text-subtle">
              <th className="text-left font-normal">spec</th>
              <th className="text-right font-normal">train</th>
              <th className="text-right font-normal">holdout</th>
              <th className="text-right font-normal">median spell</th>
              <th className="pr-3 text-right font-normal">≥1 quarter</th>
              <th className="pl-3 text-left font-normal">inputs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, s]) => {
              const p = detail.selection.persistence[name] ?? {};
              const chosen = name === SELECTION.chosen;
              return (
                <tr
                  key={name}
                  className={chosen ? "text-foreground" : s.eligible ? "text-muted" : "text-subtle"}
                >
                  <td className="py-0.5 text-left">
                    <span className="font-mono">{name}</span>
                    {chosen ? <span className="ml-1 text-micro text-primary">chosen</span> : null}
                    {!s.eligible ? (
                      <span className="ml-1 text-micro text-core">disqualified</span>
                    ) : null}
                  </td>
                  <td className="text-right font-mono tabular-nums">{pct(s.survivalTrain, 1)}</td>
                  <td className="text-right font-mono tabular-nums">{pct(s.survivalHoldout, 1)}</td>
                  <td className="text-right font-mono tabular-nums">{p.median_months ?? "—"} mo</td>
                  <td className="pr-3 text-right font-mono tabular-nums">
                    {pct(s.shareSpellsAtLeastAQuarter)}
                  </td>
                  <td className="max-w-[14rem] truncate pl-3 text-left text-micro text-subtle">
                    {s.growth.length}g + {s.inflation.length}i, {s.lookback}mo
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-micro text-subtle">
        Two things in this table matter more than the winner. Every eligible candidate survives
        revision between {pct(Math.min(...rows.map(([, s]) => s.survivalTrain ?? 1)), 0)} and{" "}
        {pct(Math.max(...rows.map(([, s]) => s.survivalTrain ?? 0)), 0)} of the time, so no
        composite rescues the framework from revision. And the &ldquo;≥1 quarter&rdquo; column never
        clears half: the framework&rsquo;s own quarterly framing is not what this data produces,
        whichever series you pick.
      </p>
    </Panel>
  );
}

function HistoryPanel({
  detail,
  isLoading,
}: {
  detail: { history: { asOf: string; quad: number; margin: number | null; name: string }[] } | null;
  isLoading: boolean;
}) {
  const [showFragile, setShowFragile] = useState(true);
  const history = detail?.history;
  const rows = useMemo(() => history ?? [], [history]);
  const strip = useMemo(() => rows.map((r) => ({ asOf: r.asOf, quad: r.quad as Quad })), [rows]);
  const fragile = useMemo(
    () => rows.filter((r) => r.margin != null && r.margin < 0.25).length,
    [rows],
  );

  if (isLoading) {
    return (
      <Panel title="The last decade">
        <p className="py-3 text-center text-caption text-muted">Loading history…</p>
      </Panel>
    );
  }
  if (!rows.length) {
    return (
      <Panel title="The last decade">
        <p className="py-3 text-center text-caption text-muted">
          History is unavailable. Nothing is shown rather than a timeline the run did not produce.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="The last decade"
      action={
        <button
          type="button"
          onClick={() => setShowFragile((v) => !v)}
          className="font-mono text-micro text-primary hover:underline"
        >
          {showFragile ? "hide" : "show"} knife-edge months
        </button>
      }
    >
      <QuadStrip readings={strip} />
      {showFragile && (
        <>
          <div className="mt-1 flex h-1.5 w-full gap-px overflow-hidden rounded-sm">
            {rows.map((r) => {
              const thin = r.margin != null && r.margin < 0.25;
              return (
                <span
                  key={r.asOf}
                  className={thin ? "min-w-0 flex-1 bg-core/70" : "min-w-0 flex-1 bg-card-2"}
                  title={
                    thin
                      ? `${monthLabel(r.asOf)} — margin ${r.margin?.toFixed(3)}, a near-tie`
                      : `${monthLabel(r.asOf)} — margin ${r.margin?.toFixed(3)}`
                  }
                />
              );
            })}
          </div>
          <p className="mt-0.5 text-micro text-subtle">
            Marked months sat inside the knife-edge margin, where the label historically held only{" "}
            {pct(MARGIN_CALIBRATION["knife-edge"]?.survival)} of the time.{" "}
            <span className="text-muted">
              {fragile} of {rows.length} months shown
            </span>{" "}
            — this is the normal state of the indicator, not an unusual patch.
          </p>
        </>
      )}
    </Panel>
  );
}

function ReturnsTestPanel() {
  const rows = Object.entries(RETURNS_BY_CHANNEL);
  return (
    <Panel
      title="Test 1 — does it position?"
      action={
        <span className={RETURNS_TEST.passes ? "text-micro text-up" : "text-micro text-core"}>
          {RETURNS_TEST.passes ? "PASSES" : "FAILED"}
        </span>
      }
    >
      <p className="text-micro text-subtle">
        Baseline: <span className="text-muted">{RETURNS_TEST.baseline}</span> — not zero. Equities
        drift up, and a rule that is long most of the time inherits that drift and looks clever.
        Signs learned on a training window, checked on a sealed holdout, block-bootstrap intervals
        because monthly returns cluster.
      </p>
      <table className="mt-1.5 w-full text-caption">
        <thead>
          <tr className="text-micro text-subtle">
            <th className="text-left font-normal">channel</th>
            <th className="text-right font-normal">signs held</th>
            <th className="text-right font-normal">edge %/mo</th>
            <th className="text-right font-normal">95% CI</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {rows.map(([c, e]) => (
            <tr key={c} className="text-muted">
              <td className="text-left">{c}</td>
              <td className="text-right">
                {e.signsHeld}/{e.usableCells}
              </td>
              <td className="text-right">{signed(e.edgePctPerMonth, 3)}</td>
              <td className="text-right text-subtle">
                [{signed(e.edgeCi[0], 2)}, {signed(e.edgeCi[1], 2)}]
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-micro text-subtle">
        {RETURNS_TEST.channelsBeatingBaseline.length} of {RETURNS_TEST.channelsTested.length}{" "}
        channels beat the baseline with an interval excluding zero, and {RETURNS_TEST.signsHeld} of{" "}
        {RETURNS_TEST.usableCells} quad cells kept their sign — a coin flip. NASDAQ&rsquo;s
        exactly-zero edge is not a rounding artefact: every sign the training window learned for it
        was positive, so &ldquo;quad positioning&rdquo; reduced to being long in all four quads. It
        matched long-only because it was long-only.
      </p>
    </Panel>
  );
}

function VolTestPanel() {
  const rows = Object.entries(VOL_BY_CHANNEL);
  return (
    <Panel
      title="Test 2 — does it size risk?"
      action={
        <span className={VOL_TEST.passes ? "text-micro text-up" : "text-micro text-core"}>
          {VOL_TEST.passes ? "PASSES" : "FAILED"}
        </span>
      }
    >
      <p className="text-micro text-subtle">
        A framework can be useless for direction and still useful for sizing, so volatility gets its
        own test. Baseline: <span className="text-muted">{VOL_TEST.baseline}</span>. Volatility is
        the most persistent quantity in finance, so a quad that merely recovers &ldquo;vol was high
        recently&rdquo; has discovered nothing.
      </p>
      <table className="mt-1.5 w-full text-caption">
        <thead>
          <tr className="text-micro text-subtle">
            <th className="text-left font-normal">channel</th>
            <th className="text-right font-normal">persistence</th>
            <th className="text-right font-normal">quad adds</th>
            <th className="text-right font-normal">p</th>
            <th className="text-right font-normal">signs</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {rows.map(([c, e]) => (
            <tr key={c} className="text-muted">
              <td className="text-left">{c}</td>
              <td className="text-right text-subtle">{pct(e.arGainOverUnconditional, 1)}</td>
              <td className="text-right">{pct(e.quadGainOverAr, 1)}</td>
              <td className="text-right text-subtle">{e.pValue?.toFixed(3) ?? "—"}</td>
              <td className="text-right text-subtle">
                {e.signsHeld}/{e.usableCells}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-micro text-subtle">
        The result is more interesting than a flat failure. The volatility SIGNATURE is real and
        stable — {VOL_TEST.signsHeld} of {VOL_TEST.usableCells} quad cells kept their sign out of
        sample, against {RETURNS_TEST.signsHeld}/{RETURNS_TEST.usableCells} for returns. Quads 3 and
        4 genuinely run hotter. But once a forecast already knows last month&rsquo;s volatility, the
        quad adds a percent or two of error reduction and none of it survives Holm correction across{" "}
        {VOL_TEST.channelsTested.length} channels. The tape already knew.
      </p>
    </Panel>
  );
}

function InputsPanel() {
  const rows = Object.entries(PUBLICATION_LAGS).sort((a, b) => a[1].medianDays - b[1].medianDays);
  return (
    <Panel title="Why the lag exists">
      <p className="text-micro text-subtle">
        Every eligible input, and how late it publishes. These are measured from the vintage
        archive, not quoted from a manual. The reading at the top of this page can be no fresher
        than the slowest series in its composite.
      </p>
      <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
        {rows.map(([sid, l]) => (
          <li key={sid} className="rounded-md bg-card-2 px-2 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-caption text-foreground">{l.label}</span>
              <span className="shrink-0 font-mono text-caption tabular-nums text-muted">
                {l.medianDays}d
                <span className="ml-1 text-micro text-subtle">p90 {l.p90Days.toFixed(0)}d</span>
              </span>
            </div>
            <p className="text-micro text-subtle">{l.note}</p>
            <p className="text-micro text-subtle">
              <span className="font-mono">{sid}</span> · {l.axis}
              {SELECTION.growth.includes(sid) || SELECTION.inflation.includes(sid) ? (
                <span className="text-primary"> · in the chosen composite</span>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-micro text-subtle">{QUAD_RUN.gdpExcludedReason}.</p>
    </Panel>
  );
}
