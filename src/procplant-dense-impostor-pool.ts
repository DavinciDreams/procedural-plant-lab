import * as THREE from "three";
import {
  buildProcPlantImpostorGeometry,
  createProcPlantImpostorAtlasTexture,
  type ProcPlantImpostorAtlas,
} from "./procplant-impostor";

export interface ProcPlantDenseImpostorSource {
  atlas: ProcPlantImpostorAtlas;
  /** Optional shared resources from an existing hero billboard package. */
  texture?: THREE.Texture;
  material?: THREE.Material;
  channelMode?: "color" | "color-normal-depth";
  seasonId?: string;
}

export interface ProcPlantDenseImpostorChannelSource extends ProcPlantDenseImpostorSource {
  texture: THREE.Texture;
  material: THREE.Material;
  channelMode: "color" | "color-normal-depth";
  seasonId: string;
}

export interface ProcPlantDenseImpostorPoolOptions {
  maxDistance?: number;
  cullHysteresis?: number;
  /** Minimum dot-score improvement required before changing atlas views. */
  viewHysteresis?: number;
  alphaTest?: number;
  frustumCulled?: boolean;
  ownTexture?: boolean;
  ownMaterial?: boolean;
}

export interface ProcPlantDenseImpostorPoolStats {
  readonly placements: number;
  visible: number;
  /** Placements excluded by the caller's visibility mask. */
  masked: number;
  culled: number;
  draws: number;
  triangles: number;
  lastMigrations: number;
  totalMigrations: number;
  readonly viewCounts: Int32Array;
}

export interface ProcPlantDenseImpostorSavings {
  fullGeometryTriangles: number;
  impostorTriangles: number;
  trianglesSaved: number;
  triangleReduction: number;
  naiveCardDraws: number;
  pooledDraws: number;
  drawsSaved: number;
}

const UNASSIGNED = -2;
const CULLED = -1;

const validateUnitInterval = (value: number, label: string, upperExclusive = false) => {
  if (!Number.isFinite(value) || value < 0 || (upperExclusive ? value >= 1 : value > 1)) {
    throw new Error(`${label} must be finite and in [0, ${upperExclusive ? "1)" : "1"}]`);
  }
};

export class ProcPlantDenseImpostorPool {
  readonly root = new THREE.Group();
  readonly meshes: readonly THREE.InstancedMesh[];
  readonly stats: ProcPlantDenseImpostorPoolStats;
  readonly atlas: ProcPlantImpostorAtlas;
  readonly texture: THREE.Texture | null;
  readonly material: THREE.Material;

  private readonly positions: Float32Array;
  private readonly rotations: Float32Array;
  private readonly scales: Float32Array;
  private readonly activeViews: Int16Array;
  private readonly visibilityMask: Uint8Array;
  private readonly maxDistance: number | null;
  private readonly cullHysteresis: number;
  private readonly viewHysteresis: number;
  private readonly ownTexture: boolean;
  private readonly ownMaterial: boolean;
  private readonly localCameraPosition = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly localDirection = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly billboardUp = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private disposed = false;

  constructor(
    source: ProcPlantImpostorAtlas | ProcPlantDenseImpostorSource,
    placements: readonly THREE.Matrix4[],
    options: ProcPlantDenseImpostorPoolOptions = {},
  ) {
    const resolved = "atlas" in source ? source : { atlas: source };
    this.atlas = resolved.atlas;
    if (this.atlas.entries.length < 1) throw new Error("dense impostor pool requires at least one atlas view");
    const cullHysteresis = options.cullHysteresis ?? 0.12;
    validateUnitInterval(cullHysteresis, "dense impostor cullHysteresis", true);
    this.cullHysteresis = cullHysteresis;
    const viewHysteresis = options.viewHysteresis ?? 0.035;
    validateUnitInterval(viewHysteresis, "dense impostor viewHysteresis");
    this.viewHysteresis = viewHysteresis;
    if (options.maxDistance !== undefined && (!Number.isFinite(options.maxDistance) || options.maxDistance < 0)) {
      throw new Error("dense impostor maxDistance must be finite and non-negative");
    }
    this.maxDistance = options.maxDistance ?? null;
    this.texture = resolved.texture ?? (resolved.material ? null : createProcPlantImpostorAtlasTexture(this.atlas));
    this.material = resolved.material ?? new THREE.MeshBasicMaterial({
      name: "procplant-dense-impostor-material",
      map: this.texture,
      alphaTest: THREE.MathUtils.clamp(options.alphaTest ?? 0.08, 0, 1),
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.ownTexture = options.ownTexture ?? (!resolved.texture && !resolved.material);
    this.ownMaterial = options.ownMaterial ?? !resolved.material;

    this.positions = new Float32Array(placements.length * 3);
    this.rotations = new Float32Array(placements.length * 4);
    this.scales = new Float32Array(placements.length * 2);
    for (let index = 0; index < placements.length; index++) {
      placements[index]!.decompose(this.position, this.quaternion, this.scale);
      this.position.toArray(this.positions, index * 3);
      this.quaternion.toArray(this.rotations, index * 4);
      this.scales[index * 2] = Math.max(Math.abs(this.scale.x), Math.abs(this.scale.z), 1e-6);
      this.scales[index * 2 + 1] = Math.max(Math.abs(this.scale.y), 1e-6);
    }
    this.activeViews = new Int16Array(placements.length);
    this.activeViews.fill(UNASSIGNED);
    this.visibilityMask = new Uint8Array(placements.length);
    this.visibilityMask.fill(1);
    const viewCounts = new Int32Array(this.atlas.entries.length);
    this.stats = {
      placements: placements.length,
      visible: 0,
      masked: 0,
      culled: 0,
      draws: 0,
      triangles: 0,
      lastMigrations: 0,
      totalMigrations: 0,
      viewCounts,
    };

    this.root.name = "procplant-dense-impostor-pool";
    this.root.userData.procplantDenseImpostorPool = {
      contentHash: this.atlas.contentHash,
      views: this.atlas.entries.length,
      placements: placements.length,
      channelMode: resolved.channelMode ?? "color",
      seasonId: resolved.seasonId ?? null,
    };
    const meshes: THREE.InstancedMesh[] = [];
    for (let viewIndex = 0; viewIndex < this.atlas.entries.length; viewIndex++) {
      const entry = this.atlas.entries[viewIndex]!;
      const geometry = buildProcPlantImpostorGeometry(this.atlas, { viewId: entry.id, mode: "billboard" });
      const mesh = new THREE.InstancedMesh(geometry, this.material, placements.length);
      mesh.name = `procplant-dense-impostor-${entry.id}`;
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = options.frustumCulled ?? true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.boundingBox = new THREE.Box3();
      mesh.boundingSphere = new THREE.Sphere();
      mesh.userData.procplantImpostorView = entry.id;
      meshes.push(mesh);
      this.root.add(mesh);
    }
    this.meshes = meshes;
  }

  /** Update with a camera position expressed in pool-local coordinates. */
  update(localCameraPosition: THREE.Vector3): ProcPlantDenseImpostorPoolStats {
    this.assertUsable();
    this.stats.visible = 0;
    this.stats.masked = 0;
    this.stats.culled = 0;
    this.stats.draws = 0;
    this.stats.triangles = 0;
    this.stats.lastMigrations = 0;
    this.stats.viewCounts.fill(0);
    for (const mesh of this.meshes) mesh.count = 0;

    for (let placement = 0; placement < this.activeViews.length; placement++) {
      const previous = this.activeViews[placement]!;
      if (this.visibilityMask[placement] === 0) {
        this.migrate(placement, previous, CULLED);
        this.stats.masked++;
        continue;
      }
      const positionOffset = placement * 3;
      const px = this.positions[positionOffset]!;
      const py = this.positions[positionOffset + 1]!;
      const pz = this.positions[positionOffset + 2]!;
      const dx = localCameraPosition.x - px;
      const dy = localCameraPosition.y - py;
      const dz = localCameraPosition.z - pz;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      const distance = Math.sqrt(distanceSq);
      if (this.shouldCull(distance, previous)) {
        this.migrate(placement, previous, CULLED);
        this.stats.culled++;
        continue;
      }
      if (distanceSq <= 1e-12) {
        this.direction.set(0, 0, 1);
      } else {
        this.direction.set(dx, dy, dz).multiplyScalar(1 / distance);
      }
      const rotationOffset = placement * 4;
      this.quaternion.set(
        this.rotations[rotationOffset]!,
        this.rotations[rotationOffset + 1]!,
        this.rotations[rotationOffset + 2]!,
        this.rotations[rotationOffset + 3]!,
      );
      this.localDirection.copy(this.direction).applyQuaternion(this.quaternion.conjugate());
      const nextView = this.resolveView(this.localDirection, previous);
      this.migrate(placement, previous, nextView);
      const mesh = this.meshes[nextView]!;
      this.composeBillboardMatrix(placement, px, py, pz);
      mesh.setMatrixAt(mesh.count, this.matrix);
      mesh.count++;
      this.stats.viewCounts[nextView]++;
      this.stats.visible++;
    }

    for (const mesh of this.meshes) {
      mesh.instanceMatrix.clearUpdateRanges();
      if (mesh.count > 0) {
        mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
        this.stats.draws++;
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.updateBounds(mesh);
    }
    this.stats.triangles = this.stats.visible * 2;
    this.stats.totalMigrations += this.stats.lastMigrations;
    return this.stats;
  }

  /** Convert a world-space camera position into pool-local space without allocating. */
  updateFromCamera(camera: THREE.Camera): ProcPlantDenseImpostorPoolStats {
    this.assertUsable();
    camera.updateWorldMatrix(true, false);
    this.root.updateWorldMatrix(true, false);
    this.localCameraPosition.setFromMatrixPosition(camera.matrixWorld);
    this.root.worldToLocal(this.localCameraPosition);
    return this.update(this.localCameraPosition);
  }

  getPlacementView(placementIndex: number): string | null {
    this.assertUsable();
    const view = this.activeViews[placementIndex];
    return view !== undefined && view >= 0 ? this.atlas.entries[view]!.id : null;
  }

  /**
   * Replace the placement visibility mask without resizing any render buffer.
   * A null mask restores every placement. The next update applies the change.
   */
  setVisibilityMask(mask: ArrayLike<number | boolean> | null) {
    this.assertUsable();
    if (mask === null) {
      this.visibilityMask.fill(1);
      return;
    }
    if (mask.length !== this.visibilityMask.length) {
      throw new Error(`dense impostor visibility mask length ${mask.length} does not match ${this.visibilityMask.length} placements`);
    }
    for (let index = 0; index < mask.length; index++) {
      this.visibilityMask[index] = mask[index] ? 1 : 0;
    }
  }

  /** Update one mask entry in place for assignment-change callbacks. */
  setPlacementVisible(placementIndex: number, visible: boolean) {
    this.assertUsable();
    if (!Number.isInteger(placementIndex) || placementIndex < 0 || placementIndex >= this.visibilityMask.length) {
      return false;
    }
    this.visibilityMask[placementIndex] = visible ? 1 : 0;
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.root.clear();
    for (const mesh of this.meshes) mesh.geometry.dispose();
    if (this.ownMaterial) this.material.dispose();
    if (this.ownTexture) this.texture?.dispose();
  }

  private shouldCull(distance: number, current: number) {
    if (this.maxDistance === null) return false;
    const threshold = current === UNASSIGNED
      ? this.maxDistance
      : current === CULLED
        ? this.maxDistance * (1 - this.cullHysteresis)
        : this.maxDistance * (1 + this.cullHysteresis);
    return distance > threshold;
  }

  private resolveView(direction: THREE.Vector3, current: number) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < this.atlas.entries.length; index++) {
      const outward = this.atlas.entries[index]!.view.outward;
      const score = direction.x * outward.x + direction.y * outward.y + direction.z * outward.z;
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }
    if (current < 0 || current === bestIndex) return bestIndex;
    const currentOutward = this.atlas.entries[current]!.view.outward;
    const currentScore = direction.x * currentOutward.x
      + direction.y * currentOutward.y
      + direction.z * currentOutward.z;
    return bestScore > currentScore + this.viewHysteresis ? bestIndex : current;
  }

  private composeBillboardMatrix(placement: number, px: number, py: number, pz: number) {
    const rotationOffset = placement * 4;
    this.quaternion.set(
      this.rotations[rotationOffset]!,
      this.rotations[rotationOffset + 1]!,
      this.rotations[rotationOffset + 2]!,
      this.rotations[rotationOffset + 3]!,
    );
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.up.addScaledVector(this.direction, -this.up.dot(this.direction));
    if (this.up.lengthSq() < 1e-8) {
      this.up.set(0, 0, 1).addScaledVector(this.direction, -this.direction.z);
      if (this.up.lengthSq() < 1e-8) this.up.set(1, 0, 0);
    }
    this.up.normalize();
    this.right.crossVectors(this.up, this.direction).normalize();
    this.billboardUp.crossVectors(this.direction, this.right).normalize();
    this.matrix.makeBasis(this.right, this.billboardUp, this.direction);
    this.scale.set(this.scales[placement * 2]!, this.scales[placement * 2 + 1]!, 1);
    this.matrix.scale(this.scale);
    this.matrix.setPosition(px, py, pz);
  }

  private migrate(placement: number, previous: number, next: number) {
    if (previous === next) return;
    this.activeViews[placement] = next;
    this.stats.lastMigrations++;
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
    if (this.disposed) throw new Error("dense impostor pool has been disposed");
  }
}

export const estimateProcPlantDenseImpostorSavings = (
  sourceTrianglesPerPlacement: number,
  stats: Pick<ProcPlantDenseImpostorPoolStats, "placements" | "visible" | "draws"> & { masked?: number },
): ProcPlantDenseImpostorSavings => {
  if (!Number.isFinite(sourceTrianglesPerPlacement) || sourceTrianglesPerPlacement < 0) {
    throw new Error("sourceTrianglesPerPlacement must be finite and non-negative");
  }
  const eligiblePlacements = Math.max(0, stats.placements - (stats.masked ?? 0));
  const fullGeometryTriangles = eligiblePlacements * sourceTrianglesPerPlacement;
  const impostorTriangles = stats.visible * 2;
  const trianglesSaved = Math.max(0, fullGeometryTriangles - impostorTriangles);
  const naiveCardDraws = stats.visible;
  return {
    fullGeometryTriangles,
    impostorTriangles,
    trianglesSaved,
    triangleReduction: fullGeometryTriangles > 0 ? trianglesSaved / fullGeometryTriangles : 0,
    naiveCardDraws,
    pooledDraws: stats.draws,
    drawsSaved: Math.max(0, naiveCardDraws - stats.draws),
  };
};

export const createProcPlantDenseImpostorPool = (
  source: ProcPlantImpostorAtlas | ProcPlantDenseImpostorSource,
  placements: readonly THREE.Matrix4[],
  options: ProcPlantDenseImpostorPoolOptions = {},
) => new ProcPlantDenseImpostorPool(source, placements, options);

/** Adopt a hero channel binding while keeping its textures and material caller-owned. */
export const createProcPlantDenseImpostorPoolFromChannelRender = (
  source: ProcPlantDenseImpostorChannelSource,
  placements: readonly THREE.Matrix4[],
  options: Omit<ProcPlantDenseImpostorPoolOptions, "ownTexture" | "ownMaterial"> = {},
) => new ProcPlantDenseImpostorPool(source, placements, {
  ...options,
  ownTexture: false,
  ownMaterial: false,
});
