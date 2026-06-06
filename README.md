# @particle-academy/fancy-query

[![Fancified](art/fancified.svg)](https://particle.academy)

Server-state for **React + Inertia + Reverb** apps — a thin wrapper over
[TanStack Query](https://tanstack.com/query) that adds the three integrations
you'd otherwise hand-roll per component:

- **Inertia page-prop hydration** — seed the cache from `usePage().props` so the
  first render is hydrated with no fetch.
- **Echo-event → query invalidation** — a declarative `event → keys` map.
- **Auto-invalidating mutations** — mutate, then refetch the keys it touched.

The value-add is the integrations, not the cache. TanStack Query, `@inertiajs/react`,
and `react` are **peer dependencies** — nothing is bundled, and apps that don't
use a data hook tree-shake the package away.

> **Status:** scaffold (v0.1.0). Public API is in place; comprehensive tests,
> the `fancy-inertia` `withData` composition, and a few edge cases are tracked
> in Tynn.

## Install

```bash
npm install @particle-academy/fancy-query @tanstack/react-query
```

## The standard flow

> **Mutation OR Echo event → invalidate keys → cache refetches once → every
> subscribed component updates automatically.**

### Before — ad-hoc per component

```jsx
const [tools, setTools] = useState([]);
useEffect(() => { fetchTools().then(setTools); }, [filters]);
useEffect(() => {
  const h = () => fetchTools().then(setTools);
  ["x-created", "x-updated"].forEach((ev) => window.addEventListener(ev, h));
  return () => ["x-created", "x-updated"].forEach((ev) => window.removeEventListener(ev, h));
}, []);
```

### After — with fancy-query

```jsx
const { data: tools } = useFancyQuery(["org-tools", filters], () =>
  api.get("/api/org/compass-tools", { filters }),
);

useFancyEchoInvalidation(`private-org.${orgId}`, {
  CompassToolUpdated: ["org-tools"],
  CompassToolDeleted: ["org-tools"],
});
```

A second component reading `["org-tools", filters]` in the same render gets the
cached result — no extra request.

## End to end

```tsx
// 1. Mount once — near the root (or via fancy-inertia's FancyAppRoot withData).
import { FancyDataRoot } from "@particle-academy/fancy-query";

<FancyDataRoot echo={window.Echo}>
  <App />
</FancyDataRoot>;
```

```tsx
// 2. A page that received ['tools' => $tools] hydrates the cache.
import {
  useInertiaHydration,
  useFancyQuery,
  useFancyMutation,
  useFancyEchoInvalidation,
} from "@particle-academy/fancy-query";

function ToolsPage({ orgId }) {
  useInertiaHydration({ tools: ["org-tools"] });

  // 3. Read — hydrated first render, then cached + deduped.
  const { data: tools } = useFancyQuery(["org-tools"], () =>
    api.get("/api/org/compass-tools"),
  );

  // 4. Mutate — invalidates the same key on success.
  const { mutate, isPending } = useFancyMutation({
    mutationFn: (payload) => api.post("/api/org/compass-tools", payload),
    invalidates: ["org-tools"],
  });

  // 5. Real-time — the same key invalidates on a broadcast.
  useFancyEchoInvalidation(`private-org.${orgId}`, {
    CompassToolUpdated: ["org-tools"],
    CompassToolDeleted: ["org-tools"],
  });

  return /* … */;
}
```

## API

| Export | What it does |
|---|---|
| `FancyDataRoot` | Mount-once provider: one `QueryClient` (+ optional Echo client) for the app. |
| `createFancyQueryClient(config?)` | A `QueryClient` with the Fancy defaults (override-friendly). |
| `FANCY_QUERY_DEFAULTS` | `staleTime: 30s`, `gcTime: 5m`, `refetchOnWindowFocus`, one retry. |
| `useFancyQuery(key, fn, options?)` | `useQuery` with the ergonomic signature; full options pass through. |
| `useFancyMutation({ mutationFn, invalidates, … })` | `useMutation` that invalidates keys on success. |
| `useFancyEchoInvalidation(channel, eventMap, options?)` | Subscribe + invalidate on broadcasts. |
| `useInertiaHydration(map, options?)` | Seed the cache from Inertia page props. |
| `useQueryClient`, `QueryClient`, `toQueryKeys` | Re-exported primitives. |

## License

MIT © Particle Academy
