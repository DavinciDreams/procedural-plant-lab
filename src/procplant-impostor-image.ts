import type {
  ProcPlantImpostorChannelLayer,
  ProcPlantImpostorChannelSet,
} from "./procplant-impostor-channels";

export const PROCPLANT_IMPOSTOR_IMAGE_CONTRACT = "procplants.impostor-image" as const;
export const PROCPLANT_IMPOSTOR_IMAGE_VERSION = 1 as const;

export interface ProcPlantImpostorEncodedImage {
  contract: typeof PROCPLANT_IMPOSTOR_IMAGE_CONTRACT;
  version: typeof PROCPLANT_IMPOSTOR_IMAGE_VERSION;
  layerId: string;
  layerIndex: number;
  seasonId: string;
  channelId: ProcPlantImpostorChannelLayer["channelId"];
  width: number;
  height: number;
  mimeType: "image/png";
  contentHash: string;
  bytes: Uint8Array;
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const textEncoder = new TextEncoder();

const concatenate = (parts: readonly Uint8Array[]) => {
  const byteLength = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
};

const uint32be = (value: number) => new Uint8Array([
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
]);

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const adler32 = (bytes: Uint8Array) => {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
};

const fnv1a32 = (bytes: Uint8Array) => {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32-${hash.toString(16).padStart(8, "0")}`;
};

const pngChunk = (type: string, data = new Uint8Array()) => {
  const typeBytes = textEncoder.encode(type);
  if (typeBytes.byteLength !== 4) throw new Error("PNG chunk type must contain four ASCII bytes");
  return concatenate([uint32be(data.byteLength), typeBytes, data, uint32be(crc32(concatenate([typeBytes, data])))]);
};

const storedZlib = (bytes: Uint8Array) => {
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  let offset = 0;
  do {
    const length = Math.min(0xffff, bytes.byteLength - offset);
    const final = offset + length >= bytes.byteLength;
    blocks.push(new Uint8Array([
      final ? 1 : 0,
      length & 0xff,
      (length >>> 8) & 0xff,
      (~length) & 0xff,
      ((~length) >>> 8) & 0xff,
    ]));
    blocks.push(bytes.subarray(offset, offset + length));
    offset += length;
  } while (offset < bytes.byteLength);
  blocks.push(uint32be(adler32(bytes)));
  return concatenate(blocks);
};

/** Deterministic RGBA8 PNG: filter-none scanlines and stored DEFLATE blocks. */
export const encodeProcPlantImpostorPng = (
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
) => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("impostor PNG dimensions must be positive integers");
  }
  const expected = width * height * 4;
  if (!Number.isSafeInteger(expected) || rgba.byteLength !== expected) {
    throw new Error("impostor PNG requires exactly width * height * 4 RGBA8 bytes");
  }
  const scanlines = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const target = y * (width * 4 + 1);
    scanlines[target] = 0;
    scanlines.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), target + 1);
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(uint32be(width), 0);
  ihdr.set(uint32be(height), 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return concatenate([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", storedZlib(scanlines)),
    pngChunk("IEND"),
  ]);
};

export const encodeProcPlantImpostorChannelImages = (
  channelSet: ProcPlantImpostorChannelSet,
): ProcPlantImpostorEncodedImage[] => channelSet.layers.map((layer) => {
  const bytes = encodeProcPlantImpostorPng(layer.atlas.rgba, layer.atlas.width, layer.atlas.height);
  return {
    contract: PROCPLANT_IMPOSTOR_IMAGE_CONTRACT,
    version: PROCPLANT_IMPOSTOR_IMAGE_VERSION,
    layerId: layer.id,
    layerIndex: layer.layerIndex,
    seasonId: layer.seasonId,
    channelId: layer.channelId,
    width: layer.atlas.width,
    height: layer.atlas.height,
    mimeType: "image/png",
    contentHash: fnv1a32(bytes),
    bytes,
  };
});

const pad4 = (length: number) => (length + 3) & ~3;

/**
 * Export aligned seasonal channel images as a deterministic, valid GLB 2.0.
 * Images are embedded as ordered PNG bufferViews; the aligned view-array and
 * channel contract live in scene extras for consumers to bind to geometry.
 */
export const exportProcPlantImpostorChannelSetGlb = (
  channelSet: ProcPlantImpostorChannelSet,
  name = "procplant-impostor-channels",
): ArrayBuffer => {
  if (!name || name.length > 128) throw new Error("impostor channel GLB name must contain 1-128 characters");
  const images = encodeProcPlantImpostorChannelImages(channelSet);
  let binaryLength = 0;
  const bufferViews = images.map((image, index) => {
    const byteOffset = binaryLength;
    binaryLength += pad4(image.bytes.byteLength);
    return {
      name: `${image.layerId}-png`,
      buffer: 0,
      byteOffset,
      byteLength: image.bytes.byteLength,
      extras: { layerIndex: index, contentHash: image.contentHash },
    };
  });
  const binary = new Uint8Array(binaryLength);
  for (let index = 0; index < images.length; index++) binary.set(images[index]!.bytes, bufferViews[index]!.byteOffset);
  const json = {
    asset: { version: "2.0", generator: "procplants deterministic impostor channel exporter v1" },
    scene: 0,
    scenes: [{
      name,
      nodes: [],
      extras: {
        procplantImpostorChannels: {
          contract: channelSet.contract,
          version: channelSet.version,
          contentHash: channelSet.contentHash,
          seasons: channelSet.seasons,
          channels: channelSet.channels,
          viewArray: channelSet.viewArray,
          layers: channelSet.layers.map((layer, index) => ({
            id: layer.id,
            layerIndex: layer.layerIndex,
            seasonId: layer.seasonId,
            channelId: layer.channelId,
            atlasContentHash: layer.contentHash,
            legacyAtlasHash: layer.legacyAtlasHash,
            image: index,
          })),
        },
      },
    }],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews,
    images: images.map((image, index) => ({
      name: image.layerId,
      bufferView: index,
      mimeType: image.mimeType,
      extras: {
        contract: image.contract,
        version: image.version,
        layerIndex: image.layerIndex,
        seasonId: image.seasonId,
        channelId: image.channelId,
        width: image.width,
        height: image.height,
        contentHash: image.contentHash,
      },
    })),
  };
  const jsonBytes = textEncoder.encode(JSON.stringify(json));
  const paddedJsonLength = pad4(jsonBytes.byteLength);
  const totalLength = 12 + 8 + paddedJsonLength + 8 + binary.byteLength;
  const glb = new ArrayBuffer(totalLength);
  const view = new DataView(glb);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  const output = new Uint8Array(glb);
  output.fill(0x20, 20, 20 + paddedJsonLength);
  output.set(jsonBytes, 20);
  const binaryHeader = 20 + paddedJsonLength;
  view.setUint32(binaryHeader, binary.byteLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  output.set(binary, binaryHeader + 8);
  return glb;
};
