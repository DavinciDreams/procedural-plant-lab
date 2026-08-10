# Imported-hero decal targeting

Imported-hero decals are an opt-in lab/library authoring path. They do not
change generated heroes or the Tellus runtime contract.

Each package binds to the imported GLB source hash, selected node/mesh/
primitive/material provenance, the authored-spine content hash, and an exact
signature of the static baked position, normal, and index buffers. Placement
stores the selected triangle's three vertex indices and barycentric coordinate.
Materialization reconstructs a deterministic local frame from that triangle
and emits one separate four-vertex/two-triangle UV0 quad. It never rewrites the
imported trunk geometry or adopts the decal into the trunk material.

The live renderer borrows the existing renderer-owned image material and
texture binding. Per-placement geometries are owned and disposed separately.
PNG, WebP, and JPEG upload limits remain 32 MiB, 4096 by 4096, and 16
megapixels. Imported targets are limited to two million vertices/triangles,
packages to 32 decals, and serialized authoring JSON to 1 MiB.

Export is all-or-nothing. The existing placement-decal GLB adopter writes
ordinary glTF UV0 primitives and an embedded deterministic PNG. It does not
invent an extension. Missing/replaced image evidence, a changed authored
spine, changed geometry, changed primitive provenance, or a stale triangle
produces no decal draw and stops decal-bearing export.

Static extraction is the evidence boundary. The imported-hero parser rejects
animations, skins, and morph targets before transform-baked authoring. A
primitive without one unambiguous source material is not targetable. Dynamic
or deforming surface attachment, multi-material triangle inference, decal
projection across seams, and reconstructing editable decal packages from an
arbitrary reimported GLB are unsupported.
