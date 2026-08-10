import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compileProcPlantMaterialGraph,
  PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  PROCPLANT_MATERIAL_GRAPH_VERSION,
  type ProcPlantMaterialGraph,
} from "../src/procplant-material-graph";
import { bakeProcPlantMaterials } from "../src/procplant-material-bake";
import { exportProcPlantUsda } from "../src/procplant-usd-export";
import { exportProcPlantUsdz } from "../src/procplant-usdz-export";
import { compileProcPlantLods, defaultPlantEnvironment, procPlantPresets } from "../src/procplants";

const outputDirectory = process.argv[2];
if (!outputDirectory) throw new Error("usage: procplant-openusd-fixtures <output-directory>");

const graph: ProcPlantMaterialGraph = {
  contract: PROCPLANT_MATERIAL_GRAPH_CONTRACT,
  version: PROCPLANT_MATERIAL_GRAPH_VERSION,
  id: "openusd-validation",
  textures: [{ id: "normal-map", uri: "normal.png", mimeType: "image/png", role: "normal", colorSpace: "linear" }],
  nodes: [
    { id: "base", kind: "color", value: [0.12, 0.5, 0.08, 0.7] },
    { id: "opacity", kind: "scalar", value: 0.7 },
    { id: "ao", kind: "scalar", value: 0.85 },
    { id: "rough", kind: "scalar", value: 0.7 },
    { id: "metal", kind: "scalar", value: 0 },
    { id: "normal", kind: "texture-sample", texture: "normal-map", channel: "normal" },
    { id: "emissive", kind: "color", value: [0.01, 0.02, 0] },
  ],
  surfaces: [{
    slot: "leaf",
    channels: { baseColor: "base", opacity: "opacity", ambientOcclusion: "ao", roughness: "rough", metalness: "metal", normal: "normal", emissive: "emissive" },
    alphaMode: "mask",
    alphaCutoff: 0.4,
  }],
};
const baked = bakeProcPlantMaterials(compileProcPlantMaterialGraph(graph), [
  { textureId: "normal-map", width: 1, height: 1, rgba: Uint8Array.of(128, 128, 255, 255) },
], { width: 2, height: 2 });
const lods = compileProcPlantLods(procPlantPresets.cloverGroundcover, 90210, defaultPlantEnvironment());
const collisions = [undefined, { type: "bounds-box" as const }, { type: "trunk-capsule" as const }];
await mkdir(outputDirectory, { recursive: true });

for (const lod of ["all" as const, 0 as const, 1 as const, 2 as const, 3 as const]) {
  for (const collision of collisions) {
    const collisionName = collision?.type ?? "none";
    const name = `validation-${lod}-${collisionName}`;
    const source = lod === "all" ? lods : [lods.find((entry) => entry.level === lod)!];
    const options = { name, genomeId: procPlantPresets.cloverGroundcover.id, seed: 90210, collision, material: { baked } };
    const usda = exportProcPlantUsda(source, options);
    await writeFile(join(outputDirectory, usda.fileName), usda.text, "utf8");
    for (const asset of usda.assets) {
      const path = join(outputDirectory, ...asset.path.split("/"));
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, asset.bytes);
    }
    const usdz = exportProcPlantUsdz(source, options);
    await writeFile(join(outputDirectory, usdz.fileName), usdz.bytes);
  }
}

console.log("generated 15 textured USDA layers and 15 aligned USDZ packages");
