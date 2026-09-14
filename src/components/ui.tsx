import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary:
          "border border-border bg-card-2 text-foreground hover:bg-card-3",
        ghost: "text-muted hover:bg-card-2 hover:text-foreground",
        danger: "bg-down/15 text-down hover:bg-down/25",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2 text-caption",
        md: "h-8 px-3 text-body",
        lg: "h-10 px-4 text-sm",
        icon: "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>
>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-8 w-full rounded-md border border-border bg-card-2 px-2.5 text-body text-foreground placeholder:text-subtle outline-none transition-shadow duration-150 focus:shadow-[0_0_0_1px_var(--color-primary)]",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export function Badge({
  className,
  tone = "neutral",
  children,
}: {
  className?: string;
  tone?: "neutral" | "up" | "down" | "warn" | "primary" | "core";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-card-3 text-muted",
    up: "bg-up/15 text-up",
    down: "bg-down/15 text-down",
    warn: "bg-warn/15 text-warn",
    primary: "bg-primary/15 text-primary",
    core: "bg-core/15 text-core",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-1.5 py-0.5 text-micro font-medium uppercase tracking-wider",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Panel({
  title,
  icon,
  action,
  children,
  className,
  bodyClassName,
  padded = true,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={cn(
        "flex h-full min-w-0 flex-col overflow-hidden rounded-lg bg-card shadow-[var(--shadow-border)]",
        className,
      )}
    >
      {title != null && (
        <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            {icon ? <span className="text-primary">{icon}</span> : null}
            <h2 className="truncate text-tiny font-medium uppercase tracking-wider text-muted">
              {title}
            </h2>
          </div>
          {action}
        </header>
      )}
      <div className={cn(padded && "p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Delta({ n, suffix = "%", digits = 1 }: { n: number; suffix?: string; digits?: number }) {
  const up = n > 0;
  const down = n < 0;
  return (
    <span
      className={cn(
        "tabular-nums",
        up && "text-up",
        down && "text-down",
        !up && !down && "text-muted",
      )}
    >
      {up ? "▲" : down ? "▼" : "·"} {up ? "+" : ""}
      {n.toFixed(digits)}
      {suffix}
    </span>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "text-micro font-medium uppercase tracking-wider text-subtle",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-sm border border-border bg-card-2 px-1 py-px font-mono text-micro text-muted">
      {children}
    </kbd>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px bg-border", className)} />;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-8 text-center text-caption text-muted">
      {children}
    </div>
  );
}

export function Card({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg bg-card p-3 shadow-[var(--shadow-border)]", className)}
      {...props}
    >
      {children}
    </div>
  );
}
