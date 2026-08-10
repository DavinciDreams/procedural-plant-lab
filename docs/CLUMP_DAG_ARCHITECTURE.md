# Bounded clump production DAG

The clump specialization has two real random streams that can be separated
without changing its legacy output:

1. the foliage-stage shoot seed generates each shoot at `seed + ordinal * 2749`;
2. the architecture-stage placement seed generates golden-angle offsets, scale
   variation, spin, and outward lean.

`createProcPlantClumpStagePlan` records those shoot seeds and transforms.
`buildProcPlantClumpStageParts` consumes the plan, while
`compileProcPlantClumpStageLods` retains the existing full/reduced/card LOD
policy. Passing the legacy seed to both streams is byte-identical to the
canonical compiler. The production DAG does exactly that unless a user
explicitly overrides one of the two stage seeds.

The edited typed path supports only:

- architecture seed overrides for placement transforms;
- foliage seed overrides for shoot generation;
- material leaf-color edits;
- bounded LOD-level selection;
- the existing deterministic output package.

Branching seeds, count/curve/placement/dependency edits, material seeds, and
added or removed stages fail closed. They do not have independent compiler
seams in the current generic clump backend.

## Daylily crown, foliage, and scape stages

Daylily uses a dedicated three-stream plan instead of pretending that each
crown is a generic whole-shoot transform:

1. the architecture seed places ten deterministic crowns across the clump;
2. the foliage seed varies branch-relative strap-leaf count, scale, and frame;
3. the reproductive seed selects crowns and builds real scape chains with
   terminal flower attachments.

Each stage replays only the legacy phase offsets it needs. Giving all three
stages the legacy seed preserves every canonical template and LOD byte, while
changing one seed cannot advance either of the other random streams. The
materialized Daylily graph now contains the real scape segments, leaf and bloom
organs, segment records, and right-handed attachment frames instead of an empty
placeholder IR.

## Budgets and compatibility

At seed `612072`, `furGrass` remains exactly 190 `grassBlade` instances with
LOD triangles `380 / 126 / 4 / 2`, vertices `1140 / 378 / 8 / 4`, and an
approximately `0.963 x 0.953` local-unit footprint. The tests pin every LOD's
SHA-256 geometry hash as well as stream isolation and rejection behavior.

At seed `612072`, Daylily remains exactly `1060 / 650 / 4 / 2` triangles and
`2988 / 1862 / 8 / 4` vertices across its monotonic LODs. Its canonical SHA-256
geometry hashes remain pinned, while the graph exposes 27 stem nodes, 24 scape
segments, 152 organs, and 152 resolved attachments. The typed work cap accounts
for each staged plan and materialized artifact.

This branch is stacked only on production-DAG PR #13. That base predates the
approved fern convergence, so its Phi fixture is intentionally pinned only as
a no-change guard for the old stack. The authoritative Phi Fern contract
(`8 fernFrond` instances, `352 / 264 / 4 / 2` triangles, approximately
`1.23 x 1.61` coverage) and Tellus v3 fixture must be re-run when this commit is
reconciled into the cumulative branch that already contains fern convergence.
No Tellus default-biome or renderer policy changes here.
