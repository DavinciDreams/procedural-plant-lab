import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const projectRoot = resolve(import.meta.dirname, "..");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "procplants-cli-png-e2e-"));
const manifestDirectory = join(temporaryDirectory, "manifest");
const imageDirectory = join(manifestDirectory, "images");
const outputPath = join(temporaryDirectory, "atlas.json");

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let entry = 0; entry < 256; entry++) {
    let value = entry;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[entry] = value >>> 0;
  }
  return table;
})();
const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};
const uint32 = (value) => Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
const concat = (...parts) => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};
const chunk = (type, data = new Uint8Array()) => {
  const typeBytes = Uint8Array.from(type, (character) => character.charCodeAt(0));
  return concat(uint32(data.length), typeBytes, data, uint32(crc32(concat(typeBytes, data))));
};

const rgbaPng = (width, height, alpha) => {
  const rows = new Uint8Array(height * (width * 4 + 1));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    rows[offset++] = 0;
    for (let x = 0; x < width; x++) rows.set([40, 170, 70, alpha[y * width + x]], offset), offset += 4;
  }
  return concat(
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", concat(uint32(width), uint32(height), Uint8Array.of(8, 6, 0, 0, 0))),
    chunk("IDAT", new Uint8Array(deflateSync(rows))),
    chunk("IEND"),
  );
};

const runCli = (args) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(process.execPath, [join(projectRoot, "scripts", "procplants-cli.mjs"), ...args], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (value) => { stdout += value; });
  child.stderr.on("data", (value) => { stderr += value; });
  child.on("error", rejectRun);
  child.on("close", (code) => resolveRun({ code, stdout, stderr }));
});

try {
  await mkdir(imageDirectory, { recursive: true });
  const size = 5;
  const alpha = Uint8Array.from({ length: size * size }, (_, index) => {
    const x = index % size, y = Math.floor(index / size);
    return x > 0 && y > 0 && x < size - 1 && y < size - 1 ? 255 : 0;
  });
  const png = rgbaPng(size, size, alpha);
  await writeFile(join(imageDirectory, "leaf.png"), png);
  await writeFile(join(imageDirectory, "flower.png"), png);
  const manifestPath = join(manifestDirectory, "atlas.json");
  const metadata = {
    pivot: { x: 0.5, y: 0 }, attachment: { x: 0.5, y: 0 },
    bendAxis: { origin: { x: 0.5, y: 0 }, direction: { x: 0, y: 1 } },
  };
  await writeFile(manifestPath, JSON.stringify({
    cutouts: [{ id: "leaf", mask: { png: "images/leaf.png" }, metadata }],
  }), "utf8");
  await writeFile(outputPath, "stale output", "utf8");

  const first = await runCli(["atlas", manifestPath, "--out", outputPath]);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /packed 1 cutouts/);
  const firstOutput = await readFile(outputPath, "utf8");
  const atlas = JSON.parse(firstOutput);
  assert.equal(atlas.command, "atlas");
  assert.equal(atlas.cutouts[0].width, size);
  assert.equal(atlas.cutouts[0].height, size);

  const second = await runCli(["atlas", manifestPath, "--out", outputPath]);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(await readFile(outputPath, "utf8"), firstOutput, "actual wrapper output must overwrite deterministically");

  const directoryOutputPath = join(temporaryDirectory, "directory-atlas.json");
  const directoryResult = await runCli(["atlas", imageDirectory, "--size", "64", "--out", directoryOutputPath]);
  assert.equal(directoryResult.code, 0, directoryResult.stderr);
  const directoryAtlas = JSON.parse(await readFile(directoryOutputPath, "utf8"));
  assert.equal(directoryAtlas.atlas.width, 64);
  assert.deepEqual(directoryAtlas.cutouts.map((entry) => entry.id), ["flower", "leaf"]);

  const corruptPng = png.slice();
  corruptPng[corruptPng.length - 1] ^= 1;
  await writeFile(join(imageDirectory, "corrupt.png"), corruptPng);
  await writeFile(join(manifestDirectory, "bad.json"), JSON.stringify({
    cutouts: [{ id: "leaf", mask: { png: "images/corrupt.png" }, metadata }],
  }), "utf8");
  const rejected = await runCli(["atlas", join(manifestDirectory, "bad.json"), "--out", outputPath]);
  assert.equal(rejected.code, 2);
  assert.match(rejected.stderr, /CRC mismatch/);
  assert.equal(await readFile(outputPath, "utf8"), firstOutput, "invalid PNG must not overwrite prior output");

  const leftovers = (await readdir(temporaryDirectory, { recursive: true })).filter((name) => name.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
  console.log(`ok 1 - actual CLI reads manifest-relative PNG alpha and overwrites deterministically (${temporaryDirectory})`);
  console.log("ok 2 - corrupt PNG exits with usage status without overwriting prior output or leaving temp files");
  console.log("ok 3 - actual CLI recursively compiles a PNG directory at an explicit atlas size");
  console.log("1..3");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
