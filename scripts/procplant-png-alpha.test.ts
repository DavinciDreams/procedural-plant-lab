import assert from "node:assert/strict";
import { inflateSync, deflateSync } from "node:zlib";
import { decodeProcPlantPngAlpha, type ProcPlantPngAlphaOptions } from "../src/procplant-png-alpha";
import { PROCPLANT_CLI_EXIT, runProcPlantCli, type ProcPlantCliIo } from "../src/procplant-cli";

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let entry = 0; entry < 256; entry++) {
    let value = entry;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[entry] = value >>> 0;
  }
  return table;
})();
const crc32 = (bytes: Uint8Array) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};
const uint32 = (value: number) => Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
const uint16 = (value: number) => Uint8Array.of(value >>> 8, value);
const concat = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};
const chunk = (type: string, data = new Uint8Array()) => {
  const typeBytes = Uint8Array.from(type, (character) => character.charCodeAt(0));
  return concat(uint32(data.length), typeBytes, data, uint32(crc32(concat(typeBytes, data))));
};
const paeth = (left: number, up: number, upperLeft: number) => {
  const p = left + up - upperLeft;
  const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upperLeft);
  return pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft;
};

interface PngFixtureOptions {
  depth?: number;
  interlace?: number;
  filters?: number[];
  prefixChunks?: Uint8Array[];
  afterHeaderChunks?: Uint8Array[];
  betweenIdatChunks?: Uint8Array[];
  compressedSuffix?: Uint8Array;
}

const makePng = (
  width: number,
  height: number,
  colorType: number,
  channels: number,
  pixels: Uint8Array,
  options: PngFixtureOptions = {},
) => {
  const rowBytes = width * channels;
  assert.equal(pixels.length, rowBytes * height);
  const filtered = new Uint8Array(height * (rowBytes + 1));
  let output = 0;
  for (let row = 0; row < height; row++) {
    const filter = options.filters?.[row] ?? 0;
    filtered[output++] = filter;
    for (let column = 0; column < rowBytes; column++) {
      const index = row * rowBytes + column;
      const left = column >= channels ? pixels[index - channels]! : 0;
      const up = row > 0 ? pixels[index - rowBytes]! : 0;
      const upperLeft = row > 0 && column >= channels ? pixels[index - rowBytes - channels]! : 0;
      const predictor = filter === 1 ? left : filter === 2 ? up : filter === 3
        ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, upperLeft) : 0;
      filtered[output++] = (pixels[index]! - predictor) & 255;
    }
  }
  const header = concat(
    uint32(width), uint32(height),
    Uint8Array.of(options.depth ?? 8, colorType, 0, 0, options.interlace ?? 0),
  );
  const compressed = concat(new Uint8Array(deflateSync(filtered)), options.compressedSuffix ?? new Uint8Array());
  const midpoint = Math.max(1, Math.floor(compressed.length / 2));
  const idat = options.betweenIdatChunks
    ? [chunk("IDAT", compressed.slice(0, midpoint)), ...options.betweenIdatChunks, chunk("IDAT", compressed.slice(midpoint))]
    : [chunk("IDAT", compressed)];
  return concat(
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    ...(options.prefixChunks ?? []),
    chunk("IHDR", header),
    ...(options.afterHeaderChunks ?? []),
    ...idat,
    chunk("IEND"),
  );
};

interface IndexedPngFixtureOptions {
  filters?: number[];
  transparency?: Uint8Array;
  chunksBeforeIdat?: Uint8Array[];
  chunksAfterIdat?: Uint8Array[];
}

const makeIndexedPng = (
  width: number,
  height: number,
  depth: 1 | 2 | 4 | 8,
  palette: Uint8Array,
  indices: Uint8Array,
  options: IndexedPngFixtureOptions = {},
) => {
  assert.equal(indices.length, width * height);
  const rowBytes = Math.ceil(width * depth / 8);
  const scanlines = new Uint8Array(rowBytes * height);
  const sampleMask = (1 << depth) - 1;
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const sample = indices[row * width + column]!;
      assert.ok(sample <= sampleMask, `sample ${sample} must fit depth ${depth}`);
      const bitOffset = column * depth;
      scanlines[row * rowBytes + Math.floor(bitOffset / 8)]! |= sample << (8 - depth - (bitOffset % 8));
    }
  }
  const filtered = new Uint8Array(height * (rowBytes + 1));
  let output = 0;
  for (let row = 0; row < height; row++) {
    const filter = options.filters?.[row] ?? 0;
    filtered[output++] = filter;
    for (let column = 0; column < rowBytes; column++) {
      const index = row * rowBytes + column;
      const left = column > 0 ? scanlines[index - 1]! : 0;
      const up = row > 0 ? scanlines[index - rowBytes]! : 0;
      const upperLeft = row > 0 && column > 0 ? scanlines[index - rowBytes - 1]! : 0;
      const predictor = filter === 1 ? left : filter === 2 ? up : filter === 3
        ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, upperLeft) : 0;
      filtered[output++] = (scanlines[index]! - predictor) & 255;
    }
  }
  const header = concat(uint32(width), uint32(height), Uint8Array.of(depth, 3, 0, 0, 0));
  const beforeIdat = options.chunksBeforeIdat ?? [
    chunk("PLTE", palette),
    ...(options.transparency ? [chunk("tRNS", options.transparency)] : []),
  ];
  return concat(
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", header),
    ...beforeIdat,
    chunk("IDAT", new Uint8Array(deflateSync(filtered))),
    ...(options.chunksAfterIdat ?? []),
    chunk("IEND"),
  );
};

const makePackedGrayscalePng = (
  width: number,
  height: number,
  depth: 1 | 2 | 4,
  samples: Uint8Array,
  options: { filters?: number[]; transparency?: number } = {},
) => {
  assert.equal(samples.length, width * height);
  const rowBytes = Math.ceil(width * depth / 8);
  const scanlines = new Uint8Array(rowBytes * height);
  const sampleMask = (1 << depth) - 1;
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const sample = samples[row * width + column]!;
      assert.ok(sample <= sampleMask, `sample ${sample} must fit depth ${depth}`);
      const bitOffset = column * depth;
      scanlines[row * rowBytes + Math.floor(bitOffset / 8)]! |= sample << (8 - depth - (bitOffset % 8));
    }
  }
  const filtered = new Uint8Array(height * (rowBytes + 1));
  let output = 0;
  for (let row = 0; row < height; row++) {
    const filter = options.filters?.[row] ?? 0;
    filtered[output++] = filter;
    for (let column = 0; column < rowBytes; column++) {
      const index = row * rowBytes + column;
      const left = column > 0 ? scanlines[index - 1]! : 0;
      const up = row > 0 ? scanlines[index - rowBytes]! : 0;
      const upperLeft = row > 0 && column > 0 ? scanlines[index - rowBytes - 1]! : 0;
      const predictor = filter === 1 ? left : filter === 2 ? up : filter === 3
        ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, upperLeft) : 0;
      filtered[output++] = (scanlines[index]! - predictor) & 255;
    }
  }
  const chunks = options.transparency === undefined ? [] : [chunk("tRNS", uint16(options.transparency))];
  return concat(
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", concat(uint32(width), uint32(height), Uint8Array.of(depth, 0, 0, 0, 0))),
    ...chunks,
    chunk("IDAT", new Uint8Array(deflateSync(filtered))),
    chunk("IEND"),
  );
};

const makeAdam7Png = (
  width: number,
  height: number,
  colorType: 0 | 2 | 3 | 4 | 6,
  depth: 1 | 2 | 4 | 8 | 16,
  channels: number,
  pixels: Uint8Array,
  options: { palette?: Uint8Array; transparency?: Uint8Array } = {},
) => {
  const startsX = [0, 4, 0, 2, 0, 1, 0] as const;
  const startsY = [0, 0, 4, 0, 2, 0, 1] as const;
  const stepsX = [8, 8, 4, 4, 2, 2, 1] as const;
  const stepsY = [8, 8, 8, 4, 4, 2, 2] as const;
  const bitsPerPixel = channels * depth;
  const bytesPerPixel = bitsPerPixel / 8;
  assert.equal(pixels.length, depth < 8 ? width * height : width * height * bytesPerPixel);
  const filteredParts: Uint8Array[] = [];
  for (let pass = 0; pass < 7; pass++) {
    const passWidth = width <= startsX[pass]! ? 0 : Math.ceil((width - startsX[pass]!) / stepsX[pass]!);
    const passHeight = height <= startsY[pass]! ? 0 : Math.ceil((height - startsY[pass]!) / stepsY[pass]!);
    if (passWidth === 0 || passHeight === 0) continue;
    const passRowBytes = Math.ceil(passWidth * bitsPerPixel / 8);
    const scanlines = new Uint8Array(passRowBytes * passHeight);
    for (let passY = 0; passY < passHeight; passY++) {
      const sourceY = startsY[pass]! + passY * stepsY[pass]!;
      for (let passX = 0; passX < passWidth; passX++) {
        const sourceX = startsX[pass]! + passX * stepsX[pass]!;
        if (depth < 8) {
          const sample = pixels[sourceY * width + sourceX]!;
          const bitOffset = passX * depth;
          scanlines[passY * passRowBytes + Math.floor(bitOffset / 8)]! |= sample << (8 - depth - (bitOffset % 8));
        } else {
          const sourceOffset = (sourceY * width + sourceX) * bytesPerPixel;
          const targetOffset = passY * passRowBytes + passX * bytesPerPixel;
          scanlines.set(pixels.subarray(sourceOffset, sourceOffset + bytesPerPixel), targetOffset);
        }
      }
    }
    const filtered = new Uint8Array(passHeight * (passRowBytes + 1));
    let output = 0;
    const filterBpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
    for (let row = 0; row < passHeight; row++) {
      const filter = (pass + row) % 5;
      filtered[output++] = filter;
      for (let column = 0; column < passRowBytes; column++) {
        const index = row * passRowBytes + column;
        const left = column >= filterBpp ? scanlines[index - filterBpp]! : 0;
        const up = row > 0 ? scanlines[index - passRowBytes]! : 0;
        const upperLeft = row > 0 && column >= filterBpp ? scanlines[index - passRowBytes - filterBpp]! : 0;
        const predictor = filter === 1 ? left : filter === 2 ? up : filter === 3
          ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, upperLeft) : 0;
        filtered[output++] = (scanlines[index]! - predictor) & 255;
      }
    }
    filteredParts.push(filtered);
  }
  const beforeIdat = [
    ...(options.palette ? [chunk("PLTE", options.palette)] : []),
    ...(options.transparency ? [chunk("tRNS", options.transparency)] : []),
  ];
  return concat(
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", concat(uint32(width), uint32(height), Uint8Array.of(depth, colorType, 0, 0, 1))),
    ...beforeIdat,
    chunk("IDAT", new Uint8Array(deflateSync(concat(...filteredParts)))),
    chunk("IEND"),
  );
};

const inflate = async (compressed: Uint8Array, maximum: number) =>
  new Uint8Array(inflateSync(compressed, { maxOutputLength: maximum }));
const decode = (png: Uint8Array, options?: ProcPlantPngAlphaOptions) => decodeProcPlantPngAlpha(png, inflate, options);

const rgbaPixels = Uint8Array.from({ length: 2 * 5 * 4 }, (_, index) => (index * 37 + 11) & 255);
const allFilters = makePng(2, 5, 6, 4, rgbaPixels, { filters: [0, 1, 2, 3, 4] });
const rgba = await decode(allFilters);
assert.equal(rgba.colorType, 6);
assert.equal(rgba.hasExplicitAlpha, true);
assert.deepEqual([...rgba.alpha], Array.from({ length: 10 }, (_, pixel) => rgbaPixels[pixel * 4 + 3]));

const adam7RgbaPixels = Uint8Array.from({ length: 9 * 10 * 4 }, (_, index) => (index * 53 + 17) & 255);
const adam7Rgba = await decode(makeAdam7Png(9, 10, 6, 8, 4, adam7RgbaPixels));
assert.deepEqual([...adam7Rgba.alpha], Array.from({ length: 90 }, (_, pixel) => adam7RgbaPixels[pixel * 4 + 3]));
const adam7Rgba16Pixels = concat(
  ...Array.from({ length: 7 * 6 }, (_, pixel) => concat(
    uint16((pixel * 101) & 0xffff), uint16((pixel * 211) & 0xffff), uint16((pixel * 307) & 0xffff),
    uint16((pixel * 997) & 0xffff),
  )),
);
assert.deepEqual(
  [...(await decode(makeAdam7Png(7, 6, 6, 16, 4, adam7Rgba16Pixels))).alpha],
  Array.from({ length: 42 }, (_, pixel) => Math.round(((pixel * 997) & 0xffff) * 255 / 0xffff)),
);
const adam7PackedSamples = Uint8Array.from({ length: 11 * 9 }, (_, pixel) => pixel % 4);
assert.deepEqual(
  [...(await decode(makeAdam7Png(11, 9, 0, 2, 1, adam7PackedSamples), { luminanceAsAlpha: true })).alpha],
  Array.from(adam7PackedSamples, (sample) => Math.round(sample * 255 / 3)),
);
const adam7Palette = Uint8Array.of(255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255);
const adam7Indices = Uint8Array.from({ length: 10 * 7 }, (_, pixel) => pixel % 4);
assert.deepEqual(
  [...(await decode(makeAdam7Png(10, 7, 3, 2, 1, adam7Indices, {
    palette: adam7Palette,
    transparency: Uint8Array.of(0, 85, 170, 255),
  }))).alpha],
  Array.from(adam7Indices, (index) => index * 85),
);

const grayscalePng = makePng(3, 1, 0, 1, Uint8Array.of(0, 127, 255));
assert.deepEqual([...(await decode(grayscalePng)).alpha], [255, 255, 255]);
assert.deepEqual([...(await decode(grayscalePng, { luminanceAsAlpha: true })).alpha], [0, 127, 255]);
const grayscaleAlpha = await decode(makePng(2, 1, 4, 2, Uint8Array.of(10, 20, 30, 40)));
assert.deepEqual([...grayscaleAlpha.alpha], [20, 40]);
const rgbPng = makePng(2, 1, 2, 3, Uint8Array.of(255, 0, 0, 255, 255, 255));
assert.deepEqual([...(await decode(rgbPng)).alpha], [255, 255]);
assert.deepEqual([...(await decode(rgbPng, { luminanceAsAlpha: true })).alpha], [77, 255]);

const grayscaleTransparency = makePng(3, 1, 0, 1, Uint8Array.of(0, 127, 255), {
  afterHeaderChunks: [chunk("tRNS", uint16(127))],
});
assert.equal((await decode(grayscaleTransparency)).hasExplicitAlpha, true);
assert.deepEqual([...(await decode(grayscaleTransparency)).alpha], [255, 0, 255]);
assert.deepEqual([...(await decode(grayscaleTransparency, { luminanceAsAlpha: true })).alpha], [0, 0, 255]);
const rgbTransparency = makePng(2, 1, 2, 3, Uint8Array.of(255, 0, 0, 255, 255, 255), {
  afterHeaderChunks: [chunk("tRNS", concat(uint16(255), uint16(0), uint16(0)))],
});
assert.equal((await decode(rgbTransparency)).hasExplicitAlpha, true);
assert.deepEqual([...(await decode(rgbTransparency)).alpha], [0, 255]);
assert.deepEqual([...(await decode(rgbTransparency, { luminanceAsAlpha: true })).alpha], [0, 255]);

for (const depth of [1, 2, 4] as const) {
  const maximum = (1 << depth) - 1;
  const samples = Uint8Array.of(0, 1, maximum, Math.max(0, maximum - 1));
  const packedGrayscale = makePackedGrayscalePng(4, 1, depth, samples, { transparency: 1 });
  assert.deepEqual([...(await decode(packedGrayscale)).alpha], [...samples].map((sample) => sample === 1 ? 0 : 255));
  assert.deepEqual(
    [...(await decode(packedGrayscale, { luminanceAsAlpha: true })).alpha],
    [...samples].map((sample) => sample === 1 ? 0 : Math.round(sample * 255 / maximum)),
  );
}

const grayscale16 = makePng(3, 1, 0, 2, concat(uint16(0x1234), uint16(0x1235), uint16(0xffff)), {
  depth: 16,
  afterHeaderChunks: [chunk("tRNS", uint16(0x1234))],
});
assert.equal((await decode(grayscale16)).hasExplicitAlpha, true);
assert.deepEqual([...(await decode(grayscale16)).alpha], [0, 255, 255]);
assert.deepEqual([...(await decode(grayscale16, { luminanceAsAlpha: true })).alpha], [0, 18, 255]);

const rgb16Transparent = [0x0102, 0x0304, 0x0506] as const;
const rgb16 = makePng(2, 1, 2, 6, concat(
  ...rgb16Transparent.map(uint16),
  uint16(0), uint16(38), uint16(943),
), {
  depth: 16,
  afterHeaderChunks: [chunk("tRNS", concat(...rgb16Transparent.map(uint16)))],
});
assert.deepEqual([...(await decode(rgb16)).alpha], [0, 255], "16-bit tRNS comparisons must include low bytes");
assert.deepEqual([...(await decode(rgb16, { luminanceAsAlpha: true })).alpha], [0, 1],
  "16-bit RGB luminance must combine native samples before 8-bit scaling");

const grayscaleAlpha16 = makePng(4, 1, 4, 4, concat(
  uint16(100), uint16(0),
  uint16(200), uint16(257),
  uint16(300), uint16(32768),
  uint16(400), uint16(65535),
), { depth: 16 });
assert.deepEqual([...(await decode(grayscaleAlpha16)).alpha], [0, 1, 128, 255]);
const rgba16Pixels = concat(
  ...[0, 257, 32768, 65278, 65535].map((alpha) => concat(uint16(1000), uint16(2000), uint16(3000), uint16(alpha))),
);
const rgba16 = makePng(1, 5, 6, 8, rgba16Pixels, { depth: 16, filters: [0, 1, 2, 3, 4] });
assert.deepEqual([...(await decode(rgba16)).alpha], [0, 1, 128, 254, 255]);

const paletteColors = Uint8Array.of(
  255, 0, 0,
  0, 255, 0,
  0, 0, 255,
  255, 255, 255,
  0, 0, 0,
  90, 140, 210,
);
const paletteLuma = [77, 149, 29, 255, 0, (77 * 90 + 150 * 140 + 29 * 210 + 128) >> 8];
for (const depth of [1, 2, 4, 8] as const) {
  const entries = Math.min(2 ** depth, paletteColors.length / 3);
  const palette = paletteColors.slice(0, entries * 3);
  const width = 11;
  const height = 5;
  const indices = Uint8Array.from({ length: width * height }, (_, pixel) => (pixel + Math.floor(pixel / width)) % entries);
  const indexed = await decode(makeIndexedPng(width, height, depth, palette, indices, { filters: [0, 1, 2, 3, 4] }));
  assert.equal(indexed.colorType, 3);
  assert.equal(indexed.hasExplicitAlpha, false);
  assert.deepEqual([...indexed.alpha], Array.from(indices, () => 255));
  const luminance = await decode(makeIndexedPng(width, height, depth, palette, indices, { filters: [0, 1, 2, 3, 4] }), {
    luminanceAsAlpha: true,
  });
  assert.deepEqual([...luminance.alpha], Array.from(indices, (index) => paletteLuma[index]!));
}
const transparencyPalette = paletteColors.slice(0, 12);
const transparencyIndices = Uint8Array.of(0, 1, 2, 3);
const indexedTransparency = makeIndexedPng(4, 1, 2, transparencyPalette, transparencyIndices, {
  transparency: Uint8Array.of(255, 128),
});
const transparent = await decode(indexedTransparency, { luminanceAsAlpha: true });
assert.equal(transparent.hasExplicitAlpha, true);
assert.deepEqual([...transparent.alpha], [255, 128, 29, 255],
  "tRNS entries must override luma while uncovered palette entries may use luma");
assert.deepEqual([...(await decode(indexedTransparency)).alpha], [255, 128, 255, 255]);
const corruptPaletteCrc = indexedTransparency.slice();
corruptPaletteCrc[41] ^= 1;
await assert.rejects(decode(corruptPaletteCrc), /PLTE chunk CRC mismatch/);

const corrupt = allFilters.slice();
corrupt[corrupt.length - 1] ^= 1;
await assert.rejects(decode(corrupt), /IEND chunk CRC mismatch/);
await assert.rejects(decode(makePng(1, 1, 3, 1, Uint8Array.of(0))), /indexed PNG requires PLTE before IDAT/);
await assert.rejects(decode(makePng(1, 1, 3, 1, Uint8Array.of(0), { depth: 3 })), /unsupported PNG bit depth 3/);
await assert.rejects(decode(makeIndexedPng(1, 1, 1, Uint8Array.of(), Uint8Array.of(0))), /PLTE has an invalid length/);
await assert.rejects(decode(makeIndexedPng(1, 1, 1, Uint8Array.of(0, 0), Uint8Array.of(0))), /PLTE has an invalid length/);
await assert.rejects(decode(makeIndexedPng(1, 1, 1, paletteColors.slice(0, 9), Uint8Array.of(0))), /too many entries/);
await assert.rejects(decode(makeIndexedPng(1, 1, 1, paletteColors.slice(0, 3), Uint8Array.of(1))), /missing palette entry 1/);
await assert.rejects(decode(makeIndexedPng(1, 1, 2, transparencyPalette, Uint8Array.of(0), {
  transparency: Uint8Array.of(0, 1, 2, 3, 4),
})), /tRNS has an invalid length/);
await assert.rejects(decode(makeIndexedPng(1, 1, 2, transparencyPalette, Uint8Array.of(0), {
  chunksBeforeIdat: [chunk("tRNS", Uint8Array.of(0)), chunk("PLTE", transparencyPalette)],
})), /tRNS must follow PLTE/);
await assert.rejects(decode(makeIndexedPng(1, 1, 2, transparencyPalette, Uint8Array.of(0), {
  chunksBeforeIdat: [chunk("PLTE", transparencyPalette), chunk("PLTE", transparencyPalette)],
})), /multiple PLTE/);
await assert.rejects(decode(makeIndexedPng(1, 1, 2, transparencyPalette, Uint8Array.of(0), {
  chunksBeforeIdat: [chunk("PLTE", transparencyPalette), chunk("tRNS", Uint8Array.of(0)), chunk("tRNS", Uint8Array.of(1))],
})), /multiple tRNS/);
await assert.rejects(decode(makeIndexedPng(1, 1, 2, transparencyPalette, Uint8Array.of(0), {
  chunksAfterIdat: [chunk("tRNS", Uint8Array.of(0))],
})), /tRNS must precede IDAT/);
await assert.rejects(decode(makeIndexedPng(1, 1, 2, transparencyPalette, Uint8Array.of(0), {
  chunksBeforeIdat: [],
  chunksAfterIdat: [chunk("PLTE", transparencyPalette)],
})), /requires PLTE before IDAT/);
await assert.rejects(decode(makeIndexedPng(1, 1, 2, transparencyPalette, Uint8Array.of(0), {
  transparency: new Uint8Array(),
})), /tRNS has an invalid length/);
await assert.rejects(decode(makePng(1, 1, 0, 1, Uint8Array.of(0), {
  afterHeaderChunks: [chunk("tRNS", Uint8Array.of(0))],
})), /grayscale PNG tRNS must contain exactly 2 bytes/);
await assert.rejects(decode(makePng(1, 1, 2, 3, Uint8Array.of(0, 0, 0), {
  afterHeaderChunks: [chunk("tRNS", Uint8Array.of(0, 0, 0, 0))],
})), /RGB PNG tRNS must contain exactly 6 bytes/);
await assert.rejects(decode(makePng(1, 1, 0, 1, Uint8Array.of(0), {
  afterHeaderChunks: [chunk("tRNS", uint16(256))],
})), /grayscale PNG tRNS sample exceeds bit depth 8/);
await assert.rejects(decode(makePng(1, 1, 2, 3, Uint8Array.of(0, 0, 0), {
  afterHeaderChunks: [chunk("tRNS", concat(uint16(0), uint16(256), uint16(0)))],
})), /RGB PNG tRNS sample exceeds bit depth 8/);
await assert.rejects(decode(makePng(1, 1, 4, 2, Uint8Array.of(0, 255), {
  afterHeaderChunks: [chunk("tRNS", uint16(0))],
})), /tRNS is not permitted for color type 4/);
await assert.rejects(decode(makePng(1, 1, 6, 4, Uint8Array.of(0, 0, 0, 255), {
  afterHeaderChunks: [chunk("tRNS", concat(uint16(0), uint16(0), uint16(0)))],
})), /tRNS is not permitted for color type 6/);
await assert.rejects(decode(makePng(1, 1, 2, 3, Uint8Array.of(0, 0, 0), {
  afterHeaderChunks: [
    chunk("tRNS", concat(uint16(0), uint16(0), uint16(0))),
    chunk("PLTE", Uint8Array.of(0, 0, 0)),
  ],
})), /PLTE must precede tRNS/);
await assert.rejects(decode(makeIndexedPng(9, 1, 1, paletteColors.slice(0, 6), new Uint8Array(9)), {
  maxInflatedBytes: 2,
}), /exceeds maxInflatedBytes \(3 > 2\)/);
await assert.rejects(decode(makePng(1, 1, 2, 3, Uint8Array.of(0, 0, 0), { depth: 4 })), /unsupported PNG bit depth 4/);
await assert.rejects(decode(makePng(1, 1, 0, 1, Uint8Array.of(0), { interlace: 2 })), /unsupported PNG interlace method 2/);
await assert.rejects(decode(makeAdam7Png(9, 10, 6, 8, 4, adam7RgbaPixels), {
  maxInflatedBytes: 379,
}), /exceeds maxInflatedBytes \(380 > 379\)/);
await assert.rejects(decode(makePng(1, 1, 0, 1, Uint8Array.of(0), { filters: [5] })), /unsupported PNG row filter 5/);
await assert.rejects(decode(makePng(1, 1, 0, 1, Uint8Array.of(0), { prefixChunks: [chunk("tEXt")] })), /IHDR must be the first/);
await assert.rejects(decode(makePng(1, 1, 0, 1, Uint8Array.of(0), {
  afterHeaderChunks: [chunk("ABCD")],
})), /unsupported critical PNG chunk ABCD/);
await assert.rejects(decode(makePng(1, 1, 0, 1, Uint8Array.of(0), {
  afterHeaderChunks: [chunk("AbcD")],
})), /invalid reserved bit/);
await assert.rejects(decode(makePng(1, 1, 0, 1, Uint8Array.of(0), {
  betweenIdatChunks: [chunk("tEXt")],
})), /IDAT chunks must be consecutive/);
await assert.rejects(decode(makePng(1, 1, 0, 1, Uint8Array.of(0), {
  compressedSuffix: Uint8Array.of(1),
})), /checksum mismatch or trailing compressed data/);
await assert.rejects(decode(grayscalePng, { maxWidth: 2 }), /dimensions exceed limits/);
await assert.rejects(decode(grayscalePng, { maxPixels: 2 }), /exceeds maxPixels/);
await assert.rejects(decode(grayscalePng, { maxEncodedBytes: 45 }), /exceeds maxEncodedBytes/);
await assert.rejects(decode(grayscalePng, { maxCompressedBytes: 1 }), /exceeds maxCompressedBytes/);
await assert.rejects(decode(grayscalePng, { maxInflatedBytes: 3 }), /exceeds maxInflatedBytes/);
await assert.rejects(decode(rgba16, { maxInflatedBytes: 44 }), /exceeds maxInflatedBytes \(45 > 44\)/);
await assert.rejects(decodeProcPlantPngAlpha(grayscalePng, async () => new Uint8Array(0)), /inflated byte count mismatch/);

const immutableSuccess = rgba16.slice();
const immutableSuccessSnapshot = immutableSuccess.slice();
await decode(immutableSuccess);
assert.deepEqual(immutableSuccess, immutableSuccessSnapshot, "successful decoding must not mutate source bytes");
const immutableFailure = grayscalePng.slice();
const immutableFailureSnapshot = immutableFailure.slice();
await assert.rejects(decodeProcPlantPngAlpha(immutableFailure, async (compressed) => {
  compressed.fill(0);
  throw new Error("injected failure");
}), /injected failure/);
assert.deepEqual(immutableFailure, immutableFailureSnapshot, "inflater failure must not mutate source bytes");

const maskSize = 5;
const maskAlpha = Uint8Array.from({ length: maskSize * maskSize }, (_, index) => {
  const x = index % maskSize, y = Math.floor(index / maskSize);
  return x > 0 && y > 0 && x < maskSize - 1 && y < maskSize - 1 ? 255 : 0;
});
const maskRgba = new Uint8Array(maskAlpha.length * 4);
for (let pixel = 0; pixel < maskAlpha.length; pixel++) maskRgba.set([30, 160, 60, maskAlpha[pixel]!], pixel * 4);
const maskPng = makePng(maskSize, maskSize, 6, 4, maskRgba, { filters: [0, 1, 2, 3, 4] });
const paletteMaskPng = makeIndexedPng(
  maskSize,
  maskSize,
  1,
  Uint8Array.of(20, 80, 30, 30, 160, 60),
  Uint8Array.from(maskAlpha, (alpha) => alpha === 0 ? 0 : 1),
  { transparency: Uint8Array.of(0, 255), filters: [0, 1, 2, 3, 4] },
);
const metadata = {
  pivot: { x: 0.5, y: 0 }, attachment: { x: 0.5, y: 0 },
  bendAxis: { origin: { x: 0.5, y: 0 }, direction: { x: 0, y: 1 } },
};
const inlineManifest = JSON.stringify({
  cutouts: [{ id: "leaf", mask: { width: maskSize, height: maskSize, alpha: [...maskAlpha] }, metadata }],
});
const pngManifest = JSON.stringify({
  cutouts: [{ id: "leaf", mask: { png: "images/leaf.png", width: maskSize, height: maskSize }, metadata }],
});
const paletteManifest = JSON.stringify({
  cutouts: [{ id: "leaf", mask: { png: "images/leaf-indexed.png", width: maskSize, height: maskSize }, metadata }],
});
const textFiles = new Map<string, string>([
  ["fixtures/inline.json", inlineManifest],
  ["fixtures/nested/manifest.json", pngManifest],
  ["fixtures/nested/palette-manifest.json", paletteManifest],
]);
const binaryFiles = new Map<string, Uint8Array>([
  ["fixtures/nested/images/leaf.png", maskPng],
  ["fixtures/nested/images/leaf-indexed.png", paletteMaskPng],
]);
const writes = new Map<string, string>();
let stderr = "";
const pathsRead: string[] = [];
const io: ProcPlantCliIo = {
  readText: async (path) => textFiles.get(path)!,
  readBinary: async (path) => { pathsRead.push(path); return binaryFiles.get(path)!; },
  writeText: async (path, contents) => { writes.set(path, contents); },
  resolveRelativePath: (manifest, reference) => `${manifest.slice(0, manifest.lastIndexOf("/") + 1)}${reference}`,
  inflateZlib: inflate,
  stdout: () => {},
  stderr: (message) => { stderr += message; },
};
assert.equal(await runProcPlantCli(["atlas", "fixtures/inline.json", "--out", "inline-output.json"], io), 0);
assert.equal(await runProcPlantCli(["atlas", "fixtures/nested/manifest.json", "--out", "png-output.json"], io), 0);
assert.equal(await runProcPlantCli(["atlas", "fixtures/nested/palette-manifest.json", "--out", "palette-output.json"], io), 0);
assert.equal(writes.get("inline-output.json"), writes.get("png-output.json"),
  "PNG and legacy inline alpha must produce byte-identical atlas metadata");
assert.equal(writes.get("inline-output.json"), writes.get("palette-output.json"),
  "indexed PNG and legacy inline alpha must produce byte-identical atlas metadata");
assert.deepEqual(pathsRead, ["fixtures/nested/images/leaf.png", "fixtures/nested/images/leaf-indexed.png"]);

textFiles.set("fixtures/nested/mismatch.json", JSON.stringify({
  cutouts: [{ id: "leaf", mask: { png: "images/leaf.png", width: 6 }, metadata }],
}));
stderr = "";
assert.equal(await runProcPlantCli(["atlas", "fixtures/nested/mismatch.json", "--out", "bad.json"], io), PROCPLANT_CLI_EXIT.usage);
assert.match(stderr, /width does not match PNG/);
const unsupportedIo: ProcPlantCliIo = { readText: io.readText, writeText: io.writeText, stdout: () => {}, stderr: (message) => { stderr += message; } };
stderr = "";
assert.equal(await runProcPlantCli(["atlas", "fixtures/nested/manifest.json", "--out", "bad.json"], unsupportedIo), PROCPLANT_CLI_EXIT.failure);
assert.match(stderr, /does not support PNG binary reads/);

console.log("ok 1 - PNG grayscale, RGB, indexed, grayscale-alpha, and RGBA alpha decode");
console.log("ok 2 - all PNG row filters plus Adam7 direct, 16-bit, indexed, and packed samples decode byte-exactly");
console.log("ok 3 - grayscale, RGB, and indexed tRNS transparency is strict and sample-exact");
console.log("ok 4 - 16-bit direct channels decode and scale alpha without losing transparency precision");
console.log("ok 5 - strict chunk, CRC, format, dimension, and decompression caps reject malformed input");
console.log("ok 6 - source bytes are immutable on success and failure, and PNG atlas inputs match inline alpha");
console.log("1..6");
