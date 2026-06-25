import * as THREE from "three";

export interface ProcPlantTemplate {
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array;
  tintable: Uint8Array;
  sway: Float32Array;
  idx: Uint32Array;
}

export type ProcPlantHabit =
  | "grass"
  | "fern"
  | "flower"
  | "tropical"
  | "shrub";

export type LeafShapeKind =
  | "lanceolate"
  | "ovate"
  | "cordate"
  | "palmate"
  | "frond"
  | "blade";

export interface CurveGene {
  base: number;
  tip: number;
  curve: number;
}

export interface ProcPlantGenome {
  id: string;
  habit: ProcPlantHabit;
  nodeCount: number;
  internode: CurveGene;
  phyllotaxisAngle: number;
  branchChance: CurveGene;
  branchAngle: { mean: number; spread: number; depthDecay: number };
  apicalDominance: number;
  leaf: {
    shape: LeafShapeKind;
    length: CurveGene;
    widthRatio: number;
    density: CurveGene;
    curl: number;
    serration: number;
    venation: number;
    colorA: number;
    colorB: number;
  };
  flower?: {
    whorls: number;
    petals: number;
    radius: number;
    color: number;
    centerColor: number;
  };
  grass?: {
    blades: number;
    furBias: number;
    heightJitter: number;
  };
  fern?: {
    pinnae: number;
    leafletPairs: number;
    arch: number;
  };
  lightResponse: {
    shadeAvoidance: number;
    leafBoostInShade: number;
    branchSuppressionInShade: number;
    phototropism: number;
  };
}

export interface ProcPlantEnvironment {
  light: number;
  moisture: number;
  crowding: number;
  biomeWarmth: number;
}

export interface ProcPlantStats {
  stems: number;
  leaves: number;
  flowers: number;
  triangles: number;
}

interface StemNode {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  radius: number;
  depth: number;
  t: number;
  index: number;
}

interface Organ {
  kind: "leaf" | "flower" | "grassBlade" | "fernLeaflet";
  position: THREE.Vector3;
  direction: THREE.Vector3;
  right: THREE.Vector3;
  scale: number;
  t: number;
}

export interface ProcPlantGraph {
  stems: StemNode[];
  segments: Array<[number, number]>;
  organs: Organ[];
}

const GOLDEN_ANGLE = THREE.MathUtils.degToRad(137.50776405);
const UP = new THREE.Vector3(0, 1, 0);

export const PHI = (1 + Math.sqrt(5)) / 2;
export const GOLDEN_ANGLE_RADIANS = GOLDEN_ANGLE;

export const defaultPlantEnvironment = (): ProcPlantEnvironment => ({
  light: 0.78,
  moisture: 0.65,
  crowding: 0.25,
  biomeWarmth: 0.7,
});

export const procPlantPresets: Record<string, ProcPlantGenome> = {
  furGrass: {
    id: "furGrass",
    habit: "grass",
    nodeCount: 9,
    internode: { base: 0.12, tip: 0.07, curve: 0.95 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.02, tip: 0, curve: 1 },
    branchAngle: { mean: 0.18, spread: 0.1, depthDecay: 0.7 },
    apicalDominance: 0.9,
    leaf: {
      shape: "blade",
      length: { base: 0.42, tip: 0.76, curve: 1.2 },
      widthRatio: 0.035,
      density: { base: 1, tip: 0.9, curve: 1 },
      curl: 0.22,
      serration: 0,
      venation: 0.15,
      colorA: 0x395f20,
      colorB: 0xa6cf62,
    },
    grass: { blades: 38, furBias: 0.9, heightJitter: 0.38 },
    lightResponse: {
      shadeAvoidance: 0.45,
      leafBoostInShade: 0.2,
      branchSuppressionInShade: 0.4,
      phototropism: 0.18,
    },
  },
  phiFern: {
    id: "phiFern",
    habit: "fern",
    nodeCount: 18,
    internode: { base: 0.09, tip: 0.055, curve: 1.1 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0, tip: 0, curve: 1 },
    branchAngle: { mean: 0.72, spread: 0.18, depthDecay: 0.55 },
    apicalDominance: 0.55,
    leaf: {
      shape: "frond",
      length: { base: 0.19, tip: 0.08, curve: 0.85 },
      widthRatio: 0.28,
      density: { base: 0.95, tip: 0.65, curve: 1 },
      curl: 0.18,
      serration: 0.15,
      venation: 0.45,
      colorA: 0x224f1d,
      colorB: 0x73b851,
    },
    fern: { pinnae: 19, leafletPairs: 5, arch: 0.72 },
    lightResponse: {
      shadeAvoidance: 0.2,
      leafBoostInShade: 0.45,
      branchSuppressionInShade: 0.1,
      phototropism: 0.1,
    },
  },
  meadowFlower: {
    id: "meadowFlower",
    habit: "flower",
    nodeCount: 10,
    internode: { base: 0.11, tip: 0.08, curve: 1.05 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.08, tip: 0.02, curve: 1.8 },
    branchAngle: { mean: 0.55, spread: 0.18, depthDecay: 0.62 },
    apicalDominance: 0.82,
    leaf: {
      shape: "lanceolate",
      length: { base: 0.42, tip: 0.2, curve: 0.75 },
      widthRatio: 0.18,
      density: { base: 0.78, tip: 0.35, curve: 1.35 },
      curl: 0.1,
      serration: 0.08,
      venation: 0.55,
      colorA: 0x315f25,
      colorB: 0x89be54,
    },
    flower: {
      whorls: 2,
      petals: 5,
      radius: 0.22,
      color: 0xffc0d7,
      centerColor: 0xf4c94c,
    },
    lightResponse: {
      shadeAvoidance: 0.72,
      leafBoostInShade: 0.18,
      branchSuppressionInShade: 0.45,
      phototropism: 0.28,
    },
  },
  tropicalAroid: {
    id: "tropicalAroid",
    habit: "tropical",
    nodeCount: 13,
    internode: { base: 0.16, tip: 0.1, curve: 1 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.12, tip: 0.04, curve: 1.4 },
    branchAngle: { mean: 0.78, spread: 0.25, depthDecay: 0.55 },
    apicalDominance: 0.72,
    leaf: {
      shape: "cordate",
      length: { base: 0.72, tip: 0.46, curve: 0.8 },
      widthRatio: 0.62,
      density: { base: 0.75, tip: 0.55, curve: 1 },
      curl: 0.2,
      serration: 0.02,
      venation: 0.85,
      colorA: 0x244d2a,
      colorB: 0x66a94f,
    },
    flower: {
      whorls: 1,
      petals: 1,
      radius: 0.12,
      color: 0xe9f0c9,
      centerColor: 0xf6db6b,
    },
    lightResponse: {
      shadeAvoidance: 0.42,
      leafBoostInShade: 0.62,
      branchSuppressionInShade: 0.22,
      phototropism: 0.2,
    },
  },
  understoryShrub: {
    id: "understoryShrub",
    habit: "shrub",
    nodeCount: 15,
    internode: { base: 0.14, tip: 0.08, curve: 1.15 },
    phyllotaxisAngle: GOLDEN_ANGLE,
    branchChance: { base: 0.36, tip: 0.12, curve: 1.6 },
    branchAngle: { mean: 0.64, spread: 0.22, depthDecay: 0.68 },
    apicalDominance: 0.48,
    leaf: {
      shape: "ovate",
      length: { base: 0.28, tip: 0.18, curve: 1 },
      widthRatio: 0.42,
      density: { base: 0.9, tip: 0.7, curve: 1 },
      curl: 0.12,
      serration: 0.12,
      venation: 0.6,
      colorA: 0x2d5b24,
      colorB: 0x7fb449,
    },
    lightResponse: {
      shadeAvoidance: 0.38,
      leafBoostInShade: 0.32,
      branchSuppressionInShade: 0.28,
      phototropism: 0.15,
    },
  },
};

const curve = (gene: CurveGene, t: number): number => {
  const u = Math.max(0, Math.min(1, t));
  const shaped = gene.curve === 1 ? u : Math.pow(u, gene.curve);
  return THREE.MathUtils.lerp(gene.base, gene.tip, shaped);
};

const rngFromSeed = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const mixCurve = (a: CurveGene, b: CurveGene, alpha: number): CurveGene => ({
  base: THREE.MathUtils.lerp(a.base, b.base, alpha),
  tip: THREE.MathUtils.lerp(a.tip, b.tip, alpha),
  curve: THREE.MathUtils.lerp(a.curve, b.curve, alpha),
});

export const hybridizePlantGenomes = (
  a: ProcPlantGenome,
  b: ProcPlantGenome,
  alpha: number,
  seed = 1,
): ProcPlantGenome => {
  const rng = rngFromSeed(seed);
  const pick = <T>(left: T, right: T): T => (rng() < alpha ? right : left);
  const habit = pick(a.habit, b.habit);
  return {
    id: `${a.id}-${b.id}-hybrid`,
    habit,
    nodeCount: Math.round(THREE.MathUtils.lerp(a.nodeCount, b.nodeCount, alpha)),
    internode: mixCurve(a.internode, b.internode, alpha),
    phyllotaxisAngle: THREE.MathUtils.lerp(a.phyllotaxisAngle, b.phyllotaxisAngle, alpha),
    branchChance: mixCurve(a.branchChance, b.branchChance, alpha),
    branchAngle: {
      mean: THREE.MathUtils.lerp(a.branchAngle.mean, b.branchAngle.mean, alpha),
      spread: THREE.MathUtils.lerp(a.branchAngle.spread, b.branchAngle.spread, alpha),
      depthDecay: THREE.MathUtils.lerp(a.branchAngle.depthDecay, b.branchAngle.depthDecay, alpha),
    },
    apicalDominance: THREE.MathUtils.lerp(a.apicalDominance, b.apicalDominance, alpha),
    leaf: {
      shape: pick(a.leaf.shape, b.leaf.shape),
      length: mixCurve(a.leaf.length, b.leaf.length, alpha),
      widthRatio: THREE.MathUtils.lerp(a.leaf.widthRatio, b.leaf.widthRatio, alpha),
      density: mixCurve(a.leaf.density, b.leaf.density, alpha),
      curl: THREE.MathUtils.lerp(a.leaf.curl, b.leaf.curl, alpha),
      serration: THREE.MathUtils.lerp(a.leaf.serration, b.leaf.serration, alpha),
      venation: THREE.MathUtils.lerp(a.leaf.venation, b.leaf.venation, alpha),
      colorA: pick(a.leaf.colorA, b.leaf.colorA),
      colorB: pick(a.leaf.colorB, b.leaf.colorB),
    },
    flower: pick(a.flower, b.flower),
    grass: pick(a.grass, b.grass),
    fern: pick(a.fern, b.fern),
    lightResponse: {
      shadeAvoidance: THREE.MathUtils.lerp(
        a.lightResponse.shadeAvoidance,
        b.lightResponse.shadeAvoidance,
        alpha,
      ),
      leafBoostInShade: THREE.MathUtils.lerp(
        a.lightResponse.leafBoostInShade,
        b.lightResponse.leafBoostInShade,
        alpha,
      ),
      branchSuppressionInShade: THREE.MathUtils.lerp(
        a.lightResponse.branchSuppressionInShade,
        b.lightResponse.branchSuppressionInShade,
        alpha,
      ),
      phototropism: THREE.MathUtils.lerp(
        a.lightResponse.phototropism,
        b.lightResponse.phototropism,
        alpha,
      ),
    },
  };
};

const tangentBasis = (direction: THREE.Vector3) => {
  const forward = direction.clone().normalize();
  const right =
    Math.abs(forward.dot(UP)) > 0.92
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3().crossVectors(forward, UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  return { forward, right, up };
};

const rotateFromAxis = (axis: THREE.Vector3, azimuth: number, elevation: number) => {
  const { forward, right, up } = tangentBasis(axis);
  const lateral = right
    .multiplyScalar(Math.cos(azimuth))
    .add(up.multiplyScalar(Math.sin(azimuth)))
    .normalize();
  return forward
    .multiplyScalar(Math.cos(elevation))
    .add(lateral.multiplyScalar(Math.sin(elevation)))
    .normalize();
};

export const buildProcPlantGraph = (
  genome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
): ProcPlantGraph => {
  const rng = rngFromSeed(seed);
  const stems: StemNode[] = [];
  const segments: Array<[number, number]> = [];
  const organs: Organ[] = [];
  const shade = 1 - THREE.MathUtils.clamp(env.light, 0, 1);
  const heightStretch = 1 + shade * genome.lightResponse.shadeAvoidance;
  const branchShadePenalty = 1 - shade * genome.lightResponse.branchSuppressionInShade;
  const lightVector = new THREE.Vector3(0.25, 1, 0.12).normalize();
  const root: StemNode = {
    position: new THREE.Vector3(0, 0, 0),
    direction: new THREE.Vector3(0, 1, 0),
    radius: genome.habit === "shrub" ? 0.035 : 0.018,
    depth: 0,
    t: 0,
    index: 0,
  };
  stems.push(root);
  const growAxis = (
    startIndex: number,
    depth: number,
    count: number,
    lengthScale: number,
  ) => {
    let previous = stems[startIndex];
    for (let i = 1; i <= count; i++) {
      const t = i / count;
      const axisNoise = (rng() - 0.5) * 0.1;
      const photo = lightVector
        .clone()
        .multiplyScalar(genome.lightResponse.phototropism * t * (0.3 + shade));
      const direction = previous.direction
        .clone()
        .add(photo)
        .add(new THREE.Vector3(axisNoise, 0, (rng() - 0.5) * 0.1))
        .normalize();
      const len = curve(genome.internode, t) * lengthScale * heightStretch;
      const position = previous.position.clone().add(direction.clone().multiplyScalar(len));
      const node: StemNode = {
        position,
        direction,
        radius:
          previous.radius *
          THREE.MathUtils.lerp(0.93, 0.72, t) *
          (depth === 0 ? 1 : 0.75),
        depth,
        t,
        index: stems.length,
      };
      stems.push(node);
      segments.push([previous.index, node.index]);
      previous = node;

      const azimuth = i * genome.phyllotaxisAngle;
      const { right } = tangentBasis(direction);
      const organDir = rotateFromAxis(direction, azimuth, Math.PI / 2.6);
      const organRight = right.applyAxisAngle(direction, azimuth).normalize();
      const density = curve(genome.leaf.density, t) * (1 + shade * genome.lightResponse.leafBoostInShade);
      if (rng() < density || genome.habit === "tropical") {
        organs.push({
          kind: "leaf",
          position,
          direction: organDir,
          right: organRight,
          scale: curve(genome.leaf.length, t) * (0.85 + rng() * 0.3),
          t,
        });
      }
      const branchChance =
        curve(genome.branchChance, t) *
        branchShadePenalty *
        Math.pow(genome.branchAngle.depthDecay, depth);
      if (
        depth < 2 &&
        i > 2 &&
        i < count - 1 &&
        rng() < branchChance * (1 - genome.apicalDominance * t)
      ) {
        const angle =
          genome.branchAngle.mean +
          (rng() - 0.5) * genome.branchAngle.spread *
            Math.pow(genome.branchAngle.depthDecay, depth);
        const branchDir = rotateFromAxis(direction, azimuth + rng() * 0.35, angle);
        const branchStart: StemNode = {
          position: position.clone(),
          direction: branchDir,
          radius: node.radius * 0.65,
          depth: depth + 1,
          t,
          index: stems.length,
        };
        stems.push(branchStart);
        segments.push([node.index, branchStart.index]);
        growAxis(branchStart.index, depth + 1, Math.max(3, Math.round(count * 0.36)), lengthScale * 0.68);
      }
    }
  };

  if (genome.habit === "grass") {
    const blades = genome.grass?.blades ?? 30;
    for (let i = 0; i < blades; i++) {
      const t = i / Math.max(1, blades - 1);
      const azimuth = i * genome.phyllotaxisAngle + (rng() - 0.5) * 0.16;
      const lean = 0.36 + rng() * 0.24;
      organs.push({
        kind: "grassBlade",
        position: new THREE.Vector3((rng() - 0.5) * 0.2, 0, (rng() - 0.5) * 0.2),
        direction: rotateFromAxis(UP, azimuth, lean),
        right: new THREE.Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth)),
        scale:
          curve(genome.leaf.length, t) *
          heightStretch *
          (1 - (genome.grass?.heightJitter ?? 0.2) * rng()),
        t,
      });
    }
    return { stems, segments, organs };
  }

  growAxis(0, 0, genome.nodeCount, 1);

  if (genome.habit === "fern" && genome.fern) {
    const fronds = Math.max(3, Math.round(genome.fern.pinnae / 3));
    for (let f = 0; f < fronds; f++) {
      const yaw = f * genome.phyllotaxisAngle;
      const direction = rotateFromAxis(UP, yaw, 0.66);
      for (let i = 0; i < genome.fern.pinnae; i++) {
        const t = i / Math.max(1, genome.fern.pinnae - 1);
        const base = direction
          .clone()
          .multiplyScalar(t * 1.1)
          .add(new THREE.Vector3(0, Math.sin(t * Math.PI) * genome.fern.arch * 0.32, 0));
        const right = new THREE.Vector3(Math.cos(yaw + Math.PI / 2), 0, -Math.sin(yaw + Math.PI / 2));
        organs.push({
          kind: "fernLeaflet",
          position: base,
          direction,
          right,
          scale: curve(genome.leaf.length, t) * Math.sin(t * Math.PI),
          t,
        });
      }
    }
  }

  if (genome.flower) {
    const tip = stems.reduce((best, node) => (node.position.y > best.position.y ? node : best), stems[0]);
    organs.push({
      kind: "flower",
      position: tip.position.clone().add(tip.direction.clone().multiplyScalar(0.05)),
      direction: tip.direction.clone(),
      right: tangentBasis(tip.direction).right,
      scale: 1,
      t: 1,
    });
  }

  return { stems, segments, organs };
};

class TemplateBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private tintable: number[] = [];
  private sway: number[] = [];
  private idx: number[] = [];

  addQuad(
    corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
    color: THREE.Color,
    tintable = true,
    sway = 1,
  ) {
    const base = this.pos.length / 3;
    const normal = new THREE.Vector3()
      .subVectors(corners[1], corners[0])
      .cross(new THREE.Vector3().subVectors(corners[2], corners[0]))
      .normalize();
    for (const corner of corners) {
      this.pos.push(corner.x, corner.y, corner.z);
      this.nrm.push(normal.x, normal.y, normal.z);
      this.col.push(color.r, color.g, color.b);
      this.tintable.push(tintable ? 1 : 0);
      this.sway.push(sway);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  addTriangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color, tint = true, sway = 1) {
    const base = this.pos.length / 3;
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const p of [a, b, c]) {
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(normal.x, normal.y, normal.z);
      this.col.push(color.r, color.g, color.b);
      this.tintable.push(tint ? 1 : 0);
      this.sway.push(sway);
    }
    this.idx.push(base, base + 1, base + 2);
  }

  build(): ProcPlantTemplate {
    return {
      pos: new Float32Array(this.pos),
      nrm: new Float32Array(this.nrm),
      col: new Float32Array(this.col),
      tintable: new Uint8Array(this.tintable),
      sway: new Float32Array(this.sway),
      idx: new Uint32Array(this.idx),
    };
  }
}

const leafWidthAt = (shape: LeafShapeKind, t: number, serration: number): number => {
  const s = Math.sin(Math.PI * t);
  const notch =
    shape === "cordate" ? 1 - 0.35 * Math.exp(-(((t - 0.12) / 0.12) ** 2)) : 1;
  const tip = shape === "lanceolate" ? s ** 1.6 : shape === "ovate" ? s ** 0.72 : s;
  const lobes = shape === "palmate" ? 0.78 + 0.22 * Math.sin(t * Math.PI * 8) : 1;
  const teeth = serration > 0 ? 1 + serration * 0.08 * Math.sin(t * Math.PI * 28) : 1;
  return Math.max(0.02, tip * notch * lobes * teeth);
};

const addLeaf = (
  builder: TemplateBuilder,
  genome: ProcPlantGenome,
  organ: Organ,
  shade: number,
) => {
  const length = organ.scale * (1 + shade * genome.lightResponse.leafBoostInShade);
  const halfWidth = length * genome.leaf.widthRatio * 0.5;
  const center = organ.position;
  const dir = organ.direction.clone().normalize();
  const right = organ.right.clone().normalize();
  const normal = new THREE.Vector3().crossVectors(right, dir).normalize();
  const color = new THREE.Color(genome.leaf.colorA).lerp(new THREE.Color(genome.leaf.colorB), organ.t);
  const segments = genome.leaf.shape === "cordate" || genome.leaf.shape === "palmate" ? 10 : 7;
  const points: THREE.Vector3[] = [];
  const spine: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const curl = Math.sin(t * Math.PI) * genome.leaf.curl * length;
    spine.push(
      center
        .clone()
        .add(dir.clone().multiplyScalar((t - 0.08) * length))
        .add(normal.clone().multiplyScalar(curl)),
    );
  }
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const w = leafWidthAt(genome.leaf.shape, t, genome.leaf.serration) * halfWidth;
    points.push(spine[i].clone().add(right.clone().multiplyScalar(-w)));
  }
  for (let i = segments; i >= 0; i--) {
    const t = i / segments;
    const w = leafWidthAt(genome.leaf.shape, t, genome.leaf.serration) * halfWidth;
    points.push(spine[i].clone().add(right.clone().multiplyScalar(w)));
  }
  const base = spine[Math.max(0, Math.floor(segments * 0.18))];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    builder.addTriangle(base, a, b, color, true, 0.35 + organ.t * 0.65);
  }
  if (genome.leaf.venation > 0.05) {
    const veinColor = color.clone().lerp(new THREE.Color(0xd9f0ba), 0.28);
    for (let i = 1; i < spine.length; i++) {
      const a = spine[i - 1];
      const b = spine[i];
      const width = length * 0.008 * genome.leaf.venation * (1 - i / spine.length);
      builder.addQuad(
        [
          a.clone().add(right.clone().multiplyScalar(-width)),
          a.clone().add(right.clone().multiplyScalar(width)),
          b.clone().add(right.clone().multiplyScalar(width * 0.5)),
          b.clone().add(right.clone().multiplyScalar(-width * 0.5)),
        ],
        veinColor,
        false,
        0.7,
      );
    }
  }
};

const addGrassBlade = (builder: TemplateBuilder, genome: ProcPlantGenome, organ: Organ) => {
  const color = new THREE.Color(genome.leaf.colorA).lerp(new THREE.Color(genome.leaf.colorB), organ.t);
  const length = organ.scale;
  const width = length * genome.leaf.widthRatio;
  const root = organ.position;
  const dir = organ.direction.clone().normalize();
  const right = organ.right.clone().normalize();
  const mid = root.clone().add(dir.clone().multiplyScalar(length * 0.54));
  const tip = root
    .clone()
    .add(dir.clone().multiplyScalar(length))
    .add(new THREE.Vector3(0, -genome.leaf.curl * length * 0.18, 0));
  builder.addTriangle(
    root.clone().add(right.clone().multiplyScalar(-width)),
    root.clone().add(right.clone().multiplyScalar(width)),
    mid.clone().add(right.clone().multiplyScalar(width * 0.42)),
    color,
    true,
    0.45,
  );
  builder.addTriangle(
    root.clone().add(right.clone().multiplyScalar(-width)),
    mid.clone().add(right.clone().multiplyScalar(width * 0.42)),
    tip,
    color,
    true,
    1,
  );
}

const addStemSegment = (
  builder: TemplateBuilder,
  a: StemNode,
  b: StemNode,
  color: THREE.Color,
) => {
  const axis = b.position.clone().sub(a.position).normalize();
  const { right, up } = tangentBasis(axis);
  const sides = 4;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const r0 = right.clone().multiplyScalar(Math.cos(a0)).add(up.clone().multiplyScalar(Math.sin(a0)));
    const r1 = right.clone().multiplyScalar(Math.cos(a1)).add(up.clone().multiplyScalar(Math.sin(a1)));
    builder.addQuad(
      [
        a.position.clone().add(r0.clone().multiplyScalar(a.radius)),
        a.position.clone().add(r1.clone().multiplyScalar(a.radius)),
        b.position.clone().add(r1.clone().multiplyScalar(b.radius)),
        b.position.clone().add(r0.clone().multiplyScalar(b.radius)),
      ],
      color,
      false,
      b.t * 0.5,
    );
  }
};

const addFlower = (builder: TemplateBuilder, genome: ProcPlantGenome, organ: Organ) => {
  if (!genome.flower) return;
  const forward = organ.direction.clone().normalize();
  const right = organ.right.clone().normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const petalColor = new THREE.Color(genome.flower.color);
  const centerColor = new THREE.Color(genome.flower.centerColor);
  const radius = genome.flower.radius;
  const petals = Math.max(1, genome.flower.petals);
  for (let w = 0; w < genome.flower.whorls; w++) {
    const offset = (w / Math.max(1, genome.flower.whorls)) * Math.PI / petals;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2 + offset;
      const radial = right.clone().multiplyScalar(Math.cos(a)).add(up.clone().multiplyScalar(Math.sin(a)));
      const base = organ.position.clone().add(radial.clone().multiplyScalar(radius * 0.18));
      const tip = organ.position
        .clone()
        .add(forward.clone().multiplyScalar(radius * 0.05))
        .add(radial.clone().multiplyScalar(radius * (1.2 - w * 0.24)));
      const side = up.clone().multiplyScalar(radius * 0.22 * Math.cos(a)).add(right.clone().multiplyScalar(-radius * 0.22 * Math.sin(a)));
      builder.addTriangle(base.clone().add(side), base.clone().sub(side), tip, petalColor, true, 0.7);
    }
  }
  const c = organ.position.clone().add(forward.clone().multiplyScalar(radius * 0.04));
  builder.addTriangle(
    c.clone().add(right.clone().multiplyScalar(-radius * 0.16)),
    c.clone().add(right.clone().multiplyScalar(radius * 0.16)),
    c.clone().add(up.clone().multiplyScalar(radius * 0.18)),
    centerColor,
    false,
    0.3,
  );
};

export const buildProcPlantTemplate = (
  genome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
): { template: ProcPlantTemplate; graph: ProcPlantGraph; stats: ProcPlantStats } => {
  const graph = buildProcPlantGraph(genome, seed, env);
  const builder = new TemplateBuilder();
  const shade = 1 - THREE.MathUtils.clamp(env.light, 0, 1);
  const stemColor = new THREE.Color(
    genome.habit === "grass" || genome.habit === "fern" ? 0x3f6d2d : 0x6d5135,
  );
  for (const [ai, bi] of graph.segments) addStemSegment(builder, graph.stems[ai], graph.stems[bi], stemColor);
  let leafCount = 0;
  let flowerCount = 0;
  for (const organ of graph.organs) {
    if (organ.kind === "grassBlade") {
      addGrassBlade(builder, genome, organ);
      leafCount++;
    } else if (organ.kind === "flower") {
      addFlower(builder, genome, organ);
      flowerCount++;
    } else {
      addLeaf(builder, genome, organ, shade);
      leafCount++;
    }
  }
  const template = builder.build();
  return {
    template,
    graph,
    stats: {
      stems: graph.segments.length,
      leaves: leafCount,
      flowers: flowerCount,
      triangles: template.idx.length / 3,
    },
  };
};

export const buildProcPlantObject = (
  genome: ProcPlantGenome,
  seed = 1,
  env: ProcPlantEnvironment = defaultPlantEnvironment(),
): THREE.Group => {
  const { template } = buildProcPlantTemplate(genome, seed, env);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(template.pos.slice(), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(template.nrm.slice(), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(template.col.slice(), 3));
  geometry.setIndex(new THREE.BufferAttribute(template.idx.slice(), 1));
  geometry.computeBoundingSphere();
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = `procplant-${genome.id}`;
  group.userData.procPlant = { genomeId: genome.id, seed };
  group.add(mesh);
  return group;
};

export const procPlantPresetIds = Object.keys(procPlantPresets);
