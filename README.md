# Procplants

Procplants is a procedural plant generator and Three.js demo for exploring believable, lightweight vegetation. It builds plant forms from reusable genomes, then scatters them into small biomes with deterministic seeds, phi-based placement, and environmental sliders.

The goal is to get rich foliage coverage without relying on heavy hand-authored meshes: leaves, petals, fronds, sprays, and grass blades are mostly low-triangle 2D forms with enough fold, curl, venation, and silhouette variation to read as alive.

## Try It

Use the controls to mix plant genomes and tune the biome:

- `Roll Dice` randomizes species, hybrid mix, seed, and environment sliders.
- `Auto Demo` keeps rolling new biomes for a hands-off showcase.
- `Save Link` copies a reproducible URL with the current recipe and camera.
- `Export JSON` downloads the current state, camera, stats, and resolved genome.

Good starting experiments:

- Mix `Vinca Vine` with `Meadow Flower` for viny flowering groundcover.
- Try `Echinacea Flower`, `Hibiscus Bloom`, `Daylily Flower`, `Foxglove Spike`, `Tulip Cup`, `Poppy Flower`, `Sunflower Tower`, `Lace Umbel`, and `Iris Bulb` for different flower architectures.
- Compare `Agave Succulent`, `Folded Palm`, and `Tropical Aroid` for rosette, canopy, and broadleaf forms.
- Use low light or high crowding to see the growth response change plant shape.

## Features

- Reusable genome model for grasses, ferns, flowers, tropical plants, reeds, bamboo, succulents, vines, conifers, palms, fan palms, groundcovers, umbels, bulbs, and shrubs.
- Golden-angle phyllotaxis for leaves, flowers, stems, and biome scatter.
- Light-responsive growth: shade stretches stems, changes leaf scale, and suppresses branches.
- Procedural leaf silhouettes with curl, serration, folds, and vein relief.
- Fur-like grass as dense low-triangle blade cards.
- Hybridization between plant genomes.
- Instanced rendering for leaves, grass blades, conifer sprays, palm fronds, petals, and flower centers.
- Reproducible URLs and JSON export for saving favorite seeds.

## Presets

Current presets include:

`furGrass`, `reedSedge`, `bambooClump`, `blueSpruce`, `foldedPalm`, `phiFern`, `meadowFlower`, `echinaceaFlower`, `hibiscusBloom`, `daylilyFlower`, `foxgloveSpike`, `tulipCup`, `poppyFlower`, `sunflowerTower`, `cloverGroundcover`, `laceUmbel`, `irisBulb`, `agaveSucculent`, `lotusBloom`, `vincaVine`, `roseBush`, `tropicalAroid`, `fanPalmUnderstory`, `desertRosette`, and `understoryShrub`.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

Build a production bundle with:

```bash
npm run build
```

## Project Structure

- `src/procplants.ts` is the generator core.
- `src/main.ts` is the standalone Three.js demo.
- `src/style.css` is the demo UI.

## Generator Output

The generator can produce a flat template:

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

For higher-throughput scenes, `buildProcPlantInstancedParts()` returns:

- merged stem geometry as a flat template
- per-organ instance matrices and colors
- separate organ kinds for leaves, grass blades, conifer sprays, palm fronds, petals, and flower centers

This keeps dense biomes relatively cheap while preserving enough botanical variation for close-up exploration.
