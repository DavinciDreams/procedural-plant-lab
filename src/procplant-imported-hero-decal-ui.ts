import { Raycaster, Vector2, type Camera } from "three";
import {
  appendProcPlantImportedHeroDecal,
  applyProcPlantImportedHeroDecals,
  createProcPlantImportedHeroDecalPackage,
  undoLastProcPlantImportedHeroDecal,
  type ProcPlantImportedHeroDecalPackage,
} from "./procplant-imported-hero-decal";
import { createProcPlantThreePlacementDecalDraws } from "./procplant-placement-decal-three";
import type {
  ProcPlantThreePlacementDecalBindingHandle,
  ProcPlantThreePlacementDecalDrawPackage,
} from "./procplant-placement-decal-three";
import type { ProcPlantLabHeroPreview } from "./procplant-lab-authoring-imports";
import type { ProcPlantPlacementDecalPixelSource } from "./procplant-placement-decal-glb";

export const materializeProcPlantImportedHeroDecalUi = (input: {
  preview: ProcPlantLabHeroPreview;
  authored: ProcPlantImportedHeroDecalPackage;
  binding: ProcPlantThreePlacementDecalBindingHandle | null;
}): { status: string; draws: ProcPlantThreePlacementDecalDrawPackage | null; message?: string } => {
  const applied = applyProcPlantImportedHeroDecals(
    input.preview.importedDecalTarget!,
    input.preview.trunk.geometry,
    input.authored,
    input.binding && !input.binding.disposed ? [input.binding.binding] : [],
  );
  if (!applied.targetMatched) return {
    status: "stale-target",
    draws: null,
    message: "Imported-hero decal target is stale. No decal was drawn; undo it or restore the exact source and authored spine.",
  };
  if (applied.decals.length !== input.authored.operations.length || !input.binding || input.binding.disposed) {
    return { status: applied.unsupported[0]?.reason ?? "missing-binding", draws: null };
  }
  const draws = createProcPlantThreePlacementDecalDraws(applied.decals, input.binding);
  draws.root.userData.procplantLiveOnly = true;
  return { status: "ready", draws };
};

export const appendProcPlantImportedHeroDecalUi = (input: {
  preview: ProcPlantLabHeroPreview;
  authored: ProcPlantImportedHeroDecalPackage | null;
  binding: ProcPlantThreePlacementDecalBindingHandle;
  triangleIndex: number;
  localPoint: import("three").Vector3;
}): { package: ProcPlantImportedHeroDecalPackage | null; message: string } => {
  const target = input.preview.importedDecalTarget!;
  if (input.authored && input.authored.target.geometrySignature !== target.geometrySignature) return {
    package: null,
    message: "Existing imported-hero decals target a different source or authored spine. Undo them before placing on this geometry.",
  };
  const authored = input.authored ?? createProcPlantImportedHeroDecalPackage(target);
  const appended = appendProcPlantImportedHeroDecal(authored, input.preview.trunk.geometry, {
    triangleIndex: input.triangleIndex,
    localPoint: input.localPoint,
    size: 0.18,
    binding: input.binding.binding,
  });
  if (!appended.operation) return {
    package: null,
    message: appended.reason === "cap"
      ? "The 32-decal imported-hero cap has been reached."
      : appended.reason === "target-mismatch"
        ? "The imported-hero geometry changed; no decal was placed."
        : "That imported-hero triangle cannot carry a stable decal anchor.",
  };
  return { package: appended.package, message: `Placed exact UV0 decal on imported primitive triangle ${input.triangleIndex}.` };
};

export const pickAndAppendProcPlantImportedHeroDecalUi = (input: {
  canvas: HTMLCanvasElement;
  camera: Camera;
  clientX: number;
  clientY: number;
  preview: ProcPlantLabHeroPreview;
  authored: ProcPlantImportedHeroDecalPackage | null;
  binding: ProcPlantThreePlacementDecalBindingHandle;
}): { package: ProcPlantImportedHeroDecalPackage | null; message: string } => {
  const rect = input.canvas.getBoundingClientRect();
  const pointer = new Vector2(
    ((input.clientX - rect.left) / rect.width) * 2 - 1,
    -((input.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new Raycaster();
  raycaster.setFromCamera(pointer, input.camera);
  const hit = raycaster.intersectObject(input.preview.trunk, false)[0];
  if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) {
    return { package: null, message: "No static imported-hero trunk triangle was selected." };
  }
  input.preview.trunk.updateMatrixWorld(true);
  return appendProcPlantImportedHeroDecalUi({
    preview: input.preview,
    authored: input.authored,
    binding: input.binding,
    triangleIndex: hit.faceIndex,
    localPoint: input.preview.trunk.worldToLocal(hit.point.clone()),
  });
};

export interface ProcPlantImportedHeroDecalUiController {
  readonly draws: ProcPlantThreePlacementDecalDrawPackage | null;
  syncButtons(): void;
  jsonStatus(): { targetEligibility: string; liveStatus: string; liveDraws: number; liveTriangles: number } | null;
  exportGlb(): Promise<void>;
  refresh(): void;
  undo(): boolean;
  dispose(): void;
}

/** Imported-only interaction controller, loaded after hero import rather than at lab startup. */
export const createProcPlantImportedHeroDecalUiController = (context: {
  canvas: HTMLCanvasElement;
  camera: Camera;
  dataset: DOMStringMap;
  statusElement: HTMLElement;
  placementKindSelect: HTMLSelectElement;
  placementModeButton: HTMLButtonElement;
  undoButton: HTMLButtonElement;
  exportGlbButton: HTMLButtonElement;
  importDecalButton: HTMLButtonElement;
  clearDecalButton: HTMLButtonElement;
  getPreview(): ProcPlantLabHeroPreview | null;
  getAuthored(): ProcPlantImportedHeroDecalPackage | null;
  setAuthored(value: ProcPlantImportedHeroDecalPackage | null): void;
  getBinding(): ProcPlantThreePlacementDecalBindingHandle | null;
  getPixels(): ProcPlantPlacementDecalPixelSource | null;
  getAudit(): Record<string, unknown> | null;
  getContentHash(): string;
  isPlacementActive(): boolean;
  isBusy(): boolean;
  closePlacement(): void;
  changed(): void;
  setStatus(message: string): void;
}): ProcPlantImportedHeroDecalUiController => {
  let currentDraws: ProcPlantThreePlacementDecalDrawPackage | null = null;
  const disposeDraws = () => {
    currentDraws?.root.removeFromParent();
    currentDraws?.dispose();
    currentDraws = null;
    delete context.dataset.heroImportDecalDraws;
    delete context.dataset.heroImportDecalTriangles;
  };
  const refresh = () => {
    disposeDraws();
    const preview = context.getPreview();
    const authored = context.getAuthored();
    if (!preview?.importedDecalTarget || !authored?.operations.length) {
      context.dataset.heroImportDecalStatus = preview?.importedDecalTargetInspection.reason ?? "no-import";
      return;
    }
    const result = materializeProcPlantImportedHeroDecalUi({ preview, authored, binding: context.getBinding() });
    context.dataset.heroImportDecalStatus = result.status;
    if (result.message) context.statusElement.textContent = result.message;
    if (!result.draws) return;
    preview.group.add(result.draws.root);
    currentDraws = result.draws;
    context.dataset.heroImportDecalDraws = String(result.draws.audit.draws);
    context.dataset.heroImportDecalTriangles = String(result.draws.audit.triangles);
  };
  const click = (event: MouseEvent) => {
    const preview = context.getPreview();
    const binding = context.getBinding();
    if (!context.isPlacementActive() || !preview?.importedDecalTarget || !binding || binding.disposed || context.isBusy()) return;
    const appended = pickAndAppendProcPlantImportedHeroDecalUi({
      canvas: context.canvas,
      camera: context.camera,
      clientX: event.clientX,
      clientY: event.clientY,
      preview,
      authored: context.getAuthored(),
      binding,
    });
    if (!appended.package) return context.setStatus(appended.message);
    context.setAuthored(appended.package);
    refresh();
    context.changed();
    context.setStatus(appended.message);
  };
  context.canvas.addEventListener("click", click);
  const syncButtons = () => {
    const binding = context.getBinding();
    const available = Boolean(context.getPreview()?.importedDecalTarget && binding && !binding.disposed);
    if (!available && context.isPlacementActive()) context.closePlacement();
    for (const option of context.placementKindSelect.options) option.disabled = option.value !== "decal";
    if (available) context.placementKindSelect.value = "decal";
    context.placementModeButton.disabled = context.isBusy() || !available;
    context.placementKindSelect.disabled = context.isBusy() || !available;
    context.undoButton.disabled = context.isBusy() || (context.getAuthored()?.operations.length ?? 0) === 0;
    context.importDecalButton.disabled = context.isBusy();
    context.clearDecalButton.disabled = context.isBusy() || !available;
    context.dataset.organPlacementAvailable = String(available);
    context.dataset.organPlacementActive = String(context.isPlacementActive() && available);
    context.dataset.organPlacementCount = String(context.getAuthored()?.operations.length ?? 0);
    context.dataset.placementDecalBindingReady = String(Boolean(binding && !binding.disposed));
  };
  return {
    get draws() { return currentDraws; },
    syncButtons,
    jsonStatus: () => {
      const preview = context.getPreview();
      return preview ? {
        targetEligibility: preview.importedDecalTargetInspection.reason,
        liveStatus: context.dataset.heroImportDecalStatus ?? "none",
        liveDraws: currentDraws?.audit.draws ?? 0,
        liveTriangles: currentDraws?.audit.triangles ?? 0,
      } : null;
    },
    exportGlb: async () => {
      const preview = context.getPreview();
      if (!preview) return;
      context.exportGlbButton.disabled = true;
      try {
        const module = await import("./procplant-lab-glb-export");
        const exported = await module.exportProcPlantLabImportedHeroDecalGlb({
          preview,
          audit: context.getAudit(),
          authored: context.getAuthored(),
          binding: context.getBinding(),
          pixels: context.getPixels(),
          contentHash: context.getContentHash(),
          dataset: context.dataset,
        });
        context.setStatus(exported.message);
      } catch (error) {
        console.error("[procplants] Imported hero GLB export failed.", error);
        context.setStatus(`Imported hero GLB export failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        context.exportGlbButton.disabled = false;
      }
    },
    refresh,
    undo: () => {
      const authored = context.getAuthored();
      if (!authored?.operations.length || context.isBusy()) return false;
      const next = undoLastProcPlantImportedHeroDecal(authored);
      context.setAuthored(next.operations.length > 0 ? next : null);
      refresh();
      context.changed();
      context.setStatus("Removed the last imported-hero decal and disposed its live quad geometry.");
      return true;
    },
    dispose: () => {
      context.canvas.removeEventListener("click", click);
      disposeDraws();
    },
  };
};
