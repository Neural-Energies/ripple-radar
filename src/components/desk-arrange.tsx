import { useEffect, useState } from "react";
import {
  WIDGET_IDS,
  WIDGET_LABEL,
  cycleSideSpan,
  defaultDeskLayout,
  moveWidget,
  readDeskLayout,
  toggleWidget,
  writeDeskLayout,
  zoneOf,
  type DeskLayout,
  type WidgetId,
} from "@/lib/desk-layout";

export function useDeskLayout() {
  const [layout, setLayout] = useState<DeskLayout>(defaultDeskLayout);
  useEffect(() => {
    setLayout(readDeskLayout());
  }, []);
  function update(next: DeskLayout) {
    setLayout(writeDeskLayout(next));
  }
  return { layout, update };
}

export function DeskArrange({
  layout,
  update,
}: {
  layout: DeskLayout;
  update: (next: DeskLayout) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-md border border-border bg-card px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-micro uppercase tracking-wider text-primary hover:underline"
        >
          {open ? "Hide layout" : "Arrange desk"}
        </button>
        <button
          type="button"
          onClick={() => update(cycleSideSpan(layout))}
          className="text-micro text-muted hover:text-foreground"
        >
          Side width {layout.sideSpan}/12
        </button>
        <button
          type="button"
          onClick={() => update(defaultDeskLayout())}
          className="ml-auto text-micro text-muted hover:text-foreground"
        >
          Reset layout
        </button>
      </div>
      {open ? (
        <ul className="mt-1.5 flex flex-col gap-1">
          {WIDGET_IDS.map((id) => (
            <WidgetRow key={id} id={id} layout={layout} update={update} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function WidgetRow({
  id,
  layout,
  update,
}: {
  id: WidgetId;
  layout: DeskLayout;
  update: (next: DeskLayout) => void;
}) {
  const zone = zoneOf(id);
  const list = layout.order[zone];
  const index = list.indexOf(id);
  const hidden = layout.hidden.includes(id);
  return (
    <li className="flex flex-wrap items-center gap-2 text-caption">
      <label className="flex min-w-40 items-center gap-1.5 text-foreground">
        <input type="checkbox" checked={!hidden} onChange={() => update(toggleWidget(layout, id))} />
        {WIDGET_LABEL[id]}
      </label>
      <span className="font-mono text-micro uppercase text-subtle">{zone}</span>
      <button
        type="button"
        disabled={index <= 0}
        onClick={() => update(moveWidget(layout, id, -1))}
        className="text-micro text-muted hover:text-foreground disabled:opacity-40"
      >
        Up
      </button>
      <button
        type="button"
        disabled={index < 0 || index >= list.length - 1}
        onClick={() => update(moveWidget(layout, id, 1))}
        className="text-micro text-muted hover:text-foreground disabled:opacity-40"
      >
        Down
      </button>
    </li>
  );
}
