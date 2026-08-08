import type { QueryKey } from "@tanstack/react-query";
import type { EchoInvalidationMap } from "./types";

/**
 * The Live Contract — how a package declares, as PURE DATA, which query keys
 * its surface owns and which broadcast events invalidate them.
 *
 * Data rather than code on purpose, because three different audiences have to
 * read the same declaration: the JS host wiring it up, the PHP twin asserting
 * parity against it, and an agent reasoning about what a mutation will
 * invalidate. Code only the first of those can execute.
 *
 * A package exports its contract from its MAIN entry and imports this type with
 * `import type`, so it erases at build and the package gains no dependency —
 * `fancy-query` stays optional for anyone who does not want live behaviour.
 *
 * @example
 * ```ts
 * import type { LiveContract } from "@particle-academy/fancy-query";
 *
 * export const catalogLive = {
 *   namespace: "catalog",
 *   events: [
 *     { event: "catalog.product.updated", keys: [["catalog", "products"]] },
 *     { event: "catalog.price.updated", keys: [["catalog", "products"], ["catalog", "prices"]] },
 *   ],
 * } as const satisfies LiveContract;
 * ```
 */
export interface LiveContract {
  /**
   * The package's stable short name, with no `fancy-` / `laravel-` prefix:
   * `catalog`, `features`, `mlm`, `flow`, `git`, `sheets`, `whiteboard`, `cms`.
   *
   * It is the first segment of every key the package owns, which is what makes
   * `["catalog"]` a whole-namespace invalidation.
   */
  readonly namespace: string;
  readonly events: readonly LiveEvent[];
  /** Default broadcast channel, when the package has an obvious one. */
  readonly channel?: string;
}

export interface LiveEvent {
  /** `<namespace>.<resource>.<verb>` — mirrors the key it invalidates. */
  readonly event: string;
  /** Keys to invalidate. TanStack matches by PREFIX, so a short key is broad. */
  readonly keys: readonly QueryKey[];
  /** Why this event invalidates a key that is not obviously its own. */
  readonly note?: string;
}

/** The verbs a contract event may use without needing a note in the package docs. */
export const LIVE_VERBS = ["created", "updated", "deleted", "moved", "completed"] as const;

export type LiveVerb = (typeof LIVE_VERBS)[number];

/**
 * Build a key the way the contract specifies: `[namespace, resource, ...rest]`.
 *
 * Every value that identifies the fetched data has to be in the key, or two
 * different fetches share a cache entry — the bug where opening record B shows
 * record A's data until a refetch lands.
 */
export function liveKey(namespace: string, resource: string, ...rest: readonly (string | number)[]): QueryKey {
  return [namespace, resource, ...rest];
}

/**
 * Turn a contract into the event→keys map {@link useFancyEchoInvalidation}
 * takes.
 *
 * Events are merged rather than overwritten when a contract lists the same
 * event twice: silently dropping the second entry's keys would leave a stale
 * cache that looks exactly like a backend that did not broadcast.
 */
export function toEchoMap(contract: LiveContract): EchoInvalidationMap {
  const map: Record<string, QueryKey[]> = {};

  for (const entry of contract.events) {
    const existing = map[entry.event] ?? (map[entry.event] = []);
    for (const key of entry.keys) {
      if (!existing.some((k) => JSON.stringify(k) === JSON.stringify(key))) {
        existing.push(key);
      }
    }
  }

  return map;
}

/** Every event name a contract declares, in declaration order, deduplicated. */
export function liveEventNames(contract: LiveContract): string[] {
  return [...new Set(contract.events.map((e) => e.event))];
}

/**
 * Everything wrong with a contract, all at once.
 *
 * Exists so the parity test on each side of a mirror pair can assert the same
 * rules rather than restating them, and so a package's own test can catch a
 * malformed contract before it ships. A contract is data a host trusts to
 * decide what to re-fetch; a key with the wrong namespace silently invalidates
 * nothing, which presents as "the UI does not update" with no error anywhere.
 */
export function validateLiveContract(contract: LiveContract): string[] {
  const problems: string[] = [];
  const { namespace } = contract;

  if (!namespace || !/^[a-z][a-z0-9-]*$/.test(namespace)) {
    problems.push(`namespace "${namespace}" must be lowercase kebab-case, with no fancy-/laravel- prefix`);
  }
  if (namespace.startsWith("fancy-") || namespace.startsWith("laravel-")) {
    problems.push(`namespace "${namespace}" must drop the package prefix — use the bare name`);
  }
  if (contract.events.length === 0) {
    problems.push("contract declares no events, so nothing would ever invalidate");
  }

  for (const { event, keys, note } of contract.events) {
    const parts = event.split(".");

    if (parts.length !== 3) {
      problems.push(`event "${event}" must be <namespace>.<resource>.<verb>`);
    } else {
      if (parts[0] !== namespace) {
        problems.push(`event "${event}" is not in namespace "${namespace}"`);
      }
      if (!(LIVE_VERBS as readonly string[]).includes(parts[2]!) && !note) {
        problems.push(
          `event "${event}" uses a verb outside ${LIVE_VERBS.join(" / ")} — add a note saying why`,
        );
      }
    }

    if (keys.length === 0) {
      problems.push(`event "${event}" invalidates nothing`);
    }

    for (const key of keys) {
      if (!Array.isArray(key) || key.length === 0) {
        problems.push(`event "${event}" has a key that is not a non-empty array`);
        continue;
      }
      if (key[0] !== namespace && !note) {
        problems.push(
          `event "${event}" invalidates ${JSON.stringify(key)}, outside its own namespace — add a note saying why`,
        );
      }
      for (const segment of key) {
        const t = typeof segment;
        if (t !== "string" && t !== "number" && t !== "boolean" && segment !== null) {
          problems.push(`event "${event}" has a key segment that is not serializable: ${String(segment)}`);
        }
      }
    }
  }

  return problems;
}
