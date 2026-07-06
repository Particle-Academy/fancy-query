import { defineConfig } from "tsup";

export default defineConfig({
  // `inertia` is a separate entry (→ `fancy-query/inertia`) so the root entry
  // never references the optional `@inertiajs/react` peer.
  entry: ["src/index.ts", "src/inertia.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  // Everything wrappable is a peer — keep them out of the bundle so apps that
  // don't use a data hook tree-shake the whole thing away.
  external: ["react", "react-dom", "@tanstack/react-query", "@inertiajs/react"],
  treeshake: true,
});
