# Hero bark region extraction

`src/procplant-hero-bark-extraction.ts` is a renderer-independent V1 authoring
contract for deriving repeatable bark resources from one bounded imported hero
mesh region. It does not reconstruct a scan or claim photogrammetry quality.

## Supported inputs

The caller selects exactly one primitive through existing hero-GLB provenance,
then chooses either:

- a finite UV rectangle over the primitive's imported UV0; or
- a normalized band of a matching `ProcPlantHeroSpineAuthoringPackage`. The
  band uses the fitted spine's deterministic cylindrical bark UVs.

For texture-derived output, the caller also supplies decoded top-left-origin
RGBA8 pixels. The raster must name an imported PNG image, match its content
hash, and be the selected primitive material's base-color binding. V1 does not
silently decode JPEG, WebP, KTX2, or even PNG: image decoding remains an
explicit host responsibility. This keeps the contract renderer-independent and
makes the decoded bytes auditable.

When decoded pixels are omitted, the API creates a deterministic bark-colored
surrogate and labels it `procedural-surrogate`. That path is useful for filling
a material slot but is not described as scanned output.

## Output and quality boundary

`extractProcPlantHeroBark()` emits owned RGBA arrays plus deterministic PNGs
for base color, luminance-derived height, and a periodic normal map. Opposite
tile boundaries are made byte-identical. The audit records pre/post seam delta,
triangle and raster work, selected-surface coverage, output bytes, provenance,
and the exact quality label.

The derived height and normal maps are appearance aids. They are not metric
displacement, captured surface normals, or recovered photogrammetry detail.
V1 processes one primitive/material binding and does not provide layer blends,
cross-junction texture continuity, fungus/knot/decal authoring, or scanned
geometry reconstruction.

`createProcPlantHeroBarkMaterialPixelSources()` returns independent base-color
and normal pixel sources compatible with the existing material graph/baker. The
height PNG remains available to exporters or host material systems that own a
displacement contract.

## Caps and failure behavior

The default operation is capped at a 256x256 output, 250,000 input triangles,
8,000,000 conservative raster work items, 32 MiB of decoded source pixels, and
64 MiB of combined RGBA/PNG output. Hard caps prevent callers from expanding
those limits without bound. Missing UVs, invalid topology, empty/low-coverage
regions, mismatched image/material/provenance records, unsupported codecs, and
work/output overruns fail before a package is released. Inputs are read-only;
the output shares no mutable arrays with the imported package or decoded raster.

The focused deterministic regression is:

```powershell
npm run test:hero-bark-extraction
```

It covers true decoded-PNG-derived UV output, a fitted-spine band, seam audits,
material-pixel adaptation, procedural-surrogate labeling, source nonmutation,
and fail-closed boundaries.
