# Placement decal GLB adoption

The placement decal exporter is an explicit evidence-bound path. It accepts the
same version-1 material/texture/UV0 binding used by the live renderer together
with the original PNG, WebP, or JPEG bytes and browser-decoded RGBA8 pixels.
It records SHA-256 hashes for the source bytes, decoded pixels, and deterministic
PNG payload. Every hash and byte array is revalidated at export time.

The exported GLB uses only glTF 2.0 core resources:

- one embedded `image/png` produced deterministically from the decoded pixels;
- one clamped linear sampler and one base-color texture;
- one double-sided metallic-roughness material with the authored alpha cutoff;
- one separate `TEXCOORD_0` primitive per decal, each fixed at four vertices and
  two triangles.

WebP and JPEG inputs are not mislabeled or attached through invented
extensions. Their decoded pixels are re-encoded as the same deterministic core
PNG used by the export. Source MIME type, dimensions, file name, hashes,
binding identity, UV rectangle, operation IDs, and node names are retained in
standard `extras`.

Export stops before material adoption if the active binding is absent, any
decal references another material or texture, source/pixel/PNG bytes differ
from their hashes, a prepared draw is missing from the base GLB, UV0 is absent,
or the primitive is no longer exactly four vertices and six indices. Imported
hero GLBs remain outside this bounded path because no target surface is guessed.
