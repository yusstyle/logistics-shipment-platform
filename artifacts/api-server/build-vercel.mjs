import { build } from "esbuild";
await build({
  entryPoints: ["src/vercel.ts"],
  outfile: "../../api/index.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["pg-native"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
});
