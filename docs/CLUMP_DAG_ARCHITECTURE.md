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

Branching seeds, count/curve/placement/dependency edits, material seeds, added
or removed stages, and the daylily crown/scapes specialization fail closed.
They do not have independent compiler seams in the current clump backend.

## Budgets and compatibility

At seed `612072`, `furGrass` remains exactly 190 `grassBlade` instances with
LOD triangles `380 / 126 / 4 / 2`, vertices `1140 / 378 / 8 / 4`, and an
approximately `0.963 x 0.953` local-unit footprint. The tests pin every LOD's
SHA-256 geometry hash as well as stream isolation and rejection behavior.

This branch is stacked only on production-DAG PR #13. That base predates the
approved fern convergence, so its Phi fixture is intentionally pinned only as
a no-change guard for the old stack. The authoritative Phi Fern contract
(`8 fernFrond` instances, `352 / 264 / 4 / 2` triangles, approximately
`1.23 x 1.61` coverage) and Tellus v3 fixture must be re-run when this commit is
reconciled into the cumulative branch that already contains fern convergence.
No Tellus default-biome or renderer policy changes here.
