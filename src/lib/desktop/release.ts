import { createServerFn } from "@tanstack/react-start";
import { decideRelease, type ReleaseDecision } from "./update-check";
import { APP_VERSION, RELEASE_REPO } from "./version";

/** What GitHub Releases says, compared with this build. Never throws — the About screen renders the message. */
export const checkPublishedRelease = createServerFn({ method: "POST" }).handler(async (): Promise<ReleaseDecision> => {
  try {
    const res = await fetch(`https://api.github.com/repos/${RELEASE_REPO}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "RippleRadar",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 404) return decideRelease(APP_VERSION, null);
    if (!res.ok) return decideRelease(APP_VERSION, null, `GitHub answered ${res.status}.`);
    const json = (await res.json()) as { tag_name?: unknown };
    const tag = typeof json.tag_name === "string" ? json.tag_name.replace(/^v/i, "") : null;
    return decideRelease(APP_VERSION, tag);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach GitHub.";
    return decideRelease(APP_VERSION, null, message);
  }
});
