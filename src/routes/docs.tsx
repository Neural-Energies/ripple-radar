import { createFileRoute, Link } from "@tanstack/react-router";
import { LEVEL_META } from "@/data/catalog";
import { Panel } from "@/components/ui";

export const Route = createFileRoute("/docs")({ component: DocsPage });

const TOC = [
  { id: "how-to-use", label: "How to use" },
  { id: "ripple", label: "What is a ripple" },
  { id: "headlines", label: "What qualifies" },
  { id: "map", label: "Ripple map" },
  { id: "analyze", label: "Analyze" },
  { id: "scenarios", label: "Scenarios & game theory" },
  { id: "legend", label: "Map legend" },
  { id: "learning", label: "Calibration" },
] as const;

function DocsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Docs</h1>
        <p className="text-caption text-muted">
          Desk reference for Alpha Recon. Operator chrome stays quiet — how-to lives here, not as
          coach marks on Live Desk or World Tape.
        </p>
      </header>

      <nav aria-label="On this page" className="flex flex-wrap gap-1.5">
        {TOC.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            className="rounded-md bg-card px-2.5 py-1 text-micro text-muted hover:bg-card-2 hover:text-foreground"
          >
            {t.label}
          </a>
        ))}
      </nav>

      <section id="how-to-use" className="scroll-mt-16">
        <Panel title="How to use">
          <ol className="flex flex-col gap-3 text-caption text-foreground">
            <DocStep n="01" title="Live Desk">
              <Link to="/" className="text-primary hover:underline">
                Live Desk
              </Link>{" "}
              is the workstation for the selected book: developing-now strip, ripple map stage,
              analysis column, ranked exposures, and evidence. Switch books from the utility-bar
              event control (not per-page chips).
            </DocStep>
            <DocStep n="02" title="World Tape">
              <Link to="/events" className="text-primary hover:underline">
                World Tape
              </Link>{" "}
              is the observatory: headline stream → clusters → open a book on the desk. Analyze
              (Mode B) stays here for pasted shocks. The top utility strip shows session clocks and
              book-linked quotes — indicative public marks, not a broker feed.
            </DocStep>
            <DocStep n="03" title="Research">
              <Link to="/maps" className="text-primary hover:underline">
                Ripple Map
              </Link>
              ,{" "}
              <Link to="/scenarios" className="text-primary hover:underline">
                Scenarios
              </Link>
              , and{" "}
              <Link to="/game-theory" className="text-primary hover:underline">
                Game Theory
              </Link>{" "}
              all read the same global active event. Click a labeled map node with a ticker to open
              that asset.
            </DocStep>
            <DocStep n="04" title="Analyze">
              Paste a market-relevant shock into Analyze. The engine constructs the book: causal
              graph, players, scenarios, and asset exposures.
            </DocStep>
            <DocStep n="05" title="Monitor & model">
              Assets / Watchlists / Alerts / Portfolio are monitor surfaces. Learning and Docs sit
              under Model — calibration on Learning is this desk&apos;s own scored record, and is
              empty until forecasts resolve.
            </DocStep>
          </ol>
        </Panel>
      </section>

      <section id="ripple" className="scroll-mt-16">
        <Panel title="What is a ripple">
          <div className="flex flex-col gap-2 text-caption text-muted">
            <p>
              A <span className="text-foreground">ripple</span> is a causal hop from an originating shock
              to a market outcome. Distance 1 is first-order (direct); higher distances are
              second/third-order transmission through industry, macro, and policy channels.
            </p>
            <p>
              The product thesis: don&apos;t trade the headline print — trade what the headline causes
              next, with an invalidation on each edge.
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                <span className="text-foreground">Direction</span> — positive or negative exposure along
                the edge
              </li>
              <li>
                <span className="text-foreground">Confidence</span> — strength of the mechanism
              </li>
              <li>
                <span className="text-foreground">Expected lag</span> — when the hop should show in price
              </li>
              <li>
                <span className="text-foreground">Invalidation</span> — the condition that kills the edge
              </li>
            </ul>
          </div>
        </Panel>
      </section>

      <section id="headlines" className="scroll-mt-16">
        <Panel title="What headlines qualify">
          <div className="flex flex-col gap-2 text-caption text-muted">
            <p>
              Only <span className="text-foreground">market-relevant</span> shocks belong on the desk:
              events that can move prices, spreads, or policy paths for tradable instruments.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md bg-card-2 px-2.5 py-2">
                <div className="mb-1 text-micro uppercase tracking-wider text-subtle">In</div>
                <ul className="list-disc space-y-0.5 pl-4 text-foreground">
                  <li>Policy surprises, central bank action</li>
                  <li>Supply shocks, chokepoints, outages</li>
                  <li>Credit / bank stress with contagion risk</li>
                  <li>Geopolitical moves with trade or energy transmission</li>
                  <li>Corporate or commodity shocks with sector beta</li>
                </ul>
              </div>
              <div className="rounded-md bg-card-2 px-2.5 py-2">
                <div className="mb-1 text-micro uppercase tracking-wider text-subtle">Out</div>
                <ul className="list-disc space-y-0.5 pl-4">
                  <li>Pure human-interest or sports noise</li>
                  <li>Opinion without a falsifiable mechanism</li>
                  <li>Duplicate reprints of the same print</li>
                  <li>Named historical templates without new evidence</li>
                </ul>
              </div>
            </div>
          </div>
        </Panel>
      </section>

      <section id="map" className="scroll-mt-16">
        <Panel title="Ripple map">
          <div className="flex flex-col gap-2 text-caption text-muted">
            <p>
              Rings are causal distance from the core event. Toggle levels in the color strip to focus.
              Hover a node for impact and mechanism blurb.
            </p>
            <p>
              <span className="text-foreground">Node click → asset.</span> Labeled nodes with tickers
              navigate to Assets. The causal links table on Ripple Map lists direction, distance,
              confidence, lag, and invalidation.
            </p>
          </div>
        </Panel>
      </section>

      <section id="analyze" className="scroll-mt-16">
        <Panel title="Analyze">
          <div className="flex flex-col gap-2 text-caption text-muted">
            <p>
              Analyze accepts free text (Live Desk bar or World Tape). Output is a full research object —
              not a preloaded war or country template. Instant book opens a thin shell without full
              construction when you need a placeholder track.
            </p>
            <p>
              Importance and probability are different: a low-probability event can still rank high on
              importance if transmission is large.
            </p>
          </div>
        </Panel>
      </section>

      <section id="scenarios" className="scroll-mt-16">
        <Panel title="Scenarios & game theory">
          <div className="flex flex-col gap-2 text-caption text-muted">
            <p>
              Scenario families follow the event type (policy, commodity, credit, kinetic, weather,
              corporate) — not a universal bull/base/bear. Each scenario carries a probability audit
              trail.
            </p>
            <p>
              Game theory answers who can change the outcome and which joint move is likely. Rows are
              the actor&apos;s moves; columns are the counterpart&apos;s. The highlighted cell is mutual
              best response — that play can rewrite the ripple.
            </p>
            <p>
              Both routes share the global active book. Full matrix:{" "}
              <Link to="/game-theory" className="text-primary hover:underline">
                Game Theory
              </Link>
              . Scenario lab:{" "}
              <Link to="/scenarios" className="text-primary hover:underline">
                Scenarios
              </Link>
              .
            </p>
          </div>
        </Panel>
      </section>

      <section id="legend" className="scroll-mt-16">
        <Panel title="Map legend">
          <ul className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(LEVEL_META) as unknown as Array<0 | 1 | 2 | 3 | 4>).map((lv) => (
              <li key={lv} className="flex items-start gap-2 rounded-md bg-card-2 px-2.5 py-2">
                <span
                  className="mt-1.5 size-2 shrink-0 rounded-full"
                  style={{ background: LEVEL_META[lv].color }}
                />
                <div>
                  <div className="text-caption font-medium text-foreground">{LEVEL_META[lv].label}</div>
                  <p className="text-tiny text-muted">{LEVEL_META[lv].hint}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-tiny text-muted">
            Link color: primary = positive direction; down tone = negative. Opacity scales with
            confidence.
          </p>
        </Panel>
      </section>

      <section id="learning" className="scroll-mt-16">
        <Panel title="Calibration">
          <p className="text-caption text-muted">
            <Link to="/learning" className="text-primary hover:underline">
              Learning
            </Link>{" "}
            scores this desk against its own append-only freeze ledger: every forecast is frozen
            before the outcome is known, becomes eligible 72h later, and is then graded by a model
            judge reading headlines archived after the fact. Accuracy, Brier, the calibration curve
            and the scored ledger are all computed from those resolved rows and nothing else — so
            the page is <span className="text-foreground">empty</span> until forecasts resolve,
            rather than filled with a sample. Model-graded, not human-verified.
          </p>
        </Panel>
      </section>

      <p className="pb-6 text-center text-micro text-subtle">
        Don&apos;t trade the headline. Trade what it causes next.
      </p>
    </div>
  );
}

function DocStep({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="font-mono text-micro text-primary">{n}</span>
      <div>
        <div className="font-medium text-foreground">{title}</div>
        <div className="mt-0.5 text-muted">{children}</div>
      </div>
    </li>
  );
}
