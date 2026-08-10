import {
  exportProcPlantUsda,
  type ProcPlantUsdaExportOptions,
  type ProcPlantUsdSource,
} from "./procplant-usd-export";

export const PROCPLANT_USDZ_EXPORT_CONTRACT = "procplants.usdz-export" as const;
export const PROCPLANT_USDZ_EXPORT_VERSION = 1 as const;

export interface ProcPlantUsdzExportOptions extends ProcPlantUsdaExportOptions {
  /** Hard archive guard. Defaults to 384 MiB and cannot exceed 768 MiB. */
  maxPackageBytes?: number;
}

export interface ProcPlantUsdzEntry {
  path: string;
  bytes: number;
  compression: "store";
  crc32: string;
  dataOffset: number;
}

export interface ProcPlantUsdzExport {
  contract: typeof PROCPLANT_USDZ_EXPORT_CONTRACT;
  version: typeof PROCPLANT_USDZ_EXPORT_VERSION;
  fileName: string;
  bytes: Uint8Array;
  contentHash: string;
  defaultLayer: string;
  entries: ProcPlantUsdzEntry[];
  usda: ReturnType<typeof exportProcPlantUsda>;
}

interface ArchiveInput {
  path: string;
  bytes: Uint8Array;
}

const encoder = new TextEncoder();

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const fnv1a32 = (bytes: Uint8Array) => {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
};

const concat = (parts: readonly Uint8Array[], total: number) => {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
};

const header = (size: number, write: (view: DataView) => void) => {
  const bytes = new Uint8Array(size);
  write(new DataView(bytes.buffer));
  return bytes;
};

const assertPath = (path: string, index: number) => {
  if (!path || path.length > 255 || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new Error(`USDZ entry ${index} has an unsafe package path`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/.test(segment))) {
    throw new Error(`USDZ entry ${index} has an unsafe package path`);
  }
  if (encoder.encode(path).byteLength !== path.length) throw new Error(`USDZ entry ${index} path must be portable ASCII`);
};

const buildArchive = (inputs: readonly ArchiveInput[], maxPackageBytes: number) => {
  if (inputs.length < 1 || inputs.length > 65) throw new Error("USDZ requires 1 to 65 bounded entries");
  if (!inputs[0]!.path.endsWith(".usda")) throw new Error("USDZ first entry must be the native USDA default layer");
  const names = new Set<string>();
  let estimated = 22;
  for (const [index, input] of inputs.entries()) {
    assertPath(input.path, index);
    if (names.has(input.path)) throw new Error(`USDZ contains duplicate entry path ${input.path}`);
    names.add(input.path);
    if (!(input.path.endsWith(".usda") || input.path.endsWith(".png"))) throw new Error(`USDZ entry type is unsupported: ${input.path}`);
    if (!(input.bytes instanceof Uint8Array)) throw new Error(`USDZ entry ${input.path} must contain bytes`);
    estimated += 30 + input.path.length + 67 + input.bytes.byteLength + 46 + input.path.length;
  }
  if (!Number.isSafeInteger(estimated) || estimated > maxPackageBytes) {
    throw new Error(`USDZ estimated package exceeds maxPackageBytes (${estimated} > ${maxPackageBytes})`);
  }

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const manifest: ProcPlantUsdzEntry[] = [];
  let localOffset = 0;
  for (const input of inputs) {
    const name = encoder.encode(input.path);
    const checksum = crc32(input.bytes);
    let extraLength = (64 - ((localOffset + 30 + name.byteLength) % 64)) % 64;
    if (extraLength > 0 && extraLength < 4) extraLength += 64;
    const extra = new Uint8Array(extraLength);
    if (extraLength > 0) {
      const view = new DataView(extra.buffer);
      view.setUint16(0, 0x1986, true);
      view.setUint16(2, extraLength - 4, true);
    }
    const local = header(30, (view) => {
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, 33, true); // 1980-01-01, deterministic DOS epoch.
      view.setUint32(14, checksum, true);
      view.setUint32(18, input.bytes.byteLength, true);
      view.setUint32(22, input.bytes.byteLength, true);
      view.setUint16(26, name.byteLength, true);
      view.setUint16(28, extra.byteLength, true);
    });
    const dataOffset = localOffset + local.byteLength + name.byteLength + extra.byteLength;
    if (dataOffset % 64 !== 0) throw new Error(`internal USDZ alignment failure for ${input.path}`);
    localParts.push(local, name, extra, input.bytes);
    manifest.push({ path: input.path, bytes: input.bytes.byteLength, compression: "store", crc32: checksum.toString(16).padStart(8, "0"), dataOffset });

    const central = header(46, (view) => {
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, 0, true);
      view.setUint16(14, 33, true);
      view.setUint32(16, checksum, true);
      view.setUint32(20, input.bytes.byteLength, true);
      view.setUint32(24, input.bytes.byteLength, true);
      view.setUint16(28, name.byteLength, true);
      view.setUint16(30, 0, true);
      view.setUint16(32, 0, true);
      view.setUint16(34, 0, true);
      view.setUint16(36, 0, true);
      view.setUint32(38, 0, true);
      view.setUint32(42, localOffset, true);
    });
    centralParts.push(central, name);
    localOffset = dataOffset + input.bytes.byteLength;
  }
  const centralOffset = localOffset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const end = header(22, (view) => {
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, inputs.length, true);
    view.setUint16(10, inputs.length, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, centralOffset, true);
    view.setUint16(20, 0, true);
  });
  const total = centralOffset + centralSize + end.byteLength;
  if (total > maxPackageBytes) throw new Error(`USDZ package exceeds maxPackageBytes (${total} > ${maxPackageBytes})`);
  return { bytes: concat([...localParts, ...centralParts, end], total), entries: manifest };
};

/**
 * Package deterministic USDA plus its copied PNG dependencies into a stored,
 * unencrypted, 64-byte-aligned USDZ archive. This intentionally emits USDA,
 * never mislabeled binary USDC.
 */
export const exportProcPlantUsdz = (
  source: ProcPlantUsdSource,
  options: ProcPlantUsdzExportOptions = {},
): ProcPlantUsdzExport => {
  const maxPackageBytes = options.maxPackageBytes ?? 384 * 1024 * 1024;
  if (!Number.isInteger(maxPackageBytes) || maxPackageBytes < 1024 || maxPackageBytes > 768 * 1024 * 1024) {
    throw new Error("maxPackageBytes must be an integer in [1024, 805306368]");
  }
  const { maxPackageBytes: _packageLimit, ...usdaOptions } = options;
  const usda = exportProcPlantUsda(source, usdaOptions);
  const inputs: ArchiveInput[] = [
    { path: usda.fileName, bytes: encoder.encode(usda.text) },
    ...usda.assets.map((asset) => ({ path: asset.path, bytes: asset.bytes })),
  ];
  const archive = buildArchive(inputs, maxPackageBytes);
  return {
    contract: PROCPLANT_USDZ_EXPORT_CONTRACT,
    version: PROCPLANT_USDZ_EXPORT_VERSION,
    fileName: usda.fileName.replace(/\.usda$/, ".usdz"),
    bytes: archive.bytes,
    contentHash: fnv1a32(archive.bytes),
    defaultLayer: usda.fileName,
    entries: archive.entries,
    usda,
  };
};
