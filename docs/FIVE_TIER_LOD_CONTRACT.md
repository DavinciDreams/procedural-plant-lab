# Opt-in five-tier LOD contract

Updated: 2026-08-10

`procplant-five-tier-lod.ts` implements the PRD's distinct five-stage stack
without changing the established four-tier compiler or Tellus contract-v3
packages:

| Tier | Representation | Phi Fern seed 612072 |
| --- | --- | ---: |
| LOD0 | Full procedural geometry | 352 triangles / 704 vertices |
| LOD1 | Independently rebuilt reduced geometry | 264 / 528 |
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

The direct low-level path still accepts a caller-baked atlas. The asset-build
path makes that bake reproducible and cacheable:

1. Create `createProcPlantFiveTierAtlasBuildManifest(...)`, or run
   `procplants lod5-atlas-plan ...`. The versioned manifest binds the exact
   genome ID, seed, LOD0 template hash, canonical capture cameras, bounded atlas
   layout, renderer/material policy, and a deterministic cache key.
2. In a browser or other environment with a real caller-owned Three
   `WebGLRenderer`, call `captureProcPlantFiveTierAtlasAsset(...)`. Procplants
   renders the exact LOD0 vertex-color geometry to a WebGL render target and
   reads back the real pixels. Headless Node deliberately produces only the
   build manifest; it does not pretend to own WebGL.
3. Persist the bounded asset with `serializeProcPlantFiveTierAtlasAsset` and
   restore it with `parseProcPlantFiveTierAtlasAsset`. The loader reconstructs
   the canonical layout and fails closed on resource limits, stale cache keys,
   changed plans, pixel-length errors, or pixel/content-hash mismatches.
4. Compile with `compileProcPlantFiveTierLodsFromAtlasAsset`, or run
   `procplants lod5-glb ...` against the captured asset. Select tiers with
   `selectProcPlantFiveTierLod`.

## Opt-in catalog batches

`createProcPlantFiveTierAtlasCatalogPlan(...)` accepts an explicit list of
preset/genome plus seed sources. It sorts canonical source slots and embeds the
exact source manifest cache key for every entry, plus a deterministic aggregate
catalog key and decoded-RGBA budget. A changed seed, LOD0 source hash, capture
plan, material policy, or atlas limit therefore changes that entry's key.

`runProcPlantFiveTierAtlasCatalog(...)` is an explicit standalone/library
operation. It requires caller-provided cache, capture, and adoption adapters;
reports bounded progress; supports `AbortSignal`; caps active work at eight and
decoded atlas bytes in flight at 512 MiB hard maxima; and streams each validated
v2 package through the adoption callback. Exact cache hits skip capture.
Wrong-key, corrupt, oversized, source-stale, or otherwise invalid records are
deleted before recapture; a failed delete or cache write is an entry failure
rather than a silent adoption.

`createProcPlantFiveTierAtlasWebGlCapturePool(...)` safely leases one of up to
eight unique caller-owned Three `WebGLRenderer` instances. Each renderer has at
most one active capture. The pool propagates cancellation between view
readbacks and releases its own references on `dispose()`, but deliberately does
not dispose caller renderers. `createProcPlantFiveTierAtlasMemoryCache(...)`
provides bounded session storage with explicit `clear()`/`dispose()`;
IndexedDB, filesystem, or service storage is still supplied by the caller.

The catalog module is exported from the full package only. Importing core or
starting the demo does not create a cache, renderer, capture job, or catalog
plan.

Compilation fails closed when the bake is absent, bound to another genome or
seed, stale for the current LOD0 geometry hash, malformed, has more than 256
views, or exceeds the caller's atlas-size ceiling. It never relabels a plain
card as a baked billboard.

Build manifests cap capture dimensions at 2,048 pixels, views at 64, atlas
dimensions at 8,192 pixels, and decoded RGBA at 256 MiB; callers may set lower
ceilings. The default 128px, 8-azimuth, 2-elevation plan produces 16 views. The
serialized asset contains RGBA8 pixels rather than an opaque GPU handle, so it
is portable across the library and CLI and can be re-hashed before adoption.

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
When the package came from a persisted atlas asset, the asset and build
contract versions plus cache key are included in ordinary root `extras`.

`npm run test:lod5` freezes costs, geometry/atlas hashes, source binding,
hysteresis, failure cases, deterministic GLB bytes, strict GLB validation, embedded image presence,
and preservation of default version-1 output. `npm run test:lod5-browser`
runs the manifest -> real WebGL capture -> serialize -> parse -> v2 compile ->
GLB export pipeline, renders the restored crossed and billboard tiers in real
Chrome WebGL 2 through SwiftShader, and re-imports the export through Three's
GLTFLoader.
This is shader/render-path correctness, not representative-device FPS.

`npm run test:lod5-catalog` proves deterministic ordering, exact per-source
keys, two-entry bounded concurrency, cache hits, source-stale regeneration,
cancellation, and bounded cache eviction. `npm run test:lod5-catalog-browser`
captures Phi Fern and Clover through real Chrome WebGL, reuses both cache
entries, regenerates a changed fern, adopts and renders LOD3/LOD4, exports and
re-imports five-scene GLBs, and checks capture/cache/pool cleanup. It is again a
correctness and resource-lifecycle proof, not an FPS or capacity benchmark.

Tellus has not adopted this opt-in version-2 stack. Tellus remains responsible
for field placement, render pressure, shadows, camera-facing transforms, and
controlled representative-device WebGL acceptance.
Tellus continues to default to WebGL because that path is faster there. This
standalone asset pipeline neither enables distant per-plant geometry in Tellus
nor exercises Procplants' separate WebGPU experiments.
