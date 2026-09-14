import { Link, createFileRoute } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-sm">
        <Logo />
        <h1 className="mt-8 text-xl font-semibold tracking-tight">Sign in to this desk</h1>
        <p className="mt-2 text-caption text-muted">
          Watchlists, alerts, custom scenarios, and the selected book sync across your devices.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {authEnabled ? (
            GROK_PROVIDERS.map((p) => (
              <button
                key={p.providerId}
                type="button"
                onClick={() => signIn(p.providerId, { callbackURL: "/" })}
                className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "h-11 w-full")}
              >
                Continue with {p.label}
              </button>
            ))
          ) : (
            <p className="text-caption text-muted">Sign-in is disabled.</p>
          )}
        </div>
        <Link
          to="/"
          className="mt-6 inline-flex min-h-11 items-center text-caption text-primary hover:underline"
        >
          Continue as guest — tape stays live, blotter stays on this device
        </Link>
      </div>
    </main>
  );
}
