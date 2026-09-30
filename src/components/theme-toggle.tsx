import { Monitor, Moon, Sun } from "lucide-react";
import { nextTheme, useTheme, type ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";

const LABEL: Record<ThemePref, string> = { dark: "Dark", light: "Light", system: "System" };

/** Cycles dark → light → system. The choice is kept on this device. */
export function ThemeToggle({ className }: { className?: string }) {
  const { pref, set } = useTheme();
  const next = nextTheme(pref);
  const Icon = pref === "light" ? Sun : pref === "system" ? Monitor : Moon;
  return (
    <button
      type="button"
      onClick={() => set(next)}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-card-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        className,
      )}
      aria-label={`Theme: ${LABEL[pref]}. Switch to ${LABEL[next]}.`}
      title={`Theme: ${LABEL[pref]} (click for ${LABEL[next]})`}
    >
      <Icon className="size-4" />
    </button>
  );
}
