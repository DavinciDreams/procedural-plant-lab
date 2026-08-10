import * as THREE from "three";
import type {
  ProcPlantAttachmentKind,
  ProcPlantCompiledLod,
  ProcPlantGraph,
} from "./procplants";

export type ProcPlantDebugLayer = "attachments" | "branches" | "frames" | "lod";
export type ProcPlantAttachmentColorMode = "kind" | "wind";

export interface ProcPlantDebugOverlayOptions {
  attachments?: boolean;
  branches?: boolean;
  frames?: boolean;
  lod?: boolean;
  attachmentColorMode?: ProcPlantAttachmentColorMode;
  markerSize?: number;
  axisLength?: number;
  maxFrames?: number;
  depthTest?: boolean;
}

export interface ProcPlantDebugLodStatus {
  level: ProcPlantCompiledLod["level"];
  label: ProcPlantCompiledLod["label"];
  distance: number;
  triangles: number;
  vertices: number;
}

const attachmentKindColors: Record<ProcPlantAttachmentKind, number> = {
  leaf: 0x52d273,
  flower: 0xff62bc,
  grassBlade: 0xa9df4f,
  fernLeaflet: 0x2fbf86,
  coniferSpray: 0x27845d,
  fernFrond: 0x36a86f,
  palmFrond: 0x58b96d,
  fruit: 0xe95b3c,
  berry: 0xa32f62,
  cone: 0x9a7147,
  thorn: 0xc7a06a,
  aerialRoot: 0x8d7355,
  mossTuft: 0x6f9d45,
  "leaf-site": 0x55c8ff,
  "branch-tip": 0xffc857,
};

const setLinePoint = (out: Float32Array, offset: number, point: THREE.Vector3) => {
  out[offset] = point.x;
  out[offset + 1] = point.y;
  out[offset + 2] = point.z;
};

const createLineSegments = (
  positions: Float32Array,
  colors: Float32Array,
  depthTest: boolean,
  name: string,
) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.StaticDrawUsage));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3).setUsage(THREE.StaticDrawUsage));
  geometry.computeBoundingSphere();
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    depthTest,
    depthWrite: false,
    transparent: true,
    opacity: 0.92,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = name;
  lines.frustumCulled = true;
  lines.renderOrder = 10;
  return lines;
};

const writeColor = (target: Float32Array, index: number, color: THREE.Color) => {
  const offset = index * 3;
  target[offset] = color.r;
  target[offset + 1] = color.g;
  target[offset + 2] = color.b;
};

export class ProcPlantDebugOverlay {
  readonly root = new THREE.Group();

  private attachmentMarkers: THREE.InstancedMesh | null = null;
  private attachmentKindColors: THREE.InstancedBufferAttribute | null = null;
  private attachmentWindColors: THREE.InstancedBufferAttribute | null = null;
  private branchLines: THREE.LineSegments | null = null;
  private frameLines: THREE.LineSegments | null = null;
  private lodIndicator: THREE.InstancedMesh | null = null;
  private activeLodLevel: ProcPlantCompiledLod["level"] = 0;
  private readonly layerVisibility: Record<ProcPlantDebugLayer, boolean>;
  private readonly inactiveLodColor = new THREE.Color(0x45505f);
  private readonly activeLodColor = new THREE.Color(0xffd166);
  private disposed = false;

  constructor(
    private readonly graph: ProcPlantGraph,
    private readonly lods: readonly ProcPlantCompiledLod[] = [],
    options: ProcPlantDebugOverlayOptions = {},
  ) {
    this.root.name = "procplant-debug-overlay";
    this.root.userData.procplantDebug = true;
    this.layerVisibility = {
      attachments: options.attachments ?? true,
      branches: options.branches ?? true,
      frames: options.frames ?? false,
      lod: options.lod ?? lods.length > 0,
    };
    const depthTest = options.depthTest ?? false;
    const markerSize = Math.max(0.002, options.markerSize ?? 0.035);
    this.buildAttachmentMarkers(markerSize, depthTest, options.attachmentColorMode ?? "kind");
    this.buildBranchLines(depthTest);
    this.buildFrameLines(Math.max(0.005, options.axisLength ?? markerSize * 4), options.maxFrames ?? 192, depthTest);
    this.buildLodIndicator(markerSize, depthTest);
    this.syncVisibility();
    if (lods.length > 0) this.setActiveLod(lods[0].level);
  }

  setLayerVisible(layer: ProcPlantDebugLayer, visible: boolean) {
    this.assertUsable();
    this.layerVisibility[layer] = visible;
    this.syncVisibility();
  }

  isLayerVisible(layer: ProcPlantDebugLayer) {
    return this.layerVisibility[layer];
  }

  setAttachmentColorMode(mode: ProcPlantAttachmentColorMode) {
    this.assertUsable();
    if (!this.attachmentMarkers) return;
    this.attachmentMarkers.instanceColor = mode === "kind"
      ? this.attachmentKindColors
      : this.attachmentWindColors;
    if (this.attachmentMarkers.instanceColor) this.attachmentMarkers.instanceColor.needsUpdate = true;
    this.attachmentMarkers.userData.colorMode = mode;
  }

  setActiveLod(level: ProcPlantCompiledLod["level"]) {
    this.assertUsable();
    const active = this.lods.find((lod) => lod.level === level);
    if (!active) return false;
    this.activeLodLevel = level;
    if (this.lodIndicator) {
      for (let i = 0; i < this.lods.length; i++) {
        this.lodIndicator.setColorAt(i, this.lods[i].level === level ? this.activeLodColor : this.inactiveLodColor);
      }
      if (this.lodIndicator.instanceColor) this.lodIndicator.instanceColor.needsUpdate = true;
    }
    this.root.userData.lodStatus = this.getLodStatus();
    return true;
  }

  getLodStatus(): ProcPlantDebugLodStatus | null {
    const lod = this.lods.find((candidate) => candidate.level === this.activeLodLevel);
    if (!lod) return null;
    return {
      level: lod.level,
      label: lod.label,
      distance: lod.distance,
      triangles: lod.triangles,
      vertices: lod.vertices,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.root.traverse((object) => {
      if (object instanceof THREE.LineSegments || object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
    this.root.clear();
    this.attachmentMarkers = null;
    this.attachmentKindColors = null;
    this.attachmentWindColors = null;
    this.branchLines = null;
    this.frameLines = null;
    this.lodIndicator = null;
  }

  private buildAttachmentMarkers(
    markerSize: number,
    depthTest: boolean,
    colorMode: ProcPlantAttachmentColorMode,
  ) {
    const attachments = this.graph.attachments;
    if (attachments.length === 0) return;
    const geometry = new THREE.IcosahedronGeometry(1, 0);
    const material = new THREE.MeshBasicMaterial({ depthTest, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geometry, material, attachments.length);
    mesh.name = "procplant-debug-attachments";
    mesh.renderOrder = 12;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const kindColors = new Float32Array(attachments.length * 3);
    const windColors = new Float32Array(attachments.length * 3);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    for (let i = 0; i < attachments.length; i++) {
      const attachment = attachments[i];
      const size = markerSize * (0.82 + THREE.MathUtils.clamp(attachment.sway, 0, 1) * 0.28);
      scale.setScalar(size);
      matrix.compose(attachment.position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
      color.setHex(attachmentKindColors[attachment.kind]);
      writeColor(kindColors, i, color);
      color.setHSL(0.66 - THREE.MathUtils.clamp(attachment.sway, 0, 1) * 0.66, 0.9, 0.55);
      writeColor(windColors, i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.attachmentKindColors = new THREE.InstancedBufferAttribute(kindColors, 3).setUsage(THREE.StaticDrawUsage);
    this.attachmentWindColors = new THREE.InstancedBufferAttribute(windColors, 3).setUsage(THREE.StaticDrawUsage);
    mesh.instanceColor = colorMode === "kind" ? this.attachmentKindColors : this.attachmentWindColors;
    mesh.userData.colorMode = colorMode;
    this.attachmentMarkers = mesh;
    this.root.add(mesh);
  }

  private buildBranchLines(depthTest: boolean) {
    const valid = this.graph.segmentRecords.filter((segment) =>
      this.graph.stems[segment.startNodeIndex] && this.graph.stems[segment.endNodeIndex]);
    if (valid.length === 0) return;
    const byId = new Map(valid.map((segment) => [segment.id, segment]));
    const parentLinks = valid.filter((segment) => segment.parentSegmentId && byId.has(segment.parentSegmentId));
    const lineCount = valid.length + parentLinks.length;
    const positions = new Float32Array(lineCount * 6);
    const colors = new Float32Array(lineCount * 6);
    const color = new THREE.Color();
    for (let i = 0; i < valid.length; i++) {
      const segment = valid[i];
      const start = this.graph.stems[segment.startNodeIndex].position;
      const end = this.graph.stems[segment.endNodeIndex].position;
      setLinePoint(positions, i * 6, start);
      setLinePoint(positions, i * 6 + 3, end);
      color.setHSL((0.58 + segment.depth * 0.13) % 1, 0.82, 0.58);
      writeColor(colors, i * 2, color);
      writeColor(colors, i * 2 + 1, color);
    }
    color.setHex(0xffd166);
    for (let i = 0; i < parentLinks.length; i++) {
      const segment = parentLinks[i];
      const parent = byId.get(segment.parentSegmentId!)!;
      const parentEnd = this.graph.stems[parent.endNodeIndex].position;
      const childStart = this.graph.stems[segment.startNodeIndex].position;
      const lineIndex = valid.length + i;
      setLinePoint(positions, lineIndex * 6, parentEnd);
      setLinePoint(positions, lineIndex * 6 + 3, childStart);
      writeColor(colors, lineIndex * 2, color);
      writeColor(colors, lineIndex * 2 + 1, color);
    }
    this.branchLines = createLineSegments(positions, colors, depthTest, "procplant-debug-branch-order");
    this.branchLines.userData.segmentCount = valid.length;
    this.branchLines.userData.parentLinkCount = parentLinks.length;
    this.root.add(this.branchLines);
  }

  private buildFrameLines(axisLength: number, maxFrames: number, depthTest: boolean) {
    const attachments = this.graph.attachments;
    if (attachments.length === 0 || maxFrames <= 0) return;
    const stride = Math.max(1, Math.ceil(attachments.length / maxFrames));
    const frameCount = Math.ceil(attachments.length / stride);
    const positions = new Float32Array(frameCount * 3 * 6);
    const colors = new Float32Array(frameCount * 3 * 6);
    const axisColors = [new THREE.Color(0xff5d5d), new THREE.Color(0x64dc73), new THREE.Color(0x5d91ff)];
    let frame = 0;
    for (let i = 0; i < attachments.length; i += stride) {
      const attachment = attachments[i];
      const axes = [attachment.right, attachment.up, attachment.tangent];
      for (let axis = 0; axis < 3; axis++) {
        const offset = (frame * 3 + axis) * 6;
        setLinePoint(positions, offset, attachment.position);
        positions[offset + 3] = attachment.position.x + axes[axis].x * axisLength;
        positions[offset + 4] = attachment.position.y + axes[axis].y * axisLength;
        positions[offset + 5] = attachment.position.z + axes[axis].z * axisLength;
        writeColor(colors, (frame * 3 + axis) * 2, axisColors[axis]);
        writeColor(colors, (frame * 3 + axis) * 2 + 1, axisColors[axis]);
      }
      frame++;
    }
    this.frameLines = createLineSegments(positions, colors, depthTest, "procplant-debug-local-frames");
    this.root.add(this.frameLines);
  }

  private buildLodIndicator(markerSize: number, depthTest: boolean) {
    if (this.lods.length === 0) return;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ depthTest, depthWrite: false });
    const indicator = new THREE.InstancedMesh(geometry, material, this.lods.length);
    indicator.name = "procplant-debug-lod-status";
    indicator.renderOrder = 12;
    indicator.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const bounds = new THREE.Box3();
    for (const node of this.graph.stems) bounds.expandByPoint(node.position);
    for (const attachment of this.graph.attachments) bounds.expandByPoint(attachment.position);
    const x = bounds.isEmpty() ? markerSize * 4 : bounds.max.x + markerSize * 4;
    const y = bounds.isEmpty() ? 0 : bounds.min.y;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(markerSize * 1.3, markerSize * 0.72, markerSize * 0.72);
    for (let i = 0; i < this.lods.length; i++) {
      position.set(x, y + i * markerSize * 1.7, 0);
      matrix.compose(position, quaternion, scale);
      indicator.setMatrixAt(i, matrix);
      indicator.setColorAt(i, this.inactiveLodColor);
    }
    indicator.instanceMatrix.needsUpdate = true;
    if (indicator.instanceColor) indicator.instanceColor.needsUpdate = true;
    this.lodIndicator = indicator;
    this.root.add(indicator);
  }

  private syncVisibility() {
    if (this.attachmentMarkers) this.attachmentMarkers.visible = this.layerVisibility.attachments;
    if (this.branchLines) this.branchLines.visible = this.layerVisibility.branches;
    if (this.frameLines) this.frameLines.visible = this.layerVisibility.frames;
    if (this.lodIndicator) this.lodIndicator.visible = this.layerVisibility.lod;
  }

  private assertUsable() {
    if (this.disposed) throw new Error("ProcPlantDebugOverlay has been disposed.");
  }
}

export const createProcPlantDebugOverlay = (
  graph: ProcPlantGraph,
  lods: readonly ProcPlantCompiledLod[] = [],
  options: ProcPlantDebugOverlayOptions = {},
) => new ProcPlantDebugOverlay(graph, lods, options);
