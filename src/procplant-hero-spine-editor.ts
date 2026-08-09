import * as THREE from "three";
import {
  createProcPlantManualMeshSpine,
  type ProcPlantMeshSpine,
} from "./procplant-mesh-helper";

export const PROCPLANT_HERO_SPINE_EDITOR_CONTRACT = "procplants.hero-spine-editor" as const;
export const PROCPLANT_HERO_SPINE_EDITOR_VERSION = 1 as const;
export const PROCPLANT_HERO_SPINE_EDITOR_MAX_POINTS = 64 as const;
export const PROCPLANT_HERO_SPINE_EDITOR_MIN_SEGMENT = 1e-4 as const;

export interface ProcPlantHeroSpineEditorPoint {
  id: string;
  position: readonly [number, number, number];
  radius: number;
}

export interface ProcPlantHeroSpineEditorState {
  contract: typeof PROCPLANT_HERO_SPINE_EDITOR_CONTRACT;
  version: typeof PROCPLANT_HERO_SPINE_EDITOR_VERSION;
  sourceContentHash: string;
  revision: number;
  nextOrdinal: number;
  selectedPointId: string | null;
  points: ProcPlantHeroSpineEditorPoint[];
  contentHash: string;
}

const quantized = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

const hashText = (value: string) => {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const canonicalPoints = (points: readonly ProcPlantHeroSpineEditorPoint[]) => points.map((point) => ({
  id: point.id,
  position: point.position.map(quantized) as [number, number, number],
  radius: quantized(point.radius),
}));

const stateHash = (state: Omit<ProcPlantHeroSpineEditorState, "contentHash">) => hashText(JSON.stringify({
  contract: state.contract,
  version: state.version,
  sourceContentHash: state.sourceContentHash,
  revision: state.revision,
  nextOrdinal: state.nextOrdinal,
  selectedPointId: state.selectedPointId,
  points: canonicalPoints(state.points),
}));

const cloneState = (state: ProcPlantHeroSpineEditorState): ProcPlantHeroSpineEditorState => ({
  ...state,
  points: canonicalPoints(state.points),
});

const withoutHash = (state: ProcPlantHeroSpineEditorState): Omit<ProcPlantHeroSpineEditorState, "contentHash"> => {
  const { contentHash: _contentHash, ...rest } = cloneState(state);
  return rest;
};

const validatePoints = (points: readonly ProcPlantHeroSpineEditorPoint[]) => {
  if (points.length < 2 || points.length > PROCPLANT_HERO_SPINE_EDITOR_MAX_POINTS) {
    throw new Error(`hero spine editor requires 2..${PROCPLANT_HERO_SPINE_EDITOR_MAX_POINTS} points`);
  }
  const ids = new Set<string>();
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    if (!point.id || point.id.length > 128 || ids.has(point.id)) throw new Error(`hero spine point ${index} has an invalid or duplicate ID`);
    ids.add(point.id);
    if (point.position.length !== 3 || point.position.some((value) => !Number.isFinite(value) || Math.abs(value) > 1_000_000)) {
      throw new Error(`hero spine point ${point.id} position must be finite and bounded`);
    }
    if (!Number.isFinite(point.radius) || point.radius <= 0 || point.radius > 1_000_000) {
      throw new Error(`hero spine point ${point.id} radius must be finite, positive, and bounded`);
    }
    if (index > 0) {
      const prior = points[index - 1]!;
      const distance = Math.hypot(
        point.position[0] - prior.position[0],
        point.position[1] - prior.position[1],
        point.position[2] - prior.position[2],
      );
      if (distance < PROCPLANT_HERO_SPINE_EDITOR_MIN_SEGMENT) {
        throw new Error(`hero spine segment ${index - 1} is degenerate`);
      }
    }
  }
};

const finalizeState = (
  state: Omit<ProcPlantHeroSpineEditorState, "contentHash">,
): ProcPlantHeroSpineEditorState => {
  const points = canonicalPoints(state.points);
  validatePoints(points);
  if (state.selectedPointId !== null && !points.some((point) => point.id === state.selectedPointId)) {
    throw new Error("hero spine selected point is missing");
  }
  const normalized = { ...state, points };
  return { ...normalized, contentHash: stateHash(normalized) };
};

export const createProcPlantHeroSpineEditorState = (
  spine: ProcPlantMeshSpine,
  sourceContentHash: string,
): ProcPlantHeroSpineEditorState => {
  if (spine.contract !== "procplants.mesh-spine" || spine.version !== 1) throw new Error("unsupported mesh spine contract");
  if (!sourceContentHash || sourceContentHash.length > 128) throw new Error("hero spine editor sourceContentHash must contain 1..128 characters");
  const points = spine.samples.map((sample, index): ProcPlantHeroSpineEditorPoint => ({
    id: `spine-point-${index.toString().padStart(3, "0")}`,
    position: sample.position.toArray(),
    radius: sample.radius,
  }));
  return finalizeState({
    contract: PROCPLANT_HERO_SPINE_EDITOR_CONTRACT,
    version: PROCPLANT_HERO_SPINE_EDITOR_VERSION,
    sourceContentHash,
    revision: 0,
    nextOrdinal: points.length,
    selectedPointId: points[0]?.id ?? null,
    points,
  });
};

const validateState = (state: ProcPlantHeroSpineEditorState) => {
  if (state.contract !== PROCPLANT_HERO_SPINE_EDITOR_CONTRACT || state.version !== PROCPLANT_HERO_SPINE_EDITOR_VERSION) {
    throw new Error("unsupported hero spine editor state");
  }
  if (!Number.isSafeInteger(state.revision) || state.revision < 0 || !Number.isSafeInteger(state.nextOrdinal) || state.nextOrdinal < state.points.length) {
    throw new Error("hero spine editor revision metadata is invalid");
  }
  if (!state.sourceContentHash || state.sourceContentHash.length > 128) throw new Error("hero spine editor sourceContentHash is invalid");
  validatePoints(state.points);
  if (state.selectedPointId !== null && !state.points.some((point) => point.id === state.selectedPointId)) {
    throw new Error("hero spine selected point is missing");
  }
  if (stateHash(withoutHash(state)) !== state.contentHash) throw new Error("hero spine editor content hash does not match its state");
};

export const selectProcPlantHeroSpineEditorPoint = (
  source: ProcPlantHeroSpineEditorState,
  pointId: string,
): ProcPlantHeroSpineEditorState => {
  validateState(source);
  if (!source.points.some((point) => point.id === pointId)) throw new Error(`unknown hero spine point: ${pointId}`);
  if (source.selectedPointId === pointId) return source;
  return finalizeState({ ...withoutHash(source), selectedPointId: pointId });
};

export const moveProcPlantHeroSpineEditorPoint = (
  source: ProcPlantHeroSpineEditorState,
  pointId: string,
  position: readonly [number, number, number],
): ProcPlantHeroSpineEditorState => {
  validateState(source);
  const index = source.points.findIndex((point) => point.id === pointId);
  if (index < 0) throw new Error(`unknown hero spine point: ${pointId}`);
  const points = canonicalPoints(source.points);
  points[index] = { ...points[index]!, position: position.map(quantized) as [number, number, number] };
  return finalizeState({
    ...withoutHash(source),
    revision: source.revision + 1,
    selectedPointId: pointId,
    points,
  });
};

export const addProcPlantHeroSpineEditorPoint = (
  source: ProcPlantHeroSpineEditorState,
  position?: readonly [number, number, number],
  radius?: number,
): ProcPlantHeroSpineEditorState => {
  validateState(source);
  if (source.points.length >= PROCPLANT_HERO_SPINE_EDITOR_MAX_POINTS) throw new Error("hero spine point cap exceeded");
  const selectedIndex = Math.max(0, source.points.findIndex((point) => point.id === source.selectedPointId));
  const insertIndex = Math.min(source.points.length, selectedIndex + 1);
  const left = source.points[selectedIndex]!;
  const right = source.points[Math.min(selectedIndex + 1, source.points.length - 1)]!;
  const prior = source.points[Math.max(0, selectedIndex - 1)]!;
  const derivedPosition: [number, number, number] = right === left
    ? [
        left.position[0] + (left.position[0] - prior.position[0]),
        left.position[1] + (left.position[1] - prior.position[1]),
        left.position[2] + (left.position[2] - prior.position[2]),
      ]
    : [
        (left.position[0] + right.position[0]) * 0.5,
        (left.position[1] + right.position[1]) * 0.5,
        (left.position[2] + right.position[2]) * 0.5,
      ];
  const id = `spine-point-${source.nextOrdinal.toString().padStart(3, "0")}`;
  const points = canonicalPoints(source.points);
  points.splice(insertIndex, 0, {
    id,
    position: (position ?? derivedPosition).map(quantized) as [number, number, number],
    radius: quantized(radius ?? (left.radius + right.radius) * 0.5),
  });
  return finalizeState({
    ...withoutHash(source),
    revision: source.revision + 1,
    nextOrdinal: source.nextOrdinal + 1,
    selectedPointId: id,
    points,
  });
};

export const deleteProcPlantHeroSpineEditorPoint = (
  source: ProcPlantHeroSpineEditorState,
  pointId = source.selectedPointId,
): ProcPlantHeroSpineEditorState => {
  validateState(source);
  if (!pointId) return source;
  const index = source.points.findIndex((point) => point.id === pointId);
  if (index < 0) throw new Error(`unknown hero spine point: ${pointId}`);
  if (source.points.length <= 2) throw new Error("hero spine editor must retain at least two points");
  const points = canonicalPoints(source.points);
  points.splice(index, 1);
  const selected = points[Math.min(index, points.length - 1)]!.id;
  return finalizeState({
    ...withoutHash(source),
    revision: source.revision + 1,
    selectedPointId: selected,
    points,
  });
};

export const procPlantHeroSpineEditorStateToSpine = (state: ProcPlantHeroSpineEditorState): ProcPlantMeshSpine => {
  validateState(state);
  const lengths = new Float64Array(state.points.length);
  for (let index = 1; index < state.points.length; index++) {
    const a = state.points[index - 1]!.position;
    const b = state.points[index]!.position;
    lengths[index] = lengths[index - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  const total = lengths.at(-1)!;
  return createProcPlantManualMeshSpine(state.points.map((point, index) => ({
    position: new THREE.Vector3().fromArray(point.position),
    radius: point.radius,
    age: lengths[index]! / total,
    branchOrder: 0,
  })));
};

export interface ProcPlantHeroSpineEditorOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  target: THREE.Object3D;
  state: ProcPlantHeroSpineEditorState;
  onPreview?: (state: ProcPlantHeroSpineEditorState) => void;
  onCommit: (state: ProcPlantHeroSpineEditorState) => void;
  onSelectionChange?: (state: ProcPlantHeroSpineEditorState) => void;
}

export class ProcPlantHeroSpineEditor {
  readonly root = new THREE.Group();
  private state: ProcPlantHeroSpineEditorState;
  private readonly initial: ProcPlantHeroSpineEditorState;
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: THREE.Camera;
  private target: THREE.Object3D;
  private readonly onPreview?: ProcPlantHeroSpineEditorOptions["onPreview"];
  private readonly onCommit: ProcPlantHeroSpineEditorOptions["onCommit"];
  private readonly onSelectionChange?: ProcPlantHeroSpineEditorOptions["onSelectionChange"];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly line: THREE.Line;
  private readonly handles = new Map<string, THREE.Mesh>();
  private drag: null | {
    pointerId: number;
    pointId: string;
    plane: THREE.Plane;
    initialState: ProcPlantHeroSpineEditorState;
  } = null;
  private disposed = false;

  constructor(options: ProcPlantHeroSpineEditorOptions) {
    this.canvas = options.canvas;
    this.camera = options.camera;
    this.target = options.target;
    this.state = cloneState(options.state);
    this.initial = cloneState(options.state);
    this.onPreview = options.onPreview;
    this.onCommit = options.onCommit;
    this.onSelectionChange = options.onSelectionChange;
    this.root.name = "procplant-hero-spine-editor";
    this.root.renderOrder = 60;
    this.line = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffc857, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.line.renderOrder = 60;
    this.root.add(this.line);
    this.rebuild();
    this.canvas.addEventListener("pointerdown", this.handlePointerDown, true);
    this.canvas.addEventListener("pointermove", this.handlePointerMove, true);
    this.canvas.addEventListener("pointerup", this.handlePointerUp, true);
    this.canvas.addEventListener("pointercancel", this.handlePointerCancel, true);
    window.addEventListener("keydown", this.handleKeyDown, true);
  }

  getState() { return cloneState(this.state); }
  setState(state: ProcPlantHeroSpineEditorState) {
    validateState(state);
    this.state = cloneState(state);
    this.rebuild();
    this.onSelectionChange?.(this.getState());
  }
  setTarget(target: THREE.Object3D) { this.target = target; }
  copyDisplayTransform(source: THREE.Object3D) {
    this.root.position.copy(source.position);
    this.root.quaternion.copy(source.quaternion);
    this.root.scale.copy(source.scale);
    this.root.updateMatrix();
  }
  addAfterSelected(position?: readonly [number, number, number]) {
    this.state = addProcPlantHeroSpineEditorPoint(this.state, position);
    this.rebuild();
    this.commit();
  }
  deleteSelected() {
    this.state = deleteProcPlantHeroSpineEditorPoint(this.state);
    this.rebuild();
    this.commit();
  }
  resetAutoFit() {
    this.state = cloneState(this.initial);
    this.rebuild();
    this.commit();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown, true);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove, true);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp, true);
    this.canvas.removeEventListener("pointercancel", this.handlePointerCancel, true);
    window.removeEventListener("keydown", this.handleKeyDown, true);
    this.root.removeFromParent();
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
    for (const handle of this.handles.values()) {
      handle.geometry.dispose();
      (handle.material as THREE.Material).dispose();
    }
    this.handles.clear();
    this.root.clear();
  }

  private rebuild() {
    this.line.geometry.dispose();
    this.line.geometry = new THREE.BufferGeometry().setFromPoints(this.state.points.map((point) => new THREE.Vector3().fromArray(point.position)));
    for (const handle of this.handles.values()) {
      handle.removeFromParent();
      handle.geometry.dispose();
      (handle.material as THREE.Material).dispose();
    }
    this.handles.clear();
    for (const point of this.state.points) {
      const selected = point.id === this.state.selectedPointId;
      const handle = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(0.025, point.radius * 0.08), 10, 7),
        new THREE.MeshBasicMaterial({ color: selected ? 0xff5f57 : 0x67d4ff, depthTest: false, depthWrite: false, toneMapped: false }),
      );
      handle.position.fromArray(point.position);
      handle.userData.procplantHeroSpinePointId = point.id;
      handle.renderOrder = 61;
      this.handles.set(point.id, handle);
      this.root.add(handle);
    }
  }

  private updateRay(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
    );
    this.camera.updateWorldMatrix(true, false);
    this.root.updateWorldMatrix(true, true);
    this.target.updateWorldMatrix(true, false);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private select(pointId: string) {
    this.state = selectProcPlantHeroSpineEditorPoint(this.state, pointId);
    this.rebuild();
    this.onSelectionChange?.(this.getState());
  }

  private commit() {
    this.onSelectionChange?.(this.getState());
    this.onCommit(this.getState());
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (this.disposed || event.button !== 0 || this.drag) return;
    this.updateRay(event);
    const handle = this.raycaster.intersectObjects([...this.handles.values()], false)[0]?.object as THREE.Mesh | undefined;
    const pointId = handle?.userData.procplantHeroSpinePointId as string | undefined;
    if (pointId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.select(pointId);
      const worldPoint = handle!.getWorldPosition(new THREE.Vector3());
      const normal = this.camera.getWorldDirection(new THREE.Vector3());
      this.drag = {
        pointerId: event.pointerId,
        pointId,
        plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, worldPoint),
        initialState: cloneState(this.state),
      };
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (!event.shiftKey) return;
    const hit = this.raycaster.intersectObject(this.target, true)[0];
    if (!hit) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const local = this.root.worldToLocal(hit.point.clone());
    this.addAfterSelected(local.toArray());
  };

  private handlePointerMove = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.updateRay(event);
    const world = this.raycaster.ray.intersectPlane(this.drag.plane, new THREE.Vector3());
    if (!world) return;
    const local = this.root.worldToLocal(world.clone()).toArray() as [number, number, number];
    try {
      this.state = moveProcPlantHeroSpineEditorPoint(this.state, this.drag.pointId, local);
      this.rebuild();
      this.onPreview?.(this.getState());
    } catch {
      // Keep the last valid state when a drag would collapse a segment.
    }
  };

  private finish(event: PointerEvent, commit: boolean) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const { pointerId, initialState } = this.drag;
    this.drag = null;
    if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
    if (commit) this.commit();
    else {
      this.state = initialState;
      this.rebuild();
      this.onPreview?.(this.getState());
      this.onSelectionChange?.(this.getState());
    }
  }
  private handlePointerUp = (event: PointerEvent) => this.finish(event, true);
  private handlePointerCancel = (event: PointerEvent) => this.finish(event, false);
  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if ((event.target as HTMLElement | null)?.matches("input, textarea, select, [contenteditable='true']")) return;
    event.preventDefault();
    try {
      this.deleteSelected();
    } catch {
      // The minimum two-point spine is intentionally non-deletable.
    }
  };
}

export const createProcPlantHeroSpineEditor = (options: ProcPlantHeroSpineEditorOptions) =>
  new ProcPlantHeroSpineEditor(options);
