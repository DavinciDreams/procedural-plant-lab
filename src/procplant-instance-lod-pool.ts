import * as THREE from "three";
import {
  buildProcPlantVisibilityClusters,
  type ProcPlantVisibilityClusterOptions,
  type ProcPlantVisibilityClusterSet,
} from "./procplant-visibility-clusters";

export interface ProcPlantInstanceLodLevel {
  /** Local-space distance at which this LOD becomes eligible. */
  distance: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  castShadow?: boolean;
  receiveShadow?: boolean;
  name?: string;
}

export interface ProcPlantInstanceLodPoolOptions {
  hysteresis?: number;
  maxDistance?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  frustumCulled?: boolean;
  ownGeometries?: boolean;
  ownMaterials?: boolean;
  /** Optional conservative spatial broad phase. Omitted preserves the legacy exact scan. */
  clusteredCulling?: ProcPlantVisibilityClusterOptions;
  configureMesh?: (mesh: THREE.InstancedMesh, level: ProcPlantInstanceLodLevel, levelIndex: number) => void;
  onPlacementLodChanged?: (placementIndex: number, previousLevel: number | null, nextLevel: number | null) => void;
}

export interface ProcPlantInstanceLodPoolStats {
  readonly placements: number;
  visible: number;
  culled: number;
  lastMigrations: number;
  totalMigrations: number;
  /** Exact distance/LOD resolutions performed by the last update. */
  exactSelectionTests: number;
  /** Placements safely rejected by cluster bounds before exact selection. */
  broadPhaseRejected: number;
  /** Placements rejected by an optional external/frustum visibility mask. */
  visibilityRejected: number;
  clusterCount: number;
  candidateClusters: number;
  clusterBytes: number;
  readonly lodCounts: Int32Array;
}

const UNASSIGNED = -2;
const CULLED = -1;

const copyMatrix = (
  source: Float32Array,
  sourceOffset: number,
  target: THREE.TypedArray,
  targetOffset: number,
) => {
  for (let component = 0; component < 16; component++) {
    target[targetOffset + component] = source[sourceOffset + component];
  }
};

export class ProcPlantInstanceLodPool {
  readonly root = new THREE.Group();
  readonly meshes: readonly THREE.InstancedMesh[];
  readonly stats: ProcPlantInstanceLodPoolStats;
  readonly lodDistances: Float32Array;

  private readonly levels: readonly ProcPlantInstanceLodLevel[];
  private readonly placementMatrices: Float32Array;
  private readonly activeLevels: Int8Array;
  private readonly hysteresis: number;
  private readonly maxDistance: number | null;
  private readonly configureMesh?: ProcPlantInstanceLodPoolOptions["configureMesh"];
  private readonly onPlacementLodChanged?: ProcPlantInstanceLodPoolOptions["onPlacementLodChanged"];
  private readonly ownGeometries: boolean;
  private readonly ownMaterials: boolean;
  private readonly clusterOptions: ProcPlantVisibilityClusterOptions | null;
  private visibilityClusterSet: ProcPlantVisibilityClusterSet | null = null;
  private instanceClusterIds = new Uint32Array(0);
  private candidateClusterMask = new Uint8Array(0);
  private clustersDirty = false;
  private readonly localCameraPosition = new THREE.Vector3();
  private visibilityGeometryRadiusFromPlacementOrigin = 0;
  private disposed = false;

  constructor(
    placements: readonly THREE.Matrix4[],
    levels: readonly ProcPlantInstanceLodLevel[],
    options: ProcPlantInstanceLodPoolOptions = {},
  ) {
    if (levels.length < 2 || levels.length > 4) {
      throw new Error(`ProcPlantInstanceLodPool requires 2-4 LOD levels; received ${levels.length}.`);
    }
    this.levels = levels.slice().sort((a, b) => a.distance - b.distance);
    this.lodDistances = new Float32Array(this.levels.map((level) => level.distance));
    if (!Number.isFinite(this.levels[0].distance) || this.levels[0].distance < 0) {
      throw new Error("LOD distances must be finite and non-negative.");
    }
    for (let i = 1; i < this.levels.length; i++) {
      if (!Number.isFinite(this.levels[i].distance) || this.levels[i].distance <= this.levels[i - 1].distance) {
        throw new Error("LOD distances must be finite and strictly increasing.");
      }
    }
    const hysteresis = options.hysteresis ?? 0.12;
    if (!Number.isFinite(hysteresis) || hysteresis < 0 || hysteresis >= 0.5) {
      throw new Error("LOD hysteresis must be finite and in the range [0, 0.5). ");
    }
    this.hysteresis = hysteresis;
    if (options.maxDistance !== undefined && (!Number.isFinite(options.maxDistance) || options.maxDistance < 0)) {
      throw new Error("LOD maxDistance must be finite and non-negative.");
    }
    this.maxDistance = options.maxDistance ?? null;
    this.configureMesh = options.configureMesh;
    this.onPlacementLodChanged = options.onPlacementLodChanged;
    this.ownGeometries = options.ownGeometries ?? false;
    this.ownMaterials = options.ownMaterials ?? false;
    this.clusterOptions = options.clusteredCulling ? { ...options.clusteredCulling } : null;
    this.placementMatrices = new Float32Array(placements.length * 16);
    for (let i = 0; i < placements.length; i++) placements[i].toArray(this.placementMatrices, i * 16);
    this.activeLevels = new Int8Array(placements.length);
    this.activeLevels.fill(UNASSIGNED);

    this.root.name = "procplant-instance-lod-pool";
    this.root.userData.procplantInstanceLodPool = true;
    const meshes: THREE.InstancedMesh[] = [];
    for (let i = 0; i < this.levels.length; i++) {
      const level = this.levels[i];
      const mesh = new THREE.InstancedMesh(level.geometry, level.material, placements.length);
      mesh.name = level.name ?? `procplant-instance-lod-${i}`;
      mesh.count = i === 0 ? placements.length : 0;
      mesh.castShadow = level.castShadow ?? options.castShadow ?? false;
      mesh.receiveShadow = level.receiveShadow ?? options.receiveShadow ?? false;
      mesh.frustumCulled = options.frustumCulled ?? true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.boundingBox = new THREE.Box3();
      mesh.boundingSphere = new THREE.Sphere();
      if (i === 0) {
        const array = mesh.instanceMatrix.array;
        for (let placement = 0; placement < placements.length; placement++) {
          copyMatrix(this.placementMatrices, placement * 16, array, placement * 16);
        }
        mesh.instanceMatrix.needsUpdate = true;
        this.updateBounds(mesh);
      }
      this.configureMesh?.(mesh, level, i);
      meshes.push(mesh);
      this.root.add(mesh);
    }
    this.meshes = meshes;
    const visibilityBounds = new THREE.Box3().makeEmpty();
    for (const level of this.levels) {
      if (!level.geometry.boundingBox) level.geometry.computeBoundingBox();
      if (level.geometry.boundingBox) visibilityBounds.union(level.geometry.boundingBox);
    }
    if (!visibilityBounds.isEmpty()) {
      const visibilityCenter = visibilityBounds.getCenter(new THREE.Vector3());
      this.visibilityGeometryRadiusFromPlacementOrigin =
        visibilityBounds.getSize(new THREE.Vector3()).length() * 0.5 + visibilityCenter.length();
    }
    const lodCounts = new Int32Array(this.levels.length);
    lodCounts[0] = placements.length;
    this.stats = {
      placements: placements.length,
      visible: placements.length,
      culled: 0,
      lastMigrations: 0,
      totalMigrations: 0,
      exactSelectionTests: 0,
      broadPhaseRejected: 0,
      visibilityRejected: 0,
      clusterCount: 0,
      candidateClusters: 0,
      clusterBytes: 0,
      lodCounts,
    };
    if (this.clusterOptions) this.rebuildVisibilityClusters();
  }

  /** Packed renderer-independent cluster data, or null on the exact legacy path. */
  get visibilityClusters() {
    return this.visibilityClusterSet;
  }

  /** Refresh and return conservative placement clusters after placement edits. */
  ensureVisibilityClusters() {
    this.assertUsable();
    if (this.clustersDirty) this.rebuildVisibilityClusters();
    return this.visibilityClusterSet;
  }

  /** Update assignments using a camera position already expressed in pool-local space. */
  update(localCameraPosition: THREE.Vector3, visibilityMask?: ArrayLike<number> | null): ProcPlantInstanceLodPoolStats {
    this.assertUsable();
    if (visibilityMask && visibilityMask.length !== this.activeLevels.length) {
      throw new Error("LOD visibility mask length must match placement count.");
    }
    if (this.clustersDirty) this.rebuildVisibilityClusters();
    this.stats.lodCounts.fill(0);
    this.stats.visible = 0;
    this.stats.culled = 0;
    this.stats.lastMigrations = 0;
    this.stats.exactSelectionTests = 0;
    this.stats.broadPhaseRejected = 0;
    this.stats.visibilityRejected = 0;
    this.stats.candidateClusters = 0;
    for (const mesh of this.meshes) mesh.count = 0;

    const clusters = this.visibilityClusterSet;
    if (clusters) {
      const broadPhaseEnabled = this.maxDistance !== null
        && Number.isFinite(localCameraPosition.x)
        && Number.isFinite(localCameraPosition.y)
        && Number.isFinite(localCameraPosition.z);
      const broadDistance = broadPhaseEnabled
        ? this.maxDistance! * (1 + this.hysteresis)
        : Infinity;
      for (let cluster = 0; cluster < clusters.clusterCount; cluster++) {
        let candidate = true;
        if (broadPhaseEnabled) {
          const offset = cluster * 4;
          const dx = clusters.clusterBounds[offset] - localCameraPosition.x;
          const dy = clusters.clusterBounds[offset + 1] - localCameraPosition.y;
          const dz = clusters.clusterBounds[offset + 2] - localCameraPosition.z;
          const nearestDistance = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - clusters.clusterBounds[offset + 3]);
          candidate = nearestDistance <= broadDistance;
        }
        this.candidateClusterMask[cluster] = candidate ? 1 : 0;
        if (candidate) this.stats.candidateClusters++;
      }
    }

    for (let placement = 0; placement < this.activeLevels.length; placement++) {
      const previous = this.activeLevels[placement];
      if (visibilityMask && Number(visibilityMask[placement]) === 0) {
        if (previous !== CULLED) {
          this.activeLevels[placement] = CULLED;
          this.stats.lastMigrations++;
          this.onPlacementLodChanged?.(placement, previous >= 0 ? previous : null, null);
        }
        this.stats.visibilityRejected++;
        this.stats.culled++;
        continue;
      }
      if (clusters && this.candidateClusterMask[this.instanceClusterIds[placement]] === 0) {
        if (previous !== CULLED) {
          this.activeLevels[placement] = CULLED;
          this.stats.lastMigrations++;
          this.onPlacementLodChanged?.(placement, previous >= 0 ? previous : null, null);
        }
        this.stats.broadPhaseRejected++;
        this.stats.culled++;
        continue;
      }
      this.stats.exactSelectionTests++;
      const matrixOffset = placement * 16;
      const dx = this.placementMatrices[matrixOffset + 12] - localCameraPosition.x;
      const dy = this.placementMatrices[matrixOffset + 13] - localCameraPosition.y;
      const dz = this.placementMatrices[matrixOffset + 14] - localCameraPosition.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const next = this.resolveLevel(distance, previous);
      if (previous !== next) {
        this.activeLevels[placement] = next;
        this.stats.lastMigrations++;
        this.onPlacementLodChanged?.(
          placement,
          previous >= 0 ? previous : null,
          next >= 0 ? next : null,
        );
      }
      if (next === CULLED) {
        this.stats.culled++;
        continue;
      }
      const targetMesh = this.meshes[next];
      copyMatrix(
        this.placementMatrices,
        matrixOffset,
        targetMesh.instanceMatrix.array,
        targetMesh.count * 16,
      );
      targetMesh.count++;
      this.stats.lodCounts[next]++;
      this.stats.visible++;
    }

    for (const mesh of this.meshes) {
      mesh.instanceMatrix.clearUpdateRanges();
      if (mesh.count > 0) mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      this.updateBounds(mesh);
    }
    this.stats.totalMigrations += this.stats.lastMigrations;
    return this.stats;
  }

  /** Convert the camera world position into pool-local space without allocating. */
  updateFromCamera(camera: THREE.Camera, visibilityMask?: ArrayLike<number> | null): ProcPlantInstanceLodPoolStats {
    this.assertUsable();
    camera.updateWorldMatrix(true, false);
    this.root.updateWorldMatrix(true, false);
    this.localCameraPosition.setFromMatrixPosition(camera.matrixWorld);
    this.root.worldToLocal(this.localCameraPosition);
    return this.update(this.localCameraPosition, visibilityMask);
  }

  /** Replace one deterministic placement; call update/updateFromCamera to reassign it. */
  setPlacementMatrix(placementIndex: number, matrix: THREE.Matrix4) {
    this.assertUsable();
    if (placementIndex < 0 || placementIndex >= this.activeLevels.length) return false;
    matrix.toArray(this.placementMatrices, placementIndex * 16);
    if (this.clusterOptions) this.clustersDirty = true;
    return true;
  }

  getPlacementLod(placementIndex: number): number | null {
    const level = this.activeLevels[placementIndex];
    return level >= 0 ? level : null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.root.clear();
    if (this.ownGeometries) {
      const disposed = new Set<THREE.BufferGeometry>();
      for (const level of this.levels) {
        if (!disposed.has(level.geometry)) level.geometry.dispose();
        disposed.add(level.geometry);
      }
    }
    if (this.ownMaterials) {
      const disposed = new Set<THREE.Material>();
      for (const level of this.levels) {
        const materials = Array.isArray(level.material) ? level.material : [level.material];
        for (const material of materials) {
          if (!disposed.has(material)) material.dispose();
          disposed.add(material);
        }
      }
    }
  }

  private resolveLevel(distance: number, current: number) {
    if (this.maxDistance !== null) {
      const cullThreshold = current === UNASSIGNED
        ? this.maxDistance
        : current === CULLED
          ? this.maxDistance * (1 - this.hysteresis)
          : this.maxDistance * (1 + this.hysteresis);
      if (distance > cullThreshold) return CULLED;
    }
    if (current < 0) return this.rawLevel(distance);
    let level = current;
    while (
      level < this.levels.length - 1
      && distance >= this.levels[level + 1].distance * (1 + this.hysteresis)
    ) {
      level++;
    }
    while (
      level > 0
      && distance < this.levels[level].distance * (1 - this.hysteresis)
    ) {
      level--;
    }
    return level;
  }

  private rebuildVisibilityClusters() {
    if (!this.clusterOptions) return;
    const centers = new Float32Array(this.activeLevels.length * 3);
    const radii = new Float32Array(this.activeLevels.length);
    for (let placement = 0; placement < this.activeLevels.length; placement++) {
      const matrixOffset = placement * 16;
      const centerOffset = placement * 3;
      centers[centerOffset] = this.placementMatrices[matrixOffset + 12]!;
      centers[centerOffset + 1] = this.placementMatrices[matrixOffset + 13]!;
      centers[centerOffset + 2] = this.placementMatrices[matrixOffset + 14]!;
      const m00 = this.placementMatrices[matrixOffset]!;
      const m01 = this.placementMatrices[matrixOffset + 4]!;
      const m02 = this.placementMatrices[matrixOffset + 8]!;
      const m10 = this.placementMatrices[matrixOffset + 1]!;
      const m11 = this.placementMatrices[matrixOffset + 5]!;
      const m12 = this.placementMatrices[matrixOffset + 9]!;
      const m20 = this.placementMatrices[matrixOffset + 2]!;
      const m21 = this.placementMatrices[matrixOffset + 6]!;
      const m22 = this.placementMatrices[matrixOffset + 10]!;
      const gram00 = m00 * m00 + m10 * m10 + m20 * m20;
      const gram11 = m01 * m01 + m11 * m11 + m21 * m21;
      const gram22 = m02 * m02 + m12 * m12 + m22 * m22;
      const gram01 = Math.abs(m00 * m01 + m10 * m11 + m20 * m21);
      const gram02 = Math.abs(m00 * m02 + m10 * m12 + m20 * m22);
      const gram12 = Math.abs(m01 * m02 + m11 * m12 + m21 * m22);
      const affineScaleUpperBound = Math.sqrt(Math.max(
        gram00 + gram01 + gram02,
        gram11 + gram01 + gram12,
        gram22 + gram02 + gram12,
      ));
      radii[placement] = this.visibilityGeometryRadiusFromPlacementOrigin * affineScaleUpperBound;
    }
    const clusters = buildProcPlantVisibilityClusters({ centers, radii }, this.clusterOptions);
    const instanceClusterIds = new Uint32Array(this.activeLevels.length);
    for (let cluster = 0; cluster < clusters.clusterCount; cluster++) {
      for (let cursor = clusters.clusterOffsets[cluster]; cursor < clusters.clusterOffsets[cluster + 1]; cursor++) {
        instanceClusterIds[clusters.clusterInstanceIndices[cursor]] = cluster;
      }
    }
    this.visibilityClusterSet = clusters;
    this.instanceClusterIds = instanceClusterIds;
    this.candidateClusterMask = new Uint8Array(clusters.clusterCount);
    this.clustersDirty = false;
    this.stats.clusterCount = clusters.clusterCount;
    this.stats.clusterBytes = clusters.byteLength + instanceClusterIds.byteLength + this.candidateClusterMask.byteLength;
  }

  private rawLevel(distance: number) {
    let level = 0;
    for (let i = 1; i < this.levels.length; i++) {
      if (distance >= this.levels[i].distance) level = i;
      else break;
    }
    return level;
  }

  private updateBounds(mesh: THREE.InstancedMesh) {
    if (mesh.count === 0) {
      mesh.boundingBox!.makeEmpty();
      mesh.boundingSphere!.center.set(0, 0, 0);
      mesh.boundingSphere!.radius = 0;
      return;
    }
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }

  private assertUsable() {
    if (this.disposed) throw new Error("ProcPlantInstanceLodPool has been disposed.");
  }
}

export const createProcPlantInstanceLodPool = (
  placements: readonly THREE.Matrix4[],
  levels: readonly ProcPlantInstanceLodLevel[],
  options: ProcPlantInstanceLodPoolOptions = {},
) => new ProcPlantInstanceLodPool(placements, levels, options);
