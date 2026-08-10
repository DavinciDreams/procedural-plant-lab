import * as THREE from "three";
import {
  attachProcPlantVineGuidePointToLiveSupport,
  createProcPlantVineLiveSupportPackage,
  createProcPlantVineLiveSupportPoseFromObject3D,
  rebuildProcPlantVineGuideFromLiveSupports,
  type ProcPlantVineLiveSupportPackage,
  type ProcPlantVineLiveSupportRebuildResult,
} from "./procplant-vine-live-support";
import {
  deserializeProcPlantVineGuidePackage,
  serializeProcPlantVineGuidePackage,
  type ProcPlantVineGuidePackage,
} from "./procplant-vine-guide-authoring";

export interface ProcPlantLabLiveVineAttachment {
  attachment: ProcPlantVineLiveSupportPackage;
  sourceGuide: ProcPlantVineGuidePackage;
  trellis: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  supportId: string;
  supportSignature: string;
}

export const attachProcPlantLabLiveVineSupport = (
  authored: ProcPlantVineGuidePackage,
  guideRoot: THREE.Object3D,
): ProcPlantLabLiveVineAttachment => {
  const xs = authored.points.map((point) => point.position[0]);
  const ys = authored.points.map((point) => point.position[1]);
  const zs = authored.points.map((point) => point.position[2]);
  const center = new THREE.Vector3(
    (Math.min(...xs) + Math.max(...xs)) * 0.5,
    (Math.min(...ys) + Math.max(...ys)) * 0.5,
    (Math.min(...zs) + Math.max(...zs)) * 0.5 - 0.04,
  );
  const trellis = new THREE.Mesh(
    new THREE.BoxGeometry(
      Math.max(0.5, Math.max(...xs) - Math.min(...xs) + 0.35),
      Math.max(0.8, Math.max(...ys) - Math.min(...ys) + 0.35),
      0.06,
    ),
    new THREE.MeshStandardMaterial({
      color: 0x8a633f,
      roughness: 0.82,
      metalness: 0.02,
      transparent: true,
      opacity: 0.78,
    }),
  );
  guideRoot.updateWorldMatrix(true, false);
  const world = guideRoot.matrixWorld.clone().multiply(
    new THREE.Matrix4().makeTranslation(center.x, center.y, center.z),
  );
  world.decompose(trellis.position, trellis.quaternion, trellis.scale);
  trellis.updateMatrixWorld(true);
  trellis.name = "procplant-live-vine-trellis";
  const supportId = "lab-live-trellis";
  const supportSignature = "lab-live-trellis-box-v1";
  const pose = createProcPlantVineLiveSupportPoseFromObject3D(trellis, {
    id: supportId,
    kind: "triangle-mesh",
    supportSignature,
    guideRoot,
  });
  let attachment = createProcPlantVineLiveSupportPackage(authored);
  for (const point of authored.points) {
    attachment = attachProcPlantVineGuidePointToLiveSupport(authored, attachment, point.id, pose);
  }
  return {
    attachment,
    sourceGuide: deserializeProcPlantVineGuidePackage(serializeProcPlantVineGuidePackage(authored)),
    trellis,
    supportId,
    supportSignature,
  };
};

export const rebuildProcPlantLabLiveVineSupport = (
  authored: ProcPlantVineGuidePackage,
  attachment: ProcPlantVineLiveSupportPackage,
  trellis: THREE.Object3D,
  guideRoot: THREE.Object3D,
): ProcPlantVineLiveSupportRebuildResult => {
  trellis.position.x += 0.24;
  trellis.position.y += 0.08;
  trellis.scale.y *= 1.12;
  trellis.updateMatrixWorld(true);
  guideRoot.updateWorldMatrix(true, false);
  const pose = createProcPlantVineLiveSupportPoseFromObject3D(trellis, {
    id: "lab-live-trellis",
    kind: "triangle-mesh",
    supportSignature: "lab-live-trellis-box-v1",
    guideRoot,
  });
  return rebuildProcPlantVineGuideFromLiveSupports(authored, attachment, [pose], { maxPointMotion: 2 });
};

export interface ProcPlantLabLiveVineUi {
  readonly attachment: ProcPlantVineLiveSupportPackage | null;
  clear(restoreGuide?: boolean): void;
  sync(): void;
  dispose(): void;
}

export interface ProcPlantLabLiveVineUiOptions {
  app: HTMLElement;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  attachButton: HTMLButtonElement;
  deformButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  getBusy(): boolean;
  getGuide(): ProcPlantVineGuidePackage | null;
  setGuide(authored: ProcPlantVineGuidePackage): void;
  getGuideRoot(): THREE.Object3D | null;
  refreshGuide(): void;
  syncGuide(): void;
  setStatus(message: string): void;
  regenerate(): void;
}

export const createProcPlantLabLiveVineUi = (options: ProcPlantLabLiveVineUiOptions): ProcPlantLabLiveVineUi => {
  let attachment: ProcPlantVineLiveSupportPackage | null = null;
  let sourceGuide: ProcPlantVineGuidePackage | null = null;
  let trellis: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> | null = null;

  const disposeTrellis = () => {
    if (!trellis) return;
    options.scene.remove(trellis);
    trellis.geometry.dispose();
    trellis.material.dispose();
    trellis = null;
    options.app.dataset.vineLiveSupportDisposed = "true";
  };
  const clear = (restoreGuide = false) => {
    if (restoreGuide && sourceGuide) options.setGuide(sourceGuide);
    attachment = null;
    sourceGuide = null;
    disposeTrellis();
    options.app.dataset.vineLiveSupportStatus = "canonical";
    options.app.dataset.vineLiveSupportBindings = "0";
    delete options.app.dataset.vineLiveSupportReason;
    delete options.app.dataset.vineLiveSupportTransformedPoints;
  };
  const sync = () => {
    const guide = options.getGuide();
    const guideReady = Boolean(guide && guide.points.length >= 2 && options.getGuideRoot());
    options.attachButton.disabled = options.getBusy() || !guideReady || attachment !== null;
    options.deformButton.disabled = options.getBusy() || !attachment || !trellis;
    options.resetButton.disabled = options.getBusy() || !attachment;
    options.app.dataset.vineLiveSupportStatus = attachment
      ? (options.app.dataset.vineLiveSupportStatus ?? "attached")
      : "canonical";
    options.app.dataset.vineLiveSupportBindings = String(attachment?.bindings.length ?? 0);
  };

  options.attachButton.addEventListener("click", () => void (async () => {
    const authored = options.getGuide();
    const guideRoot = options.getGuideRoot();
    if (options.getBusy() || !authored || authored.points.length < 2 || !guideRoot || attachment) return;
    const attached = attachProcPlantLabLiveVineSupport(authored, guideRoot);
    if (options.getBusy() || options.getGuide() !== authored || options.getGuideRoot() !== guideRoot) {
      attached.trellis.geometry.dispose();
      attached.trellis.material.dispose();
      return;
    }
    sourceGuide = attached.sourceGuide;
    attachment = attached.attachment;
    trellis = attached.trellis;
    options.scene.add(trellis);
    options.app.dataset.vineLiveSupportLoaded = "true";
    options.app.dataset.vineLiveSupportDisposed = "false";
    options.app.dataset.vineLiveSupportStatus = "attached";
    options.app.dataset.vineLiveSupportSupportId = attached.supportId;
    options.app.dataset.vineLiveSupportGeometrySignature = attached.supportSignature;
    options.app.dataset.vineLiveSupportDraws = String(options.renderer.info.render.calls);
    options.app.dataset.vineLiveSupportBackend = options.renderer.capabilities.isWebGL2 ? "webgl2" : "webgl1";
    sync();
    options.setStatus("Attached every guide point to stable trellis-local coordinates. The caller still owns transform updates and rebuild timing.");
  })());

  options.deformButton.addEventListener("click", () => void (async () => {
    const authored = options.getGuide();
    const currentAttachment = attachment;
    const currentTrellis = trellis;
    const guideRoot = options.getGuideRoot();
    if (options.getBusy() || !authored || !currentAttachment || !currentTrellis || !guideRoot) return;
    const rebuilt = rebuildProcPlantLabLiveVineSupport(authored, currentAttachment, currentTrellis, guideRoot);
    options.app.dataset.vineLiveSupportStatus = rebuilt.status;
    options.app.dataset.vineLiveSupportReason = rebuilt.reason ?? "none";
    options.app.dataset.vineLiveSupportTransformedPoints = String(rebuilt.audit.transformedPoints);
    if (rebuilt.status !== "rebuilt") {
      options.setStatus(`Live support rebuild failed closed: ${rebuilt.reason}.`);
      sync();
      return;
    }
    options.setGuide(rebuilt.authored);
    attachment = rebuilt.attachment;
    options.refreshGuide();
    options.syncGuide();
    options.setStatus(`Rebuilt ${rebuilt.audit.transformedPoints} attached guide points after the caller-owned trellis transform update.`);
    options.regenerate();
  })());

  options.resetButton.addEventListener("click", () => {
    if (options.getBusy() || !attachment) return;
    clear(true);
    options.refreshGuide();
    options.syncGuide();
    options.setStatus("Disposed the live trellis and restored the exact pre-attachment V1 guide.");
    options.regenerate();
  });

  sync();
  return { get attachment() { return attachment; }, clear, sync, dispose: clear };
};
