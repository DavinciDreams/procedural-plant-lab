import * as THREE from "three";
import {
  cloneProcPlantFreeformCrown,
  PROCPLANT_FREEFORM_CROWN_CONTRACT,
  PROCPLANT_FREEFORM_CROWN_MAX_VOLUMES,
  PROCPLANT_FREEFORM_CROWN_VERSION,
  type ProcPlantCrownControlVolume,
  type ProcPlantFreeformCrown,
} from "./procplant-space-colonization";

export type ProcPlantCrownAxis = "width" | "height" | "depth";

export interface ProcPlantCrownVolumeValues {
  width: number;
  height: number;
  depth: number;
}

export interface ProcPlantCrownControlVolumeUpdate {
  operation?: "add" | "subtract";
  dimensions?: readonly [number, number, number];
  weight?: number;
  rotation?: readonly [number, number, number, number] | null;
}

export interface ProcPlantCrownVolumeToolOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  shape: "ellipsoid" | "box";
  center: readonly [number, number, number];
  dimensions: readonly [number, number, number];
  values: ProcPlantCrownVolumeValues;
  freeform?: ProcPlantFreeformCrown | null;
  min?: number;
  max?: number;
  step?: number;
  onPreview: (values: ProcPlantCrownVolumeValues, axis: ProcPlantCrownAxis) => void;
  onCommit: (values: ProcPlantCrownVolumeValues, axis: ProcPlantCrownAxis) => void;
  onCancel: (values: ProcPlantCrownVolumeValues, axis: ProcPlantCrownAxis) => void;
  onDraggingChange?: (dragging: boolean, axis: ProcPlantCrownAxis | null) => void;
  onFreeformPreview?: (field: ProcPlantFreeformCrown, volumeId: string) => void;
  onFreeformCommit?: (field: ProcPlantFreeformCrown | null, volumeId: string | null) => void;
  onFreeformCancel?: (field: ProcPlantFreeformCrown, volumeId: string) => void;
  onFreeformDraggingChange?: (dragging: boolean, volumeId: string | null) => void;
  onSelectionChange?: (volumeId: string | null) => void;
}

export interface ProcPlantCrownAxisProjection {
  value: number;
  unclamped: number;
}

export const projectProcPlantCrownAxisValue = (
  startValue: number,
  worldDelta: number,
  worldUnitsPerLocalUnit: number,
  baseLocalExtent: number,
  min = 0.5,
  max = 1.8,
  step = 0.05,
): ProcPlantCrownAxisProjection => {
  if (![startValue, worldDelta, worldUnitsPerLocalUnit, baseLocalExtent, min, max, step].every(Number.isFinite)) {
    throw new Error("crown axis projection requires finite inputs");
  }
  if (worldUnitsPerLocalUnit <= 0 || baseLocalExtent <= 0 || min > max || step <= 0) {
    throw new Error("crown axis projection requires positive scale, extent, step, and ordered bounds");
  }
  const unclamped = startValue + worldDelta / (worldUnitsPerLocalUnit * baseLocalExtent);
  const clamped = THREE.MathUtils.clamp(unclamped, min, max);
  const value = THREE.MathUtils.clamp(Math.round(clamped / step) * step, min, max);
  return { value: Number(value.toFixed(6)), unclamped };
};

const AXES: readonly ProcPlantCrownAxis[] = ["width", "height", "depth"];
const AXIS_INDEX: Record<ProcPlantCrownAxis, number> = { width: 0, height: 1, depth: 2 };
const AXIS_VECTOR: Record<ProcPlantCrownAxis, THREE.Vector3> = {
  width: new THREE.Vector3(1, 0, 0),
  height: new THREE.Vector3(0, 1, 0),
  depth: new THREE.Vector3(0, 0, 1),
};
const AXIS_COLOR: Record<ProcPlantCrownAxis, number> = {
  width: 0xff6b6b,
  height: 0x7fe36b,
  depth: 0x66aaff,
};

interface AxisDragState {
  kind: "axis";
  pointerId: number;
  axis: ProcPlantCrownAxis;
  startValues: ProcPlantCrownVolumeValues;
  startPlanePoint: THREE.Vector3;
  axisWorld: THREE.Vector3;
  plane: THREE.Plane;
  worldUnitsPerLocalUnit: number;
  baseLocalExtent: number;
}

interface ControlDragState {
  kind: "control";
  pointerId: number;
  volumeId: string;
  startField: ProcPlantFreeformCrown;
  startPlanePoint: THREE.Vector3;
  startDisplayCenter: THREE.Vector3;
  plane: THREE.Plane;
}

type DragState = AxisDragState | ControlDragState;

const copyValues = (values: ProcPlantCrownVolumeValues): ProcPlantCrownVolumeValues => ({
  width: values.width,
  height: values.height,
  depth: values.depth,
});

export class ProcPlantCrownVolumeTool {
  readonly root = new THREE.Group();

  private readonly canvas: HTMLCanvasElement;
  private readonly camera: THREE.Camera;
  private readonly shape: ProcPlantCrownVolumeToolOptions["shape"];
  private readonly center = new THREE.Vector3();
  private readonly dimensions = new THREE.Vector3();
  private readonly values: ProcPlantCrownVolumeValues;
  private readonly min: number;
  private readonly max: number;
  private readonly step: number;
  private readonly onPreview: ProcPlantCrownVolumeToolOptions["onPreview"];
  private readonly onCommit: ProcPlantCrownVolumeToolOptions["onCommit"];
  private readonly onCancel: ProcPlantCrownVolumeToolOptions["onCancel"];
  private readonly onDraggingChange?: ProcPlantCrownVolumeToolOptions["onDraggingChange"];
  private readonly onFreeformPreview?: ProcPlantCrownVolumeToolOptions["onFreeformPreview"];
  private readonly onFreeformCommit?: ProcPlantCrownVolumeToolOptions["onFreeformCommit"];
  private readonly onFreeformCancel?: ProcPlantCrownVolumeToolOptions["onFreeformCancel"];
  private readonly onFreeformDraggingChange?: ProcPlantCrownVolumeToolOptions["onFreeformDraggingChange"];
  private readonly onSelectionChange?: ProcPlantCrownVolumeToolOptions["onSelectionChange"];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly intersection = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly worldOrigin = new THREE.Vector3();
  private readonly worldAxisPoint = new THREE.Vector3();
  private readonly volume: THREE.Mesh;
  private readonly handles = new Map<ProcPlantCrownAxis, THREE.Mesh>();
  private readonly rails = new Map<ProcPlantCrownAxis, THREE.Mesh>();
  private readonly controlVolumes = new Map<string, THREE.Mesh>();
  private readonly controlHandles = new Map<string, THREE.Mesh>();
  private freeform: ProcPlantFreeformCrown | null;
  private selectedVolumeId: string | null = null;
  private drag: DragState | null = null;
  private hoveredAxis: ProcPlantCrownAxis | null = null;
  private disposed = false;

  constructor(options: ProcPlantCrownVolumeToolOptions) {
    this.canvas = options.canvas;
    this.camera = options.camera;
    this.shape = options.shape;
    this.center.fromArray(options.center);
    this.dimensions.fromArray(options.dimensions);
    if (this.dimensions.x <= 0 || this.dimensions.y <= 0 || this.dimensions.z <= 0) {
      throw new Error("crown volume dimensions must be positive");
    }
    this.min = options.min ?? 0.5;
    this.max = options.max ?? 1.8;
    this.step = options.step ?? 0.05;
    projectProcPlantCrownAxisValue(1, 0, 1, 1, this.min, this.max, this.step);
    this.values = copyValues(options.values);
    this.onPreview = options.onPreview;
    this.onCommit = options.onCommit;
    this.onCancel = options.onCancel;
    this.onDraggingChange = options.onDraggingChange;
    this.onFreeformPreview = options.onFreeformPreview;
    this.onFreeformCommit = options.onFreeformCommit;
    this.onFreeformCancel = options.onFreeformCancel;
    this.onFreeformDraggingChange = options.onFreeformDraggingChange;
    this.onSelectionChange = options.onSelectionChange;
    this.freeform = options.freeform ? cloneProcPlantFreeformCrown(options.freeform) : null;

    this.root.name = "procplant-crown-volume-tool";
    this.root.renderOrder = 30;
    const volumeGeometry = this.shape === "ellipsoid"
      ? new THREE.SphereGeometry(1, 24, 14)
      : new THREE.BoxGeometry(1, 1, 1);
    const volumeMaterial = new THREE.MeshBasicMaterial({
      color: 0xf0d891,
      wireframe: true,
      transparent: true,
      opacity: 0.38,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.volume = new THREE.Mesh(volumeGeometry, volumeMaterial);
    this.volume.name = `procplant-crown-${this.shape}`;
    this.volume.renderOrder = 30;
    this.root.add(this.volume);

    for (const axis of AXES) {
      const material = new THREE.MeshBasicMaterial({
        color: AXIS_COLOR[axis],
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 8), material);
      rail.name = `procplant-crown-${axis}-rail`;
      rail.renderOrder = 31;
      if (axis === "width") rail.rotation.z = -Math.PI / 2;
      if (axis === "depth") rail.rotation.x = Math.PI / 2;
      this.rails.set(axis, rail);
      this.root.add(rail);

      const handle = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 10), material);
      handle.name = `procplant-crown-${axis}-handle`;
      handle.userData.procplantCrownAxis = axis;
      handle.renderOrder = 32;
      this.handles.set(axis, handle);
      this.root.add(handle);
    }
    this.setValues(this.values);
    this.rebuildControlMeshes();

    this.canvas.addEventListener("pointerdown", this.handlePointerDown, true);
    this.canvas.addEventListener("pointermove", this.handlePointerMove, true);
    this.canvas.addEventListener("pointerup", this.handlePointerUp, true);
    this.canvas.addEventListener("pointercancel", this.handlePointerCancel, true);
    this.canvas.addEventListener("lostpointercapture", this.handleLostPointerCapture, true);
    window.addEventListener("keydown", this.handleKeyDown, true);
  }

  setValues(values: ProcPlantCrownVolumeValues) {
    this.values.width = THREE.MathUtils.clamp(values.width, this.min, this.max);
    this.values.height = THREE.MathUtils.clamp(values.height, this.min, this.max);
    this.values.depth = THREE.MathUtils.clamp(values.depth, this.min, this.max);
    const multipliers = [this.values.width, this.values.height, this.values.depth] as const;
    const extents = AXES.map((axis) => this.baseExtent(axis) * multipliers[AXIS_INDEX[axis]]);
    this.volume.position.copy(this.center);
    this.volume.scale.set(
      this.dimensions.x * this.values.width,
      this.dimensions.y * this.values.height,
      this.dimensions.z * this.values.depth,
    );
    for (const axis of AXES) {
      const index = AXIS_INDEX[axis];
      const extent = extents[index]!;
      const axisVector = AXIS_VECTOR[axis];
      this.handles.get(axis)!.position.copy(this.center).addScaledVector(axisVector, extent);
      const rail = this.rails.get(axis)!;
      rail.position.copy(this.center).addScaledVector(axisVector, extent * 0.5);
      rail.scale.set(1, extent, 1);
    }
    this.syncControlMeshes();
  }

  getFreeform() {
    return this.freeform ? cloneProcPlantFreeformCrown(this.freeform) : null;
  }

  getSelectedVolumeId() {
    return this.selectedVolumeId;
  }

  getSelectedControlVolume() {
    const field = this.freeform ? cloneProcPlantFreeformCrown(this.freeform) : null;
    return field?.volumes.find((volume) => volume.id === this.selectedVolumeId) ?? null;
  }

  updateSelectedControlVolume(update: ProcPlantCrownControlVolumeUpdate) {
    if (!this.freeform || !this.selectedVolumeId) return this.getFreeform();
    const selectedId = this.selectedVolumeId;
    const volumes = this.freeform.volumes.map((volume) => {
      if (volume.id !== selectedId) return volume;
      return {
        ...volume,
        ...(update.operation === undefined ? {} : { operation: update.operation }),
        ...(update.dimensions === undefined ? {} : { dimensions: [...update.dimensions] as [number, number, number] }),
        ...(update.weight === undefined ? {} : { weight: update.weight }),
        ...(update.rotation === undefined
          ? {}
          : update.rotation === null
            ? { rotation: undefined }
            : { rotation: [...update.rotation] as [number, number, number, number] }),
      };
    });
    this.freeform = cloneProcPlantFreeformCrown({
      contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
      version: PROCPLANT_FREEFORM_CROWN_VERSION,
      volumes,
    });
    this.syncControlMeshes();
    this.onFreeformCommit?.(cloneProcPlantFreeformCrown(this.freeform), selectedId);
    return cloneProcPlantFreeformCrown(this.freeform);
  }

  addControlVolume(shape: "ellipsoid" | "box" = "ellipsoid", operation: "add" | "subtract" = "add") {
    const volumes = this.freeform?.volumes.map((volume) => ({ ...volume })) ?? [{
      id: "volume-1",
      shape: this.shape,
      center: this.center.toArray() as [number, number, number],
      dimensions: this.dimensions.toArray() as [number, number, number],
    }];
    if (volumes.length >= PROCPLANT_FREEFORM_CROWN_MAX_VOLUMES) {
      throw new Error(`freeform crown control-volume cap exceeded (${PROCPLANT_FREEFORM_CROWN_MAX_VOLUMES})`);
    }
    let ordinal = volumes.length + 1;
    const ids = new Set(volumes.map((volume) => volume.id));
    while (ids.has(`volume-${ordinal}`)) ordinal++;
    const side = ordinal % 2 === 0 ? 1 : -1;
    const ring = Math.max(1, Math.ceil((ordinal - 1) / 2));
    const id = `volume-${ordinal}`;
    const selected = volumes.find((volume) => volume.id === this.selectedVolumeId) ?? volumes[0]!;
    volumes.push({
      id,
      ...(operation === "add" ? {} : { operation }),
      shape,
      center: operation === "subtract" ? [...selected.center] : [
        this.center.x + side * this.dimensions.x * 0.48 * ring,
        this.center.y + this.dimensions.y * 0.08 * ((ordinal % 3) - 1),
        this.center.z + this.dimensions.z * 0.14 * ((ordinal % 2) ? -1 : 1),
      ],
      dimensions: operation === "subtract"
        ? selected.dimensions.map((value) => value * 0.45) as [number, number, number]
        : [this.dimensions.x * 0.48, this.dimensions.y * 0.48, this.dimensions.z * 0.48],
    });
    this.freeform = cloneProcPlantFreeformCrown({
      contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
      version: PROCPLANT_FREEFORM_CROWN_VERSION,
      volumes,
    });
    this.setSelectedVolume(id);
    this.rebuildControlMeshes();
    this.onFreeformCommit?.(cloneProcPlantFreeformCrown(this.freeform), id);
    return cloneProcPlantFreeformCrown(this.freeform);
  }

  removeSelectedControlVolume() {
    if (!this.freeform || !this.selectedVolumeId) return this.getFreeform();
    const removed = this.selectedVolumeId;
    const volumes = this.freeform.volumes.filter((volume) => volume.id !== removed);
    const hasAdditive = volumes.some((volume) => volume.operation !== "subtract");
    this.freeform = volumes.length && hasAdditive ? {
      contract: PROCPLANT_FREEFORM_CROWN_CONTRACT,
      version: PROCPLANT_FREEFORM_CROWN_VERSION,
      volumes,
    } : null;
    this.setSelectedVolume(volumes[0]?.id ?? null);
    this.rebuildControlMeshes();
    this.onFreeformCommit?.(this.getFreeform(), this.selectedVolumeId);
    return this.getFreeform();
  }

  cancel() {
    if (this.drag) this.cancelDrag();
  }

  dispose() {
    if (this.disposed) return;
    if (this.drag) this.cancelDrag();
    this.disposed = true;
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown, true);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove, true);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp, true);
    this.canvas.removeEventListener("pointercancel", this.handlePointerCancel, true);
    this.canvas.removeEventListener("lostpointercapture", this.handleLostPointerCapture, true);
    window.removeEventListener("keydown", this.handleKeyDown, true);
    this.canvas.style.removeProperty("cursor");
    this.root.removeFromParent();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of objectMaterials) materials.add(material);
    });
    this.root.clear();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }

  private baseExtent(axis: ProcPlantCrownAxis) {
    const dimension = this.dimensions.getComponent(AXIS_INDEX[axis]);
    return this.shape === "ellipsoid" ? dimension : dimension * 0.5;
  }

  private displayedCenter(volume: ProcPlantCrownControlVolume) {
    return new THREE.Vector3(
      this.center.x + (volume.center[0] - this.center.x) * this.values.width,
      this.center.y + (volume.center[1] - this.center.y) * this.values.height,
      this.center.z + (volume.center[2] - this.center.z) * this.values.depth,
    );
  }

  private setSelectedVolume(volumeId: string | null) {
    this.selectedVolumeId = volumeId;
    for (const [id, handle] of this.controlHandles) handle.scale.setScalar(id === volumeId ? 1.35 : 1);
    this.onSelectionChange?.(volumeId);
  }

  private disposeMesh(mesh: THREE.Mesh) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => material.dispose());
  }

  private rebuildControlMeshes() {
    for (const mesh of this.controlVolumes.values()) this.disposeMesh(mesh);
    for (const mesh of this.controlHandles.values()) this.disposeMesh(mesh);
    this.controlVolumes.clear();
    this.controlHandles.clear();
    if (!this.freeform) return;
    for (const control of this.freeform.volumes) {
      const volumeMaterial = new THREE.MeshBasicMaterial({
        color: control.operation === "subtract" ? 0xff6688 : control.id === this.selectedVolumeId ? 0xffc857 : 0x79d8ff,
        wireframe: true,
        transparent: true,
        opacity: 0.52,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      const geometry = control.shape === "ellipsoid"
        ? new THREE.SphereGeometry(1, 18, 10)
        : new THREE.BoxGeometry(1, 1, 1);
      const volumeMesh = new THREE.Mesh(geometry, volumeMaterial);
      volumeMesh.name = `procplant-crown-control-${control.id}`;
      volumeMesh.renderOrder = 33;
      this.controlVolumes.set(control.id, volumeMesh);
      this.root.add(volumeMesh);

      const handle = new THREE.Mesh(
        new THREE.SphereGeometry(0.115, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xffc857, depthTest: false, depthWrite: false, toneMapped: false }),
      );
      handle.name = `procplant-crown-control-${control.id}-handle`;
      handle.userData.procplantCrownVolumeId = control.id;
      handle.renderOrder = 34;
      this.controlHandles.set(control.id, handle);
      this.root.add(handle);
    }
    this.syncControlMeshes();
    this.setSelectedVolume(this.selectedVolumeId && this.controlHandles.has(this.selectedVolumeId)
      ? this.selectedVolumeId
      : this.freeform.volumes[0]?.id ?? null);
  }

  private syncControlMeshes() {
    if (!this.freeform) return;
    for (const control of this.freeform.volumes) {
      const center = this.displayedCenter(control);
      const volume = this.controlVolumes.get(control.id);
      const handle = this.controlHandles.get(control.id);
      if (!volume || !handle) continue;
      volume.position.copy(center);
      volume.scale.set(
        control.dimensions[0] * this.values.width,
        control.dimensions[1] * this.values.height,
        control.dimensions[2] * this.values.depth,
      );
      volume.quaternion.fromArray(control.rotation ?? [0, 0, 0, 1]);
      handle.position.copy(center);
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
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private pickTarget(event: PointerEvent): { kind: "axis"; axis: ProcPlantCrownAxis } | { kind: "control"; volumeId: string } | null {
    this.updateRay(event);
    const hit = this.raycaster.intersectObjects([
      ...this.handles.values(),
      ...this.controlHandles.values(),
    ], false)[0];
    const axis = hit?.object.userData.procplantCrownAxis as ProcPlantCrownAxis | undefined;
    if (axis) return { kind: "axis", axis };
    const volumeId = hit?.object.userData.procplantCrownVolumeId as string | undefined;
    return volumeId ? { kind: "control", volumeId } : null;
  }

  private setHoveredAxis(axis: ProcPlantCrownAxis | null) {
    if (axis === this.hoveredAxis) return;
    if (this.hoveredAxis) this.handles.get(this.hoveredAxis)?.scale.setScalar(1);
    this.hoveredAxis = axis;
    if (axis) this.handles.get(axis)?.scale.setScalar(1.24);
    this.canvas.style.cursor = axis ? (axis === "height" ? "ns-resize" : "ew-resize") : "";
  }

  private beginDrag(event: PointerEvent, axis: ProcPlantCrownAxis) {
    this.updateRay(event);
    const handle = this.handles.get(axis)!;
    const handleWorld = handle.getWorldPosition(this.worldOrigin);
    const axisWorld = AXIS_VECTOR[axis].clone().transformDirection(this.root.matrixWorld).normalize();
    const planeNormal = this.scratch.copy(this.raycaster.ray.direction)
      .addScaledVector(axisWorld, -this.raycaster.ray.direction.dot(axisWorld));
    if (planeNormal.lengthSq() < 1e-8) {
      this.camera.getWorldDirection(planeNormal).addScaledVector(axisWorld, -planeNormal.dot(axisWorld));
    }
    if (planeNormal.lengthSq() < 1e-8) {
      planeNormal.set(0, 1, 0).transformDirection(this.camera.matrixWorld)
        .addScaledVector(axisWorld, -planeNormal.dot(axisWorld));
    }
    if (planeNormal.lengthSq() < 1e-8) {
      planeNormal.copy(Math.abs(axisWorld.y) < 0.9 ? AXIS_VECTOR.height : AXIS_VECTOR.width)
        .addScaledVector(axisWorld, -planeNormal.dot(axisWorld));
    }
    planeNormal.normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, handleWorld);
    const startPlanePoint = this.raycaster.ray.intersectPlane(plane, this.intersection);
    if (!startPlanePoint) return;
    this.root.localToWorld(this.worldOrigin.copy(this.center));
    this.root.localToWorld(this.worldAxisPoint.copy(this.center).add(AXIS_VECTOR[axis]));
    const worldUnitsPerLocalUnit = this.worldOrigin.distanceTo(this.worldAxisPoint);
    if (!(worldUnitsPerLocalUnit > 0)) return;
    this.drag = {
      kind: "axis",
      pointerId: event.pointerId,
      axis,
      startValues: copyValues(this.values),
      startPlanePoint: startPlanePoint.clone(),
      axisWorld,
      plane,
      worldUnitsPerLocalUnit,
      baseLocalExtent: this.baseExtent(axis),
    };
    this.canvas.setPointerCapture(event.pointerId);
    this.setHoveredAxis(axis);
    this.onDraggingChange?.(true, axis);
  }

  private beginControlDrag(event: PointerEvent, volumeId: string) {
    if (!this.freeform) return;
    this.updateRay(event);
    const handle = this.controlHandles.get(volumeId);
    if (!handle) return;
    const handleWorld = handle.getWorldPosition(this.worldOrigin);
    const normal = new THREE.Vector3();
    this.camera.getWorldDirection(normal);
    if (normal.lengthSq() < 1e-8) normal.copy(this.raycaster.ray.direction);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(), handleWorld);
    const startPlanePoint = this.raycaster.ray.intersectPlane(plane, this.intersection);
    if (!startPlanePoint) return;
    const volume = this.freeform.volumes.find((candidate) => candidate.id === volumeId);
    if (!volume) return;
    this.drag = {
      kind: "control",
      pointerId: event.pointerId,
      volumeId,
      startField: cloneProcPlantFreeformCrown(this.freeform),
      startPlanePoint: startPlanePoint.clone(),
      startDisplayCenter: this.displayedCenter(volume),
      plane,
    };
    this.setSelectedVolume(volumeId);
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.style.cursor = "move";
    this.onFreeformDraggingChange?.(true, volumeId);
  }

  private previewDrag(event: PointerEvent) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.updateRay(event);
    const point = this.raycaster.ray.intersectPlane(drag.plane, this.intersection);
    if (!point) return;
    if (drag.kind === "control") {
      const localPoint = this.root.worldToLocal(point.clone());
      const localStart = this.root.worldToLocal(drag.startPlanePoint.clone());
      const displayCenter = drag.startDisplayCenter.clone().add(localPoint.sub(localStart));
      const authoredCenter: [number, number, number] = [
        this.center.x + (displayCenter.x - this.center.x) / this.values.width,
        this.center.y + (displayCenter.y - this.center.y) / this.values.height,
        this.center.z + (displayCenter.z - this.center.z) / this.values.depth,
      ].map((value) => THREE.MathUtils.clamp(value, -1_000_000, 1_000_000)) as [number, number, number];
      this.freeform = {
        ...this.freeform!,
        volumes: this.freeform!.volumes.map((volume) => volume.id === drag.volumeId
          ? { ...volume, center: authoredCenter }
          : volume),
      };
      this.syncControlMeshes();
      this.onFreeformPreview?.(cloneProcPlantFreeformCrown(this.freeform), drag.volumeId);
      return;
    }
    const worldDelta = this.scratch.copy(point).sub(drag.startPlanePoint).dot(drag.axisWorld);
    const startValue = drag.startValues[drag.axis];
    const { value } = projectProcPlantCrownAxisValue(
      startValue,
      worldDelta,
      drag.worldUnitsPerLocalUnit,
      drag.baseLocalExtent,
      this.min,
      this.max,
      this.step,
    );
    if (this.values[drag.axis] === value) return;
    this.values[drag.axis] = value;
    this.setValues(this.values);
    this.onPreview(copyValues(this.values), drag.axis);
  }

  private finishDrag() {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (this.canvas.hasPointerCapture(drag.pointerId)) this.canvas.releasePointerCapture(drag.pointerId);
    if (drag.kind === "axis") {
      this.onDraggingChange?.(false, drag.axis);
      this.onCommit(copyValues(this.values), drag.axis);
    } else {
      this.onFreeformDraggingChange?.(false, drag.volumeId);
      this.onFreeformCommit?.(this.getFreeform(), drag.volumeId);
    }
  }

  private cancelDrag() {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (this.canvas.hasPointerCapture(drag.pointerId)) this.canvas.releasePointerCapture(drag.pointerId);
    if (drag.kind === "axis") {
      this.setValues(drag.startValues);
      this.onDraggingChange?.(false, drag.axis);
      this.onCancel(copyValues(drag.startValues), drag.axis);
    } else {
      this.freeform = cloneProcPlantFreeformCrown(drag.startField);
      this.rebuildControlMeshes();
      this.onFreeformDraggingChange?.(false, drag.volumeId);
      this.onFreeformCancel?.(cloneProcPlantFreeformCrown(this.freeform), drag.volumeId);
    }
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (this.disposed || event.button !== 0 || this.drag) return;
    const target = this.pickTarget(event);
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (target.kind === "axis") this.beginDrag(event, target.axis);
    else this.beginControlDrag(event, target.volumeId);
  };

  private handlePointerMove = (event: PointerEvent) => {
    if (this.disposed) return;
    if (this.drag) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.previewDrag(event);
      return;
    }
    const target = this.pickTarget(event);
    this.setHoveredAxis(target?.kind === "axis" ? target.axis : null);
    if (target?.kind === "control") this.canvas.style.cursor = "move";
  };

  private handlePointerUp = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.finishDrag();
  };

  private handlePointerCancel = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.cancelDrag();
  };

  private handleLostPointerCapture = (event: PointerEvent) => {
    if (this.drag?.pointerId === event.pointerId) this.cancelDrag();
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !this.drag) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.cancelDrag();
  };
}

export const createProcPlantCrownVolumeTool = (options: ProcPlantCrownVolumeToolOptions) =>
  new ProcPlantCrownVolumeTool(options);
