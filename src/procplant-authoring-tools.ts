// Cold authoring surface shared by trim, debug visualization, and GLB export.
// Keeping these exports behind one entry avoids loading several small chunks
// while leaving the default renderer and regeneration path untouched.
export { createProcPlantDebugOverlay } from "./procplant-debug";
export {
  disposePreparedProcPlantGlbExport,
  exportProcPlantGlb,
  prepareProcPlantGlbExport,
} from "./procplant-export";
export { createProcPlantPruneTool } from "./procplant-prune-tool";
export { pruneProcPlantGraph } from "./procplant-pruning";
