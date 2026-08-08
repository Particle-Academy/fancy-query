import { describe, expect, it } from "vitest";
import {
    LIVE_VERBS,
    liveEventNames,
    liveKey,
    toEchoMap,
    validateLiveContract,
    type LiveContract,
} from "../src/live";

const catalog = {
    namespace: "catalog",
    events: [
        { event: "catalog.product.updated", keys: [["catalog", "products"]] },
        { event: "catalog.product.deleted", keys: [["catalog", "products"]] },
        { event: "catalog.price.updated", keys: [["catalog", "products"], ["catalog", "prices"]] },
    ],
} as const satisfies LiveContract;

describe("liveKey", () => {
    it("builds [namespace, resource, ...rest]", () => {
        expect(liveKey("catalog", "products")).toEqual(["catalog", "products"]);
        expect(liveKey("catalog", "products", 42)).toEqual(["catalog", "products", 42]);
        expect(liveKey("catalog", "products", 42, "prices")).toEqual(["catalog", "products", 42, "prices"]);
    });
});

describe("toEchoMap", () => {
    it("produces the event→keys map the invalidation hook takes", () => {
        expect(toEchoMap(catalog)).toEqual({
            "catalog.product.updated": [["catalog", "products"]],
            "catalog.product.deleted": [["catalog", "products"]],
            "catalog.price.updated": [["catalog", "products"], ["catalog", "prices"]],
        });
    });

    it("MERGES a repeated event rather than letting the last one win", () => {
        // Overwriting would silently drop the first entry's keys, and a cache
        // that is not invalidated looks exactly like a backend that never
        // broadcast — no error, just a UI that does not update.
        const contract = {
            namespace: "flow",
            events: [
                { event: "flow.run.updated", keys: [["flow", "runs"]] },
                { event: "flow.run.updated", keys: [["flow", "runs", 1]] },
            ],
        } as const satisfies LiveContract;

        expect(toEchoMap(contract)["flow.run.updated"]).toEqual([
            ["flow", "runs"],
            ["flow", "runs", 1],
        ]);
    });

    it("does not duplicate an identical key listed twice", () => {
        const contract = {
            namespace: "flow",
            events: [
                { event: "flow.run.updated", keys: [["flow", "runs"]] },
                { event: "flow.run.updated", keys: [["flow", "runs"]] },
            ],
        } as const satisfies LiveContract;

        expect(toEchoMap(contract)["flow.run.updated"]).toHaveLength(1);
    });
});

describe("liveEventNames", () => {
    it("lists every event once, in declaration order", () => {
        expect(liveEventNames(catalog)).toEqual([
            "catalog.product.updated",
            "catalog.product.deleted",
            "catalog.price.updated",
        ]);
    });
});

describe("validateLiveContract", () => {
    // A contract is data a host TRUSTS to decide what to re-fetch. Every rule
    // here exists because breaking it fails silently rather than loudly.

    it("passes a well-formed contract", () => {
        expect(validateLiveContract(catalog)).toEqual([]);
    });

    it("rejects a namespace carrying the package prefix", () => {
        // `fancy-catalog` as a namespace would make every key start with the
        // wrong segment, so nothing a package invalidates would match what the
        // UI queried.
        const problems = validateLiveContract({
            namespace: "fancy-catalog",
            events: [{ event: "fancy-catalog.product.updated", keys: [["fancy-catalog", "products"]] }],
        });

        expect(problems.join(" ")).toContain("drop the package prefix");
    });

    it("rejects an event name that is not namespace.resource.verb", () => {
        const problems = validateLiveContract({
            namespace: "catalog",
            events: [{ event: "productUpdated", keys: [["catalog", "products"]] }],
        });

        expect(problems.join(" ")).toContain("<namespace>.<resource>.<verb>");
    });

    it("rejects an event announced under someone else's namespace", () => {
        const problems = validateLiveContract({
            namespace: "catalog",
            events: [{ event: "mlm.product.updated", keys: [["catalog", "products"]] }],
        });

        expect(problems.join(" ")).toContain('not in namespace "catalog"');
    });

    it("rejects an unusual verb unless the contract says why", () => {
        const bare = validateLiveContract({
            namespace: "catalog",
            events: [{ event: "catalog.product.synced", keys: [["catalog", "products"]] }],
        });
        expect(bare.join(" ")).toContain("outside");

        const explained = validateLiveContract({
            namespace: "catalog",
            events: [
                {
                    event: "catalog.product.synced",
                    keys: [["catalog", "products"]],
                    note: "Stripe sync is neither a create nor an update from our side.",
                },
            ],
        });
        expect(explained).toEqual([]);
    });

    it("rejects an event that invalidates nothing", () => {
        const problems = validateLiveContract({
            namespace: "catalog",
            events: [{ event: "catalog.product.updated", keys: [] }],
        });

        expect(problems.join(" ")).toContain("invalidates nothing");
    });

    it("rejects a cross-namespace key unless the contract says why", () => {
        // Reaching into another package's keys is sometimes right and always
        // worth explaining — it is invisible coupling otherwise.
        const bare = validateLiveContract({
            namespace: "catalog",
            events: [{ event: "catalog.product.updated", keys: [["features", "flags"]] }],
        });
        expect(bare.join(" ")).toContain("outside its own namespace");

        const explained = validateLiveContract({
            namespace: "catalog",
            events: [
                {
                    event: "catalog.product.updated",
                    keys: [["features", "flags"]],
                    note: "A product's features gate FMS flags, so both caches go stale together.",
                },
            ],
        });
        expect(explained).toEqual([]);
    });

    it("rejects an unserializable key segment", () => {
        // Every value identifying the fetched data must be in the key, and TanStack
        // hashes keys structurally — a function or symbol makes that hash unstable.
        const problems = validateLiveContract({
            namespace: "catalog",
            events: [{ event: "catalog.product.updated", keys: [["catalog", (() => 1) as never]] }],
        });

        expect(problems.join(" ")).toContain("not serializable");
    });

    it("rejects a contract with no events at all", () => {
        expect(validateLiveContract({ namespace: "catalog", events: [] }).join(" "))
            .toContain("nothing would ever invalidate");
    });

    it("reports every problem at once, not just the first", () => {
        const problems = validateLiveContract({
            namespace: "Fancy_Catalog",
            events: [{ event: "nope", keys: [] }],
        });

        expect(problems.length).toBeGreaterThan(2);
    });
});

describe("the documented verbs", () => {
    it("are the five the plan names", () => {
        expect([...LIVE_VERBS]).toEqual(["created", "updated", "deleted", "moved", "completed"]);
    });
});
