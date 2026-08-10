# Opt-in five-tier LOD contract

Updated: 2026-08-10

`procplant-five-tier-lod.ts` implements the PRD's distinct five-stage stack
without changing the established four-tier compiler or Tellus contract-v3
packages:

| Tier | Representation | Phi Fern seed 612072 |
| --- | --- | ---: |
| LOD0 | Full procedural geometry | 352 triangles / 1,056 vertices |
| LOD1 | Independently rebuilt reduced geometry | 264 / 792 |
| LOD2 | Procedural clumped/crossed cards | 4 / 8 |
| LOD3 | Baked-atlas crossed tree impostor | 4 / 8 |
| LOD4 | Baked-atlas camera-facing billboard | 2 / 4 |

The equal LOD2/LOD3 triangle count is intentional. LOD2 is a cheap geometric
silhouette with vertex color; LOD3 spends the same four triangles on two
atlas-backed views of the baked tree. LOD4 removes the second card. A capture
plan with more than one elevation is recorded as hemisphere coverage; an
azimuth-only bake remains valid and is labelled as such.

## Opt-in and failure behavior

The default `compileProcPlantLods`, `buildProcPlantRuntimePackage`, GLB extras,
and Tellus package continue to use `procplants.runtime-lod-selection` version
1 with levels 0-3. The five-tier API uses version 2 and is exported only from
the full `procplants` entry.

1. Bake a real `ProcPlantImpostorAtlas` from the exact LOD0 plant.
2. Bind it with `bindProcPlantFiveTierAtlas(atlas, genome, seed, environment)`.
3. Call `compileProcPlantFiveTierLods` with that binding.
4. Select tiers with `selectProcPlantFiveTierLod`.

Compilation fails closed when the bake is absent, bound to another genome or
seed, stale for the current LOD0 geometry hash, malformed, has more than 256
views, or exceeds the caller's atlas-size ceiling. It never relabels a plain
card as a baked billboard.

LOD3/LOD4 templates borrow the atlas UV contract but not its bytes. Runtime
renderers must bind the package atlas, choose the nearest baked view, update UVs
when that view changes, and rotate LOD4 toward the camera. The package borrows
caller-owned atlas bytes and never disposes them.

## Export contract

`exportProcPlantFiveTierLodGlb` writes a deterministic GLB 2.0 containing five
standard glTF scenes (one mesh per tier), the baked PNG atlas, standard
materials/accessors, Procplants sway and tintability attributes, and versioned
scene-selection metadata in ordinary glTF `extras`. LOD0 is the default scene,
so unaware viewers do not draw all tiers on top of one another. Atlas UVs are
converted from the runtime's bottom-left convention to glTF's image convention
during export. No nonexistent Khronos LOD extension is declared; aware
consumers explicitly select the scene mapped to the desired tier.

`npm run test:lod5` freezes costs, geometry/atlas hashes, source binding,
hysteresis, failure cases, deterministic GLB bytes, strict GLB validation, embedded image presence,
and preservation of default version-1 output. `npm run test:lod5-browser`
renders the baked crossed and billboard tiers in real Chrome WebGL 2 through
SwiftShader and re-imports the export through Three's GLTFLoader; the reference
produced two draw calls and 8,957 changed pixels.
This is shader/render-path correctness, not representative-device FPS.

Tellus has not adopted this opt-in version-2 stack. Tellus remains responsible
for field placement, render pressure, shadows, camera-facing transforms, and
controlled representative-device WebGL acceptance.
