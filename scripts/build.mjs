// Builds ./public (static assets for the Worker):
//   public/blox/   host page + epoxy client   (engine files come from Roblox's CDN at runtime)
//   public/proxy/  Scramjet sign-in browser
//   public/_headers  cross-origin isolation for /blox/ (needed for SharedArrayBuffer)
import { cp, mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUB = join(ROOT, "public");
const require = createRequire(import.meta.url);

await rm(PUB, { recursive: true, force: true });
await mkdir(join(PUB, "blox"), { recursive: true });
await mkdir(join(PUB, "proxy", "scramjet"), { recursive: true });
await mkdir(join(PUB, "proxy", "controller"), { recursive: true });

// --- /blox/ ---
await cp(join(ROOT, "webblox"), join(PUB, "blox"), { recursive: true });
const epoxyEntry = require.resolve("@mercuryworkshop/epoxy-transport"); // dist/index.mjs
await copyFile(epoxyEntry, join(PUB, "blox", "epoxy.mjs"));

// --- /proxy/ ---
for (const f of ["index.html", "style.css", "sw.js"]) await copyFile(join(ROOT, "proxy", f), join(PUB, "proxy", f));
await build({
  entryPoints: [join(ROOT, "proxy", "main.ts")],
  outfile: join(PUB, "proxy", "main.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  minify: true,
});
const { scramjetPath } = await import(pathToFileURL(require.resolve("@mercuryworkshop/scramjet/path")).href);
const { controllerPath } = await import(pathToFileURL(require.resolve("@mercuryworkshop/scramjet-controller/path")).href);
for (const f of ["scramjet.js", "scramjet.wasm"]) await copyFile(join(scramjetPath, f), join(PUB, "proxy", "scramjet", f));
for (const f of ["controller.api.js", "controller.inject.js", "controller.sw.js"])
  await copyFile(join(controllerPath, f), join(PUB, "proxy", "controller", f));

// --- headers ---
await writeFile(
  join(PUB, "_headers"),
  `/blox
/blox/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  Cache-Control: no-cache
`,
);
console.log("[weblox] built ./public");
