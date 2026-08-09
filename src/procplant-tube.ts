import * as THREE from "three";

export const PROCPLANT_BRANCH_U_ATTRIBUTE = "procplantBranchU" as const;
export const PROCPLANT_BRANCH_V_ATTRIBUTE = "procplantBranchV" as const;
export const PROCPLANT_BRANCH_ORDER_ATTRIBUTE = "procplantBranchOrder" as const;
export const PROCPLANT_BRANCH_AGE_ATTRIBUTE = "procplantBranchAge" as const;
export const PROCPLANT_BRANCH_SWAY_ATTRIBUTE = "procplantSway" as const;
export const PROCPLANT_BRANCH_TINTABLE_ATTRIBUTE = "procplantTintable" as const;

export interface ProcPlantTubeSample {
  position: THREE.Vector3;
  radius: number;
  age?: number;
  branchOrder?: number;
}

export interface ProcPlantSweptTubeOptions {
  radialSegments?: number;
  barkRepeatLength?: number;
  irregularity?: number;
  irregularityFrequency?: number;
  seed?: number;
  collarStrength?: number;
  collarLength?: number;
  color?: THREE.ColorRepresentation;
  junctionAo?: number;
  capStart?: boolean;
  capEnd?: boolean;
}

export interface ProcPlantTubeFrame {
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

const assertSamples = (samples: readonly ProcPlantTubeSample[]) => {
  if (samples.length < 2) throw new Error("swept tube requires at least two samples");
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]!;
    if (![sample.position.x, sample.position.y, sample.position.z, sample.radius].every(Number.isFinite)) {
      throw new Error(`tube sample ${index} must be finite`);
    }
    if (sample.radius <= 0) throw new Error(`tube sample ${index} radius must be positive`);
    if (index > 0 && sample.position.distanceToSquared(samples[index - 1]!.position) < 1e-12) {
      throw new Error(`tube samples ${index - 1} and ${index} must not overlap`);
    }
  }
};

const tangentAt = (samples: readonly ProcPlantTubeSample[], index: number) => {
  if (index === 0) return samples[1]!.position.clone().sub(samples[0]!.position).normalize();
  if (index === samples.length - 1) return samples[index]!.position.clone().sub(samples[index - 1]!.position).normalize();
  return samples[index + 1]!.position.clone().sub(samples[index - 1]!.position).normalize();
};

/** Build twist-stable frames by parallel-transporting the first cross-section. */
export const buildProcPlantParallelTransportFrames = (
  samples: readonly ProcPlantTubeSample[],
  initialRight?: THREE.Vector3,
): ProcPlantTubeFrame[] => {
  assertSamples(samples);
  const frames: ProcPlantTubeFrame[] = [];
  const firstTangent = tangentAt(samples, 0);
  let firstRight = initialRight?.clone().projectOnPlane(firstTangent);
  if (!firstRight || firstRight.lengthSq() < 1e-8) {
    const reference = Math.abs(firstTangent.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    firstRight = new THREE.Vector3().crossVectors(reference, firstTangent);
  }
  firstRight.normalize();
  frames.push({
    tangent: firstTangent,
    right: firstRight,
    up: new THREE.Vector3().crossVectors(firstTangent, firstRight).normalize(),
  });
  const rotation = new THREE.Quaternion();
  for (let index = 1; index < samples.length; index++) {
    const tangent = tangentAt(samples, index);
    const previous = frames[index - 1]!;
    rotation.setFromUnitVectors(previous.tangent, tangent);
    let right = previous.right.clone().applyQuaternion(rotation).projectOnPlane(tangent);
    if (right.lengthSq() < 1e-8) right = previous.up.clone().cross(tangent);
    right.normalize();
    // Quaternion transport can choose an equivalent flipped frame near 180°;
    // retain continuity explicitly because bark seams must not jump rings.
    if (right.dot(previous.right) < 0) right.negate();
    frames.push({
      tangent,
      right,
      up: new THREE.Vector3().crossVectors(tangent, right).normalize(),
    });
  }
  return frames;
};

/** Solve the pipe-model parent radius: parent^p = sum(children^p). */
export const procPlantPipeModelRadius = (childRadii: readonly number[], exponent = 2.2) => {
  if (!Number.isFinite(exponent) || exponent <= 0) throw new Error("pipe exponent must be finite and positive");
  if (childRadii.length === 0) return 0;
  let flow = 0;
  for (const radius of childRadii) {
    if (!Number.isFinite(radius) || radius < 0) throw new Error("child radii must be finite and non-negative");
    flow += radius ** exponent;
  }
  return flow ** (1 / exponent);
};

const ringNoise = (seed: number, ring: number, side: number, frequency: number) => {
  const value = Math.sin(seed * 0.000103 + ring * 12.9898 + side * 78.233 + Math.sin((ring + side) * frequency) * 4.17) * 43758.5453;
  return value - Math.floor(value);
};

/**
 * Build an indexed generalized cylinder with parallel-transport frames,
 * irregular bark silhouette, cylindrical UVs, collar swelling, junction AO,
 * and branch-coordinate/wind attributes.
 */
export const createProcPlantSweptTubeGeometry = (
  samples: readonly ProcPlantTubeSample[],
  options: ProcPlantSweptTubeOptions = {},
): THREE.BufferGeometry => {
  assertSamples(samples);
  const radialSegments = Math.max(3, Math.min(64, Math.round(options.radialSegments ?? 7)));
  const barkRepeatLength = Math.max(1e-4, options.barkRepeatLength ?? 1.2);
  const irregularity = THREE.MathUtils.clamp(options.irregularity ?? 0.045, 0, 0.45);
  const frequency = Math.max(0.01, options.irregularityFrequency ?? 1.7);
  const collarStrength = THREE.MathUtils.clamp(options.collarStrength ?? 0.12, 0, 1.2);
  const collarLength = THREE.MathUtils.clamp(options.collarLength ?? 0.16, 0.001, 1);
  const junctionAo = THREE.MathUtils.clamp(options.junctionAo ?? 0.18, 0, 0.9);
  const seed = options.seed ?? 1;
  const baseColor = new THREE.Color(options.color ?? 0x72583c);
  const frames = buildProcPlantParallelTransportFrames(samples);
  const cumulative = new Float64Array(samples.length);
  for (let index = 1; index < samples.length; index++) {
    cumulative[index] = cumulative[index - 1]! + samples[index]!.position.distanceTo(samples[index - 1]!.position);
  }
  const totalLength = Math.max(1e-8, cumulative[cumulative.length - 1]!);
  const ringWidth = radialSegments + 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const branchU: number[] = [];
  const branchV: number[] = [];
  const branchOrder: number[] = [];
  const branchAge: number[] = [];
  const sway: number[] = [];
  const tintable: number[] = [];
  const indices: number[] = [];

  for (let ring = 0; ring < samples.length; ring++) {
    const sample = samples[ring]!;
    const frame = frames[ring]!;
    const axial = cumulative[ring]! / totalLength;
    const collar = 1 + collarStrength * Math.max(0, 1 - axial / collarLength) ** 2;
    const ao = 1 - junctionAo * Math.max(0, 1 - axial / Math.max(collarLength * 1.6, 1e-4));
    const ringColor = baseColor.clone().multiplyScalar(ao);
    for (let side = 0; side <= radialSegments; side++) {
      const v = side / radialSegments;
      const angle = v * Math.PI * 2;
      const radial = frame.right.clone().multiplyScalar(Math.cos(angle)).addScaledVector(frame.up, Math.sin(angle));
      const noise = 1 + (ringNoise(seed, ring, side % radialSegments, frequency) * 2 - 1) * irregularity;
      const radius = sample.radius * collar * noise;
      const position = sample.position.clone().addScaledVector(radial, radius);
      positions.push(position.x, position.y, position.z);
      normals.push(radial.x, radial.y, radial.z);
      uvs.push(v, cumulative[ring]! / barkRepeatLength);
      colors.push(ringColor.r, ringColor.g, ringColor.b);
      branchU.push(axial);
      branchV.push(v);
      branchOrder.push(sample.branchOrder ?? 0);
      branchAge.push(THREE.MathUtils.clamp(sample.age ?? axial, 0, 1));
      sway.push(axial * axial);
      tintable.push(0);
    }
  }
  for (let ring = 0; ring < samples.length - 1; ring++) {
    for (let side = 0; side < radialSegments; side++) {
      const a = ring * ringWidth + side;
      const b = a + 1;
      const c = (ring + 1) * ringWidth + side;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const addCap = (ring: number, reverse: boolean) => {
    const centerIndex = positions.length / 3;
    const sample = samples[ring]!;
    const frame = frames[ring]!;
    positions.push(sample.position.x, sample.position.y, sample.position.z);
    const capNormal = frame.tangent.clone().multiplyScalar(reverse ? -1 : 1);
    normals.push(capNormal.x, capNormal.y, capNormal.z);
    uvs.push(0.5, 0.5);
    colors.push(baseColor.r, baseColor.g, baseColor.b);
    branchU.push(ring === 0 ? 0 : 1);
    branchV.push(0.5);
    branchOrder.push(sample.branchOrder ?? 0);
    branchAge.push(THREE.MathUtils.clamp(sample.age ?? (ring === 0 ? 0 : 1), 0, 1));
    sway.push(ring === 0 ? 0 : 1);
    tintable.push(0);
    const start = ring * ringWidth;
    for (let side = 0; side < radialSegments; side++) {
      if (reverse) indices.push(centerIndex, start + side + 1, start + side);
      else indices.push(centerIndex, start + side, start + side + 1);
    }
  };
  if (options.capStart) addCap(0, true);
  if (options.capEnd) addCap(samples.length - 1, false);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute(PROCPLANT_BRANCH_U_ATTRIBUTE, new THREE.Float32BufferAttribute(branchU, 1));
  geometry.setAttribute(PROCPLANT_BRANCH_V_ATTRIBUTE, new THREE.Float32BufferAttribute(branchV, 1));
  geometry.setAttribute(PROCPLANT_BRANCH_ORDER_ATTRIBUTE, new THREE.Float32BufferAttribute(branchOrder, 1));
  geometry.setAttribute(PROCPLANT_BRANCH_AGE_ATTRIBUTE, new THREE.Float32BufferAttribute(branchAge, 1));
  geometry.setAttribute(PROCPLANT_BRANCH_SWAY_ATTRIBUTE, new THREE.Float32BufferAttribute(sway, 1));
  geometry.setAttribute(PROCPLANT_BRANCH_TINTABLE_ATTRIBUTE, new THREE.Uint8BufferAttribute(tintable, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.procplantSweptTube = {
    radialSegments,
    rings: samples.length,
    triangles: indices.length / 3,
    length: totalLength,
  };
  return geometry;
};
