import { Outlet, createFileRoute } from "@tanstack/react-router";
import { MacroChrome } from "@/components/macro/workstation";

export const Route = createFileRoute("/macro")({
  component: MacroLayout,
});

function MacroLayout() {
  return (
    <MacroChrome>
      <Outlet />
    </MacroChrome>
  );
}
