import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { inflateSync } from "node:zlib";

const projectRoot = resolve(import.meta.dirname, "..");
const tempDirectory = await mkdtemp(join(tmpdir(), "procplants-cli-"));
const outputFile = join(tempDirectory, "procplant-cli.mjs");

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/**
 * Recursively discovers regular JSON files without following symbolic links.
 * Skipping symlinks keeps traversal within the caller-selected directory tree.
 */
const listTextFiles = async (directory) => {
  const root = resolve(directory);
  const files = [];
  const visit = async (current) => {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        files.push({
          path,
          relativePath: relative(root, path).replaceAll("\\", "/"),
        });
      }
    }
  };
  await visit(root);
  return files;
};

const listBinaryFiles = async (directory) => {
  const root = resolve(directory);
  const files = [];
  const visit = async (current) => {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
        files.push({ path, relativePath: relative(root, path).replaceAll("\\", "/") });
      }
    }
  };
  await visit(root);
  return files;
};

const expandPaths = async (pattern) => {
  const absolute = resolve(pattern);
  const directory = dirname(absolute);
  const namePattern = basename(absolute);
  if (/[*?]/.test(directory)) throw new Error("validation wildcards are supported only in the file name");
  const expression = new RegExp(`^${namePattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".")}$`, "i");
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && expression.test(entry.name))
    .map((entry) => join(directory, entry.name))
    .sort(compareText);
};

const writeBinary = async (path, contents) => {
  const target = resolve(path);
  const targetDirectory = dirname(target);
  await mkdir(targetDirectory, { recursive: true });
  const temporary = join(
    targetDirectory,
    `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, contents, { flag: "wx" });
    try {
      await rename(temporary, target);
    } catch (error) {
      // Windows does not consistently replace an existing destination with
      // rename. The complete temporary file still prevents partial generation;
      // fall back to replacing the explicitly requested target in place.
      if (!(error && typeof error === "object" && "code" in error &&
        (error.code === "EEXIST" || error.code === "EPERM"))) throw error;
      await writeFile(target, contents);
    }
  } finally {
    await rm(temporary, { force: true });
  }
};

try {
  await build({
    entryPoints: [join(projectRoot, "src", "procplant-cli.ts")],
    outfile: outputFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  const { runProcPlantCli } = await import(`${pathToFileURL(outputFile).href}?run=${Date.now()}`);
  process.exitCode = await runProcPlantCli(process.argv.slice(2), {
    readText: (path) => readFile(resolve(path), "utf8"),
    readBinary: async (path) => new Uint8Array(await readFile(resolve(path))),
    writeText: async (path, contents) => writeBinary(path, new TextEncoder().encode(contents)),
    writeBinary,
    listTextFiles,
    listBinaryFiles,
    expandPaths,
    resolvePath: (path) => resolve(path),
    resolveRelativePath: (manifestPath, referencedPath) => resolve(dirname(resolve(manifestPath)), referencedPath),
    inflateZlib: async (contents, maximumOutputBytes) => {
      const result = inflateSync(contents, { maxOutputLength: maximumOutputBytes, info: true });
      if (result.engine.bytesWritten !== contents.length) throw new Error("zlib stream contains trailing bytes");
      return new Uint8Array(result.buffer);
    },
    stdout: (message) => process.stdout.write(message),
    stderr: (message) => process.stderr.write(message),
  });
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
