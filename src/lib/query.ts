import { QueryClient } from "@tanstack/react-query";

/**
 * The app's react-query client.
 *
 * This did not exist. `@tanstack/react-query` was a dependency and components
 * called `useQuery`, but nothing ever mounted a `QueryClientProvider`, so every
 * one of those calls threw "No QueryClient set" — silently on the server, where
 * the render fell back to a shell, and into the route error boundary on the
 * client. The historical-analog panel was one of the casualties.
 *
 * SERVER VS BROWSER
 *
 * On the server a client must be created per request. A module-level singleton
 * would let one request's fetched data be served to the next visitor, which is
 * a data-leak bug rather than a performance one. In the browser the opposite is
 * true: a new client on every render throws the cache away, so there the
 * singleton is correct.
 */
function make(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Everything this app queries is a generated artifact or a delayed
        // quote. Refetching on every window focus buys nothing and costs a
        // request per tab switch.
        refetchOnWindowFocus: false,
        staleTime: 5 * 60 * 1000,
        // One retry, not three: a failing server function is usually a missing
        // artifact, and three attempts only delays the panel that is built to
        // render the absence.
        retry: 1,
      },
    },
  });
}

let browserClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return make();
  browserClient ??= make();
  return browserClient;
}
