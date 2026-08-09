import * as THREE from "three";
import type { ProcPlantGraph, ProcPlantSegmentRecord } from "./procplants";

export interface ProcPlantPruneToolOptions {
  /** Multiplier applied to authored stem radius when building pick cylinders. */
  radiusScale?: number;
  /** Minimum local-space pick radius for very thin twigs. */
  minimumRadius?: number;
  radialSegments?: number;
  visible?: boolean;
  opacity?: number;
  depthTest?: boolean;
  layer?: number;
  baseColor?: number;
  highlightColor?: number;
  selectedColor?: number;
}

export interface ProcPlantPickViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ProcPlantSegmentPick {
  segmentId: string;
  instanceId: number;
  distance: number;
  point: THREE.Vector3;
  segment: ProcPlantSegmentRecord;
}

export interface ProcPlantNdcPoint {
  readonly x: number;
  readonly y: number;
}

export type ProcPlantSegmentSelectionMode = "replace" | "additive";

export interface ProcPlantStrokeSelectionOptions {
  /** Replace the current selection, or add hits to it. */
  mode?: ProcPlantSegmentSelectionMode;
  /** Additional half-width around the NDC stroke. */
  radiusNdc?: number;
}

export interface ProcPlantLassoSelectionOptions {
  /** Replace the current selection, or add hits to it. */
  mode?: ProcPlantSegmentSelectionMode;
  /** Additional NDC tolerance outside the projected cylinder silhouette. */
  edgeToleranceNdc?: number;
}

export interface ProcPlantSegmentSelectionResult {
  readonly mode: ProcPlantSegmentSelectionMode;
  /** Hits from this gesture, in stable segment-ID order. */
  readonly matchedSegmentIds: readonly string[];
  /** Complete selection after applying the gesture, in stable segment-ID order. */
  readonly selectedSegmentIds: readonly string[];
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

const pointToSegmentDistanceSquared = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) => {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }
  const t = THREE.MathUtils.clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1);
  const ex = px - (ax + dx * t);
  const ey = py - (ay + dy * t);
  return ex * ex + ey * ey;
};

const orientation2d = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

const onSegment2d = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) => pointToSegmentDistanceSquared(px, py, ax, ay, bx, by) <= 1e-14;

const segmentsIntersect2d = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
) => {
  const o1 = orientation2d(ax, ay, bx, by, cx, cy);
  const o2 = orientation2d(ax, ay, bx, by, dx, dy);
  const o3 = orientation2d(cx, cy, dx, dy, ax, ay);
  const o4 = orientation2d(cx, cy, dx, dy, bx, by);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) {
    return true;
  }
  return (Math.abs(o1) <= 1e-12 && onSegment2d(cx, cy, ax, ay, bx, by))
    || (Math.abs(o2) <= 1e-12 && onSegment2d(dx, dy, ax, ay, bx, by))
    || (Math.abs(o3) <= 1e-12 && onSegment2d(ax, ay, cx, cy, dx, dy))
    || (Math.abs(o4) <= 1e-12 && onSegment2d(bx, by, cx, cy, dx, dy));
};

const segmentDistanceSquared2d = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
) => {
  if (segmentsIntersect2d(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    pointToSegmentDistanceSquared(ax, ay, cx, cy, dx, dy),
    pointToSegmentDistanceSquared(bx, by, cx, cy, dx, dy),
    pointToSegmentDistanceSquared(cx, cy, ax, ay, bx, by),
    pointToSegmentDistanceSquared(dx, dy, ax, ay, bx, by),
  );
};

const pointInPolygon = (x: number, y: number, polygon: readonly ProcPlantNdcPoint[]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (onSegment2d(x, y, a.x, a.y, b.x, b.y)) return true;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
};

const hasOnlyFinitePoints = (points: readonly ProcPlantNdcPoint[]) => {
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  }
  return true;
};

export class ProcPlantPruneTool {
  readonly object: THREE.InstancedMesh;
  readonly segmentIds: readonly string[];

  private readonly segments: ProcPlantSegmentRecord[];
  private readonly instanceBySegmentId = new Map<string, number>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly intersections: THREE.Intersection<THREE.InstancedMesh>[] = [];
  private readonly color = new THREE.Color();
  private readonly baseColor: number;
  private readonly highlightColor: number;
  private readonly selectedColor: number;
  private readonly segmentEndpoints: Float32Array;
  private readonly segmentRadii: Float32Array;
  private readonly projectedSegments: Float32Array;
  private readonly projectedRadii: Float32Array;
  private readonly projectedVisible: Uint8Array;
  private readonly matchedFlags: Uint8Array;
  private readonly selectedFlags: Uint8Array;
  private readonly worldStart = new THREE.Vector3();
  private readonly worldEnd = new THREE.Vector3();
  private readonly viewStart = new THREE.Vector3();
  private readonly viewEnd = new THREE.Vector3();
  private readonly projectedPoint = new THREE.Vector3();
  private readonly projectedOffset = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private readonly cameraUp = new THREE.Vector3();
  private selectedSegmentId: string | null = null;
  private highlightedSegmentId: string | null = null;
  private disposed = false;

  constructor(graph: ProcPlantGraph, options: ProcPlantPruneToolOptions = {}) {
    const radiusScale = Math.max(0.01, options.radiusScale ?? 1.8);
    const minimumRadius = Math.max(1e-4, options.minimumRadius ?? 0.018);
    const radialSegments = Math.max(3, Math.floor(options.radialSegments ?? 6));
    this.baseColor = options.baseColor ?? 0x54b8ff;
    this.highlightColor = options.highlightColor ?? 0xffd166;
    this.selectedColor = options.selectedColor ?? 0xff5d73;

    this.segments = graph.segmentRecords
      .filter((segment) => graph.stems[segment.startNodeIndex] && graph.stems[segment.endNodeIndex])
      .slice()
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.segmentIds = this.segments.map((segment) => segment.id);
    this.segmentEndpoints = new Float32Array(this.segments.length * 6);
    this.segmentRadii = new Float32Array(this.segments.length);
    this.projectedSegments = new Float32Array(this.segments.length * 4);
    this.projectedRadii = new Float32Array(this.segments.length);
    this.projectedVisible = new Uint8Array(this.segments.length);
    this.matchedFlags = new Uint8Array(this.segments.length);
    this.selectedFlags = new Uint8Array(this.segments.length);

    const geometry = new THREE.CylinderGeometry(1, 1, 1, radialSegments, 1, false);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: THREE.MathUtils.clamp(options.opacity ?? 0.24, 0, 1),
      depthTest: options.depthTest ?? false,
      depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, this.segments.length);
    mesh.name = "procplant-prune-segment-picker";
    mesh.visible = options.visible ?? true;
    mesh.renderOrder = 20;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    if (options.layer !== undefined) mesh.layers.set(options.layer);

    const midpoint = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < this.segments.length; i++) {
      const segment = this.segments[i];
      const start = graph.stems[segment.startNodeIndex];
      const end = graph.stems[segment.endNodeIndex];
      direction.subVectors(end.position, start.position);
      const length = Math.max(1e-5, direction.length());
      direction.multiplyScalar(1 / length);
      midpoint.addVectors(start.position, end.position).multiplyScalar(0.5);
      quaternion.setFromUnitVectors(Y_AXIS, direction);
      const radius = Math.max(minimumRadius, Math.max(start.radius, end.radius) * radiusScale);
      const endpointOffset = i * 6;
      this.segmentEndpoints[endpointOffset] = start.position.x;
      this.segmentEndpoints[endpointOffset + 1] = start.position.y;
      this.segmentEndpoints[endpointOffset + 2] = start.position.z;
      this.segmentEndpoints[endpointOffset + 3] = end.position.x;
      this.segmentEndpoints[endpointOffset + 4] = end.position.y;
      this.segmentEndpoints[endpointOffset + 5] = end.position.z;
      this.segmentRadii[i] = radius;
      scale.set(radius, length, radius);
      matrix.compose(midpoint, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, this.color.setHex(this.baseColor));
      this.instanceBySegmentId.set(segment.id, i);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.userData.procplantPruneTool = true;
    mesh.userData.segmentIds = this.segmentIds;
    this.object = mesh;
  }

  pick(raycaster: THREE.Raycaster = this.raycaster): ProcPlantSegmentPick | null {
    this.assertUsable();
    this.intersections.length = 0;
    this.object.updateWorldMatrix(true, false);
    raycaster.intersectObject(this.object, false, this.intersections);
    const hit = this.intersections[0];
    if (!hit || hit.instanceId === undefined) return null;
    const segment = this.segments[hit.instanceId];
    if (!segment) return null;
    return {
      segmentId: segment.id,
      instanceId: hit.instanceId,
      distance: hit.distance,
      point: hit.point,
      segment,
    };
  }

  pickFromNdc(
    x: number,
    y: number,
    camera: THREE.Camera,
    raycaster: THREE.Raycaster = this.raycaster,
  ) {
    this.assertUsable();
    this.ndc.set(THREE.MathUtils.clamp(x, -1, 1), THREE.MathUtils.clamp(y, -1, 1));
    raycaster.setFromCamera(this.ndc, camera);
    return this.pick(raycaster);
  }

  pickFromScreen(
    clientX: number,
    clientY: number,
    viewport: ProcPlantPickViewport,
    camera: THREE.Camera,
    raycaster: THREE.Raycaster = this.raycaster,
  ) {
    this.assertUsable();
    if (viewport.width <= 0 || viewport.height <= 0) return null;
    const localX = (clientX - viewport.left) / viewport.width;
    const localY = (clientY - viewport.top) / viewport.height;
    if (localX < 0 || localX > 1 || localY < 0 || localY > 1) return null;
    return this.pickFromNdc(localX * 2 - 1, -(localY * 2 - 1), camera, raycaster);
  }

  /** Return stroke hits without changing selection. */
  findSegmentsFromNdcStroke(
    points: readonly ProcPlantNdcPoint[],
    camera: THREE.Camera,
    radiusNdc = 0.012,
  ) {
    this.assertUsable();
    this.matchNdcStroke(points, camera, radiusNdc);
    return this.collectFlaggedSegmentIds(this.matchedFlags);
  }

  /** Select projected segment cylinders intersected by an open NDC polyline. */
  selectSegmentsFromNdcStroke(
    points: readonly ProcPlantNdcPoint[],
    camera: THREE.Camera,
    options: ProcPlantStrokeSelectionOptions = {},
  ): ProcPlantSegmentSelectionResult {
    this.assertUsable();
    this.matchNdcStroke(points, camera, options.radiusNdc ?? 0.012);
    return this.applyMatchedSelection(options.mode ?? "replace");
  }

  /** Return lasso hits without changing selection. */
  findSegmentsFromNdcLasso(
    polygon: readonly ProcPlantNdcPoint[],
    camera: THREE.Camera,
    edgeToleranceNdc = 0,
  ) {
    this.assertUsable();
    this.matchNdcLasso(polygon, camera, edgeToleranceNdc);
    return this.collectFlaggedSegmentIds(this.matchedFlags);
  }

  /** Select projected segment cylinders overlapping a closed NDC polygon. */
  selectSegmentsFromNdcLasso(
    polygon: readonly ProcPlantNdcPoint[],
    camera: THREE.Camera,
    options: ProcPlantLassoSelectionOptions = {},
  ): ProcPlantSegmentSelectionResult {
    this.assertUsable();
    this.matchNdcLasso(polygon, camera, options.edgeToleranceNdc ?? 0);
    return this.applyMatchedSelection(options.mode ?? "replace");
  }

  segmentIdForInstance(instanceId: number) {
    return this.segmentIds[instanceId] ?? null;
  }

  setSelectedSegment(segmentId: string | null) {
    this.assertUsable();
    if (segmentId !== null && !this.instanceBySegmentId.has(segmentId)) return false;
    this.matchedFlags.fill(0);
    if (segmentId !== null) this.matchedFlags[this.instanceBySegmentId.get(segmentId)!] = 1;
    this.applyMatchedSelection("replace");
    return true;
  }

  setSelectedSegments(
    segmentIds: readonly string[],
    mode: ProcPlantSegmentSelectionMode = "replace",
  ): ProcPlantSegmentSelectionResult {
    this.assertUsable();
    this.matchedFlags.fill(0);
    for (let i = 0; i < segmentIds.length; i++) {
      const instanceId = this.instanceBySegmentId.get(segmentIds[i]!);
      if (instanceId !== undefined) this.matchedFlags[instanceId] = 1;
    }
    return this.applyMatchedSelection(mode);
  }

  getSelectedSegment() {
    return this.selectedSegmentId;
  }

  getSelectedSegments() {
    this.assertUsable();
    return this.collectFlaggedSegmentIds(this.selectedFlags);
  }

  setHighlightedSegment(segmentId: string | null) {
    this.assertUsable();
    if (segmentId !== null && !this.instanceBySegmentId.has(segmentId)) return false;
    const previous = this.highlightedSegmentId;
    this.highlightedSegmentId = segmentId;
    this.refreshSegmentColor(previous);
    this.refreshSegmentColor(segmentId);
    this.object.userData.highlightedSegmentId = segmentId;
    return true;
  }

  getHighlightedSegment() {
    return this.highlightedSegmentId;
  }

  setVisible(visible: boolean) {
    this.assertUsable();
    this.object.visible = visible;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.object.removeFromParent();
    this.object.geometry.dispose();
    const materials = Array.isArray(this.object.material) ? this.object.material : [this.object.material];
    for (const material of materials) material.dispose();
    this.intersections.length = 0;
    this.instanceBySegmentId.clear();
  }

  private matchNdcStroke(
    points: readonly ProcPlantNdcPoint[],
    camera: THREE.Camera,
    radiusNdc: number,
  ) {
    this.matchedFlags.fill(0);
    if (points.length === 0 || !hasOnlyFinitePoints(points)) return;
    this.updateProjectedSegments(camera);
    const strokeRadius = Math.max(0, Number.isFinite(radiusNdc) ? radiusNdc : 0);
    for (let i = 0; i < this.segments.length; i++) {
      if (!this.projectedVisible[i]) continue;
      const offset = i * 4;
      const ax = this.projectedSegments[offset]!;
      const ay = this.projectedSegments[offset + 1]!;
      const bx = this.projectedSegments[offset + 2]!;
      const by = this.projectedSegments[offset + 3]!;
      const radius = strokeRadius + this.projectedRadii[i]!;
      const radiusSquared = radius * radius;
      if (points.length === 1) {
        const point = points[0]!;
        if (pointToSegmentDistanceSquared(point.x, point.y, ax, ay, bx, by) <= radiusSquared) {
          this.matchedFlags[i] = 1;
        }
        continue;
      }
      for (let j = 1; j < points.length; j++) {
        const start = points[j - 1]!;
        const end = points[j]!;
        if (segmentDistanceSquared2d(ax, ay, bx, by, start.x, start.y, end.x, end.y) <= radiusSquared) {
          this.matchedFlags[i] = 1;
          break;
        }
      }
    }
  }

  private matchNdcLasso(
    polygon: readonly ProcPlantNdcPoint[],
    camera: THREE.Camera,
    edgeToleranceNdc: number,
  ) {
    this.matchedFlags.fill(0);
    if (polygon.length < 3 || !hasOnlyFinitePoints(polygon)) return;
    this.updateProjectedSegments(camera);
    const extraRadius = Math.max(0, Number.isFinite(edgeToleranceNdc) ? edgeToleranceNdc : 0);
    for (let i = 0; i < this.segments.length; i++) {
      if (!this.projectedVisible[i]) continue;
      const offset = i * 4;
      const ax = this.projectedSegments[offset]!;
      const ay = this.projectedSegments[offset + 1]!;
      const bx = this.projectedSegments[offset + 2]!;
      const by = this.projectedSegments[offset + 3]!;
      if (pointInPolygon(ax, ay, polygon) || pointInPolygon(bx, by, polygon)) {
        this.matchedFlags[i] = 1;
        continue;
      }
      const radius = this.projectedRadii[i]! + extraRadius;
      const radiusSquared = radius * radius;
      for (let j = 0, previous = polygon.length - 1; j < polygon.length; previous = j++) {
        const edgeStart = polygon[previous]!;
        const edgeEnd = polygon[j]!;
        if (segmentDistanceSquared2d(
          ax,
          ay,
          bx,
          by,
          edgeStart.x,
          edgeStart.y,
          edgeEnd.x,
          edgeEnd.y,
        ) <= radiusSquared) {
          this.matchedFlags[i] = 1;
          break;
        }
      }
    }
  }

  private updateProjectedSegments(camera: THREE.Camera) {
    this.object.updateWorldMatrix(true, false);
    camera.updateWorldMatrix(true, false);
    this.cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    this.cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const worldElements = this.object.matrixWorld.elements;
    const worldScale = Math.max(
      Math.hypot(worldElements[0]!, worldElements[1]!, worldElements[2]!),
      Math.hypot(worldElements[4]!, worldElements[5]!, worldElements[6]!),
      Math.hypot(worldElements[8]!, worldElements[9]!, worldElements[10]!),
    );
    for (let i = 0; i < this.segments.length; i++) {
      const endpointOffset = i * 6;
      const projectedOffset = i * 4;
      this.worldStart.set(
        this.segmentEndpoints[endpointOffset]!,
        this.segmentEndpoints[endpointOffset + 1]!,
        this.segmentEndpoints[endpointOffset + 2]!,
      ).applyMatrix4(this.object.matrixWorld);
      this.worldEnd.set(
        this.segmentEndpoints[endpointOffset + 3]!,
        this.segmentEndpoints[endpointOffset + 4]!,
        this.segmentEndpoints[endpointOffset + 5]!,
      ).applyMatrix4(this.object.matrixWorld);
      this.viewStart.copy(this.worldStart).applyMatrix4(camera.matrixWorldInverse);
      this.viewEnd.copy(this.worldEnd).applyMatrix4(camera.matrixWorldInverse);
      if (this.viewStart.z >= -1e-6 || this.viewEnd.z >= -1e-6) {
        this.projectedVisible[i] = 0;
        continue;
      }
      this.projectedPoint.copy(this.worldStart).project(camera);
      const startX = this.projectedPoint.x;
      const startY = this.projectedPoint.y;
      const startZ = this.projectedPoint.z;
      this.projectedPoint.copy(this.worldEnd).project(camera);
      const endX = this.projectedPoint.x;
      const endY = this.projectedPoint.y;
      const endZ = this.projectedPoint.z;
      if (!Number.isFinite(startX)
        || !Number.isFinite(startY)
        || !Number.isFinite(startZ)
        || !Number.isFinite(endX)
        || !Number.isFinite(endY)
        || !Number.isFinite(endZ)
        || (startZ < -1 && endZ < -1)
        || (startZ > 1 && endZ > 1)) {
        this.projectedVisible[i] = 0;
        continue;
      }
      this.projectedSegments[projectedOffset] = startX;
      this.projectedSegments[projectedOffset + 1] = startY;
      this.projectedSegments[projectedOffset + 2] = endX;
      this.projectedSegments[projectedOffset + 3] = endY;
      const radiusWorld = this.segmentRadii[i]! * worldScale;
      this.projectedRadii[i] = Math.max(
        this.projectRadiusAt(this.worldStart, startX, startY, radiusWorld, camera),
        this.projectRadiusAt(this.worldEnd, endX, endY, radiusWorld, camera),
      );
      this.projectedVisible[i] = 1;
    }
  }

  private projectRadiusAt(
    worldPoint: THREE.Vector3,
    projectedX: number,
    projectedY: number,
    radiusWorld: number,
    camera: THREE.Camera,
  ) {
    this.projectedOffset.copy(worldPoint).addScaledVector(this.cameraRight, radiusWorld).project(camera);
    const rightX = this.projectedOffset.x - projectedX;
    const rightY = this.projectedOffset.y - projectedY;
    let radiusSquared = rightX * rightX + rightY * rightY;
    this.projectedOffset.copy(worldPoint).addScaledVector(this.cameraUp, radiusWorld).project(camera);
    const upX = this.projectedOffset.x - projectedX;
    const upY = this.projectedOffset.y - projectedY;
    radiusSquared = Math.max(radiusSquared, upX * upX + upY * upY);
    return Math.sqrt(radiusSquared);
  }

  private applyMatchedSelection(mode: ProcPlantSegmentSelectionMode): ProcPlantSegmentSelectionResult {
    for (let i = 0; i < this.segments.length; i++) {
      const wasSelected = this.selectedFlags[i] === 1;
      const isSelected = this.matchedFlags[i] === 1 || (mode === "additive" && wasSelected);
      this.selectedFlags[i] = isSelected ? 1 : 0;
      if (wasSelected !== isSelected) this.refreshSegmentColor(this.segmentIds[i]!);
    }
    const matchedSegmentIds = this.collectFlaggedSegmentIds(this.matchedFlags);
    const selectedSegmentIds = this.collectFlaggedSegmentIds(this.selectedFlags);
    this.selectedSegmentId = selectedSegmentIds[0] ?? null;
    this.object.userData.selectedSegmentId = this.selectedSegmentId;
    this.object.userData.selectedSegmentIds = selectedSegmentIds.slice();
    return { mode, matchedSegmentIds, selectedSegmentIds };
  }

  private collectFlaggedSegmentIds(flags: Uint8Array) {
    const result: string[] = [];
    for (let i = 0; i < this.segmentIds.length; i++) {
      if (flags[i]) result.push(this.segmentIds[i]!);
    }
    return result;
  }

  private refreshSegmentColor(segmentId: string | null) {
    if (segmentId === null) return;
    const instanceId = this.instanceBySegmentId.get(segmentId);
    if (instanceId === undefined) return;
    const hex = this.selectedFlags[instanceId]
      ? this.selectedColor
      : segmentId === this.highlightedSegmentId
        ? this.highlightColor
        : this.baseColor;
    this.object.setColorAt(instanceId, this.color.setHex(hex));
    if (this.object.instanceColor) this.object.instanceColor.needsUpdate = true;
  }

  private assertUsable() {
    if (this.disposed) throw new Error("ProcPlantPruneTool has been disposed.");
  }
}

export const createProcPlantPruneTool = (
  graph: ProcPlantGraph,
  options: ProcPlantPruneToolOptions = {},
) => new ProcPlantPruneTool(graph, options);
