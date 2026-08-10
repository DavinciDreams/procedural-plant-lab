import {
  PROCPLANT_MATERIAL_BAKE_CONTRACT,
  PROCPLANT_MATERIAL_BAKE_VERSION,
  type ProcPlantBakedImageUsage,
  type ProcPlantBakedMaterialBundle,
} from "./procplant-material-bake";

export const PROCPLANT_MATERIAL_KTX2_CONTRACT = "procplants.material-ktx2" as const;
export const PROCPLANT_MATERIAL_KTX2_VERSION = 1 as const;

export type ProcPlantMaterialKtx2Codec = "etc1s" | "uastc";
export type ProcPlantMaterialAlphaMode = "opaque" | "binary" | "translucent";

export interface ProcPlantMaterialKtx2Policy {
  codec: ProcPlantMaterialKtx2Codec;
  colorSpace: "srgb" | "linear";
  alphaMode: ProcPlantMaterialAlphaMode;
  mipmaps: true;
  uastcZstd: boolean;
  uastcRdo: false;
  normalMapPreset: boolean;
  etc1sQuality: 192;
  etc1sCompressionLevel: 2;
  uastcQuality: 2;
}

export interface ProcPlantMaterialKtx2EncodeRequest {
  rgba: Uint8Array;
  width: number;
  height: number;
  usage: ProcPlantBakedImageUsage;
  policy: ProcPlantMaterialKtx2Policy;
  maxOutputBytes: number;
}

export interface ProcPlantMaterialKtx2Encoder {
  readonly id: string;
  readonly version: string;
  encode(request: ProcPlantMaterialKtx2EncodeRequest): Promise<Uint8Array>;
}

export interface ProcPlantMaterialKtx2Options {
  maxImages?: number;
  maxWidth?: number;
  maxHeight?: number;
  maxPixelsPerImage?: number;
  maxTotalPixels?: number;
  maxSourceBytes?: number;
  maxOutputBytesPerImage?: number;
  maxTotalOutputBytes?: number;
}

export interface ProcPlantMaterialKtx2Image {
  name: string;
  usage: ProcPlantBakedImageUsage;
  width: number;
  height: number;
  contentHash: string;
  policy: ProcPlantMaterialKtx2Policy;
  mipLevels: number;
  bytes: Uint8Array;
}

export interface ProcPlantMaterialKtx2Bundle {
  contract: typeof PROCPLANT_MATERIAL_KTX2_CONTRACT;
  version: typeof PROCPLANT_MATERIAL_KTX2_VERSION;
  sourceBakeContentHash: string;
  encoder: { id: string; version: string };
  /** Stable for the exact pinned WASM/options/input; native/platform Basis encoders are not promised byte-identical. */
  determinismExpectation: "byte-stable-with-pinned-wasm-and-options";
  images: ProcPlantMaterialKtx2Image[];
  contentHash: string;
}

const KTX2_IDENTIFIER = Uint8Array.of(0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a);
const integer = (value: number, min: number, max: number, label: string) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer in [${min}, ${max}]`);
  return value;
};
const hashBytes = (bytes: Uint8Array) => {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
};

export const classifyProcPlantMaterialAlpha = (rgba: Uint8Array): ProcPlantMaterialAlphaMode => {
  let hasZero = false;
  for (let offset = 3; offset < rgba.byteLength; offset += 4) {
    const alpha = rgba[offset]!;
    if (alpha > 0 && alpha < 255) return "translucent";
    if (alpha === 0) hasZero = true;
  }
  return hasZero ? "binary" : "opaque";
};

/** Color maps use compact ETC1S unless alpha fidelity is required; data maps always use UASTC. */
export const selectProcPlantMaterialKtx2Policy = (
  usage: ProcPlantBakedImageUsage,
  colorSpace: "srgb" | "linear",
  alphaMode: ProcPlantMaterialAlphaMode,
): ProcPlantMaterialKtx2Policy => {
  const color = usage === "baseColor" || usage === "emissive";
  const codec: ProcPlantMaterialKtx2Codec = color && alphaMode === "opaque" ? "etc1s" : "uastc";
  const expectedColorSpace = color ? "srgb" : "linear";
  if (colorSpace !== expectedColorSpace) throw new Error(`${usage} requires ${expectedColorSpace} KTX2 color space`);
  return {
    codec,
    colorSpace,
    alphaMode,
    mipmaps: true,
    uastcZstd: codec === "uastc",
    uastcRdo: false,
    normalMapPreset: usage === "normal",
    etc1sQuality: 192,
    etc1sCompressionLevel: 2,
    uastcQuality: 2,
  };
};

const mipLevelCount = (width: number, height: number) => Math.floor(Math.log2(Math.max(width, height))) + 1;

const validateKtx2 = (
  bytes: Uint8Array,
  width: number,
  height: number,
  policy: ProcPlantMaterialKtx2Policy,
) => {
  if (bytes.byteLength < 80 || KTX2_IDENTIFIER.some((byte, index) => bytes[index] !== byte)) {
    throw new Error("material KTX2 encoder returned an invalid KTX2 identifier/header");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const expectedLevels = mipLevelCount(width, height);
  const supercompression = view.getUint32(44, true);
  if (view.getUint32(12, true) !== 0 || view.getUint32(16, true) !== 1 || view.getUint32(20, true) !== width ||
    view.getUint32(24, true) !== height || view.getUint32(28, true) !== 0 || view.getUint32(32, true) !== 0 ||
    view.getUint32(36, true) !== 1 || view.getUint32(40, true) !== expectedLevels) {
    throw new Error("material KTX2 encoder returned incompatible dimensions, faces, or mip levels");
  }
  if (supercompression !== (policy.codec === "etc1s" ? 1 : 2)) {
    throw new Error(`material KTX2 encoder returned incompatible ${policy.codec} supercompression`);
  }
  const dfdOffset = view.getUint32(48, true);
  const dfdLength = view.getUint32(52, true);
  if (dfdOffset < 80 || dfdLength < 16 || dfdOffset + dfdLength > bytes.byteLength) throw new Error("material KTX2 has an invalid data format descriptor");
  const primaries = bytes[dfdOffset + 13];
  const transfer = bytes[dfdOffset + 14];
  const flags = bytes[dfdOffset + 15];
  const expectedTransfer = policy.colorSpace === "srgb" ? 2 : 1;
  const compatiblePrimaries = primaries === 1 || (policy.colorSpace === "linear" && primaries === 0);
  if (!compatiblePrimaries || transfer !== expectedTransfer || (flags! & 1) !== 0) {
    throw new Error(`material KTX2 encoder returned incompatible ${policy.colorSpace} color metadata or premultiplied alpha (primaries=${primaries}, transfer=${transfer}, flags=${flags})`);
  }
  return expectedLevels;
};

export const validateProcPlantMaterialKtx2Bundle = (
  baked: ProcPlantBakedMaterialBundle,
  bundle: ProcPlantMaterialKtx2Bundle,
) => {
  if (bundle.contract !== PROCPLANT_MATERIAL_KTX2_CONTRACT || bundle.version !== PROCPLANT_MATERIAL_KTX2_VERSION ||
    bundle.sourceBakeContentHash !== baked.contentHash || bundle.determinismExpectation !== "byte-stable-with-pinned-wasm-and-options" ||
    !bundle.encoder?.id || !bundle.encoder.version || bundle.images.length !== baked.images.length) {
    throw new Error("material KTX2 bundle does not match the material bake or supported contract");
  }
  for (let index = 0; index < baked.images.length; index++) {
    const source = baked.images[index]!;
    const encoded = bundle.images[index]!;
    const expectedPolicy = selectProcPlantMaterialKtx2Policy(source.usage, source.colorSpace, classifyProcPlantMaterialAlpha(source.rgba));
    if (encoded.name !== source.name || encoded.usage !== source.usage || encoded.width !== source.width || encoded.height !== source.height ||
      !(encoded.bytes instanceof Uint8Array) || encoded.bytes.byteLength === 0 || encoded.contentHash !== hashBytes(encoded.bytes) ||
      JSON.stringify(encoded.policy) !== JSON.stringify(expectedPolicy) || encoded.mipLevels !== validateKtx2(encoded.bytes, source.width, source.height, expectedPolicy)) {
      throw new Error(`material KTX2 image ${index} does not match its bake metadata, policy, or bytes`);
    }
  }
  const identity = new TextEncoder().encode(`${baked.contentHash}\n${bundle.encoder.id}\n${bundle.encoder.version}\n${bundle.images.map((image) => image.contentHash).join("\n")}`);
  if (bundle.contentHash !== hashBytes(identity)) throw new Error("material KTX2 bundle contentHash does not match its encoded images");
};

export const encodeProcPlantBakedMaterialsKtx2 = async (
  baked: ProcPlantBakedMaterialBundle,
  encoder: ProcPlantMaterialKtx2Encoder,
  options: ProcPlantMaterialKtx2Options = {},
): Promise<ProcPlantMaterialKtx2Bundle> => {
  if (baked.contract !== PROCPLANT_MATERIAL_BAKE_CONTRACT || baked.version !== PROCPLANT_MATERIAL_BAKE_VERSION || !baked.ready) {
    throw new Error("KTX2 encoding requires a ready supported material bake");
  }
  if (!encoder?.id || !encoder.version || typeof encoder.encode !== "function") throw new Error("KTX2 encoding requires an identified encoder implementation");
  const maxImages = integer(options.maxImages ?? 128, 1, 1024, "maxImages");
  const maxWidth = integer(options.maxWidth ?? 4096, 4, 8192, "maxWidth");
  const maxHeight = integer(options.maxHeight ?? 4096, 4, 8192, "maxHeight");
  const maxPixelsPerImage = integer(options.maxPixelsPerImage ?? 12_582_912, 16, 67_108_864, "maxPixelsPerImage");
  const maxTotalPixels = integer(options.maxTotalPixels ?? 50_331_648, 16, 268_435_456, "maxTotalPixels");
  const maxSourceBytes = integer(options.maxSourceBytes ?? 192 * 1024 * 1024, 64, 1024 * 1024 * 1024, "maxSourceBytes");
  const maxOutputBytesPerImage = integer(options.maxOutputBytesPerImage ?? 64 * 1024 * 1024, 64, 512 * 1024 * 1024, "maxOutputBytesPerImage");
  const maxTotalOutputBytes = integer(options.maxTotalOutputBytes ?? 256 * 1024 * 1024, 64, 1024 * 1024 * 1024, "maxTotalOutputBytes");
  if (baked.images.length === 0 || baked.images.length > maxImages) throw new Error(`material KTX2 image count exceeds maxImages (${baked.images.length} > ${maxImages})`);
  let totalPixels = 0;
  let sourceBytes = 0;
  let outputBytes = 0;
  const images: ProcPlantMaterialKtx2Image[] = [];
  for (const image of baked.images) {
    integer(image.width, 4, maxWidth, `${image.name}.width`);
    integer(image.height, 4, maxHeight, `${image.name}.height`);
    if (image.width % 4 !== 0 || image.height % 4 !== 0) throw new Error(`${image.name} dimensions must be multiples of 4 for KTX2 encoding`);
    const pixels = image.width * image.height;
    if (!Number.isSafeInteger(pixels) || pixels > maxPixelsPerImage) throw new Error(`${image.name} exceeds maxPixelsPerImage`);
    if (image.rgba.byteLength !== pixels * 4) throw new Error(`${image.name}.rgba must contain exactly width * height * 4 bytes`);
    totalPixels += pixels;
    sourceBytes += image.rgba.byteLength;
    if (!Number.isSafeInteger(totalPixels) || totalPixels > maxTotalPixels) throw new Error("material KTX2 input exceeds maxTotalPixels");
    if (!Number.isSafeInteger(sourceBytes) || sourceBytes > maxSourceBytes) throw new Error("material KTX2 input exceeds maxSourceBytes");
    const policy = selectProcPlantMaterialKtx2Policy(image.usage, image.colorSpace, classifyProcPlantMaterialAlpha(image.rgba));
    const encoded = await encoder.encode({
      rgba: image.rgba.slice(), width: image.width, height: image.height, usage: image.usage, policy, maxOutputBytes: maxOutputBytesPerImage,
    });
    if (!(encoded instanceof Uint8Array) || encoded.byteLength === 0 || encoded.byteLength > maxOutputBytesPerImage) {
      throw new Error(`${image.name} KTX2 output exceeds maxOutputBytesPerImage or is invalid`);
    }
    outputBytes += encoded.byteLength;
    if (!Number.isSafeInteger(outputBytes) || outputBytes > maxTotalOutputBytes) throw new Error("material KTX2 output exceeds maxTotalOutputBytes");
    const bytes = encoded.slice();
    images.push({ name: image.name, usage: image.usage, width: image.width, height: image.height, contentHash: hashBytes(bytes), policy, mipLevels: validateKtx2(bytes, image.width, image.height, policy), bytes });
  }
  const identity = new TextEncoder().encode(`${baked.contentHash}\n${encoder.id}\n${encoder.version}\n${images.map((image) => image.contentHash).join("\n")}`);
  const bundle: ProcPlantMaterialKtx2Bundle = {
    contract: PROCPLANT_MATERIAL_KTX2_CONTRACT,
    version: PROCPLANT_MATERIAL_KTX2_VERSION,
    sourceBakeContentHash: baked.contentHash,
    encoder: { id: encoder.id, version: encoder.version },
    determinismExpectation: "byte-stable-with-pinned-wasm-and-options",
    images,
    contentHash: hashBytes(identity),
  };
  validateProcPlantMaterialKtx2Bundle(baked, bundle);
  return bundle;
};
