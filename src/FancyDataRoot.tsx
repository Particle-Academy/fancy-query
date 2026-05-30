import { createContext, useContext, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFancyQueryClient } from "./client";
import type { EchoLike } from "./types";

const EchoContext = createContext<EchoLike | null>(null);

/** Read the Echo client provided to {@link FancyDataRoot} (null if none). */
export function useEchoClient(): EchoLike | null {
  return useContext(EchoContext);
}

export interface FancyDataRootProps {
  children: ReactNode;
  /** Bring your own QueryClient. Omit to get one with the Fancy defaults. */
  client?: QueryClient;
  /**
   * The consumer's Laravel Echo instance (or any {@link EchoLike}). Provided to
   * `useFancyEchoInvalidation` via context so call sites don't thread it.
   * fancy-query never owns the connection.
   */
  echo?: EchoLike | null;
}

/**
 * Mount-once data provider: a single {@link QueryClient} (+ optional Echo
 * client) for the whole app. Compose it once near the root — or, in a
 * Laravel/Inertia app, via `fancy-inertia`'s `FancyAppRoot` `withData` flag.
 *
 * Do NOT mount a second `QueryClientProvider`; that silently splits the cache.
 */
export function FancyDataRoot({ children, client, echo = null }: FancyDataRootProps) {
  const [queryClient] = useState(() => client ?? createFancyQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <EchoContext.Provider value={echo}>{children}</EchoContext.Provider>
    </QueryClientProvider>
  );
}
