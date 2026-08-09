import * as THREE from "three";
import { type ProcPlantInstanceLodPool, type ProcPlantInstanceLodPoolStats } from "./procplant-instance-lod-pool";
import {
  ProcPlantVisibilitySelector,
  type ProcPlantVisibilityClusterSet,
  type ProcPlantVisibilitySelection,
  type ProcPlantVisibilityView,
} from "./procplant-visibility-clusters";

export const PROCPLANT_THREE_VISIBILITY_LOD_ADAPTER_CONTRACT = "procplants.three-visibility-lod-adapter" as const;
export const PROCPLANT_THREE_VISIBILITY_LOD_ADAPTER_VERSION = 1 as const;

export interface ProcPlantThreeVisibilityLodAdapterOptions {
  enabled?: boolean;
  /** Optional selector distance cap. Pool max-distance/hysteresis remains authoritative. */
  maxDistance?: number;
  /** Conservative pool-local expansion applied to all six frustum planes. */
  frustumPadding?: number;
  disposePool?: boolean;
}

export interface ProcPlantThreeVisibilityLodAdapterStats {
  readonly contract: typeof PROCPLANT_THREE_VISIBILITY_LOD_ADAPTER_CONTRACT;
  readonly version: typeof PROCPLANT_THREE_VISIBILITY_LOD_ADAPTER_VERSION;
  enabled: boolean;
  updates: number;
  legacyUpdates: number;
  selectorRebuilds: number;
  viewRevision: number;
  viewChanged: boolean;
  clusterHash: string | null;
  clusterCount: number;
  visibleClusters: number;
  rejectedClusters: number;
  candidateInstances: number;
  frustumVisibleInstances: number;
  frustumRejectedInstances: number;
  poolVisibleInstances: number;
  poolCulledInstances: number;
  poolMigrations: number;
  stableScratchBytes: number;
  readonly selectedLodCounts: Uint32Array;
  readonly poolLodCounts: Int32Array;
}

const finiteNonNegative = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative`);
  return value;
};

export class ProcPlantThreeVisibilityLodAdapter {
  readonly stats: ProcPlantThreeVisibilityLodAdapterStats;

  private enabled: boolean;
  private readonly pool: ProcPlantInstanceLodPool;
  private readonly maxDistance: number;
  private readonly frustumPadding: number;
  private readonly disposePool: boolean;
  private readonly projectionView = new THREE.Matrix4();
  private readonly localViewProjection = new THREE.Matrix4();
  private readonly inversePoolWorld = new THREE.Matrix4();
  private readonly cameraWorldPosition = new THREE.Vector3();
  private readonly localCameraPosition = new THREE.Vector3();
  private readonly planes = new Float32Array(24);
  private readonly cameraPosition = new Float32Array(3);
  private readonly view: ProcPlantVisibilityView;
  private readonly lastViewProjection = new Float64Array(16);
  private readonly lastCameraPosition = new Float64Array(3);
  private selector: ProcPlantVisibilitySelector | null = null;
  private selectorClusters: ProcPlantVisibilityClusterSet | null = null;
  private visibilityMask = new Uint8Array(0);
  private hasView = false;
  private disposed = false;

  constructor(pool: ProcPlantInstanceLodPool, options: ProcPlantThreeVisibilityLodAdapterOptions = {}) {
    if (options.enabled !== undefined && typeof options.enabled !== "boolean") throw new Error("visibility adapter enabled must be boolean");
    if (options.disposePool !== undefined && typeof options.disposePool !== "boolean") throw new Error("visibility adapter disposePool must be boolean");
    this.pool = pool;
    this.enabled = options.enabled ?? true;
    this.maxDistance = options.maxDistance === undefined
      ? Infinity
      : finiteNonNegative(options.maxDistance, "visibility adapter maxDistance");
    this.frustumPadding = finiteNonNegative(options.frustumPadding ?? 0.001, "visibility adapter frustumPadding");
    this.disposePool = options.disposePool ?? false;
    this.view = { planes: this.planes, cameraPosition: this.cameraPosition, maxDistance: this.maxDistance };
    this.stats = {
      contract: PROCPLANT_THREE_VISIBILITY_LOD_ADAPTER_CONTRACT,
      version: PROCPLANT_THREE_VISIBILITY_LOD_ADAPTER_VERSION,
      enabled: this.enabled,
      updates: 0,
      legacyUpdates: 0,
      selectorRebuilds: 0,
      viewRevision: 0,
      viewChanged: false,
      clusterHash: null,
      clusterCount: 0,
      visibleClusters: 0,
      rejectedClusters: 0,
      candidateInstances: 0,
      frustumVisibleInstances: 0,
      frustumRejectedInstances: 0,
      poolVisibleInstances: pool.stats.visible,
      poolCulledInstances: pool.stats.culled,
      poolMigrations: 0,
      stableScratchBytes: this.planes.byteLength + this.cameraPosition.byteLength +
        this.lastViewProjection.byteLength + this.lastCameraPosition.byteLength,
      selectedLodCounts: new Uint32Array(pool.lodDistances.length),
      poolLodCounts: pool.stats.lodCounts,
    };
  }

  get isEnabled() {
    return this.enabled;
  }

  setEnabled(enabled: boolean) {
    this.assertUsable();
    if (typeof enabled !== "boolean") throw new Error("visibility adapter enabled must be boolean");
    this.enabled = enabled;
    this.stats.enabled = enabled;
  }

  update(camera: THREE.Camera): ProcPlantThreeVisibilityLodAdapterStats {
    this.assertUsable();
    this.stats.updates++;
    if (!this.enabled) {
      this.stats.legacyUpdates++;
      this.stats.viewChanged = false;
      this.clearSelectionStats();
      this.adoptPoolStats(this.pool.updateFromCamera(camera));
      return this.stats;
    }
    const clusters = this.pool.ensureVisibilityClusters();
    if (!clusters) throw new Error("visibility adapter requires a pool configured with clusteredCulling");
    this.ensureSelector(clusters);
    this.updateView(camera);
    const selection = this.selector!.select(this.view);
    this.visibilityMask.fill(0);
    for (let index = 0; index < selection.visibleInstanceCount; index++) {
      this.visibilityMask[selection.visibleInstanceIndices[index]!] = 1;
    }
    this.adoptSelection(selection);
    this.adoptPoolStats(this.pool.update(this.localCameraPosition, this.visibilityMask));
    return this.stats;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.selector = null;
    this.selectorClusters = null;
    this.visibilityMask = new Uint8Array(0);
    if (this.disposePool) this.pool.dispose();
  }

  private ensureSelector(clusters: ProcPlantVisibilityClusterSet) {
    if (this.selectorClusters === clusters) return;
    this.selectorClusters = clusters;
    this.selector = new ProcPlantVisibilitySelector(clusters, this.pool.lodDistances);
    this.visibilityMask = new Uint8Array(clusters.instanceCount);
    this.stats.selectorRebuilds++;
    this.stats.clusterHash = clusters.contentHash;
    this.stats.clusterCount = clusters.clusterCount;
    const selection = this.selector.result;
    this.stats.stableScratchBytes = this.planes.byteLength + this.cameraPosition.byteLength +
      this.lastViewProjection.byteLength + this.lastCameraPosition.byteLength + this.visibilityMask.byteLength +
      selection.visibleClusterIndices.byteLength + selection.visibleInstanceIndices.byteLength +
      selection.instanceLods.byteLength + selection.lodCounts.byteLength + selection.lodOffsets.byteLength +
      selection.lodInstanceIndices.byteLength;
  }

  private updateView(camera: THREE.Camera) {
    camera.updateWorldMatrix(true, false);
    this.pool.root.updateWorldMatrix(true, false);
    this.projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.localViewProjection.multiplyMatrices(this.projectionView, this.pool.root.matrixWorld);
    this.cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
    this.inversePoolWorld.copy(this.pool.root.matrixWorld).invert();
    this.localCameraPosition.copy(this.cameraWorldPosition).applyMatrix4(this.inversePoolWorld);
    const m = this.localViewProjection.elements;
    this.writePlane(0, m[3]! + m[0]!, m[7]! + m[4]!, m[11]! + m[8]!, m[15]! + m[12]!);
    this.writePlane(1, m[3]! - m[0]!, m[7]! - m[4]!, m[11]! - m[8]!, m[15]! - m[12]!);
    this.writePlane(2, m[3]! + m[1]!, m[7]! + m[5]!, m[11]! + m[9]!, m[15]! + m[13]!);
    this.writePlane(3, m[3]! - m[1]!, m[7]! - m[5]!, m[11]! - m[9]!, m[15]! - m[13]!);
    if (camera.reversedDepth) {
      this.writePlane(4, m[3]! - m[2]!, m[7]! - m[6]!, m[11]! - m[10]!, m[15]! - m[14]!);
      this.writePlane(5, m[2]!, m[6]!, m[10]!, m[14]!);
    } else {
      if (camera.coordinateSystem === THREE.WebGLCoordinateSystem) {
        this.writePlane(4, m[3]! + m[2]!, m[7]! + m[6]!, m[11]! + m[10]!, m[15]! + m[14]!);
      } else if (camera.coordinateSystem === THREE.WebGPUCoordinateSystem) {
        this.writePlane(4, m[2]!, m[6]!, m[10]!, m[14]!);
      } else {
        throw new Error("visibility adapter camera has an unsupported coordinate system");
      }
      this.writePlane(5, m[3]! - m[2]!, m[7]! - m[6]!, m[11]! - m[10]!, m[15]! - m[14]!);
    }
    this.cameraPosition[0] = this.localCameraPosition.x;
    this.cameraPosition[1] = this.localCameraPosition.y;
    this.cameraPosition[2] = this.localCameraPosition.z;
    let changed = !this.hasView;
    for (let index = 0; index < 16; index++) {
      if (this.lastViewProjection[index] !== m[index]) changed = true;
      this.lastViewProjection[index] = m[index]!;
    }
    for (let index = 0; index < 3; index++) {
      if (this.lastCameraPosition[index] !== this.cameraPosition[index]) changed = true;
      this.lastCameraPosition[index] = this.cameraPosition[index]!;
    }
    this.hasView = true;
    this.stats.viewChanged = changed;
    if (changed) this.stats.viewRevision++;
  }

  private writePlane(index: number, x: number, y: number, z: number, d: number) {
    const length = Math.hypot(x, y, z);
    if (!(length > 1e-20) || !Number.isFinite(length) || !Number.isFinite(x) || !Number.isFinite(y) ||
      !Number.isFinite(z) || !Number.isFinite(d)) {
      throw new Error(`visibility adapter camera produced invalid frustum plane ${index}`);
    }
    const offset = index * 4;
    this.planes[offset] = x / length;
    this.planes[offset + 1] = y / length;
    this.planes[offset + 2] = z / length;
    this.planes[offset + 3] = d / length + this.frustumPadding;
  }

  private clearSelectionStats() {
    this.stats.visibleClusters = 0;
    this.stats.rejectedClusters = 0;
    this.stats.candidateInstances = 0;
    this.stats.frustumVisibleInstances = 0;
    this.stats.frustumRejectedInstances = 0;
    this.stats.selectedLodCounts.fill(0);
  }

  private adoptSelection(selection: ProcPlantVisibilitySelection) {
    this.stats.visibleClusters = selection.visibleClusterCount;
    this.stats.rejectedClusters = selection.rejectedClusterCount;
    this.stats.candidateInstances = selection.candidateInstanceCount;
    this.stats.frustumVisibleInstances = selection.visibleInstanceCount;
    this.stats.frustumRejectedInstances = selection.rejectedClusterInstances + selection.frustumCulledCandidateCount +
      selection.distanceCulledCandidateCount;
    this.stats.selectedLodCounts.set(selection.lodCounts);
  }

  private adoptPoolStats(poolStats: ProcPlantInstanceLodPoolStats) {
    this.stats.poolVisibleInstances = poolStats.visible;
    this.stats.poolCulledInstances = poolStats.culled;
    this.stats.poolMigrations = poolStats.lastMigrations;
  }

  private assertUsable() {
    if (this.disposed) throw new Error("ProcPlantThreeVisibilityLodAdapter has been disposed");
  }
}

export const createProcPlantThreeVisibilityLodAdapter = (
  pool: ProcPlantInstanceLodPool,
  options: ProcPlantThreeVisibilityLodAdapterOptions = {},
) => new ProcPlantThreeVisibilityLodAdapter(pool, options);
