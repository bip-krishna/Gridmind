import { build } from "esbuild";
await build({
  entryPoints: ["src/mcp/project-memory.ts"], outfile: "dist/memory/project-mcp.mjs",
  bundle: true, platform: "node", format: "esm", target: "node22",
  external: ["better-sqlite3"],
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
