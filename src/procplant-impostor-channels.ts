import {
  buildProcPlantImpostorAtlas,
  createProcPlantImpostorAtlasLayout,
  selectProcPlantImpostorView,
  type ProcPlantImpostorAtlas,
  type ProcPlantImpostorAtlasEntry,
  type ProcPlantImpostorAtlasOptions,
  type ProcPlantImpostorCapturePlan,
  type ProcPlantImpostorCaptureView,
  type ProcPlantImpostorRaster,
  type ProcPlantImpostorVec3,
} from "./procplant-impostor";

export const PROCPLANT_IMPOSTOR_CHANNEL_CONTRACT = "procplants.impostor-channel" as const;
export const PROCPLANT_IMPOSTOR_CHANNEL_SET_CONTRACT = "procplants.impostor-channel-set" as const;
export const PROCPLANT_IMPOSTOR_CHANNEL_VERSION = 1 as const;

export type ProcPlantImpostorChannelId = "color" | "normal" | "depth";

export interface ProcPlantImpostorChannelDefinition {
  contract: typeof PROCPLANT_IMPOSTOR_CHANNEL_CONTRACT;
  version: typeof PROCPLANT_IMPOSTOR_CHANNEL_VERSION;
  id: ProcPlantImpostorChannelId;
  pixelFormat: "rgba8";
  colorSpace: "srgb" | "linear";
  alpha: "coverage";
  encoding: string;
  dilation: "legacy-edge-copy" | "nearest-valid";
  convention: Readonly<Record<string, string | number>>;
}

export const PROCPLANT_IMPOSTOR_CHANNELS: Readonly<Record<ProcPlantImpostorChannelId, ProcPlantImpostorChannelDefinition>> = Object.freeze({
  color: Object.freeze({
    contract: PROCPLANT_IMPOSTOR_CHANNEL_CONTRACT,
    version: PROCPLANT_IMPOSTOR_CHANNEL_VERSION,
    id: "color",
    pixelFormat: "rgba8",
    colorSpace: "srgb",
    alpha: "coverage",
    encoding: "legacy RGBA8 color; bytes and atlas hash remain the version-1 color contract",
    dilation: "legacy-edge-copy",
    convention: Object.freeze({ transparent: "capture-defined RGBA", origin: "top-left" }),
  }),
  normal: Object.freeze({
    contract: PROCPLANT_IMPOSTOR_CHANNEL_CONTRACT,
    version: PROCPLANT_IMPOSTOR_CHANNEL_VERSION,
    id: "normal",
    pixelFormat: "rgba8",
    colorSpace: "linear",
    alpha: "coverage",
    encoding: "RGB = round(clamp(viewNormal * 0.5 + 0.5) * 255)",
    dilation: "nearest-valid",
    convention: Object.freeze({
      x: "+camera.right",
      y: "+camera.up",
      z: "+plant-to-camera view.outward",
      transparent: "128,128,255,0",
      validNormalLength: 1,
    }),
  }),
  depth: Object.freeze({
    contract: PROCPLANT_IMPOSTOR_CHANNEL_CONTRACT,
    version: PROCPLANT_IMPOSTOR_CHANNEL_VERSION,
    id: "depth",
    pixelFormat: "rgba8",
    colorSpace: "linear",
    alpha: "coverage",
    encoding: "24-bit UNORM in RGB, most-significant byte first",
    dilation: "nearest-valid",
    convention: Object.freeze({
      nearValue: 0,
      farValue: 1,
      nearPlane: "view.projection.maxDepth (camera-facing bound)",
      farPlane: "view.projection.minDepth (rear bound)",
      formula: "(maxDepth - pointDepthAlongOutward) / (maxDepth - minDepth)",
      transparent: "255,255,255,0",
    }),
  }),
});

export interface ProcPlantImpostorSeason {
  id: string;
  label?: string;
}

export interface ProcPlantImpostorChannelCaptureRequest {
  plan: ProcPlantImpostorCapturePlan;
  view: ProcPlantImpostorCaptureView;
  season: ProcPlantImpostorSeason;
  channel: ProcPlantImpostorChannelDefinition;
  width: number;
  height: number;
}

export type ProcPlantImpostorChannelCapture = (
  request: ProcPlantImpostorChannelCaptureRequest,
) => Promise<ProcPlantImpostorRaster>;

export interface ProcPlantImpostorChannelSetOptions extends Omit<ProcPlantImpostorAtlasOptions, "dilate"> {
  seasons?: readonly ProcPlantImpostorSeason[];
  channels?: readonly ProcPlantImpostorChannelId[];
  maxViews?: number;
  maxSeasons?: number;
  maxBytes?: number;
  maxCaptureDimension?: number;
}

export interface ProcPlantImpostorEmbeddedImageMetadata {
  name: string;
  width: number;
  height: number;
  byteLength: number;
  sourcePixelFormat: "RGBA8";
  sourceOrigin: "top-left";
  sourcePayload: "raw";
  glb: {
    requiresEncoding: true;
    recommendedMimeType: "image/png";
    bufferViewAlignment: 4;
  };
  extras: {
    contract: typeof PROCPLANT_IMPOSTOR_CHANNEL_CONTRACT;
    version: typeof PROCPLANT_IMPOSTOR_CHANNEL_VERSION;
    channel: ProcPlantImpostorChannelId;
    seasonId: string;
    contentHash: string;
  };
}

export interface ProcPlantImpostorChannelLayer {
  id: string;
  layerIndex: number;
  seasonId: string;
  channelId: ProcPlantImpostorChannelId;
  channel: ProcPlantImpostorChannelDefinition;
  atlas: ProcPlantImpostorAtlas;
  /** Hash includes channel convention, season, layout, plan metadata, and bytes. */
  contentHash: string;
  /** The untouched version-1 atlas hash; exact for legacy color compatibility. */
  legacyAtlasHash: string;
  embeddedImage: ProcPlantImpostorEmbeddedImageMetadata;
}

export interface ProcPlantImpostorChannelSetAudit {
  captureCalls: number;
  viewCount: number;
  seasonCount: number;
  channelCount: number;
  layerCount: number;
  perChannelViewBytes: number;
  perViewBytes: number;
  perSeasonAtlasBytes: number;
  totalAtlasBytes: number;
  maxBytes: number;
}

export interface ProcPlantImpostorChannelSet {
  contract: typeof PROCPLANT_IMPOSTOR_CHANNEL_SET_CONTRACT;
  version: typeof PROCPLANT_IMPOSTOR_CHANNEL_VERSION;
  plan: ProcPlantImpostorCapturePlan;
  seasons: ProcPlantImpostorSeason[];
  channels: ProcPlantImpostorChannelDefinition[];
  layers: ProcPlantImpostorChannelLayer[];
  viewArray: {
    order: "season-channel-view";
    orderedLayerIds: string[];
    orderedViewIds: string[];
    entries: ProcPlantImpostorChannelViewArrayEntry[];
  };
  contentHash: string;
  audit: ProcPlantImpostorChannelSetAudit;
}

export interface ProcPlantImpostorChannelViewSample {
  channelId: ProcPlantImpostorChannelId;
  layerIndex: number;
  arrayIndex: number;
  layerContentHash: string;
  uv: ProcPlantImpostorAtlasEntry["uv"];
  paddedUv: ProcPlantImpostorAtlasEntry["paddedUv"];
}

export interface ProcPlantImpostorChannelViewArrayEntry {
  arrayIndex: number;
  layerIndex: number;
  viewIndex: number;
  seasonId: string;
  channelId: ProcPlantImpostorChannelId;
  viewId: string;
  uv: ProcPlantImpostorAtlasEntry["uv"];
  paddedUv: ProcPlantImpostorAtlasEntry["paddedUv"];
}

export interface ProcPlantImpostorChannelViewSelection {
  seasonId: string;
  viewId: string;
  viewIndex: number;
  score: number;
  samples: ProcPlantImpostorChannelViewSample[];
}

export const PROCPLANT_IMPOSTOR_CHANNEL_HARD_CAPS = Object.freeze({
  views: 256,
  seasons: 8,
  captureDimension: 2048,
  atlasSize: 8192,
  bytes: 512 * 1024 * 1024,
});

const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

export const encodeProcPlantImpostorNormal = (
  normal: ProcPlantImpostorVec3,
  alpha = 255,
): readonly [number, number, number, number] => {
  const length = Math.hypot(normal.x, normal.y, normal.z);
  if (!Number.isFinite(length) || length <= 1e-12) throw new Error("impostor normal must be finite and non-zero");
  if (!Number.isInteger(alpha) || alpha < 0 || alpha > 255) throw new Error("impostor normal alpha must be a byte");
  return [
    Math.round((normal.x / length * 0.5 + 0.5) * 255),
    Math.round((normal.y / length * 0.5 + 0.5) * 255),
    Math.round((normal.z / length * 0.5 + 0.5) * 255),
    alpha,
  ];
};

export const decodeProcPlantImpostorNormal = (rgba: ArrayLike<number>): ProcPlantImpostorVec3 => {
  if (rgba.length < 3) throw new Error("encoded impostor normal requires RGB bytes");
  const x = finiteByte(rgba[0], "normal R") / 255 * 2 - 1;
  const y = finiteByte(rgba[1], "normal G") / 255 * 2 - 1;
  const z = finiteByte(rgba[2], "normal B") / 255 * 2 - 1;
  const length = Math.hypot(x, y, z);
  if (length <= 1e-12) throw new Error("encoded impostor normal is degenerate");
  return { x: x / length, y: y / length, z: z / length };
};

const DEPTH_MAX = 0xffffff;

export const encodeProcPlantImpostorLinearDepth = (
  normalizedDepth: number,
  alpha = 255,
): readonly [number, number, number, number] => {
  if (!Number.isFinite(normalizedDepth) || normalizedDepth < 0 || normalizedDepth > 1) {
    throw new Error("normalized impostor depth must be finite in [0, 1]");
  }
  if (!Number.isInteger(alpha) || alpha < 0 || alpha > 255) throw new Error("impostor depth alpha must be a byte");
  const encoded = Math.round(normalizedDepth * DEPTH_MAX);
  return [(encoded >>> 16) & 0xff, (encoded >>> 8) & 0xff, encoded & 0xff, alpha];
};

export const decodeProcPlantImpostorLinearDepth = (rgba: ArrayLike<number>) => {
  if (rgba.length < 3) throw new Error("encoded impostor depth requires RGB bytes");
  const encoded = (finiteByte(rgba[0], "depth R") << 16) |
    (finiteByte(rgba[1], "depth G") << 8) |
    finiteByte(rgba[2], "depth B");
  return encoded / DEPTH_MAX;
};

export const normalizeProcPlantImpostorViewDepth = (
  view: ProcPlantImpostorCaptureView,
  pointDepthAlongOutward: number,
) => {
  if (!Number.isFinite(pointDepthAlongOutward)) throw new Error("impostor point depth must be finite");
  const range = view.projection.maxDepth - view.projection.minDepth;
  if (!Number.isFinite(range) || range <= 1e-12) throw new Error("impostor view depth range must be positive");
  return clampUnit((view.projection.maxDepth - pointDepthAlongOutward) / range);
};

export const denormalizeProcPlantImpostorViewDepth = (
  view: ProcPlantImpostorCaptureView,
  normalizedDepth: number,
) => {
  if (!Number.isFinite(normalizedDepth) || normalizedDepth < 0 || normalizedDepth > 1) {
    throw new Error("normalized impostor depth must be finite in [0, 1]");
  }
  return view.projection.maxDepth - normalizedDepth * (view.projection.maxDepth - view.projection.minDepth);
};

const finiteByte = (value: number | undefined, label: string) => {
  if (!Number.isInteger(value) || value! < 0 || value! > 255) throw new Error(`${label} must be a byte`);
  return value!;
};

const validateRaster = (raster: ProcPlantImpostorRaster, label: string) => {
  if (!Number.isInteger(raster.width) || !Number.isInteger(raster.height) || raster.width <= 0 || raster.height <= 0) {
    throw new Error(`${label} dimensions must be positive integers`);
  }
  if (raster.rgba.length !== raster.width * raster.height * 4) throw new Error(`${label} has invalid RGBA length`);
};

export const canonicalizeProcPlantImpostorChannelRaster = (
  raster: ProcPlantImpostorRaster,
  channelId: ProcPlantImpostorChannelId,
): ProcPlantImpostorRaster => {
  validateRaster(raster, `impostor ${channelId} raster`);
  if (channelId === "color") return raster;
  const rgba = new Uint8ClampedArray(raster.rgba);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const alpha = rgba[offset + 3]!;
    if (alpha === 0) {
      if (channelId === "normal") rgba.set([128, 128, 255, 0], offset);
      else rgba.set([255, 255, 255, 0], offset);
      continue;
    }
    if (channelId === "normal") {
      rgba.set(encodeProcPlantImpostorNormal(decodeProcPlantImpostorNormal(rgba.subarray(offset, offset + 4)), alpha), offset);
    } else {
      rgba.set(encodeProcPlantImpostorLinearDepth(decodeProcPlantImpostorLinearDepth(rgba.subarray(offset, offset + 4)), alpha), offset);
    }
  }
  return { id: raster.id, width: raster.width, height: raster.height, rgba };
};

/** Fill only the gutter from the nearest alpha-valid texel using deterministic Manhattan distance. */
export const dilateProcPlantImpostorNearestValidRaster = (
  raster: ProcPlantImpostorRaster,
  padding: number,
): Required<ProcPlantImpostorRaster> => {
  validateRaster(raster, "impostor nearest-valid raster");
  if (!Number.isInteger(padding) || padding < 0) throw new Error("impostor raster padding must be a non-negative integer");
  const width = raster.width + padding * 2;
  const height = raster.height + padding * 2;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const owners = new Int32Array(width * height);
  owners.fill(-1);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      const sourcePixel = y * raster.width + x;
      const targetPixel = (y + padding) * width + x + padding;
      const sourceOffset = sourcePixel * 4;
      const targetOffset = targetPixel * 4;
      rgba[targetOffset] = raster.rgba[sourceOffset]!;
      rgba[targetOffset + 1] = raster.rgba[sourceOffset + 1]!;
      rgba[targetOffset + 2] = raster.rgba[sourceOffset + 2]!;
      rgba[targetOffset + 3] = raster.rgba[sourceOffset + 3]!;
      if (raster.rgba[sourcePixel * 4 + 3]! > 0) {
        owners[targetPixel] = sourcePixel;
        queue[tail++] = targetPixel;
      }
    }
  }
  const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  while (head < tail) {
    const pixel = queue[head++]!;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    for (const [dx, dy] of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const neighbor = ny * width + nx;
      if (owners[neighbor] !== -1) continue;
      owners[neighbor] = owners[pixel]!;
      queue[tail++] = neighbor;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = x >= padding && x < padding + raster.width && y >= padding && y < padding + raster.height;
      if (inside) continue;
      const owner = owners[y * width + x]!;
      // An entirely transparent capture uses its canonical first texel as the
      // gutter sentinel. Otherwise every gutter texel comes from a valid texel.
      const sourceOffset = (owner >= 0 ? owner : 0) * 4;
      const targetOffset = (y * width + x) * 4;
      rgba[targetOffset] = raster.rgba[sourceOffset]!;
      rgba[targetOffset + 1] = raster.rgba[sourceOffset + 1]!;
      rgba[targetOffset + 2] = raster.rgba[sourceOffset + 2]!;
      rgba[targetOffset + 3] = raster.rgba[sourceOffset + 3]!;
    }
  }
  return { id: raster.id ?? "", width, height, rgba };
};

const hashBytes = (bytes: Uint8Array, seed = 0x811c9dc5) => {
  let hash = seed >>> 0;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

const hashLayer = (
  plan: ProcPlantImpostorCapturePlan,
  season: ProcPlantImpostorSeason,
  channel: ProcPlantImpostorChannelDefinition,
  atlas: ProcPlantImpostorAtlas,
) => {
  const metadata = new TextEncoder().encode(JSON.stringify({
    contract: PROCPLANT_IMPOSTOR_CHANNEL_SET_CONTRACT,
    version: PROCPLANT_IMPOSTOR_CHANNEL_VERSION,
    season,
    channel,
    atlas: { width: atlas.width, height: atlas.height, padding: atlas.padding, entries: atlas.entries.map((entry) => ({ id: entry.id, x: entry.x, y: entry.y, uv: entry.uv, paddedUv: entry.paddedUv })) },
    depthRanges: channel.id === "depth" ? plan.views.map((view) => ({ id: view.id, minDepth: view.projection.minDepth, maxDepth: view.projection.maxDepth })) : undefined,
  }));
  const metadataHash = hashBytes(metadata);
  const final = hashBytes(new Uint8Array(atlas.rgba.buffer, atlas.rgba.byteOffset, atlas.rgba.byteLength), metadataHash);
  return `fnv1a32-${final.toString(16).padStart(8, "0")}`;
};

const canonicalSeasons = (input: readonly ProcPlantImpostorSeason[] | undefined, maximum: number) => {
  if (input && input.length === 0) throw new Error("impostor seasons must not be empty");
  const seasons = (input ?? [{ id: "default", label: "Default" }]).map((season, index) => {
    if (!season.id.trim() || season.id.length > 64) throw new Error(`impostor season ${index} id must contain 1-64 characters`);
    if (season.label !== undefined && season.label.length > 128) throw new Error(`${season.id} label must contain at most 128 characters`);
    return { id: season.id, ...(season.label === undefined ? {} : { label: season.label }) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (seasons.length > maximum) throw new Error(`impostor season count exceeds maxSeasons (${maximum})`);
  for (let index = 1; index < seasons.length; index++) {
    if (seasons[index]!.id === seasons[index - 1]!.id) throw new Error(`duplicate impostor season id: ${seasons[index]!.id}`);
  }
  return seasons;
};

const canonicalChannels = (input: readonly ProcPlantImpostorChannelId[] | undefined) => {
  if (input && input.length === 0) throw new Error("impostor channels must not be empty");
  const requested = input ? [...input] : ["color", "normal", "depth"] as ProcPlantImpostorChannelId[];
  if (new Set(requested).size !== requested.length) throw new Error("impostor channels must be unique");
  for (const id of requested) if (!PROCPLANT_IMPOSTOR_CHANNELS[id]) throw new Error(`unsupported impostor channel: ${String(id)}`);
  return (["color", "normal", "depth"] as const).filter((id) => requested.includes(id));
};

const capped = (value: number, label: string, hardCap: number, minimum = 1) => {
  if (!Number.isInteger(value) || value < minimum || value > hardCap) throw new Error(`${label} must be an integer in [${minimum}, ${hardCap}]`);
  return value;
};

const alignedLayout = (reference: ProcPlantImpostorAtlas, candidate: ProcPlantImpostorAtlas) =>
  reference.width === candidate.width && reference.height === candidate.height && reference.padding === candidate.padding &&
  reference.entries.length === candidate.entries.length && reference.entries.every((entry, index) => {
    const other = candidate.entries[index];
    return other?.id === entry.id && other.x === entry.x && other.y === entry.y &&
      JSON.stringify(other.uv) === JSON.stringify(entry.uv) && JSON.stringify(other.paddedUv) === JSON.stringify(entry.paddedUv);
  });

export const buildProcPlantImpostorChannelSet = async (
  plan: ProcPlantImpostorCapturePlan,
  capture: ProcPlantImpostorChannelCapture,
  options: ProcPlantImpostorChannelSetOptions = {},
): Promise<ProcPlantImpostorChannelSet> => {
  const maxViews = capped(options.maxViews ?? PROCPLANT_IMPOSTOR_CHANNEL_HARD_CAPS.views, "impostor maxViews", PROCPLANT_IMPOSTOR_CHANNEL_HARD_CAPS.views);
  const maxSeasons = capped(options.maxSeasons ?? PROCPLANT_IMPOSTOR_CHANNEL_HARD_CAPS.seasons, "impostor maxSeasons", PROCPLANT_IMPOSTOR_CHANNEL_HARD_CAPS.seasons);
  const maxCaptureDimension = capped(options.maxCaptureDimension ?? 1024, "impostor maxCaptureDimension", PROCPLANT_IMPOSTOR_CHANNEL_HARD_CAPS.captureDimension);
  const maxBytes = capped(options.maxBytes ?? 128 * 1024 * 1024, "impostor maxBytes", PROCPLANT_IMPOSTOR_CHANNEL_HARD_CAPS.bytes);
  if (plan.views.length > maxViews) throw new Error(`impostor view count exceeds maxViews (${maxViews})`);
  if (plan.width > maxCaptureDimension || plan.height > maxCaptureDimension) throw new Error(`impostor capture dimensions exceed maxCaptureDimension (${maxCaptureDimension})`);
  const seasons = canonicalSeasons(options.seasons, maxSeasons);
  const channelIds = canonicalChannels(options.channels);
  const channels = channelIds.map((id) => PROCPLANT_IMPOSTOR_CHANNELS[id]);
  const maxSize = capped(options.maxSize ?? 4096, "impostor maxSize", PROCPLANT_IMPOSTOR_CHANNEL_HARD_CAPS.atlasSize);
  const atlasOptions: ProcPlantImpostorAtlasOptions = {
    padding: options.padding,
    width: options.width,
    powerOfTwo: options.powerOfTwo,
    maxSize,
    signal: options.signal,
  };
  const layout = createProcPlantImpostorAtlasLayout(plan, atlasOptions);
  const layerCount = seasons.length * channels.length;
  const atlasBytes = layout.width * layout.height * 4;
  const totalAtlasBytes = atlasBytes * layerCount;
  const captureBytes = plan.width * plan.height * 4 * plan.views.length * layerCount;
  if (!Number.isSafeInteger(totalAtlasBytes) || totalAtlasBytes > maxBytes) throw new Error(`impostor atlas bytes exceed maxBytes (${maxBytes})`);
  if (!Number.isSafeInteger(captureBytes) || captureBytes > maxBytes) throw new Error(`impostor capture work bytes exceed maxBytes (${maxBytes})`);

  const layers: ProcPlantImpostorChannelLayer[] = [];
  let referenceAtlas: ProcPlantImpostorAtlas | null = null;
  let captureCalls = 0;
  for (const season of seasons) {
    for (const channel of channels) {
      if (options.signal?.aborted) throw new DOMException("Impostor channel capture aborted", "AbortError");
      const atlas = await buildProcPlantImpostorAtlas(plan, async ({ view, width, height }) => {
        if (options.signal?.aborted) throw new DOMException("Impostor channel capture aborted", "AbortError");
        captureCalls++;
        const raster = await capture({ plan, view, season: { ...season }, channel, width, height });
        if (options.signal?.aborted) throw new DOMException("Impostor channel capture aborted", "AbortError");
        return canonicalizeProcPlantImpostorChannelRaster(raster, channel.id);
      }, {
        ...atlasOptions,
        dilate: channel.dilation === "nearest-valid" ? dilateProcPlantImpostorNearestValidRaster : undefined,
      });
      if (referenceAtlas && !alignedLayout(referenceAtlas, atlas)) throw new Error(`impostor layer layout drifted for ${season.id}/${channel.id}`);
      referenceAtlas ??= atlas;
      const contentHash = hashLayer(plan, season, channel, atlas);
      const layerIndex = layers.length;
      const id = `${season.id}:${channel.id}`;
      layers.push({
        id,
        layerIndex,
        seasonId: season.id,
        channelId: channel.id,
        channel,
        atlas,
        contentHash,
        legacyAtlasHash: atlas.contentHash,
        embeddedImage: {
          name: `procplant-impostor-${season.id}-${channel.id}`,
          width: atlas.width,
          height: atlas.height,
          byteLength: atlas.rgba.byteLength,
          sourcePixelFormat: "RGBA8",
          sourceOrigin: "top-left",
          sourcePayload: "raw",
          glb: { requiresEncoding: true, recommendedMimeType: "image/png", bufferViewAlignment: 4 },
          extras: {
            contract: PROCPLANT_IMPOSTOR_CHANNEL_CONTRACT,
            version: PROCPLANT_IMPOSTOR_CHANNEL_VERSION,
            channel: channel.id,
            seasonId: season.id,
            contentHash,
          },
        },
      });
    }
  }
  const setMetadata = new TextEncoder().encode(JSON.stringify({
    contract: PROCPLANT_IMPOSTOR_CHANNEL_SET_CONTRACT,
    version: PROCPLANT_IMPOSTOR_CHANNEL_VERSION,
    plan: { width: plan.width, height: plan.height, views: plan.views.map((view) => ({ id: view.id, projection: view.projection })) },
    seasons,
    channels,
    layers: layers.map((layer) => ({ id: layer.id, layerIndex: layer.layerIndex, contentHash: layer.contentHash })),
  }));
  let setHash = hashBytes(setMetadata);
  for (const layer of layers) setHash = hashBytes(new TextEncoder().encode(layer.contentHash), setHash);
  return {
    contract: PROCPLANT_IMPOSTOR_CHANNEL_SET_CONTRACT,
    version: PROCPLANT_IMPOSTOR_CHANNEL_VERSION,
    plan,
    seasons,
    channels,
    layers,
    viewArray: {
      order: "season-channel-view",
      orderedLayerIds: layers.map((layer) => layer.id),
      orderedViewIds: plan.views.map((view) => view.id),
      entries: layers.flatMap((layer) => layer.atlas.entries.map((entry): ProcPlantImpostorChannelViewArrayEntry => ({
        arrayIndex: layer.layerIndex * plan.views.length + entry.index,
        layerIndex: layer.layerIndex,
        viewIndex: entry.index,
        seasonId: layer.seasonId,
        channelId: layer.channelId,
        viewId: entry.id,
        uv: { ...entry.uv },
        paddedUv: { ...entry.paddedUv },
      }))),
    },
    contentHash: `fnv1a32-${setHash.toString(16).padStart(8, "0")}`,
    audit: {
      captureCalls,
      viewCount: plan.views.length,
      seasonCount: seasons.length,
      channelCount: channels.length,
      layerCount,
      perChannelViewBytes: plan.width * plan.height * 4,
      perViewBytes: plan.width * plan.height * 4 * channels.length,
      perSeasonAtlasBytes: atlasBytes * channels.length,
      totalAtlasBytes,
      maxBytes,
    },
  };
};

export const selectProcPlantImpostorChannelView = (
  channelSet: ProcPlantImpostorChannelSet,
  seasonId: string,
  plantToCamera: ProcPlantImpostorVec3,
): ProcPlantImpostorChannelViewSelection => {
  const seasonLayers = channelSet.layers.filter((layer) => layer.seasonId === seasonId)
    .sort((a, b) => a.layerIndex - b.layerIndex);
  if (seasonLayers.length !== channelSet.channels.length) throw new Error(`impostor season not found or incomplete: ${seasonId}`);
  const selected = selectProcPlantImpostorView(seasonLayers[0]!.atlas, plantToCamera);
  const samples = seasonLayers.map((layer): ProcPlantImpostorChannelViewSample => {
    const entry = layer.atlas.entries[selected.entry.index];
    if (!entry || entry.id !== selected.entry.id) throw new Error(`impostor channel view alignment failed for ${layer.id}`);
    return {
      channelId: layer.channelId,
      layerIndex: layer.layerIndex,
      arrayIndex: layer.layerIndex * channelSet.plan.views.length + selected.entry.index,
      layerContentHash: layer.contentHash,
      uv: { ...entry.uv },
      paddedUv: { ...entry.paddedUv },
    };
  });
  return {
    seasonId,
    viewId: selected.entry.id,
    viewIndex: selected.entry.index,
    score: selected.score,
    samples,
  };
};
