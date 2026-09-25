import { createFileRoute } from "@tanstack/react-router";
import { MacroPageBody, useMacroRegime } from "@/components/macro-strip";
import { ReleaseDrawer, WhatChanged } from "@/components/macro/workstation";
import { Panel } from "@/components/ui";

export const Route = createFileRoute("/macro/")({
  component: MacroOverview,
});

function MacroOverview() {
  const read = useMacroRegime();
  return (
    <>
      <WhatChanged read={read} />
      <ReleaseDrawer read={read} />
      <Panel title="Validated regime">
        <MacroPageBody read={read} />
      </Panel>
    </>
  );
}
