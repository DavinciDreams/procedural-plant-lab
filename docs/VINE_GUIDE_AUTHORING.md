# Static vine guide authoring

`src/procplant-vine-guide-authoring.ts` is the bounded authoring seam between
viewport clicks and Procplants' existing guided-vine generator.

The V1 package stores up to 32 ordered local-space points. Every point has a
stable, non-recycled `vine-guide-point:NNNN` identity. The package is bound to
the source genome ID, generator seed, and a signature of the unedited vine gene
plus node count. Serialization is deterministic JSON with a 16 KiB input cap.
Stale targets and non-vine genomes preserve the exact source object.

Zero points is canonical. One point is an authoring draft and does not change
rendered geometry. Two or more points create a static `follow` guide before the
canonical generator graph is built. The applied gene uses adhesion 1, sag 0,
and avoidance radius 0 so the authored polyline, rather than synthesized
support behavior, owns the centerline. Existing foliage and flower cadence
remain part of the source gene. Typed guided-vine DAG edits still execute over
the resulting architecture, while the DAG continues to reject live guide or
collision parameters.

The lab's Place Vine Guide mode projects each click onto a camera-facing plane.
The first plane passes through the orbit target; subsequent planes pass through
the last authored point. Orbiting between clicks is the explicit way to author
depth. The overlay shows the static polyline and stable points, and undo/reset
rebuild or restore the canonical vine as appropriate. The versioned package is
restored from the bounded `vg` URL parameter, and JSON export includes it
alongside the applied genome.

The optional Support: Static Ground mode instead ray-picks the lab's immutable
ground mesh, transforms its indexed geometry into hero-local space, and builds a
bounded static BVH snapshot. `procplant-vine-surface-authoring.ts` also accepts
caller-owned primitive obstacle snapshots and prebuilt mesh indexes. It chooses
the nearest explicitly eligible support, rejects points beyond the snap radius,
offsets by the requested clearance, then re-queries every supplied obstacle.
Any remaining penetration fails closed without changing the package. Cross-kind
IDs must be unique, object count and query work are bounded, and input snapshots
are not mutated.

Successful snaps append only the materialized local-space point to the existing
V1 package. Support IDs, meshes, and query state are deliberately not serialized,
so JSON and GLB export cannot imply an attachment that does not exist. Rebuild a
mesh index and re-snap after any support deformation. This is static authoring,
not live collision, attachment solving, physics, growth deformation, or ongoing
surface conformance.
