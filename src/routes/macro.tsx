import { createFileRoute } from "@tanstack/react-router";
import { MacroPageBody, useMacroRegime } from "@/components/macro-strip";

export const Route = createFileRoute("/macro")({ component: MacroPage });

function MacroPage() {
  const read = useMacroRegime();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
      <header>
        <div className="text-micro uppercase tracking-wider text-subtle">FRED</div>
        <h1 className="text-base font-semibold tracking-tight">Macro risk</h1>
      </header>
      <MacroPageBody read={read} />
    </div>
  );
}
