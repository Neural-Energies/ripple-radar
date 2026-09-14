import { Link } from "@tanstack/react-router";
import { Cloud, CloudOff } from "lucide-react";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useSyncMode } from "@/components/desk-sync";
import { cn } from "@/lib/utils";

export function AuthSlot() {
  const { user, isPending } = useCurrentUserState();
  const sync = useSyncMode();

  if (isPending) {
    return <div className="size-8 shrink-0 animate-pulse rounded-full bg-card-3" aria-hidden />;
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {user ? (
        <>
          <span
            className={cn(
              "hidden items-center gap-1 font-mono text-micro uppercase tracking-wider sm:inline-flex",
              sync === "cloud" ? "text-up" : "text-subtle",
            )}
            title={sync === "cloud" ? "Desk synced to this account" : "Saving on this device only"}
          >
            {sync === "cloud" ? <Cloud className="size-3.5" /> : <CloudOff className="size-3.5" />}
            {sync === "cloud" ? "Synced" : sync === "pending" ? "Syncing" : "Local"}
          </span>
          <div className="max-w-[9.5rem] overflow-hidden sm:max-w-none">
            <UserButton />
          </div>
        </>
      ) : (
        <Link
          to="/login"
          className="inline-flex h-11 items-center rounded-md px-2 text-caption text-primary hover:underline"
        >
          Sign in
        </Link>
      )}
    </div>
  );
}
