import {
  buildProcPlantInstancedParts,
  type ProcPlantEnvironment,
  type ProcPlantGenome,
} from "./procplants";

interface TreePreviewRequest {
  id: number;
  genome: ProcPlantGenome;
  seed: number;
  env: ProcPlantEnvironment;
}

self.addEventListener("message", (event: MessageEvent<TreePreviewRequest>) => {
  const { id, genome, seed, env } = event.data;
  try {
    const built = buildProcPlantInstancedParts(genome, seed, env);
    const template = built.stems;
    self.postMessage(
      { id, template, stats: built.stats },
      {
        transfer: [
          template.pos.buffer,
          template.nrm.buffer,
          template.col.buffer,
          template.tintable.buffer,
          template.sway.buffer,
          template.idx.buffer,
        ] as ArrayBuffer[],
      },
    );
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
