export const PROCPLANT_PNG_ALPHA_CONTRACT = "procplants.png-alpha" as const;
export const PROCPLANT_PNG_ALPHA_VERSION = 1 as const;

export interface ProcPlantPngDecodeLimits {
  maxEncodedBytes?: number;
  maxCompressedBytes?: number;
  maxWidth?: number;
  maxHeight?: number;
  maxPixels?: number;
  maxInflatedBytes?: number;
}

export interface ProcPlantPngAlphaOptions extends ProcPlantPngDecodeLimits {
  /** Uses grayscale/luma as alpha only where the pixel/palette entry has no explicit alpha. */
  luminanceAsAlpha?: boolean;
}

export interface ProcPlantPngAlphaImage {
  contract: typeof PROCPLANT_PNG_ALPHA_CONTRACT;
  version: typeof PROCPLANT_PNG_ALPHA_VERSION;
  width: number;
  height: number;
  colorType: 0 | 2 | 3 | 4 | 6;
  hasExplicitAlpha: boolean;
  alpha: Uint8Array;
}

export type ProcPlantInflateZlib = (
  compressed: Uint8Array,
  /** The exact expected output length and a hard upper bound. */
  maximumOutputBytes: number,
) => Promise<Uint8Array>;

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const MAX_SAFE_ARRAY_LENGTH = 0x7fffffff;

const boundedInteger = (value: number, label: string, minimum: number, maximum: number) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
};

const readUint32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset]! * 0x1000000) + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!) >>> 0;

const chunkName = (bytes: Uint8Array, offset: number) =>
  String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let entry = 0; entry < 256; entry++) {
    let value = entry;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[entry] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array, start: number, end: number) => {
  let value = 0xffffffff;
  for (let offset = start; offset < end; offset++) value = crcTable[(value ^ bytes[offset]!) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const adler32 = (bytes: Uint8Array) => {
  let first = 1;
  let second = 0;
  for (let offset = 0; offset < bytes.length; offset++) {
    first = (first + bytes[offset]!) % 65521;
    second = (second + first) % 65521;
  }
  return ((second << 16) | first) >>> 0;
};

const paeth = (left: number, up: number, upperLeft: number) => {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= upDistance && leftDistance <= upperLeftDistance
    ? left
    : upDistance <= upperLeftDistance ? up : upperLeft;
};

/**
 * Strictly decodes alpha from a bounded non-interlaced or Adam7 PNG. Grayscale supports
 * 1/2/4/8/16-bit samples, indexed color supports 1/2/4/8-bit samples, and the
 * remaining direct-color formats support 8/16-bit channels. The caller supplies
 * zlib inflation so this module remains runtime independent.
 */
export const decodeProcPlantPngAlpha = async (
  source: ArrayLike<number>,
  inflateZlib: ProcPlantInflateZlib,
  options: ProcPlantPngAlphaOptions = {},
): Promise<ProcPlantPngAlphaImage> => {
  const maxEncodedBytes = boundedInteger(options.maxEncodedBytes ?? 32 * 1024 * 1024, "maxEncodedBytes", 45, MAX_SAFE_ARRAY_LENGTH);
  const maxCompressedBytes = boundedInteger(options.maxCompressedBytes ?? 24 * 1024 * 1024, "maxCompressedBytes", 1, MAX_SAFE_ARRAY_LENGTH);
  const maxWidth = boundedInteger(options.maxWidth ?? 8192, "maxWidth", 1, 1_000_000);
  const maxHeight = boundedInteger(options.maxHeight ?? 8192, "maxHeight", 1, 1_000_000);
  const maxPixels = boundedInteger(options.maxPixels ?? 16_777_216, "maxPixels", 1, MAX_SAFE_ARRAY_LENGTH);
  const maxInflatedBytes = boundedInteger(options.maxInflatedBytes ?? 64 * 1024 * 1024, "maxInflatedBytes", 1, MAX_SAFE_ARRAY_LENGTH);
  if (options.luminanceAsAlpha !== undefined && typeof options.luminanceAsAlpha !== "boolean") {
    throw new Error("luminanceAsAlpha must be boolean");
  }
  if (source.length > maxEncodedBytes) throw new Error(`PNG exceeds maxEncodedBytes (${source.length} > ${maxEncodedBytes})`);
  if (!Number.isSafeInteger(source.length) || source.length < 0) throw new Error("PNG source length is invalid");
  let bytes: Uint8Array;
  if (source instanceof Uint8Array) bytes = source;
  else {
    bytes = new Uint8Array(source.length);
    for (let index = 0; index < source.length; index++) {
      const byte = source[index];
      if (!Number.isInteger(byte) || byte! < 0 || byte! > 255) throw new Error(`PNG source byte ${index} is invalid`);
      bytes[index] = byte!;
    }
  }
  if (bytes.length < 45) throw new Error("PNG is truncated");
  for (let index = 0; index < PNG_SIGNATURE.length; index++) {
    if (bytes[index] !== PNG_SIGNATURE[index]) throw new Error("invalid PNG signature");
  }

  let offset: number = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let colorType: 0 | 2 | 3 | 4 | 6 | null = null;
  let bitDepth = 0;
  let filterBytesPerPixel = 0;
  let interlaceMethod: 0 | 1 = 0;
  let sawHeader = false;
  let sawImageData = false;
  let imageDataEnded = false;
  let sawEnd = false;
  let sawPalette = false;
  let sawTransparency = false;
  let palette: Uint8Array | null = null;
  let paletteAlpha: Uint8Array | null = null;
  let transparentGrayscale: number | null = null;
  let transparentRgb: readonly [number, number, number] | null = null;
  let compressedLength = 0;
  const compressedParts: Uint8Array[] = [];

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("PNG chunk header is truncated");
    const length = readUint32(bytes, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    const chunkEnd = dataEnd + 4;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.length) throw new Error("PNG chunk payload is truncated");
    const type = chunkName(bytes, typeOffset);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error("PNG chunk type contains invalid bytes");
    if ((bytes[typeOffset + 2]! & 0x20) !== 0) throw new Error(`${type} chunk has an invalid reserved bit`);
    const expectedCrc = readUint32(bytes, dataEnd);
    const actualCrc = crc32(bytes, typeOffset, dataEnd);
    if (expectedCrc !== actualCrc) throw new Error(`${type} chunk CRC mismatch`);
    if (!sawHeader && type !== "IHDR") throw new Error("IHDR must be the first PNG chunk");
    if (sawEnd) throw new Error("PNG contains chunks after IEND");

    if (type === "IHDR") {
      if (sawHeader) throw new Error("PNG contains multiple IHDR chunks");
      if (length !== 13) throw new Error("IHDR must contain 13 bytes");
      width = readUint32(bytes, dataOffset);
      height = readUint32(bytes, dataOffset + 4);
      if (width === 0 || height === 0) throw new Error("PNG dimensions must be positive");
      if (width > maxWidth || height > maxHeight) throw new Error(`PNG dimensions exceed limits (${width}x${height})`);
      if (width * height > maxPixels) throw new Error(`PNG exceeds maxPixels (${width * height} > ${maxPixels})`);
      const depth = bytes[dataOffset + 8]!;
      const sourceColorType = bytes[dataOffset + 9]!;
      const compression = bytes[dataOffset + 10]!;
      const filter = bytes[dataOffset + 11]!;
      const interlace = bytes[dataOffset + 12]!;
      if (sourceColorType !== 0 && sourceColorType !== 2 && sourceColorType !== 3 && sourceColorType !== 4 && sourceColorType !== 6) {
        throw new Error(`unsupported PNG color type ${sourceColorType}; expected grayscale, RGB, indexed, grayscale-alpha, or RGBA`);
      }
      const validDepth = sourceColorType === 0
        ? [1, 2, 4, 8, 16].includes(depth)
        : sourceColorType === 3
          ? [1, 2, 4, 8].includes(depth)
          : [8, 16].includes(depth);
      if (!validDepth) {
        throw new Error(`unsupported PNG bit depth ${depth} for color type ${sourceColorType}`);
      }
      if (compression !== 0) throw new Error(`unsupported PNG compression method ${compression}`);
      if (filter !== 0) throw new Error(`unsupported PNG filter method ${filter}`);
      if (interlace !== 0 && interlace !== 1) throw new Error(`unsupported PNG interlace method ${interlace}`);
      colorType = sourceColorType;
      bitDepth = depth;
      interlaceMethod = interlace;
      const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 1;
      filterBytesPerPixel = Math.max(1, Math.ceil(channels * bitDepth / 8));
      sawHeader = true;
    } else if (type === "PLTE") {
      if (sawImageData) throw new Error("PLTE must precede IDAT");
      if (sawPalette) throw new Error("PNG contains multiple PLTE chunks");
      if (sawTransparency) throw new Error("PLTE must precede tRNS");
      if (length === 0 || length % 3 !== 0 || length > 768) throw new Error("PLTE has an invalid length");
      if (colorType === 0 || colorType === 4) throw new Error("PLTE is not permitted for grayscale PNGs");
      if (colorType === 3 && length / 3 > 2 ** bitDepth) {
        throw new Error(`PLTE has too many entries for indexed bit depth ${bitDepth}`);
      }
      palette = bytes.slice(dataOffset, dataEnd);
      sawPalette = true;
    } else if (type === "tRNS") {
      if (sawImageData) throw new Error("tRNS must precede IDAT");
      if (sawTransparency) throw new Error("PNG contains multiple tRNS chunks");
      if (colorType === 3) {
        if (!sawPalette || !palette) throw new Error("indexed PNG tRNS must follow PLTE");
        const paletteEntries = palette.length / 3;
        if (length === 0 || length > paletteEntries) throw new Error("indexed PNG tRNS has an invalid length");
        paletteAlpha = bytes.slice(dataOffset, dataEnd);
      } else if (colorType === 0) {
        if (length !== 2) throw new Error("grayscale PNG tRNS must contain exactly 2 bytes");
        transparentGrayscale = (bytes[dataOffset]! << 8) | bytes[dataOffset + 1]!;
        const maximumSample = bitDepth === 16 ? 0xffff : (1 << bitDepth) - 1;
        if (transparentGrayscale > maximumSample) {
          throw new Error(`grayscale PNG tRNS sample exceeds bit depth ${bitDepth}`);
        }
      } else if (colorType === 2) {
        if (length !== 6) throw new Error("RGB PNG tRNS must contain exactly 6 bytes");
        transparentRgb = [
          (bytes[dataOffset]! << 8) | bytes[dataOffset + 1]!,
          (bytes[dataOffset + 2]! << 8) | bytes[dataOffset + 3]!,
          (bytes[dataOffset + 4]! << 8) | bytes[dataOffset + 5]!,
        ];
        const maximumSample = bitDepth === 16 ? 0xffff : 0xff;
        if (transparentRgb.some((sample) => sample > maximumSample)) {
          throw new Error(`RGB PNG tRNS sample exceeds bit depth ${bitDepth}`);
        }
      } else {
        throw new Error(`PNG tRNS is not permitted for color type ${colorType}`);
      }
      sawTransparency = true;
    } else if (type === "IDAT") {
      if (imageDataEnded) throw new Error("IDAT chunks must be consecutive");
      if (colorType === 3 && !sawPalette) throw new Error("indexed PNG requires PLTE before IDAT");
      sawImageData = true;
      compressedLength += length;
      if (!Number.isSafeInteger(compressedLength) || compressedLength > maxCompressedBytes) {
        throw new Error(`PNG image data exceeds maxCompressedBytes (${compressedLength} > ${maxCompressedBytes})`);
      }
      compressedParts.push(bytes.slice(dataOffset, dataEnd));
    } else if (type === "IEND") {
      if (length !== 0) throw new Error("IEND must be empty");
      if (!sawImageData) throw new Error("PNG contains no IDAT data");
      sawEnd = true;
    } else {
      if (sawImageData) imageDataEnded = true;
      const critical = (bytes[typeOffset]! & 0x20) === 0;
      if (critical) throw new Error(`unsupported critical PNG chunk ${type}`);
    }
    offset = chunkEnd;
    if (sawEnd) break;
  }
  if (!sawEnd) throw new Error("PNG contains no IEND chunk");
  if (offset !== bytes.length) throw new Error("PNG contains trailing bytes after IEND");
  if (colorType === null) throw new Error("PNG header was not decoded");

  const bitsPerPixel = colorType === 3
    ? bitDepth
    : (colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4) * bitDepth;
  const rowBytes = Math.ceil(width * bitsPerPixel / 8);
  const adam7StartsX = [0, 4, 0, 2, 0, 1, 0] as const;
  const adam7StartsY = [0, 0, 4, 0, 2, 0, 1] as const;
  const adam7StepsX = [8, 8, 4, 4, 2, 2, 1] as const;
  const adam7StepsY = [8, 8, 8, 4, 4, 2, 2] as const;
  const adam7Passes = interlaceMethod === 1
    ? adam7StartsX.map((startX, index) => {
      const startY = adam7StartsY[index]!;
      const stepX = adam7StepsX[index]!;
      const stepY = adam7StepsY[index]!;
      const passWidth = width <= startX ? 0 : Math.ceil((width - startX) / stepX);
      const passHeight = height <= startY ? 0 : Math.ceil((height - startY) / stepY);
      return { startX, startY, stepX, stepY, width: passWidth, height: passHeight, rowBytes: Math.ceil(passWidth * bitsPerPixel / 8) };
    })
    : [{ startX: 0, startY: 0, stepX: 1, stepY: 1, width, height, rowBytes }];
  const expectedInflatedBytes = adam7Passes.reduce((total, pass) => {
    if (pass.width === 0 || pass.height === 0) return total;
    return total + pass.height * (pass.rowBytes + 1);
  }, 0);
  if (!Number.isSafeInteger(expectedInflatedBytes) || expectedInflatedBytes > maxInflatedBytes) {
    throw new Error(`PNG inflated data exceeds maxInflatedBytes (${expectedInflatedBytes} > ${maxInflatedBytes})`);
  }
  const compressed = new Uint8Array(compressedLength);
  let compressedOffset = 0;
  for (const part of compressedParts) {
    compressed.set(part, compressedOffset);
    compressedOffset += part.length;
  }
  if (compressed.length < 6) throw new Error("PNG zlib stream is truncated");
  const compressionMethod = compressed[0]! & 0x0f;
  const windowSize = compressed[0]! >>> 4;
  if (compressionMethod !== 8 || windowSize > 7 || ((compressed[0]! << 8) | compressed[1]!) % 31 !== 0) {
    throw new Error("PNG has an invalid zlib header");
  }
  if ((compressed[1]! & 0x20) !== 0) throw new Error("PNG zlib preset dictionaries are unsupported");
  let filtered: Uint8Array;
  try {
    filtered = await inflateZlib(compressed, expectedInflatedBytes);
  } catch (error) {
    throw new Error(`PNG zlib stream is invalid (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!(filtered instanceof Uint8Array)) throw new Error("PNG inflater must return Uint8Array");
  if (filtered.length !== expectedInflatedBytes) {
    throw new Error(`PNG inflated byte count mismatch (${filtered.length} !== ${expectedInflatedBytes})`);
  }
  const expectedAdler = readUint32(compressed, compressed.length - 4);
  const actualAdler = adler32(filtered);
  if (expectedAdler !== actualAdler) throw new Error("PNG zlib checksum mismatch or trailing compressed data");

  const pixels = new Uint8Array(rowBytes * height);
  let filteredOffset = 0;
  for (let passIndex = 0; passIndex < adam7Passes.length; passIndex++) {
    const pass = adam7Passes[passIndex]!;
    if (pass.width === 0 || pass.height === 0) continue;
    const passPixels = new Uint8Array(pass.rowBytes * pass.height);
    for (let row = 0; row < pass.height; row++) {
      const filter = filtered[filteredOffset++]!;
      if (filter > 4) {
        const location = interlaceMethod === 0 ? `row ${row}` : `pass ${passIndex + 1} row ${row}`;
        throw new Error(`unsupported PNG row filter ${filter} at ${location}`);
      }
      const outputOffset = row * pass.rowBytes;
      const priorOffset = outputOffset - pass.rowBytes;
      for (let column = 0; column < pass.rowBytes; column++) {
        const encoded = filtered[filteredOffset++]!;
        const left = column >= filterBytesPerPixel ? passPixels[outputOffset + column - filterBytesPerPixel]! : 0;
        const up = row > 0 ? passPixels[priorOffset + column]! : 0;
        const upperLeft = row > 0 && column >= filterBytesPerPixel
          ? passPixels[priorOffset + column - filterBytesPerPixel]!
          : 0;
        const predictor = filter === 0 ? 0
          : filter === 1 ? left
            : filter === 2 ? up
              : filter === 3 ? Math.floor((left + up) / 2)
                : paeth(left, up, upperLeft);
        passPixels[outputOffset + column] = (encoded + predictor) & 0xff;
      }
    }
    if (interlaceMethod === 0) {
      pixels.set(passPixels);
      continue;
    }
    if (bitDepth < 8) {
      const mask = (1 << bitDepth) - 1;
      for (let passY = 0; passY < pass.height; passY++) {
        const targetY = pass.startY + passY * pass.stepY;
        for (let passX = 0; passX < pass.width; passX++) {
          const sourceBit = passX * bitDepth;
          const sample = (passPixels[passY * pass.rowBytes + Math.floor(sourceBit / 8)]!
            >>> (8 - bitDepth - (sourceBit % 8))) & mask;
          const targetX = pass.startX + passX * pass.stepX;
          const targetBit = targetX * bitDepth;
          const targetOffset = targetY * rowBytes + Math.floor(targetBit / 8);
          const shift = 8 - bitDepth - (targetBit % 8);
          pixels[targetOffset] = (pixels[targetOffset]! & ~(mask << shift)) | (sample << shift);
        }
      }
    } else {
      const bytesPerPixel = bitsPerPixel / 8;
      for (let passY = 0; passY < pass.height; passY++) {
        const targetY = pass.startY + passY * pass.stepY;
        for (let passX = 0; passX < pass.width; passX++) {
          const targetX = pass.startX + passX * pass.stepX;
          const sourceOffset = passY * pass.rowBytes + passX * bytesPerPixel;
          const targetOffset = targetY * rowBytes + targetX * bytesPerPixel;
          pixels.set(passPixels.subarray(sourceOffset, sourceOffset + bytesPerPixel), targetOffset);
        }
      }
    }
  }

  const sampleMaximum = (1 << Math.min(bitDepth, 16)) - 1;
  const sampleToByte = (sample: number) => bitDepth === 8 ? sample : Math.round(sample * 255 / sampleMaximum);
  const luminanceToByte = (red: number, green: number, blue: number) =>
    sampleToByte(Math.floor((77 * red + 150 * green + 29 * blue + 128) / 256));
  const sampleAt = (row: number, column: number, channel: number) => {
    if (bitDepth < 8) {
      const bitOffset = column * bitDepth;
      const packed = pixels[row * rowBytes + Math.floor(bitOffset / 8)]!;
      return (packed >>> (8 - bitDepth - (bitOffset % 8))) & sampleMaximum;
    }
    const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 1;
    const bytesPerSample = bitDepth / 8;
    const sourceOffset = row * rowBytes + (column * channels + channel) * bytesPerSample;
    return bitDepth === 16
      ? (pixels[sourceOffset]! << 8) | pixels[sourceOffset + 1]!
      : pixels[sourceOffset]!;
  };
  const hasExplicitAlpha = colorType === 4 || colorType === 6 || sawTransparency;
  const alpha = new Uint8Array(width * height);
  for (let pixel = 0; pixel < alpha.length; pixel++) {
    const row = Math.floor(pixel / width);
    const column = pixel % width;
    if (colorType === 3) {
      const bitOffset = column * bitDepth;
      const packed = pixels[row * rowBytes + Math.floor(bitOffset / 8)]!;
      const paletteIndex = (packed >>> (8 - bitDepth - (bitOffset % 8))) & ((1 << bitDepth) - 1);
      const paletteEntries = palette!.length / 3;
      if (paletteIndex >= paletteEntries) {
        throw new Error(`indexed PNG pixel ${pixel} references missing palette entry ${paletteIndex}`);
      }
      if (paletteAlpha && paletteIndex < paletteAlpha.length) alpha[pixel] = paletteAlpha[paletteIndex]!;
      else if (options.luminanceAsAlpha) {
        const paletteOffset = paletteIndex * 3;
        alpha[pixel] = (77 * palette![paletteOffset]! + 150 * palette![paletteOffset + 1]! +
          29 * palette![paletteOffset + 2]! + 128) >> 8;
      } else alpha[pixel] = 255;
      continue;
    }
    if (colorType === 4) alpha[pixel] = sampleToByte(sampleAt(row, column, 1));
    else if (colorType === 6) alpha[pixel] = sampleToByte(sampleAt(row, column, 3));
    else if (colorType === 0) {
      const grayscale = sampleAt(row, column, 0);
      if (transparentGrayscale === grayscale) alpha[pixel] = 0;
      else if (options.luminanceAsAlpha) alpha[pixel] = sampleToByte(grayscale);
      else alpha[pixel] = 255;
    } else {
      const red = sampleAt(row, column, 0);
      const green = sampleAt(row, column, 1);
      const blue = sampleAt(row, column, 2);
      if (transparentRgb && red === transparentRgb[0] && green === transparentRgb[1] && blue === transparentRgb[2]) {
        alpha[pixel] = 0;
      } else if (options.luminanceAsAlpha) {
        alpha[pixel] = luminanceToByte(red, green, blue);
      } else alpha[pixel] = 255;
    }
  }
  return {
    contract: PROCPLANT_PNG_ALPHA_CONTRACT,
    version: PROCPLANT_PNG_ALPHA_VERSION,
    width,
    height,
    colorType,
    hasExplicitAlpha,
    alpha,
  };
};
