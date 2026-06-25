# Tellus Handoff: Procplants LOD, Biomes, and Evolution

Date: 2026-06-25

This handoff describes how to wire the standalone Procplants generator into
Tellus without making Tellus more monolithic. The goal is a deterministic,
chunk-aware biome system that can evolve over time, stream with terrain chunks,
and render dense foliage with instancing, LOD, and later impostors.

## Current State

Procplants now provides:

- reusable plant genomes and `hybridizePlantGenomes(...)`;
- deterministic graph generation from `genome + seed + environment`;
- `buildProcPlantInstancedParts(...)`, which separates stems from instanced
  leaves, grass blades, petals, palms, conifer sprays, daylily/foxglove
  impostors, poppy discs, and flower centers;
- geometry factories for each instanced organ kind;
- environment controls for light, moisture, crowding, biome warmth, and density;
- a stable demo/export surface for saving good seeds.

Tellus already has useful seams:

- `src/tellus-vegetation.ts`
  - chunk-streamed vegetation around the player;
  - sector-level trees;
  - `sampleHeight`, `samplePaint`, `bounds`, `notifyTerrainChanged()`, and
    `stats()` hooks;
  - quality tiers tied to FPS.
- `src/tellus-chunk-renderer.ts`
  - chunk terrain LOD via `lodSegments`;
  - `sampleHeight(...)` and `samplePaint(...)`;
  - chunk skirt seam fix through `CHUNK_SKIRT_DEPTH`;
  - load radius and active chunk stats.
- `src/main.tsx`
  - already constructs vegetation from terrain providers and chunked bounds;
  - exposes `window.__tellusPerf()` with vegetation stats.

Important local note: Tellus currently has an untracked
`src/tellus-procplants.ts`. Treat it as exploratory/stale unless reviewed
against the current Procplants source. The Procplants repo should be source of
truth for now.

## Design Target

Tellus should treat Procplants as a procedural biome renderer, not as persistent
per-plant object state.

Persist only compact biome/evolution inputs:

```ts
type ProcPlantBiomePatch = {
  version: 1;
  seed: number;
  primary: string;
  secondary?: string;
  hybrid: number;
  density: number;
  environment: {
    light: number;
    moisture: number;
    crowding: number;
    biomeWarmth: number;
  };
  evolution?: {
    generation: number;
    parentPatchIds?: string[];
    mutationRate: number;
    lastTick?: number;
  };
};
```

Derive every rendered plant from:

```text
worldId + chunk coords + terrain paint + terrain revision + biome patch seed
```

Do not store individual plant transforms in world state unless a player
explicitly places or harvests a special plant.

## Chunk Integration

Add a Procplants layer beside, or inside, `createVegetation(...)`.

Recommended shape:

```ts
createProcPlantVegetation({
  scene,
  useWebGPU,
  sampleHeight,
  samplePaint,
  bounds,
  chunkSize: 12,          // can match existing vegetation CHUNK first
  sectorSize: 72,         // can match existing tree sectors
  getBiomePatch(x, z),
  getTerrainRevision(x, z),
});
```

For the first Tellus pass, reuse the existing vegetation update lifecycle:

- call from the same `vegetation.update(px, pz, playerY, fps, nowMs)` path;
- use the existing active chunk bounds from chunked worlds;
- rebuild affected procplant chunks from `notifyTerrainChanged()`;
- route paint kinds into biome defaults:
  - `meadow`, `flowers`: meadow/daylily/foxglove/lace/vinca pools;
  - `grass`: grass/reed/clover pools;
  - `beach`: palm/reed/sparse grass pools;
  - `dirt`: shrub/vinca/rose/desert transition pools;
  - `snow`: conifer/sparse grass pools;
  - `rock`, `stone`, `brick`: sparse succulents/moss/low density.

Start with chunk-local generation. Add cross-chunk spread later.

## Rendering Plan

Use the instanced output path for the world layer:

```ts
const built = buildProcPlantInstancedParts(genome, seed, env);
```

Cache shared geometry by instance kind and leaf parameters:

```text
leaf: shape + widthRatio + serration + curl
grassBlade: widthRatio + curl
petal / flowerDisc / flowerCenter / daylilyBloom / foxgloveBloom
coniferSpray / palmFrond
```

Recommended draw grouping:

- one merged stem buffer per active procplant chunk;
- one `InstancedMesh` per `(kind, geometryKey, materialKey)` per active chunk
  or per sector;
- one shared wind/sway material for organs, matching current Tellus vegetation
  material conventions;
- one shared stem material with vertex colors.

Do not create a `THREE.Group` per plant in Tellus. The standalone demo does
that for inspection, but Tellus needs chunk-level buffers.

## LOD Tiers

Use camera/player distance and active chunk ring. A practical first set:

| Tier | Range | Geometry | Update |
|---|---:|---|---|
| LOD0 | near, within 24-36 m | full instanced procplants | rebuild on terrain/biome dirty |
| LOD1 | mid, 36-72 m | fewer plants, no small flowers, simplified stems | rebuild less often |
| LOD2 | far, 72-140 m | color-tinted grass/flower cards or merged low-count impostor clusters | no wind or slow wind |
| LOD3 | very far | biome tint/ground texture only | no plant geometry |

Tie LOD to chunk rings:

- ring 0-1: LOD0
- ring 2: LOD1
- ring 3+: LOD2 or off, depending FPS tier

This mirrors the chunk terrain idea in `tellus-chunk-renderer.ts`, where nearby
chunks use full segments and far chunks use reduced segments. The terrain skirt
fix means vegetation should not try to cover chunk seams; let chunk terrain own
seams.

## Impostors

Procplants already has botanical impostor ideas baked into geometry:

- poppy as folded red disc + center;
- daylily as star + underside triangle;
- foxglove as down-hanging triangular bell + lip;
- conifer and palm as folded cluster/frond sheets rather than individual needles.

Next Tellus impostor step:

1. Add a chunk-level `BiomeImpostorMesh` for LOD2.
2. Use one vertical or terrain-aligned card per 2-4 meter cell.
3. Color the card from the dominant local genome and paint kind.
4. Use alpha/dither or simple cutout shapes only if needed; avoid texture work
   until the geometry LOD path is stable.

Later, render-to-texture impostor atlases can be generated per biome patch, but
that is not necessary for the first integration.

## Evolution Model

Keep evolution patch-local and deterministic:

```ts
function evolveBiomePatch(parent: ProcPlantBiomePatch, inputs: {
  lightDelta: number;
  moistureDelta: number;
  crowdingDelta: number;
  terrainPaintMix: Record<string, number>;
  neighborSeeds: number[];
  eventSeed: number;
}): ProcPlantBiomePatch
```

Rules:

- interbreed by calling `hybridizePlantGenomes(primary, secondary, hybrid, seed)`;
- mutate environment and density before mutating plant structure;
- keep mutation rates small per tick;
- propagate to neighboring chunks only when density or maturity passes a
  threshold;
- store only changed biome patch records, not regenerated plants.

Possible local evolution triggers:

- terrain paint changes;
- sculpted height/slope changes;
- water/pond proximity;
- shade from placed trees/buildings;
- player actions: seed, clear, burn, harvest, fertilize;
- world time tick.

## Tellus File Plan

Suggested files:

- `src/tellus-procplants.ts`
  - vendored or adapted Procplants generator core;
  - should be refreshed from this repo before implementation.
- `src/tellus-procplant-vegetation.ts`
  - chunk/sector manager, caches, LOD selection, rebuild queues.
- `src/tellus-procplant-biomes.ts`
  - mapping from terrain paint + world template + biome patch to genomes/env.
- `src/tellus-procplant-evolution.ts`
  - patch mutation/interbreeding functions.
- `src/tellus-procplant-materials.ts`
  - shared organ/stem materials and wind uniforms.

Avoid putting this all into `main.tsx`. The Tellus main file should only
construct and update the system, similar to the current `createVegetation(...)`
call.

## Backend / Hyades Shape

For Hyades/Gnostr world state, biome patches can be chunk metadata or a
separate grain keyed by world/chunk:

```text
world/{worldId}/biomes/{cx},{cz}
```

Patch payload should be small and mergeable:

```json
{
  "type": "biome.patch",
  "worldId": "chunked-64-main",
  "chunkX": 8,
  "chunkZ": 8,
  "patch": {
    "version": 1,
    "seed": 12345,
    "primary": "foxgloveSpike",
    "secondary": "phiFern",
    "hybrid": 0.2,
    "density": 0.45,
    "environment": {
      "light": 0.72,
      "moisture": 0.5,
      "crowding": 0.77,
      "biomeWarmth": 0.7
    }
  }
}
```

Do not block first frontend integration on backend persistence. Start with
deterministic patches derived from terrain paint and chunk coordinates, then
persist edits/evolution once the renderer is stable.

## First Implementation Pass

1. Refresh `src/tellus-procplants.ts` from current Procplants.
2. Add `createProcPlantVegetation(...)` as a sibling to existing vegetation.
3. Gate it behind a runtime/localStorage flag:

```text
tellus.procplants = "1"
```

4. Render only chunk-local LOD0/LOD1 first.
5. Use paint-based biome defaults, no backend persistence.
6. Add `window.__tellusPerf().procplants` stats:

```ts
{
  chunks: number;
  plants: number;
  instances: number;
  stemTriangles: number;
  organDraws: number;
  lod0: number;
  lod1: number;
  lod2: number;
}
```

7. Validate in a chunked world while moving across chunk boundaries.
8. Only then add evolution patches.

## Validation Checklist

- `npm run typecheck` or `npx tsc --noEmit`
- focused tests for deterministic chunk seeds:
  - same world/chunk/paint/revision produces same instance counts;
  - different chunk coords produce different scatter;
  - terrain paint changes choose different biome defaults.
- browser smoke in a chunked world:
  - no visible chunk seam dependence;
  - no plant popping inside the near ring;
  - vegetation updates after sculpt/paint;
  - `window.__tellusPerf()` stays stable while crossing chunk boundaries.
- FPS check:
  - use Tellus quality tiering;
  - verify LOD drops density before dropping all nearby vegetation.

## Risks / Watchouts

- The current Tellus worktree has unrelated local changes; avoid mixing this
  integration into texture/interior work.
- The existing untracked `src/tellus-procplants.ts` may not include recent
  Procplants kinds such as `coniferSpray`, `palmFrond`, `flowerDisc`,
  `daylilyBloom`, and `foxgloveBloom`.
- Instanced visible-side orientation was fixed in Procplants after many flower
  passes. Preserve current matrix/normal conventions when porting.
- Do not serialize individual generated plant meshes into world state.
- Do not use asset-failure "impostor" semantics for biome impostors. These are
  intentional vegetation LODs, not fallbacks for broken generated assets.

## Good Next PR Shape

Title:

```text
Add procplant vegetation adapter behind feature flag
```

Scope:

- vendored generator refresh;
- `tellus-procplant-vegetation.ts`;
- flag-gated construction in `main.tsx`;
- deterministic chunk seed tests;
- no backend protocol changes yet.

Leave biome persistence/evolution and render-to-texture impostors for follow-up
PRs.
