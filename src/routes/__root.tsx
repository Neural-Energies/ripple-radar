import { useEffect } from "react";
import { createRootRoute, HeadContent, Outlet, Scripts, useRouterState } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { AppShell } from "@/components/app-shell";
import { DeskSync } from "@/components/desk-sync";
import { LiveProvider } from "@/lib/live/provider";
import { useApp } from "@/lib/store";
import appCss from "../styles.css?url";

const APP_NAME = "Ripple Radar";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content:
          "Don't trade the headline. Trade what it causes next. Ripple Radar maps shocks into transmission chains, probabilities, and ranked second-order exposures.",
      },
      { name: "theme-color", content: "#060c18" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: Root,
});

function Root() {
  return (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <HydrateStore>
            <DeskSync>
              <LiveProvider>
                <ShellGate>
                  <Outlet />
                </ShellGate>
              </LiveProvider>
            </DeskSync>
          </HydrateStore>
        </AuthProvider>
        <Toaster
          theme="dark"
          position="bottom-right"
          closeButton
          toastOptions={{
            style: {
              background: "var(--color-card-2)",
              border: "1px solid var(--color-border)",
              color: "var(--color-foreground)",
            },
          }}
        />
        <Scripts />
      </body>
    </html>
  );
}

function ShellGate({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === "/login") return <>{children}</>;
  return <AppShell>{children}</AppShell>;
}

function HydrateStore({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void Promise.resolve(useApp.persist.rehydrate()).then(() => {
      useApp.getState().setHydrated(true);
    });
  }, []);
  return children;
}
