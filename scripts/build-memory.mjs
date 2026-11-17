import { build } from "esbuild";
await build({
  entryPoints: { "project-mcp": "src/mcp/project-memory.ts", "project-http": "src/mcp/project-http.ts" }, outdir: "dist/memory", outExtension: { ".js": ".mjs" },
  bundle: true, platform: "node", format: "esm", target: "node22",
  external: ["better-sqlite3"],
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
