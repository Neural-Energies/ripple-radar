import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-7 shrink-0", className)}
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="15" fill="var(--color-card)" stroke="var(--color-primary)" strokeWidth="1.4" />
      <circle cx="16" cy="16" r="10" fill="none" stroke="var(--color-primary)" strokeOpacity="0.35" strokeWidth="1" />
      <circle cx="16" cy="16" r="5.5" fill="none" stroke="var(--color-primary)" strokeOpacity="0.55" strokeWidth="1" />
      <path d="M10 10 L22 22 M22 10 L10 22" stroke="var(--color-primary)" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="16" cy="16" r="1.6" fill="var(--color-primary)" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <div>
        <div className="text-sm font-semibold leading-none tracking-wide text-foreground">
          RIPPLE RADAR
        </div>
        <div className={cn("mt-0.5 text-micro uppercase tracking-wider text-subtle", compact && "hidden md:block")}>
          Trade what it causes next.
        </div>
      </div>
    </div>
  );
}
