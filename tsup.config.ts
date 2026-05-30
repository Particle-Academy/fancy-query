import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  // Everything wrappable is a peer — keep them out of the bundle so apps that
  // don't use a data hook tree-shake the whole thing away.
  external: ["react", "react-dom", "@tanstack/react-query", "@inertiajs/react"],
  treeshake: true,
});
