import * as THREE from "three";

export const PROCPLANT_SWAY_ATTRIBUTE = "procplantSway";
export const PROCPLANT_INSTANCE_SWAY_ATTRIBUTE = "procplantInstanceSway";
export const PROCPLANT_WIND_PHASE_ATTRIBUTE = "procplantWindPhase";
export const PROCPLANT_WIND_ANCHOR_ATTRIBUTE = "procplantWindAnchor";
export const PROCPLANT_WIND_BAND_ATTRIBUTE = "procplantWindBand";

const PROCPLANT_TINTABLE_ATTRIBUTE = "procplantTintable";
const PROCPLANT_BRANCH_ORDER_ATTRIBUTE = "procplantBranchOrder";
const PROCPLANT_BRANCH_U_ATTRIBUTE = "procplantBranchU";

export const PROCPLANT_WIND_BAND_TRUNK = 0 as const;
export const PROCPLANT_WIND_BAND_BRANCH = 1 as const;
export const PROCPLANT_WIND_BAND_LEAF = 2 as const;

export type ProcPlantWindBand =
  | typeof PROCPLANT_WIND_BAND_TRUNK
  | typeof PROCPLANT_WIND_BAND_BRANCH
  | typeof PROCPLANT_WIND_BAND_LEAF;

export interface ProcPlantWindUniforms {
  time: { value: number };
  strength: { value: number };
}

export interface ProcPlantWindShaderOptions {
  /**
   * Opt in to render-only trunk/branch/leaf bands and anchor-relative motion.
   * The default remains the version-1 scalar-sway shader for downstream compatibility.
   */
  hierarchical?: boolean;
}

export interface ProcPlantHierarchicalWindAttributeOptions {
  /** Used only when neither tintable nor branch-order semantics are present. */
  fallbackBand?: ProcPlantWindBand;
}

export interface ProcPlantHierarchicalWindAudit {
  readonly contract: "procplants.hierarchical-wind-attributes";
  readonly version: 1;
  readonly vertexCount: number;
  readonly trunkVertices: number;
  readonly branchVertices: number;
  readonly leafVertices: number;
  readonly trunkComponents: number;
  readonly branchComponents: number;
  readonly leafComponents: number;
  readonly branchSource: "procplantBranchOrder" | "unavailable";
  readonly leafSource: "procplantTintable" | "fallback" | "unavailable";
  readonly attributeBytes: number;
}

export const createProcPlantWindUniforms = (strength = 0.16): ProcPlantWindUniforms => ({
  time: { value: 0 },
  strength: { value: strength },
});

const windVertexDeclarations = `
uniform float procplantWindTime;
uniform float procplantWindStrength;
attribute float ${PROCPLANT_SWAY_ATTRIBUTE};
#ifdef USE_INSTANCING
attribute float ${PROCPLANT_INSTANCE_SWAY_ATTRIBUTE};
attribute float ${PROCPLANT_WIND_PHASE_ATTRIBUTE};
#endif
`;

const hierarchicalWindVertexDeclarations = `
attribute vec3 ${PROCPLANT_WIND_ANCHOR_ATTRIBUTE};
attribute float ${PROCPLANT_WIND_BAND_ATTRIBUTE};

vec3 procplantRotateAroundAxis(vec3 value, vec3 axis, float angle) {
  float sine = sin(angle);
  float cosine = cos(angle);
  return value * cosine + cross(axis, value) * sine + axis * dot(axis, value) * (1.0 - cosine);
}
`;

const windInstanceValues = `
float procplantInstanceSwayValue = 1.0;
float procplantWindPhaseValue = 0.0;
#ifdef USE_INSTANCING
procplantInstanceSwayValue = ${PROCPLANT_INSTANCE_SWAY_ATTRIBUTE};
procplantWindPhaseValue = ${PROCPLANT_WIND_PHASE_ATTRIBUTE};
#endif
float procplantSwayValue = clamp(${PROCPLANT_SWAY_ATTRIBUTE} * procplantInstanceSwayValue, 0.0, 1.5);
`;

const windVertexTransform = `
#include <begin_vertex>
${windInstanceValues}
float procplantWindWave = sin(procplantWindTime * 1.35 + procplantWindPhaseValue + position.y * 0.72);
float procplantWindCross = cos(procplantWindTime * 0.91 + procplantWindPhaseValue * 1.37 + position.x * 0.34);
float procplantWindAmplitude = procplantWindStrength * procplantSwayValue;
transformed.x += procplantWindWave * procplantWindAmplitude;
transformed.z += procplantWindCross * procplantWindAmplitude * 0.42;
`;

const hierarchicalWindFactors = `
float procplantBandValue = clamp(floor(${PROCPLANT_WIND_BAND_ATTRIBUTE} + 0.5), 0.0, 2.0);
float procplantLeafWeight = step(1.5, procplantBandValue);
float procplantBranchWeight = step(0.5, procplantBandValue) * (1.0 - procplantLeafWeight);
float procplantTrunkWeight = 1.0 - procplantBranchWeight - procplantLeafWeight;
vec3 procplantWindLocal = position - ${PROCPLANT_WIND_ANCHOR_ATTRIBUTE};
float procplantWindGust = 0.72 + 0.28 * sin(procplantWindTime * 0.31 + procplantWindPhaseValue * 0.17 + ${PROCPLANT_WIND_ANCHOR_ATTRIBUTE}.x * 0.73 + ${PROCPLANT_WIND_ANCHOR_ATTRIBUTE}.z * 0.41);
float procplantTrunkWave = sin(procplantWindTime * 0.72 + procplantWindPhaseValue + position.y * 0.42);
float procplantTrunkCross = cos(procplantWindTime * 0.49 + procplantWindPhaseValue * 1.21 + position.x * 0.19);
float procplantBranchWave = sin(procplantWindTime * 1.37 + procplantWindPhaseValue + dot(${PROCPLANT_WIND_ANCHOR_ATTRIBUTE}.xz, vec2(0.37, 0.23)));
float procplantLeafWave = sin(procplantWindTime * 4.83 + procplantWindPhaseValue * 1.71 + dot(procplantWindLocal, vec3(2.1, 5.3, 3.7)));
float procplantBranchAngle = procplantWindStrength * procplantSwayValue * procplantWindGust * procplantBranchWave * 0.62;
float procplantLeafAngle = procplantWindStrength * procplantSwayValue * procplantWindGust * (0.82 * procplantBranchWave + 0.28 * procplantLeafWave);
vec3 procplantBranchAxis = normalize(vec3(0.12, 0.04, 1.0));
vec3 procplantLeafAxis = normalize(vec3(0.68, 0.16, 0.72));
`;

const hierarchicalWindVertexTransform = `
#include <begin_vertex>
{
${windInstanceValues}
${hierarchicalWindFactors}
float procplantWindAmplitude = procplantWindStrength * procplantSwayValue * procplantWindGust;
vec3 procplantTrunkPosition = transformed + vec3(
  procplantTrunkWave * procplantWindAmplitude,
  0.0,
  procplantTrunkCross * procplantWindAmplitude * 0.34
);
vec3 procplantBranchPosition = ${PROCPLANT_WIND_ANCHOR_ATTRIBUTE} + procplantRotateAroundAxis(procplantWindLocal, procplantBranchAxis, procplantBranchAngle);
vec3 procplantLeafPosition = ${PROCPLANT_WIND_ANCHOR_ATTRIBUTE} + procplantRotateAroundAxis(procplantWindLocal, procplantLeafAxis, procplantLeafAngle);
vec3 procplantLeafRippleDirection = normalize(vec3(-procplantWindLocal.z + 0.01, 0.24, procplantWindLocal.x + 0.01));
procplantLeafPosition += procplantLeafRippleDirection * procplantLeafWave * procplantWindAmplitude * 0.045;
transformed = procplantTrunkPosition * procplantTrunkWeight
  + procplantBranchPosition * procplantBranchWeight
  + procplantLeafPosition * procplantLeafWeight;
}
`;

const hierarchicalWindNormalTransform = `
#include <beginnormal_vertex>
{
${windInstanceValues}
${hierarchicalWindFactors}
vec3 procplantBranchNormal = procplantRotateAroundAxis(objectNormal, procplantBranchAxis, procplantBranchAngle);
vec3 procplantLeafNormal = procplantRotateAroundAxis(objectNormal, procplantLeafAxis, procplantLeafAngle);
objectNormal = objectNormal * procplantTrunkWeight
  + procplantBranchNormal * procplantBranchWeight
  + procplantLeafNormal * procplantLeafWeight;
}
`;

type WindShader = Parameters<THREE.MeshLambertMaterial["onBeforeCompile"]>[0];

export const installProcPlantWindShader = <T extends THREE.Material>(
  material: T,
  uniforms: ProcPlantWindUniforms,
  options: ProcPlantWindShaderOptions = {},
): T => {
  const hierarchical = options.hierarchical === true;
  material.onBeforeCompile = ((shader: WindShader) => {
    shader.uniforms.procplantWindTime = uniforms.time;
    shader.uniforms.procplantWindStrength = uniforms.strength;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\n${windVertexDeclarations}${hierarchical ? hierarchicalWindVertexDeclarations : ""}`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        hierarchical ? hierarchicalWindNormalTransform : "#include <beginnormal_vertex>",
      )
      .replace(
        "#include <begin_vertex>",
        hierarchical ? hierarchicalWindVertexTransform : windVertexTransform,
      );
  }) as T["onBeforeCompile"];
  material.customProgramCacheKey = () => hierarchical ? "procplant-wind-v2-hierarchical" : "procplant-wind-v1";
  return material;
};

export const addProcPlantSwayAttribute = (
  geometry: THREE.BufferGeometry,
  values?: Float32Array,
): THREE.BufferGeometry => {
  const position = geometry.getAttribute("position");
  if (!position || geometry.hasAttribute(PROCPLANT_SWAY_ATTRIBUTE)) return geometry;
  let sway = values;
  if (!sway || sway.length !== position.count) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const minY = box?.min.y ?? 0;
    const height = Math.max(1e-4, (box?.max.y ?? 1) - minY);
    sway = new Float32Array(position.count);
    for (let i = 0; i < position.count; i++) {
      const normalizedHeight = THREE.MathUtils.clamp((position.getY(i) - minY) / height, 0, 1);
      sway[i] = normalizedHeight * normalizedHeight;
    }
  }
  geometry.setAttribute(
    PROCPLANT_SWAY_ATTRIBUTE,
    new THREE.BufferAttribute(sway, 1).setUsage(THREE.StaticDrawUsage),
  );
  return geometry;
};

const assertFiniteAttribute = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, label: string) => {
  for (let vertex = 0; vertex < attribute.count; vertex++) {
    for (let item = 0; item < attribute.itemSize; item++) {
      if (!Number.isFinite(attribute.getComponent(vertex, item))) {
        throw new Error(`${label}[${vertex}].${item} must be finite`);
      }
    }
  }
};

class ProcPlantWindDisjointSet {
  private readonly parent: Int32Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    for (let index = 0; index < size; index++) this.parent[index] = index;
  }

  find(value: number): number {
    let root = value;
    while (this.parent[root] !== root) root = this.parent[root]!;
    while (this.parent[value] !== value) {
      const next = this.parent[value]!;
      this.parent[value] = root;
      value = next;
    }
    return root;
  }

  union(left: number, right: number) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    if (leftRoot < rightRoot) this.parent[rightRoot] = leftRoot;
    else this.parent[leftRoot] = rightRoot;
  }
}

const componentAnchor = (
  vertices: readonly number[],
  band: ProcPlantWindBand,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  sway: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
  branchU: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
  structuralDistance: ((vertex: number) => number) | null,
) => {
  let bestVertex = vertices[0]!;
  let bestMetric = Number.POSITIVE_INFINITY;
  for (const vertex of vertices) {
    let metric: number;
    if (band === PROCPLANT_WIND_BAND_BRANCH && branchU) {
      metric = branchU.getX(vertex);
    } else if (band === PROCPLANT_WIND_BAND_LEAF && structuralDistance) {
      metric = structuralDistance(vertex);
    } else if (sway) {
      metric = sway.getX(vertex);
    } else {
      metric = position.getY(vertex);
    }
    if (metric < bestMetric || (metric === bestMetric && vertex < bestVertex)) {
      bestMetric = metric;
      bestVertex = vertex;
    }
  }
  return [position.getX(bestVertex), position.getY(bestVertex), position.getZ(bestVertex)] as const;
};

/**
 * Derive render-only hierarchy data from attributes already present on a Three geometry.
 * `procplantTintable` distinguishes organs; `procplantBranchOrder` distinguishes branch
 * tubes when that authored semantic survives to the renderer. Missing semantics remain
 * trunk unless the caller explicitly identifies an organ-only prototype with fallbackBand.
 */
export const addProcPlantHierarchicalWindAttributes = (
  geometry: THREE.BufferGeometry,
  options: ProcPlantHierarchicalWindAttributeOptions = {},
): ProcPlantHierarchicalWindAudit => {
  const position = geometry.getAttribute("position");
  if (!position || position.itemSize !== 3) throw new Error("hierarchical wind requires finite vec3 positions");
  assertFiniteAttribute(position, "hierarchical wind position");
  const existingAnchor = geometry.getAttribute(PROCPLANT_WIND_ANCHOR_ATTRIBUTE);
  const existingBand = geometry.getAttribute(PROCPLANT_WIND_BAND_ATTRIBUTE);
  if (Boolean(existingAnchor) !== Boolean(existingBand)) {
    throw new Error("hierarchical wind anchor and band attributes must be installed together");
  }
  const tintable = geometry.getAttribute(PROCPLANT_TINTABLE_ATTRIBUTE);
  const branchOrder = geometry.getAttribute(PROCPLANT_BRANCH_ORDER_ATTRIBUTE);
  const branchU = geometry.getAttribute(PROCPLANT_BRANCH_U_ATTRIBUTE);
  const sway = geometry.getAttribute(PROCPLANT_SWAY_ATTRIBUTE);
  for (const [attribute, label] of [
    [tintable, PROCPLANT_TINTABLE_ATTRIBUTE],
    [branchOrder, PROCPLANT_BRANCH_ORDER_ATTRIBUTE],
    [branchU, PROCPLANT_BRANCH_U_ATTRIBUTE],
    [sway, PROCPLANT_SWAY_ATTRIBUTE],
  ] as const) {
    if (attribute && attribute.count !== position.count) throw new Error(`${label} must contain one value per vertex`);
    if (attribute) assertFiniteAttribute(attribute, label);
  }
  if (existingAnchor || existingBand) {
    if (existingAnchor!.itemSize !== 3 || existingAnchor!.count !== position.count) {
      throw new Error("existing hierarchical wind anchor must contain one vec3 per vertex");
    }
    if (existingBand!.itemSize !== 1 || existingBand!.count !== position.count) {
      throw new Error("existing hierarchical wind band must contain one scalar per vertex");
    }
  }

  const fallbackBand = options.fallbackBand ?? PROCPLANT_WIND_BAND_TRUNK;
  if (![PROCPLANT_WIND_BAND_TRUNK, PROCPLANT_WIND_BAND_BRANCH, PROCPLANT_WIND_BAND_LEAF].includes(fallbackBand)) {
    throw new Error("hierarchical wind fallbackBand must be trunk, branch, or leaf");
  }
  const bands = existingBand
    ? new Uint8Array(Array.from({ length: position.count }, (_, vertex) => existingBand.getX(vertex)))
    : new Uint8Array(position.count);
  if (!existingBand) {
    for (let vertex = 0; vertex < position.count; vertex++) {
      bands[vertex] = tintable
        ? tintable.getX(vertex) > 0.5
          ? PROCPLANT_WIND_BAND_LEAF
          : branchOrder?.getX(vertex) > 0
            ? PROCPLANT_WIND_BAND_BRANCH
            : PROCPLANT_WIND_BAND_TRUNK
        : branchOrder
          ? branchOrder.getX(vertex) > 0
            ? PROCPLANT_WIND_BAND_BRANCH
            : PROCPLANT_WIND_BAND_TRUNK
          : fallbackBand;
    }
  }
  for (let vertex = 0; vertex < bands.length; vertex++) {
    if (bands[vertex]! > PROCPLANT_WIND_BAND_LEAF) throw new Error(`hierarchical wind band ${vertex} is outside 0..2`);
  }

  const disjoint = new ProcPlantWindDisjointSet(position.count);
  const connectTriangle = (a: number, b: number, c: number) => {
    if (a >= position.count || b >= position.count || c >= position.count) {
      throw new Error("hierarchical wind index references a missing vertex");
    }
    if (bands[a] === bands[b]) disjoint.union(a, b);
    if (bands[b] === bands[c]) disjoint.union(b, c);
    if (bands[c] === bands[a]) disjoint.union(c, a);
  };
  if (geometry.index) {
    if (geometry.index.count % 3 !== 0) throw new Error("hierarchical wind indices must contain triangles");
    for (let offset = 0; offset < geometry.index.count; offset += 3) {
      connectTriangle(geometry.index.getX(offset), geometry.index.getX(offset + 1), geometry.index.getX(offset + 2));
    }
  } else {
    if (position.count % 3 !== 0) throw new Error("non-indexed hierarchical wind geometry must contain triangles");
    for (let vertex = 0; vertex < position.count; vertex += 3) connectTriangle(vertex, vertex + 1, vertex + 2);
  }
  // TemplateBuilder intentionally duplicates triangle vertices. Reconnect exact
  // authored corners so one organ receives one stable attachment anchor.
  const vertexAtPosition = new Map<string, number>();
  for (let vertex = 0; vertex < position.count; vertex++) {
    const key = `${bands[vertex]}:${Math.round(position.getX(vertex) * 1e6)}:${Math.round(position.getY(vertex) * 1e6)}:${Math.round(position.getZ(vertex) * 1e6)}`;
    const prior = vertexAtPosition.get(key);
    if (prior === undefined) vertexAtPosition.set(key, vertex);
    else disjoint.union(prior, vertex);
  }

  const components = new Map<number, number[]>();
  for (let vertex = 0; vertex < position.count; vertex++) {
    const root = disjoint.find(vertex);
    const vertices = components.get(root) ?? [];
    vertices.push(vertex);
    components.set(root, vertices);
  }
  const structuralVertices = Array.from({ length: position.count }, (_, vertex) => vertex)
    .filter((vertex) => bands[vertex] !== PROCPLANT_WIND_BAND_LEAF);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const diagonal = bounds?.getSize(new THREE.Vector3()).length() ?? 1;
  const cellSize = Math.max(1e-5, diagonal / 64);
  const cellCoordinate = (value: number) => Math.floor(value / cellSize);
  const cellKey = (x: number, y: number, z: number) => `${x}:${y}:${z}`;
  const structuralGrid = new Map<string, number[]>();
  for (const vertex of structuralVertices) {
    const key = cellKey(
      cellCoordinate(position.getX(vertex)),
      cellCoordinate(position.getY(vertex)),
      cellCoordinate(position.getZ(vertex)),
    );
    const vertices = structuralGrid.get(key) ?? [];
    vertices.push(vertex);
    structuralGrid.set(key, vertices);
  }
  // A capped deterministic fallback handles unusually detached authored organs
  // without turning the common attached-leaf path into an all-pairs search.
  const maxStructuralSamples = 2048;
  const structuralStride = Math.max(1, Math.ceil(structuralVertices.length / maxStructuralSamples));
  const structuralSamples = structuralVertices.filter((_, index) => index % structuralStride === 0);
  const structuralDistance = structuralVertices.length === 0 ? null : (vertex: number) => {
    const x = position.getX(vertex);
    const y = position.getY(vertex);
    const z = position.getZ(vertex);
    const cx = cellCoordinate(x);
    const cy = cellCoordinate(y);
    const cz = cellCoordinate(z);
    let best = Number.POSITIVE_INFINITY;
    for (let radius = 0; radius <= 3 && !Number.isFinite(best); radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (radius > 0 && Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== radius) continue;
            for (const structuralVertex of structuralGrid.get(cellKey(cx + dx, cy + dy, cz + dz)) ?? []) {
              const offsetX = x - position.getX(structuralVertex);
              const offsetY = y - position.getY(structuralVertex);
              const offsetZ = z - position.getZ(structuralVertex);
              best = Math.min(best, offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ);
            }
          }
        }
      }
    }
    if (Number.isFinite(best)) return best;
    for (const structuralVertex of structuralSamples) {
      const offsetX = x - position.getX(structuralVertex);
      const offsetY = y - position.getY(structuralVertex);
      const offsetZ = z - position.getZ(structuralVertex);
      best = Math.min(best, offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ);
    }
    return best;
  };
  const anchors = existingAnchor ? null : new Float32Array(position.count * 3);
  const componentCounts = [0, 0, 0];
  for (const vertices of components.values()) {
    const band = bands[vertices[0]!]! as ProcPlantWindBand;
    componentCounts[band]!++;
    if (!anchors) continue;
    const anchor = componentAnchor(vertices, band, position, sway, branchU, structuralDistance);
    for (const vertex of vertices) anchors.set(anchor, vertex * 3);
  }
  if (!existingAnchor) {
    geometry.setAttribute(
      PROCPLANT_WIND_ANCHOR_ATTRIBUTE,
      new THREE.BufferAttribute(anchors!, 3).setUsage(THREE.StaticDrawUsage),
    );
  }
  if (!existingBand) {
    geometry.setAttribute(
      PROCPLANT_WIND_BAND_ATTRIBUTE,
      new THREE.BufferAttribute(bands, 1).setUsage(THREE.StaticDrawUsage),
    );
  }
  const counts = [0, 0, 0];
  for (const band of bands) counts[band]!++;
  const audit: ProcPlantHierarchicalWindAudit = Object.freeze({
    contract: "procplants.hierarchical-wind-attributes",
    version: 1,
    vertexCount: position.count,
    trunkVertices: counts[PROCPLANT_WIND_BAND_TRUNK]!,
    branchVertices: counts[PROCPLANT_WIND_BAND_BRANCH]!,
    leafVertices: counts[PROCPLANT_WIND_BAND_LEAF]!,
    trunkComponents: componentCounts[PROCPLANT_WIND_BAND_TRUNK]!,
    branchComponents: componentCounts[PROCPLANT_WIND_BAND_BRANCH]!,
    leafComponents: componentCounts[PROCPLANT_WIND_BAND_LEAF]!,
    branchSource: branchOrder ? "procplantBranchOrder" : "unavailable",
    leafSource: tintable ? "procplantTintable" : fallbackBand === PROCPLANT_WIND_BAND_LEAF ? "fallback" : "unavailable",
    attributeBytes: position.count * (Float32Array.BYTES_PER_ELEMENT * 3 + Uint8Array.BYTES_PER_ELEMENT),
  });
  geometry.userData.procplantHierarchicalWind = audit;
  return audit;
};

const phaseForMatrix = (matrix: THREE.Matrix4, index: number) => {
  const elements = matrix.elements;
  const value = Math.sin(elements[12] * 12.9898 + elements[14] * 78.233 + index * 0.61803398875) * 43758.5453;
  return (value - Math.floor(value)) * Math.PI * 2;
};

export const addProcPlantInstanceWindAttributes = (
  mesh: THREE.InstancedMesh,
  matrices?: ArrayLike<THREE.Matrix4>,
  swayValues?: ArrayLike<number>,
) => {
  const sway = new Float32Array(mesh.count);
  const phase = new Float32Array(mesh.count);
  const scratchMatrix = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    sway[i] = swayValues?.[i] ?? 1;
    const matrix = matrices?.[i] ?? scratchMatrix;
    if (!matrices) mesh.getMatrixAt(i, scratchMatrix);
    phase[i] = phaseForMatrix(matrix, i);
  }
  mesh.geometry.setAttribute(
    PROCPLANT_INSTANCE_SWAY_ATTRIBUTE,
    new THREE.InstancedBufferAttribute(sway, 1).setUsage(THREE.StaticDrawUsage),
  );
  mesh.geometry.setAttribute(
    PROCPLANT_WIND_PHASE_ATTRIBUTE,
    new THREE.InstancedBufferAttribute(phase, 1).setUsage(THREE.StaticDrawUsage),
  );
};

export const createProcPlantWindShadowMaterials = (
  uniforms: ProcPlantWindUniforms,
  options: ProcPlantWindShaderOptions = {},
) => ({
  depth: installProcPlantWindShader(
    new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    uniforms,
    options,
  ),
  distance: installProcPlantWindShader(new THREE.MeshDistanceMaterial(), uniforms, options),
});
