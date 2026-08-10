import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const projectRoot = resolve(import.meta.dirname, "..");
const outputRoot = join(projectRoot, "dist");
const manifest = JSON.parse(await readFile(join(outputRoot, ".vite", "manifest.json"), "utf8"));

const closure = (roots) => {
  const pending = [...roots];
  const visited = new Set();
  while (pending.length > 0) {
    const key = pending.shift();
    if (visited.has(key)) continue;
    const entry = manifest[key];
    assert.ok(entry, `missing Vite manifest entry ${key}`);
    visited.add(key);
    pending.push(...(entry.imports ?? []));
  }
  return [...visited].sort();
};

const footprint = async (keys, includeCss = false) => {
  const files = new Set();
  for (const key of keys) {
    const entry = manifest[key];
    files.add(entry.file);
    if (includeCss) for (const css of entry.css ?? []) files.add(css);
  }
  let rawBytes = 0;
  let gzipBytes = 0;
  for (const file of files) {
    const bytes = await readFile(join(outputRoot, file));
    rawBytes += bytes.byteLength;
    gzipBytes += gzipSync(bytes, { level: 9 }).byteLength;
  }
  return { files: [...files].sort(), rawBytes, gzipBytes };
};

const indexEntry = manifest["index.html"];
assert.deepEqual(indexEntry.dynamicImports, ["src/main.ts"], "bootstrap must dynamically load one lab entry");
const bootstrapKeys = closure(["index.html"]);
const interactiveKeys = closure(["index.html", "src/main.ts"]);
const bootstrap = await footprint(bootstrapKeys, true);
const interactive = await footprint(interactiveKeys, true);

assert.ok(bootstrap.rawBytes <= 12_000, `bootstrap grew beyond 12 kB (${bootstrap.rawBytes})`);
assert.ok(bootstrap.gzipBytes <= 4_000, `bootstrap grew beyond 4 kB gzip (${bootstrap.gzipBytes})`);
assert.ok(interactive.rawBytes <= 1_050_000, `interactive static closure grew beyond 1.05 MB (${interactive.rawBytes})`);
assert.ok(interactive.gzipBytes <= 280_000, `interactive static closure grew beyond 280 kB gzip (${interactive.gzipBytes})`);

const forbiddenStaticEntries = [
  "node_modules/@dgreenheck/ez-tree/build/ez-tree.es.js",
  "src/procplant-graph-editor-ui.ts",
  "src/procplant-material-graph-editor-ui.ts",
  "src/procplant-authoring-tools.ts",
  "src/procplant-crown-volume-tool.ts",
  "src/procplant-impostor-three.ts",
  "src/procplant-lab-authoring-imports.ts",
];
for (const key of forbiddenStaticEntries) {
  const manifestKey = manifest[key]
    ? key
    : Object.keys(manifest).find((candidate) => candidate.replaceAll("\\", "/").endsWith(`/${key}`));
  assert.ok(manifestKey, `expected lazy manifest entry ${key}`);
  assert.equal(interactiveKeys.includes(manifestKey), false, `${key} must remain outside the interactive static closure`);
}
assert.equal(interactive.files.some((file) => /webgpu/i.test(file)), false,
  "opt-in WebGPU code must remain outside the WebGL lab startup closure");

console.log(JSON.stringify({ bootstrap, interactive, lazyEntries: forbiddenStaticEntries }, null, 2));
console.log("procplant startup load budget passed");
