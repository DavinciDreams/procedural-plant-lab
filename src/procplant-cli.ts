import { PROCPLANT_GENERATOR_CONTRACT_REVISION } from "./procplant-contract";
import {
  createProcPlantCutout,
  packProcPlantCutoutAtlas,
  type ProcPlantAlphaMask,
  type ProcPlantCutoutMetadata,
  type ProcPlantCutoutTraceOptions,
} from "./procplant-cutout";
import {
  PROCPLANT_EXPORT_PROFILES,
  inspectProcPlantReadiness,
  type ProcPlantExportProfileId,
} from "./plant-readiness";
import { exportProcPlantGlb } from "./procplant-export";
import { validateProcPlantGlb } from "./procplant-glb-validation";
import { exportProcPlantUsda } from "./procplant-usd-export";
import {
  exportProcPlantVariantGlbBundle,
  PROCPLANT_STANDARD_VARIANTS,
} from "./procplant-variant-export";
import {
  decodeProcPlantPngAlpha,
  type ProcPlantInflateZlib,
} from "./procplant-png-alpha";
import {
  buildProcPlantRuntimePackage,
  compileProcPlantLods,
  defaultPlantEnvironment,
  type ProcPlantGenome,
} from "./procplants";

export const PROCPLANT_CLI_CONTRACT = "procplants.headless-cli" as const;
export const PROCPLANT_CLI_VERSION = 1 as const;

export const PROCPLANT_CLI_EXIT = {
  success: 0,
  failure: 1,
  usage: 2,
} as const;

export interface ProcPlantCliIo {
  readText(path: string): Promise<string>;
  /** Optional binary capability used by PNG atlas inputs. */
  readBinary?(path: string): Promise<Uint8Array>;
  writeText(path: string, contents: string): Promise<void>;
  /** Optional binary capability used by native GLB output. */
  writeBinary?(path: string, contents: Uint8Array): Promise<void>;
  /**
   * Optional directory capability used by `compile-dir`. The adapter owns
   * filesystem traversal and returns JSON text files with portable paths
   * relative to the requested directory.
   */
  listTextFiles?(path: string): Promise<readonly ProcPlantCliDirectoryFile[]>;
  /** Recursively lists bounded PNG inputs for directory atlas compilation. */
  listBinaryFiles?(path: string): Promise<readonly ProcPlantCliDirectoryFile[]>;
  /** Expands a bounded, non-recursive validation wildcard in the adapter filesystem. */
  expandPaths?(pattern: string): Promise<readonly string[]>;
  /** Returns an absolute, normalized path for directory safety comparisons. */
  resolvePath?(path: string): string;
  /** Resolves an asset reference relative to a manifest file. */
  resolveRelativePath?(manifestPath: string, referencedPath: string): string;
  /** Bounded zlib capability used by the runtime-independent PNG parser. */
  inflateZlib?: ProcPlantInflateZlib;
  stdout(message: string): void;
  stderr(message: string): void;
}

export interface ProcPlantCliDirectoryFile {
  path: string;
  relativePath: string;
}

export interface ProcPlantCliCompileOutput {
  contract: typeof PROCPLANT_CLI_CONTRACT;
  version: typeof PROCPLANT_CLI_VERSION;
  generatorContractRevision: typeof PROCPLANT_GENERATOR_CONTRACT_REVISION;
  command: "compile";
  profile: ProcPlantExportProfileId;
  seed: number;
  environment: ReturnType<typeof defaultPlantEnvironment>;
  runtime: ReturnType<typeof buildProcPlantRuntimePackage>;
  readiness: ReturnType<typeof inspectProcPlantReadiness>;
  variants?: Array<{
    index: number;
    seed: number;
    runtime: ReturnType<typeof buildProcPlantRuntimePackage>;
    readiness: ReturnType<typeof inspectProcPlantReadiness>;
  }>;
}

export interface ProcPlantCliCompileDirectoryManifestEntry {
  source: string;
  output: string;
  genomeId: string;
  habit: ProcPlantGenome["habit"];
  seed: number;
  ready: boolean;
  readinessScore: number;
  warningCount: number;
  contentHash: string;
}

export interface ProcPlantCliCompileDirectoryManifest {
  contract: typeof PROCPLANT_CLI_CONTRACT;
  version: typeof PROCPLANT_CLI_VERSION;
  generatorContractRevision: typeof PROCPLANT_GENERATOR_CONTRACT_REVISION;
  command: "compile-dir";
  profile: ProcPlantExportProfileId;
  seed: number;
  variants: number | null;
  count: number;
  entries: ProcPlantCliCompileDirectoryManifestEntry[];
}

export const PROCPLANT_CLI_USAGE = `Usage:
  procplants compile <genome.json> --profile <tellus-realtime|web-preview|hero-asset> --seed <uint32> --out <file> [--variants <1-256>]
  procplants compile-dir <directory> --profile <tellus-realtime|web-preview|hero-asset> --seed <uint32> --out <directory> [--variants <1-256>]
  procplants glb <genome.json> --profile <tellus-realtime|web-preview|hero-asset> --seed <uint32> --out <file.glb> [--lod <0|1|2|3|all>] [--collision <none|bounds-box|trunk-capsule>] [--meshopt <none|required|fallback>]
  procplants variant-glb <genome.json> --profile <tellus-realtime|web-preview|hero-asset> --seed <uint32> --out <file.glb> [--variants <spring,summer,autumn,winter,damaged>] [--lod <0|1|2|3|all>] [--collision <none|bounds-box|trunk-capsule>] [--meshopt <none|required|fallback>]
  procplants usda <genome.json> --profile <tellus-realtime|web-preview|hero-asset> --seed <uint32> --out <file.usda> [--lod <0|1|2|3|all>] [--collision <none|bounds-box|trunk-capsule>]
  procplants validate <genome.json|asset.glb|pattern> [...]
  procplants atlas <manifest.json|png-directory> --out <metadata.json> [--size <pixels>]
`;

class ProcPlantCliInputError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const assertRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new ProcPlantCliInputError(`${label} must be an object`);
  return value;
};

const assertString = (value: unknown, label: string) => {
  if (typeof value !== "string" || !value.trim()) throw new ProcPlantCliInputError(`${label} must be a non-empty string`);
  return value;
};

const assertFinite = (value: unknown, label: string) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ProcPlantCliInputError(`${label} must be finite`);
  return value;
};

const validateCurve = (value: unknown, label: string) => {
  const curve = assertRecord(value, label);
  assertFinite(curve.base, `${label}.base`);
  assertFinite(curve.tip, `${label}.tip`);
  assertFinite(curve.curve, `${label}.curve`);
};

export const validateProcPlantGenomeInput = (value: unknown): ProcPlantGenome => {
  const genome = assertRecord(value, "genome");
  assertString(genome.id, "genome.id");
  const habits = new Set(["grass", "fern", "flower", "tropical", "shrub", "vine", "tree", "conifer", "palm", "moss"]);
  if (typeof genome.habit !== "string" || !habits.has(genome.habit)) {
    throw new ProcPlantCliInputError(`genome.habit must be one of ${[...habits].join(", ")}`);
  }
  if (!Number.isInteger(genome.nodeCount) || (genome.nodeCount as number) <= 0) {
    throw new ProcPlantCliInputError("genome.nodeCount must be a positive integer");
  }
  validateCurve(genome.internode, "genome.internode");
  assertFinite(genome.phyllotaxisAngle, "genome.phyllotaxisAngle");
  validateCurve(genome.branchChance, "genome.branchChance");
  const branchAngle = assertRecord(genome.branchAngle, "genome.branchAngle");
  assertFinite(branchAngle.mean, "genome.branchAngle.mean");
  assertFinite(branchAngle.spread, "genome.branchAngle.spread");
  assertFinite(branchAngle.depthDecay, "genome.branchAngle.depthDecay");
  assertFinite(genome.apicalDominance, "genome.apicalDominance");
  const leaf = assertRecord(genome.leaf, "genome.leaf");
  const leafShapes = new Set(["lanceolate", "ovate", "cordate", "palmate", "spatulate", "fan", "linear", "round", "frond", "blade"]);
  if (typeof leaf.shape !== "string" || !leafShapes.has(leaf.shape)) {
    throw new ProcPlantCliInputError(`genome.leaf.shape must be one of ${[...leafShapes].join(", ")}`);
  }
  validateCurve(leaf.length, "genome.leaf.length");
  validateCurve(leaf.density, "genome.leaf.density");
  for (const field of ["widthRatio", "curl", "serration", "venation", "colorA", "colorB"] as const) {
    assertFinite(leaf[field], `genome.leaf.${field}`);
  }
  const lightResponse = assertRecord(genome.lightResponse, "genome.lightResponse");
  for (const field of ["shadeAvoidance", "leafBoostInShade", "branchSuppressionInShade", "phototropism"] as const) {
    assertFinite(lightResponse[field], `genome.lightResponse.${field}`);
  }
  return value as ProcPlantGenome;
};

const parseJson = (contents: string, path: string): unknown => {
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new ProcPlantCliInputError(`${path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
};

const readGenome = async (path: string, io: ProcPlantCliIo) =>
  validateProcPlantGenomeInput(parseJson(await io.readText(path), path));

const parseFlags = (args: readonly string[]) => {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new ProcPlantCliInputError(`expected --flag value, received: ${args.slice(index).join(" ")}`);
    }
    if (flags.has(flag)) throw new ProcPlantCliInputError(`duplicate option: ${flag}`);
    flags.set(flag, value);
  }
  return flags;
};

const requireOnlyFlags = (
  flags: Map<string, string>,
  allowed: readonly string[],
  required: readonly string[] = allowed,
) => {
  for (const flag of flags.keys()) {
    if (!allowed.includes(flag)) throw new ProcPlantCliInputError(`unknown option: ${flag}`);
  }
  for (const flag of required) {
    if (!flags.has(flag)) throw new ProcPlantCliInputError(`missing required option: ${flag}`);
  }
};

const parseSeed = (value: string) => {
  const seed = Number(value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new ProcPlantCliInputError("--seed must be an integer in [0, 4294967295]");
  }
  return seed;
};

const parseVariantCount = (value: string | undefined) => {
  if (value === undefined) return null;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 256) {
    throw new ProcPlantCliInputError("--variants must be an integer in [1, 256]");
  }
  return count;
};

const serialize = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const compileGenome = (
  genome: ProcPlantGenome,
  profile: ProcPlantExportProfileId,
  seed: number,
  variantCount: number | null,
): ProcPlantCliCompileOutput => {
  const environment = defaultPlantEnvironment();
  return {
    contract: PROCPLANT_CLI_CONTRACT,
    version: PROCPLANT_CLI_VERSION,
    generatorContractRevision: PROCPLANT_GENERATOR_CONTRACT_REVISION,
    command: "compile",
    profile,
    seed,
    environment,
    runtime: buildProcPlantRuntimePackage(genome, seed, environment),
    readiness: inspectProcPlantReadiness(genome, seed, environment, profile),
    ...(variantCount
      ? {
          variants: Array.from({ length: variantCount }, (_, index) => {
            const variantSeed = index === 0
              ? seed
              : (seed + Math.imul(index, 0x9e3779b9)) >>> 0;
            return {
              index,
              seed: variantSeed,
              runtime: buildProcPlantRuntimePackage(genome, variantSeed, environment),
              readiness: inspectProcPlantReadiness(genome, variantSeed, environment, profile),
            };
          }),
        }
      : {}),
  };
};

const parseCompileOptions = (args: readonly string[]) => {
  const flags = parseFlags(args);
  requireOnlyFlags(
    flags,
    ["--profile", "--seed", "--out", "--variants"],
    ["--profile", "--seed", "--out"],
  );
  const profile = flags.get("--profile") as ProcPlantExportProfileId;
  if (!(profile in PROCPLANT_EXPORT_PROFILES)) {
    throw new ProcPlantCliInputError("--profile must be tellus-realtime, web-preview, or hero-asset");
  }
  return {
    profile,
    seed: parseSeed(flags.get("--seed")!),
    outputPath: assertString(flags.get("--out"), "--out"),
    variantCount: parseVariantCount(flags.get("--variants")),
  };
};

const compileCommand = async (args: readonly string[], io: ProcPlantCliIo) => {
  const genomePath = args[0];
  if (!genomePath || genomePath.startsWith("--")) throw new ProcPlantCliInputError("compile requires <genome.json>");
  const { profile, seed, outputPath, variantCount } = parseCompileOptions(args.slice(1));
  const genome = await readGenome(genomePath, io);
  const output = compileGenome(genome, profile, seed, variantCount);
  await io.writeText(outputPath, serialize(output));
  io.stdout(`compiled ${genome.id} for ${profile} -> ${outputPath}\n`);
};

type ProcPlantCliGlbLod = 0 | 1 | 2 | 3 | "all";

const parseGlbLod = (value: string | undefined): ProcPlantCliGlbLod => {
  if (value === undefined || value === "0") return 0;
  if (value === "all") return "all";
  const level = Number(value);
  if (level === 1 || level === 2 || level === 3) return level;
  throw new ProcPlantCliInputError("--lod must be 0, 1, 2, 3, or all");
};

const parseGlbCollision = (value: string | undefined) => {
  if (value === undefined || value === "none") return undefined;
  if (value === "bounds-box" || value === "trunk-capsule") return { type: value } as const;
  throw new ProcPlantCliInputError("--collision must be none, bounds-box, or trunk-capsule");
};

const parseGlbMeshopt = (value: string | undefined) => {
  if (value === undefined || value === "none") return undefined;
  if (value === "required" || value === "fallback") return { compatibility: value } as const;
  throw new ProcPlantCliInputError("--meshopt must be none, required, or fallback");
};

const glbCommand = async (args: readonly string[], io: ProcPlantCliIo) => {
  const genomePath = args[0];
  if (!genomePath || genomePath.startsWith("--")) throw new ProcPlantCliInputError("glb requires <genome.json>");
  const flags = parseFlags(args.slice(1));
  requireOnlyFlags(
    flags,
    ["--profile", "--seed", "--out", "--lod", "--collision", "--meshopt"],
    ["--profile", "--seed", "--out"],
  );
  const profile = flags.get("--profile") as ProcPlantExportProfileId;
  if (!(profile in PROCPLANT_EXPORT_PROFILES)) {
    throw new ProcPlantCliInputError("--profile must be tellus-realtime, web-preview, or hero-asset");
  }
  const seed = parseSeed(flags.get("--seed")!);
  const outputPath = assertString(flags.get("--out"), "--out");
  if (!outputPath.toLowerCase().endsWith(".glb")) throw new ProcPlantCliInputError("--out must end in .glb");
  const lodSelection = parseGlbLod(flags.get("--lod"));
  const collision = parseGlbCollision(flags.get("--collision"));
  const meshopt = parseGlbMeshopt(flags.get("--meshopt"));
  if (!io.writeBinary) {
    throw new Error("glb is unavailable because this CLI adapter does not support binary writes");
  }
  const genome = await readGenome(genomePath, io);
  const environment = defaultPlantEnvironment();
  const readiness = inspectProcPlantReadiness(genome, seed, environment, profile);
  const lods = compileProcPlantLods(genome, seed, environment);
  const source = lodSelection === "all"
    ? lods
    : lods.find((lod) => lod.level === lodSelection)?.template;
  if (!source) throw new Error(`compiled GLB source is missing LOD ${lodSelection}`);
  const bytes = await exportProcPlantGlb(source, {
    name: genome.id,
    genomeId: genome.id,
    seed,
    ...(collision ? { collision } : {}),
    ...(meshopt ? { meshopt } : {}),
    metadata: {
      cliContract: PROCPLANT_CLI_CONTRACT,
      cliVersion: PROCPLANT_CLI_VERSION,
      profile,
      readinessScore: readiness.score,
      readinessReady: readiness.ready,
      lodSelection: String(lodSelection),
    },
  });
  await io.writeBinary(outputPath, new Uint8Array(bytes));
  io.stdout(
    `compiled ${genome.id} GLB (${lodSelection === "all" ? "all LODs" : `LOD ${lodSelection}`}, ${bytes.byteLength} bytes) -> ${outputPath}\n`,
  );
};

const usdaCommand = async (args: readonly string[], io: ProcPlantCliIo) => {
  const genomePath = args[0];
  if (!genomePath || genomePath.startsWith("--")) throw new ProcPlantCliInputError("usda requires <genome.json>");
  const flags = parseFlags(args.slice(1));
  requireOnlyFlags(
    flags,
    ["--profile", "--seed", "--out", "--lod", "--collision"],
    ["--profile", "--seed", "--out"],
  );
  const profile = flags.get("--profile") as ProcPlantExportProfileId;
  if (!(profile in PROCPLANT_EXPORT_PROFILES)) {
    throw new ProcPlantCliInputError("--profile must be tellus-realtime, web-preview, or hero-asset");
  }
  const seed = parseSeed(flags.get("--seed")!);
  const outputPath = assertString(flags.get("--out"), "--out");
  if (!outputPath.toLowerCase().endsWith(".usda")) throw new ProcPlantCliInputError("--out must end in .usda");
  const lodSelection = parseGlbLod(flags.get("--lod"));
  const collision = parseGlbCollision(flags.get("--collision"));
  const genome = await readGenome(genomePath, io);
  const environment = defaultPlantEnvironment();
  const readiness = inspectProcPlantReadiness(genome, seed, environment, profile);
  const lods = compileProcPlantLods(genome, seed, environment);
  const source = lodSelection === "all"
    ? lods
    : lods.filter((lod) => lod.level === lodSelection);
  if (source.length === 0) throw new Error(`compiled USDA source is missing LOD ${lodSelection}`);
  const output = exportProcPlantUsda(source, {
    name: genome.id,
    genomeId: genome.id,
    seed,
    ...(collision ? { collision } : {}),
    metadata: {
      cliContract: PROCPLANT_CLI_CONTRACT,
      cliVersion: PROCPLANT_CLI_VERSION,
      profile,
      readinessScore: readiness.score,
      readinessReady: readiness.ready,
    },
  });
  await io.writeText(outputPath, output.text);
  io.stdout(
    `compiled ${genome.id} USDA (${lodSelection === "all" ? `${output.lods.length} LOD variants` : `LOD ${lodSelection}`}, ${output.bytes} bytes) -> ${outputPath}\n`,
  );
};

const parseStandardVariantSelection = (value: string | undefined) => {
  if (value === undefined) return PROCPLANT_STANDARD_VARIANTS;
  const requested = value.split(",").map((entry) => entry.trim().toLowerCase());
  if (requested.length === 0 || requested.some((entry) => !entry)) {
    throw new ProcPlantCliInputError("--variants must be a comma-separated standard variant list");
  }
  const unique = new Set(requested);
  if (unique.size !== requested.length) throw new ProcPlantCliInputError("--variants must not contain duplicates");
  const known = new Set(PROCPLANT_STANDARD_VARIANTS.map((variant) => variant.name));
  const unknown = requested.find((name) => !known.has(name));
  if (unknown) throw new ProcPlantCliInputError(`--variants contains unknown standard variant: ${unknown}`);
  // Canonical standard order makes equivalent selections byte-identical.
  return PROCPLANT_STANDARD_VARIANTS.filter((variant) => unique.has(variant.name));
};

const variantGlbCommand = async (args: readonly string[], io: ProcPlantCliIo) => {
  const genomePath = args[0];
  if (!genomePath || genomePath.startsWith("--")) throw new ProcPlantCliInputError("variant-glb requires <genome.json>");
  const flags = parseFlags(args.slice(1));
  requireOnlyFlags(
    flags,
    ["--profile", "--seed", "--out", "--variants", "--lod", "--collision", "--meshopt"],
    ["--profile", "--seed", "--out"],
  );
  const profile = flags.get("--profile") as ProcPlantExportProfileId;
  if (!(profile in PROCPLANT_EXPORT_PROFILES)) {
    throw new ProcPlantCliInputError("--profile must be tellus-realtime, web-preview, or hero-asset");
  }
  const seed = parseSeed(flags.get("--seed")!);
  const outputPath = assertString(flags.get("--out"), "--out");
  if (!outputPath.toLowerCase().endsWith(".glb")) throw new ProcPlantCliInputError("--out must end in .glb");
  if (!io.writeBinary) throw new Error("variant-glb is unavailable because this CLI adapter does not support binary writes");
  const lod = parseGlbLod(flags.get("--lod"));
  const collision = parseGlbCollision(flags.get("--collision"));
  const meshopt = parseGlbMeshopt(flags.get("--meshopt"));
  const variants = parseStandardVariantSelection(flags.get("--variants"));
  const genome = await readGenome(genomePath, io);
  const environment = defaultPlantEnvironment();
  const readiness = inspectProcPlantReadiness(genome, seed, environment, profile);
  const bundle = await exportProcPlantVariantGlbBundle(genome, seed, environment, {
    variants,
    lod,
    glb: {
      ...(collision ? { collision } : {}),
      ...(meshopt ? { meshopt } : {}),
    },
    metadata: {
      cliContract: PROCPLANT_CLI_CONTRACT,
      cliVersion: PROCPLANT_CLI_VERSION,
      profile,
      readinessScore: readiness.score,
      readinessReady: readiness.ready,
    },
  });
  await io.writeBinary(outputPath, new Uint8Array(bundle.bytes));
  io.stdout(
    `compiled ${genome.id} variant GLB (${variants.length} variants, ${bundle.manifest.variants.reduce((sum, variant) => sum + variant.lods.length, 0)} scenes, ${bundle.bytes.byteLength} bytes) -> ${outputPath}\n`,
  );
};

const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

const normalizeDirectoryPath = (value: string) => {
  const slashPath = value.replace(/\\/g, "/");
  const drive = slashPath.match(/^[A-Za-z]:/)?.[0] ?? "";
  const rooted = slashPath.startsWith("/") || Boolean(drive);
  const tail = drive ? slashPath.slice(drive.length) : slashPath;
  const parts: string[] = [];
  for (const part of tail.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts.at(-1) !== "..") parts.pop();
      else if (!rooted) parts.push(part);
      continue;
    }
    parts.push(part);
  }
  const normalized = `${drive.toLowerCase()}${rooted ? "/" : ""}${parts.join("/")}`.toLowerCase();
  return normalized === "/" || /^[a-z]:\/$/.test(normalized)
    ? normalized
    : normalized.replace(/\/$/, "");
};

const normalizeBatchRelativePath = (value: unknown, label: string) => {
  const path = assertString(value, label).replace(/\\/g, "/");
  const parts = path.split("/");
  if (
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new ProcPlantCliInputError(`${label} must be a safe relative path`);
  }
  if (!path.toLowerCase().endsWith(".json")) {
    throw new ProcPlantCliInputError(`${label} must end in .json`);
  }
  return path;
};

const outputSlug = (id: string) => {
  const slug = id
    .normalize("NFKD")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  if (!slug) throw new ProcPlantCliInputError(`genome.id cannot produce a safe batch output name: ${id}`);
  return `${slug}.procplant.json`;
};

const joinOutputPath = (directory: string, filename: string) =>
  directory.endsWith("/") || directory.endsWith("\\") ? `${directory}${filename}` : `${directory}/${filename}`;

const contentHash = (contents: string) => {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(contents)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const compileDirectoryCommand = async (args: readonly string[], io: ProcPlantCliIo) => {
  const inputDirectory = args[0];
  if (!inputDirectory || inputDirectory.startsWith("--")) {
    throw new ProcPlantCliInputError("compile-dir requires <directory>");
  }
  const { profile, seed, outputPath, variantCount } = parseCompileOptions(args.slice(1));
  if (!io.listTextFiles || !io.resolvePath) {
    throw new Error(
      "compile-dir is unavailable because this CLI adapter does not support directory listing and path resolution",
    );
  }
  const normalizedInput = normalizeDirectoryPath(io.resolvePath(inputDirectory));
  const normalizedOutput = normalizeDirectoryPath(io.resolvePath(outputPath));
  const inputPrefix = normalizedInput.endsWith("/") ? normalizedInput : `${normalizedInput}/`;
  if (
    normalizedInput === normalizedOutput ||
    (normalizedInput && normalizedOutput.startsWith(inputPrefix))
  ) {
    throw new ProcPlantCliInputError("--out must not be the input directory or a directory inside it");
  }

  const listed = await io.listTextFiles(inputDirectory);
  if (!Array.isArray(listed) || listed.length === 0) {
    throw new ProcPlantCliInputError("compile-dir found no genome JSON files");
  }
  const seenSources = new Set<string>();
  const sources = listed.map((entry, index) => {
    const record = assertRecord(entry, `compile-dir files[${index}]`);
    const path = assertString(record.path, `compile-dir files[${index}].path`);
    const relativePath = normalizeBatchRelativePath(
      record.relativePath,
      `compile-dir files[${index}].relativePath`,
    );
    const key = relativePath.toLowerCase();
    if (seenSources.has(key)) throw new ProcPlantCliInputError(`duplicate batch source path: ${relativePath}`);
    seenSources.add(key);
    return { path, relativePath };
  }).sort((left, right) => compareText(left.relativePath, right.relativePath));

  const seenOutputs = new Map<string, string>();
  const compiled = [] as Array<{
    source: string;
    output: string;
    contents: string;
    genome: ProcPlantGenome;
    compiled: ProcPlantCliCompileOutput;
  }>;
  for (const source of sources) {
    const genome = await readGenome(source.path, io);
    const output = outputSlug(genome.id);
    const outputKey = output.toLowerCase();
    const collision = seenOutputs.get(outputKey);
    if (collision) {
      throw new ProcPlantCliInputError(
        `batch output name collision: ${collision} and ${source.relativePath} both map to ${output}`,
      );
    }
    seenOutputs.set(outputKey, source.relativePath);
    const compiledOutput = compileGenome(genome, profile, seed, variantCount);
    compiled.push({
      source: source.relativePath,
      output,
      contents: serialize(compiledOutput),
      genome,
      compiled: compiledOutput,
    });
  }

  const manifest: ProcPlantCliCompileDirectoryManifest = {
    contract: PROCPLANT_CLI_CONTRACT,
    version: PROCPLANT_CLI_VERSION,
    generatorContractRevision: PROCPLANT_GENERATOR_CONTRACT_REVISION,
    command: "compile-dir",
    profile,
    seed,
    variants: variantCount,
    count: compiled.length,
    entries: compiled.map((entry) => ({
      source: entry.source,
      output: entry.output,
      genomeId: entry.genome.id,
      habit: entry.genome.habit,
      seed,
      ready: entry.compiled.readiness.ready,
      readinessScore: entry.compiled.readiness.score,
      warningCount: entry.compiled.readiness.warnings.length,
      contentHash: contentHash(entry.contents),
    })),
  };

  for (const entry of compiled) {
    await io.writeText(joinOutputPath(outputPath, entry.output), entry.contents);
  }
  const manifestPath = joinOutputPath(outputPath, "manifest.json");
  await io.writeText(manifestPath, serialize(manifest));
  io.stdout(`compiled ${compiled.length} genomes for ${profile} -> ${manifestPath}\n`);
};

const validatePath = async (path: string, io: ProcPlantCliIo) => {
  if (path.toLowerCase().endsWith(".glb")) {
    if (!io.readBinary) throw new Error("GLB validation is unavailable because this CLI adapter does not support binary reads");
    let report: Awaited<ReturnType<typeof validateProcPlantGlb>>;
    try {
      report = await validateProcPlantGlb(await io.readBinary(path));
    } catch (error) {
      throw new ProcPlantCliInputError(`${path}: invalid Procplants GLB (${error instanceof Error ? error.message : String(error)})`);
    }
    return { ...report, command: "validate" as const, assetType: "glb" as const };
  }
  if (!path.toLowerCase().endsWith(".json")) throw new ProcPlantCliInputError("validate input must end in .json or .glb");
  const genome = await readGenome(path, io);
  return {
    contract: PROCPLANT_CLI_CONTRACT,
    version: PROCPLANT_CLI_VERSION,
    command: "validate",
    assetType: "genome" as const,
    valid: true as const,
    genomeId: genome.id,
    habit: genome.habit,
  };
};

const validateCommand = async (args: readonly string[], io: ProcPlantCliIo) => {
  if (args.length === 0 || args.some((arg) => arg.startsWith("--"))) {
    throw new ProcPlantCliInputError("validate requires one or more <genome.json|asset.glb|pattern> inputs");
  }
  const expanded: string[] = [];
  for (const input of args) {
    if (/[*?]/.test(input)) {
      if (!io.expandPaths) throw new ProcPlantCliInputError("validation wildcards are unavailable in this CLI adapter");
      const matches = [...await io.expandPaths(input)].sort(compareText);
      if (matches.length === 0) throw new ProcPlantCliInputError(`${input}: validation wildcard matched no files`);
      expanded.push(...matches);
    } else {
      expanded.push(input);
    }
    if (expanded.length > 4096) throw new ProcPlantCliInputError("validate accepts at most 4096 expanded inputs");
  }
  const paths = [...new Set(expanded)].sort(compareText);
  const reports = [];
  for (const path of paths) reports.push({ path, report: await validatePath(path, io) });
  if (reports.length === 1 && args.length === 1 && !/[*?]/.test(args[0]!)) {
    io.stdout(serialize(reports[0]!.report));
    return;
  }
  io.stdout(serialize({
    contract: PROCPLANT_CLI_CONTRACT,
    version: PROCPLANT_CLI_VERSION,
    command: "validate",
    assetType: "batch",
    valid: true,
    count: reports.length,
    entries: reports.map(({ path, report }) => ({ path, ...report })),
  }));
};

const optionalFinite = (value: unknown, fallback: number, label: string) =>
  value === undefined ? fallback : assertFinite(value, label);

const optionalBoolean = (value: unknown, label: string): boolean | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new ProcPlantCliInputError(`${label} must be boolean`);
  return value;
};

const manifestMetadata = (value: unknown, label: string): ProcPlantCutoutMetadata | undefined => {
  if (value === undefined) return undefined;
  const metadata = assertRecord(value, label);
  const point = (entry: unknown, pointLabel: string) => {
    const record = assertRecord(entry, pointLabel);
    return { x: assertFinite(record.x, `${pointLabel}.x`), y: assertFinite(record.y, `${pointLabel}.y`) };
  };
  const bendAxis = assertRecord(metadata.bendAxis, `${label}.bendAxis`);
  const normalDirection = metadata.normalDirection === undefined
    ? undefined
    : assertRecord(metadata.normalDirection, `${label}.normalDirection`);
  return {
    pivot: point(metadata.pivot, `${label}.pivot`),
    attachment: point(metadata.attachment, `${label}.attachment`),
    bendAxis: {
      origin: point(bendAxis.origin, `${label}.bendAxis.origin`),
      direction: point(bendAxis.direction, `${label}.bendAxis.direction`),
    },
    ...(normalDirection ? { normalDirection: {
      x: assertFinite(normalDirection.x, `${label}.normalDirection.x`),
      y: assertFinite(normalDirection.y, `${label}.normalDirection.y`),
      z: assertFinite(normalDirection.z, `${label}.normalDirection.z`),
    } } : {}),
  };
};

const fallbackManifestReference = (manifestPath: string, referencedPath: string) => {
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/.test(referencedPath)) return referencedPath;
  const normalizedManifest = manifestPath.replaceAll("\\", "/");
  const separator = normalizedManifest.lastIndexOf("/");
  return separator < 0 ? referencedPath : `${normalizedManifest.slice(0, separator + 1)}${referencedPath}`;
};

const atlasMask = async (
  maskRecord: Record<string, unknown>,
  label: string,
  manifestPath: string,
  io: ProcPlantCliIo,
): Promise<ProcPlantAlphaMask> => {
  if (maskRecord.png !== undefined) {
    if (maskRecord.alpha !== undefined) throw new ProcPlantCliInputError(`${label} must not define both png and alpha`);
    const reference = assertString(maskRecord.png, `${label}.png`);
    if (reference.includes("\0")) throw new ProcPlantCliInputError(`${label}.png must not contain a null byte`);
    const luminanceAsAlpha = optionalBoolean(maskRecord.luminanceAsAlpha, `${label}.luminanceAsAlpha`) ?? false;
    if (!io.readBinary || !io.inflateZlib) {
      throw new Error("CLI adapter does not support PNG binary reads and zlib inflation");
    }
    const path = io.resolveRelativePath
      ? io.resolveRelativePath(manifestPath, reference)
      : fallbackManifestReference(manifestPath, reference);
    const bytes = await io.readBinary(path);
    let decoded: Awaited<ReturnType<typeof decodeProcPlantPngAlpha>>;
    try {
      decoded = await decodeProcPlantPngAlpha(bytes, io.inflateZlib, { luminanceAsAlpha });
    } catch (error) {
      throw new ProcPlantCliInputError(`${label}.png is invalid (${error instanceof Error ? error.message : String(error)})`);
    }
    for (const dimension of ["width", "height"] as const) {
      if (maskRecord[dimension] === undefined) continue;
      const expected = assertFinite(maskRecord[dimension], `${label}.${dimension}`);
      if (!Number.isInteger(expected) || expected <= 0) {
        throw new ProcPlantCliInputError(`${label}.${dimension} must be a positive integer`);
      }
      if (expected !== decoded[dimension]) {
        throw new ProcPlantCliInputError(`${label}.${dimension} does not match PNG (${expected} !== ${decoded[dimension]})`);
      }
    }
    return { width: decoded.width, height: decoded.height, alpha: decoded.alpha };
  }

  const width = assertFinite(maskRecord.width, `${label}.width`);
  const height = assertFinite(maskRecord.height, `${label}.height`);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new ProcPlantCliInputError(`${label} dimensions must be positive integers`);
  }
  if (!Array.isArray(maskRecord.alpha) && !ArrayBuffer.isView(maskRecord.alpha)) {
    throw new ProcPlantCliInputError(`${label}.alpha must be an array of bytes`);
  }
  const alphaValues = Array.from(maskRecord.alpha as ArrayLike<unknown>).map((alpha, alphaIndex) => {
    const byte = assertFinite(alpha, `${label}.alpha[${alphaIndex}]`);
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new ProcPlantCliInputError(`${label}.alpha[${alphaIndex}] must be a byte`);
    }
    return byte;
  });
  return { width, height, alpha: Uint8Array.from(alphaValues) };
};

const atlasCommand = async (args: readonly string[], io: ProcPlantCliIo) => {
  const manifestPath = args[0];
  if (!manifestPath || manifestPath.startsWith("--")) throw new ProcPlantCliInputError("atlas requires <manifest.json|png-directory>");
  const flags = parseFlags(args.slice(1));
  requireOnlyFlags(flags, ["--out", "--size"], ["--out"]);
  const outputPath = assertString(flags.get("--out"), "--out");
  const sizeFlag = flags.get("--size");
  const atlasSize = sizeFlag === undefined ? undefined : Number(sizeFlag);
  if (atlasSize !== undefined && (!Number.isInteger(atlasSize) || atlasSize < 16 || atlasSize > 16_384)) {
    throw new ProcPlantCliInputError("--size must be an integer in [16, 16384]");
  }
  let manifest: Record<string, unknown>;
  if (manifestPath.toLowerCase().endsWith(".json")) {
    manifest = assertRecord(parseJson(await io.readText(manifestPath), manifestPath), "atlas manifest");
  } else {
    if (!io.listBinaryFiles) throw new Error("directory atlas compilation is unavailable because this CLI adapter cannot list PNG files");
    const files = [...await io.listBinaryFiles(manifestPath)].sort((left, right) => compareText(left.relativePath, right.relativePath));
    if (files.length === 0) throw new ProcPlantCliInputError("atlas PNG directory contains no regular .png files");
    if (files.length > 4096) throw new ProcPlantCliInputError(`atlas PNG directory exceeds 4096 files (${files.length})`);
    const ids = new Set<string>();
    const cutouts = files.map((file, index) => {
      const normalizedRelativePath = assertString(file.relativePath, `atlas PNG files[${index}].relativePath`).replaceAll("\\", "/");
      const relativeParts = normalizedRelativePath.split("/");
      if (normalizedRelativePath.startsWith("/") || /^[A-Za-z]:/.test(normalizedRelativePath)
        || relativeParts.some((part) => !part || part === "." || part === "..")
        || !normalizedRelativePath.toLowerCase().endsWith(".png")) {
        throw new ProcPlantCliInputError(`atlas PNG directory returned an unsafe path: ${file.relativePath}`);
      }
      const id = normalizedRelativePath.slice(0, -4)
        .replace(/[^A-Za-z0-9._/-]+/g, "-").replaceAll("/", "-").replace(/^-+|-+$/g, "");
      if (!id) throw new ProcPlantCliInputError(`atlas PNG file ${file.relativePath} cannot form a stable cutout id`);
      if (ids.has(id)) throw new ProcPlantCliInputError(`atlas PNG paths collide on cutout id ${id}`);
      ids.add(id);
      return { id, mask: { png: file.path }, sourceIndex: index };
    });
    manifest = { cutouts, atlas: { powerOfTwo: true } };
  }
  if (!Array.isArray(manifest.cutouts) || manifest.cutouts.length === 0) {
    throw new ProcPlantCliInputError("atlas manifest.cutouts must be a non-empty array");
  }
  const cutouts: ReturnType<typeof createProcPlantCutout>[] = [];
  for (let index = 0; index < manifest.cutouts.length; index++) {
    const value = manifest.cutouts[index];
    const entry = assertRecord(value, `atlas manifest.cutouts[${index}]`);
    const maskRecord = entry.mask === undefined ? entry : assertRecord(entry.mask, `atlas manifest.cutouts[${index}].mask`);
    const trace: ProcPlantCutoutTraceOptions = {
      threshold: optionalFinite(entry.threshold, 0.5, `atlas manifest.cutouts[${index}].threshold`),
      simplifyTolerance: optionalFinite(entry.simplifyTolerance, 0.75, `atlas manifest.cutouts[${index}].simplifyTolerance`),
    };
    const mask = await atlasMask(maskRecord, `atlas manifest.cutouts[${index}].mask`, manifestPath, io);
    try {
      cutouts.push(createProcPlantCutout(
        assertString(entry.id, `atlas manifest.cutouts[${index}].id`),
        mask,
        manifestMetadata(entry.metadata, `atlas manifest.cutouts[${index}].metadata`),
        trace,
      ));
    } catch (error) {
      if (error instanceof ProcPlantCliInputError) throw error;
      throw new ProcPlantCliInputError(
        `atlas manifest.cutouts[${index}] is invalid (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
  const atlasOptions = isRecord(manifest.atlas) ? manifest.atlas : manifest;
  let atlas: ReturnType<typeof packProcPlantCutoutAtlas>;
  try {
    atlas = packProcPlantCutoutAtlas(cutouts, {
      padding: atlasOptions.padding === undefined ? undefined : optionalFinite(atlasOptions.padding, 2, "atlas manifest.padding"),
      width: atlasSize ?? (atlasOptions.width === undefined ? undefined : optionalFinite(atlasOptions.width, 0, "atlas manifest.width")),
      maxWidth: atlasSize ?? (atlasOptions.maxWidth === undefined ? undefined : optionalFinite(atlasOptions.maxWidth, 4096, "atlas manifest.maxWidth")),
      powerOfTwo: optionalBoolean(atlasOptions.powerOfTwo, "atlas manifest.powerOfTwo"),
    });
  } catch (error) {
    if (error instanceof ProcPlantCliInputError) throw error;
    throw new ProcPlantCliInputError(
      `atlas manifest packing options are invalid (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const sortedCutouts = [...cutouts].sort((a, b) => a.id.localeCompare(b.id));
  const output = {
    contract: PROCPLANT_CLI_CONTRACT,
    version: PROCPLANT_CLI_VERSION,
    generatorContractRevision: PROCPLANT_GENERATOR_CONTRACT_REVISION,
    command: "atlas" as const,
    atlas,
    cutouts: sortedCutouts.map((cutout) => ({
      id: cutout.id,
      width: cutout.width,
      height: cutout.height,
      threshold: cutout.threshold,
      contour: cutout.contour,
      contours: cutout.contours,
      metadata: cutout.metadata,
    })),
  };
  await io.writeText(outputPath, serialize(output));
  io.stdout(`packed ${cutouts.length} cutouts -> ${outputPath}\n`);
};

export const runProcPlantCli = async (argv: readonly string[], io: ProcPlantCliIo): Promise<number> => {
  try {
    const command = argv[0];
    if (!command || command === "--help" || command === "-h" || command === "help") {
      io.stdout(PROCPLANT_CLI_USAGE);
      return command ? PROCPLANT_CLI_EXIT.success : PROCPLANT_CLI_EXIT.usage;
    }
    if (command === "compile") await compileCommand(argv.slice(1), io);
    else if (command === "compile-dir") await compileDirectoryCommand(argv.slice(1), io);
    else if (command === "glb") await glbCommand(argv.slice(1), io);
    else if (command === "variant-glb") await variantGlbCommand(argv.slice(1), io);
    else if (command === "usda") await usdaCommand(argv.slice(1), io);
    else if (command === "validate") await validateCommand(argv.slice(1), io);
    else if (command === "atlas") await atlasCommand(argv.slice(1), io);
    else throw new ProcPlantCliInputError(`unknown command: ${command}`);
    return PROCPLANT_CLI_EXIT.success;
  } catch (error) {
    const inputError = error instanceof ProcPlantCliInputError;
    io.stderr(`procplants: ${error instanceof Error ? error.message : String(error)}\n`);
    if (inputError) io.stderr(PROCPLANT_CLI_USAGE);
    return inputError ? PROCPLANT_CLI_EXIT.usage : PROCPLANT_CLI_EXIT.failure;
  }
};
