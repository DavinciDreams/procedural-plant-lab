# Procplants

Standalone procedural plant lab for Three.js, designed to stay portable enough for a later Tellus adapter.

## What It Builds

- A reusable genome model for grass, ferns, flowers, tropical plants, reeds, bamboo, succulents, vines, fan palms, and shrubs.
- Phi/golden-angle phyllotaxis for leaves and biome scatter.
- Light-responsive growth: shade stretches stems, changes leaf scale, and suppresses branches.
- Procedural 2D leaf silhouettes with vein strips instead of generic oval cards.
- Fur-like grass blades as dense, low-triangle cards.
- Hybridization between plant genomes.
- A merged-buffer renderer that mirrors Tellus's vegetation performance shape.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Useful Files

- `src/procplants.ts` is the generator core.
- `src/main.ts` is the standalone Three.js lab.
- `src/style.css` is only the lab UI.

Current presets include `furGrass`, `reedSedge`, `bambooClump`, `phiFern`, `meadowFlower`, `lotusBloom`, `vincaVine`, `roseBush`, `tropicalAroid`, `fanPalmUnderstory`, `desertRosette`, and `understoryShrub`.

The generator returns a flat template:

```ts
{
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array;
  tintable: Uint8Array;
  sway: Float32Array;
  idx: Uint32Array;
}
```

That shape is intentionally close to Tellus's existing vegetation template buffers, so later wiring should be an adapter/import decision rather than a renderer rewrite.
