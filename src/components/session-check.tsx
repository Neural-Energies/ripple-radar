import { Link } from "@tanstack/react-router";
import { Delta, Panel } from "@/components/ui";
import { useMacroRegime } from "@/components/macro-strip";
import { QUAD_NAME, regimeFlips } from "@/lib/live/macro-regime";
import { useLive } from "@/lib/live/provider";
import { SESSION_LEGS, sessionCheck } from "@/lib/live/session-check";

const READ: Record<"agrees" | "fights" | "split" | "no tape", string> = {
  agrees: "The tape agrees with the usual pattern.",
  fights: "The tape is fighting the usual pattern.",
  split: "The tape is split.",
  "no tape": "No tape on these names yet.",
};

export function SessionCheck() {
  const read = useMacroRegime();
  const quotes = useLive((s) => s.desk?.quotes);
  if (!read || read.status !== "ok" || read.quad == null) return null;
  const legs = SESSION_LEGS[read.quad];
  const tape: Record<string, number | undefined> = {};
  const states: string[] = [];
  for (const leg of legs) {
    for (const ticker of leg.tickers) {
      const quote = quotes?.[ticker];
      if (!quote) continue;
      tape[ticker] = quote.changePct;
      states.push(quote.state);
    }
  }
  const check = sessionCheck(read.quad, tape);
  const live = states.length > 0 && states.every((state) => state === "live");
  const flip = regimeFlips(read.legs ?? [])[0];
  return (
    <Panel
      title="Before you size"
      action={
        <Link to="/macro" className="text-micro text-primary hover:underline">
          Macro
        </Link>
      }
    >
      <p className="text-caption text-foreground">
        Quad {read.quad} · {QUAD_NAME[read.quad]}. {READ[check.read]}
        {check.n > 0 ? ` ${check.met} of ${check.n}.` : ""} {live ? "This session." : "Last print."}
      </p>
      {check.rows.length ? (
        <ul className="mt-1">
          {check.rows.map((row) => (
            <li key={row.label} className="flex items-baseline justify-between gap-2 border-b border-border/60 py-1 last:border-b-0">
              <span className="text-caption">
                {row.label}{" "}
                <span className="font-mono text-micro text-subtle">
                  {row.ticker} {row.expect === "up" ? "usually up" : "usually down"}
                </span>
              </span>
              <span className="font-mono text-micro">
                <Delta n={row.changePct} />
                <span className="ml-2 text-subtle">{row.met ? "fits" : "does not"}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {flip ? (
        <p className="mt-1 text-micro text-muted">
          Nearest quad flip: {flip.legs.map((leg) => `${leg.label} (${leg.distance.toFixed(1)} pts)`).join(", ")} → Quad{" "}
          {flip.to} · {QUAD_NAME[flip.to]}.
        </p>
      ) : null}
      <p className="mt-1 text-micro text-subtle">Usual pattern against the last print. Not an order.</p>
    </Panel>
  );
}
