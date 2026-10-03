import { useState } from "react";
import { Button } from "@/components/ui";
import type { RadarEvent } from "@/data/types";
import { bookExportHtml, bookExportText } from "@/lib/export-book";

function download(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function BookExport({ event, disabled }: { event: RadarEvent; disabled?: boolean }) {
  const [note, setNote] = useState<string | null>(null);
  const off = disabled || !event.id;

  async function copy() {
    const text = bookExportText(event);
    try {
      await navigator.clipboard.writeText(text);
      setNote("Copied.");
    } catch {
      download("ripple-radar-book.txt", text, "text/plain");
      setNote("Clipboard was blocked. The book downloaded instead.");
    }
  }

  function save() {
    download("ripple-radar-book.txt", bookExportText(event), "text/plain");
    setNote("Downloaded.");
  }

  function pdf() {
    const html = bookExportHtml(bookExportText(event));
    const w = window.open("", "_blank");
    if (!w) {
      download("ripple-radar-book.html", html, "text/html");
      setNote("Pop-ups are blocked. An HTML file downloaded — open it and choose Print, then Save as PDF.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
    setNote("Use the print dialog and choose Save as PDF.");
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button type="button" size="sm" variant="secondary" disabled={off} onClick={() => void copy()}>
        Copy book
      </Button>
      <Button type="button" size="sm" variant="secondary" disabled={off} onClick={save}>
        Download
      </Button>
      <Button type="button" size="sm" variant="secondary" disabled={off} onClick={pdf}>
        PDF
      </Button>
      {note ? <span className="text-micro text-subtle">{note}</span> : null}
    </div>
  );
}
