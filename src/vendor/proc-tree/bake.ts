/**
 * TSL-free geometry baker for Weber & Penn trees.
 *
 * Replaces hyperscape's BranchGeometry + LeafGeometry (the latter pulls in a
 * WebGPU/TSL leaf material that does not work under Tellus's WebGL2 fallback).
 * This module produces pure typed-array geometry:
 *   - branch tubes (positions/normals/indices) in Y-up space
 *   - leaf cards   (positions/normals/indices) in Y-up space
 *
 * The branch tube generation is ported faithfully from BranchGeometry.ts; leaves
 * are baked as oriented flat shape-cards (no instancing, no shader) so they merge
 * straight into Tellus's vertex-soup Template.
 *
 * COORDINATE SYSTEM: the generator works in Z-up (Blender). We convert to Y-up:
 *   Blender X -> X, Blender Y -> -Z, Blender Z -> Y.
 */

import * as THREE from "three";
import {
  calcPointOnBezier,
  calcTangentToBezier,
  type BezierSplinePoint,
} from "./Bezier";
import { getLeafShape, getBlossomShape } from "./LeafShapes";
import type {
  StemData,
  LeafData,
  TreeData,
  TreeParams,
  BakeOptions,
} from "./types";

/** Flat geometry buffers (non-indexed-friendly, indexed). */
export type Soup = {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
};

export type BakedGeometryRange = {
  vertexStart: number;
  vertexCount: number;
  indexStart: number;
  indexCount: number;
};

export type BakedStemRange = BakedGeometryRange & {
  stemIndex: number;
  depth: number;
  parentStemIndex: number | null;
  childStemIndices: number[];
  baked: boolean;
};

export type BakedLeafRange = BakedGeometryRange & {
  /** Stable source index in TreeData.leaves. */
  leafIndex: number;
  /** Attachment identity used by the public Weber-Penn graph for this sampled card. */
  attachmentId: string;
  parentStemIndex: number;
  parentAxialT: number;
  isBlossom: boolean;
};

export type BakedTreeTopology = {
  /** Content-bound signature over topology, exact ranges, and baked buffers. */
  signature: string;
  stems: BakedStemRange[];
  leaves: BakedLeafRange[];
};

export type BakedTree = {
  branches: Soup;
  leaves: Soup;
  /** Axis-aligned bounds of the combined geometry (Y-up). */
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** Stable source ownership and exact output ranges for deterministic editing. */
  topology: BakedTreeTopology;
};

const DEFAULTS: Required<BakeOptions> = {
  radialSegments: 6,
  branchSamples: 4,
  branchCaps: false,
  maxBranchDepth: Infinity,
  maxStems: 2000,
  maxLeaves: 50000,
  leafScaleMultiplier: 1,
  blossomScaleMultiplier: 1,
  foliageMass: 0,
  foliageClusterDensity: 1,
  foliageTipBias: 0.5,
  foliageSpread: 1,
};

function transformVec3(v: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.z, -v.y);
}

// ── Branch tubes ────────────────────────────────────────────────────────────

function calcRadialSegments(stem: StemData, base: number): number {
  if (stem.depth === 0) return Math.max(5, base);
  if (stem.depth === 1) return Math.max(4, Math.floor(base * 0.75));
  return Math.max(3, Math.floor(base * 0.5));
}

function calcReferenceFrame(
  tangent: THREE.Vector3,
  prevRight: THREE.Vector3,
): { right: THREE.Vector3; up: THREE.Vector3 } {
  let right = prevRight.clone().projectOnPlane(tangent);
  if (right.lengthSq() < 0.0001) {
    if (Math.abs(tangent.y) < 0.99) {
      right = new THREE.Vector3(0, 1, 0).cross(tangent);
    } else {
      right = new THREE.Vector3(1, 0, 0).cross(tangent);
    }
  }
  right.normalize();
  const up = new THREE.Vector3().crossVectors(tangent, right).normalize();
  return { right, up };
}

type Accum = {
  positions: number[];
  normals: number[];
  indices: number[];
};

function bakeStem(
  stem: StemData,
  radialSegments: number,
  segmentSamples: number,
  caps: boolean,
  out: Accum,
): void {
  const points = stem.points;
  if (points.length < 2) return;

  const spline: BezierSplinePoint[] = points.map((p) => ({
    co: transformVec3(p.position),
    handleLeft: transformVec3(p.handleLeft),
    handleRight: transformVec3(p.handleRight),
  }));

  const sampled: Array<{ position: THREE.Vector3; radius: number; t: number }> =
    [];
  for (let i = 0; i < spline.length - 1; i++) {
    const startPoint = spline[i]!;
    const endPoint = spline[i + 1]!;
    const startRadius = points[i]!.radius;
    const endRadius = points[i + 1]!.radius;
    const jStart = i === 0 ? 0 : 1;
    for (let j = jStart; j <= segmentSamples; j++) {
      const t = j / segmentSamples;
      const globalT = (i + t) / (spline.length - 1);
      const position = calcPointOnBezier(t, startPoint, endPoint);
      const radius = startRadius + (endRadius - startRadius) * t;
      sampled.push({ position, radius, t: globalT });
    }
  }

  const numRings = sampled.length;
  if (numRings < 2) return;

  const baseVert = out.positions.length / 3;
  let prevRight = new THREE.Vector3(1, 0, 0);

  for (let i = 0; i < numRings; i++) {
    const { position, radius, t } = sampled[i]!;
    const segmentIndex = Math.min(
      Math.floor(t * (spline.length - 1)),
      spline.length - 2,
    );
    const localT = t * (spline.length - 1) - segmentIndex;
    const tangent = calcTangentToBezier(
      Math.max(0.001, Math.min(0.999, localT)),
      spline[segmentIndex]!,
      spline[segmentIndex + 1]!,
    ).normalize();

    const { right, up } = calcReferenceFrame(tangent, prevRight);
    prevRight = right;

    for (let j = 0; j < radialSegments; j++) {
      const angle = (j / radialSegments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const nx = cos * right.x + sin * up.x;
      const ny = cos * right.y + sin * up.y;
      const nz = cos * right.z + sin * up.z;
      const nl = Math.hypot(nx, ny, nz) || 1;
      out.positions.push(
        position.x + (nx / nl) * radius,
        position.y + (ny / nl) * radius,
        position.z + (nz / nl) * radius,
      );
      out.normals.push(nx / nl, ny / nl, nz / nl);
    }
  }

  for (let i = 0; i < numRings - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const curr = baseVert + i * radialSegments + j;
      const next = baseVert + i * radialSegments + ((j + 1) % radialSegments);
      const currNext = baseVert + (i + 1) * radialSegments + j;
      const nextNext =
        baseVert + (i + 1) * radialSegments + ((j + 1) % radialSegments);
      out.indices.push(curr, next, currNext);
      out.indices.push(next, nextNext, currNext);
    }
  }

  if (caps) {
    // bottom cap
    const bottom = sampled[0]!;
    const bTan = calcTangentToBezier(0.001, spline[0]!, spline[1]!)
      .normalize()
      .negate();
    const bottomCenter = out.positions.length / 3;
    out.positions.push(bottom.position.x, bottom.position.y, bottom.position.z);
    out.normals.push(bTan.x, bTan.y, bTan.z);
    for (let j = 0; j < radialSegments; j++) {
      const curr = baseVert + j;
      const next = baseVert + ((j + 1) % radialSegments);
      out.indices.push(bottomCenter, next, curr);
    }
    // top cap
    const top = sampled[numRings - 1]!;
    const tTan = calcTangentToBezier(
      0.999,
      spline[spline.length - 2]!,
      spline[spline.length - 1]!,
    ).normalize();
    const topCenter = out.positions.length / 3;
    out.positions.push(top.position.x, top.position.y, top.position.z);
    out.normals.push(tTan.x, tTan.y, tTan.z);
    const lastRing = baseVert + (numRings - 1) * radialSegments;
    for (let j = 0; j < radialSegments; j++) {
      const curr = lastRing + j;
      const next = lastRing + ((j + 1) % radialSegments);
      out.indices.push(topCenter, curr, next);
    }
  }
}

// ── Leaf cards ──────────────────────────────────────────────────────────────

const _leafPos = new THREE.Vector3();
const _leafDir = new THREE.Vector3();
const _leafRight = new THREE.Vector3();
const _leafUp = new THREE.Vector3();
const _vert = new THREE.Vector3();
const _rotMatrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();

function bakeLeaf(
  leaf: LeafData,
  verts: ReadonlyArray<readonly [number, number, number]>,
  faces: ReadonlyArray<readonly number[]>,
  out: Accum,
): void {
  _leafPos.set(leaf.position.x, leaf.position.z, -leaf.position.y);
  _leafDir.set(leaf.direction.x, leaf.direction.z, -leaf.direction.y).normalize();
  _leafRight.set(leaf.right.x, leaf.right.z, -leaf.right.y).normalize();
  _leafUp.crossVectors(_leafDir, _leafRight).normalize();
  _rotMatrix.makeBasis(_leafRight, _leafUp, _leafDir);
  _quat.setFromRotationMatrix(_rotMatrix);

  // leaf normal = card facing (its local +Y in shape space maps to dir)
  const nrm = _leafDir.clone();

  const base = out.positions.length / 3;
  for (let i = 0; i < verts.length; i++) {
    const vtx = verts[i]!;
    _vert.set(vtx[0], vtx[1], vtx[2]).applyQuaternion(_quat).add(_leafPos);
    out.positions.push(_vert.x, _vert.y, _vert.z);
    out.normals.push(nrm.x, nrm.y, nrm.z);
  }

  for (const face of faces) {
    if (face.length === 3) {
      out.indices.push(base + face[0]!, base + face[1]!, base + face[2]!);
    } else if (face.length === 4) {
      out.indices.push(base + face[0]!, base + face[1]!, base + face[2]!);
      out.indices.push(base + face[0]!, base + face[2]!, base + face[3]!);
    } else if (face.length > 4) {
      for (let i = 1; i < face.length - 1; i++) {
        out.indices.push(base + face[0]!, base + face[i]!, base + face[i + 1]!);
      }
    }
  }
}

function scaleShape(
  verts: ReadonlyArray<readonly [number, number, number]>,
  gScale: number,
  scale: number,
  scaleX: number,
): Array<readonly [number, number, number]> {
  return verts.map(
    (v) =>
      [
        v[0] * scale * gScale * scaleX,
        v[1] * scale * gScale,
        v[2] * scale * gScale,
      ] as const,
  );
}

function emptySoup(): Soup {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    indices: new Uint32Array(0),
  };
}

function toSoup(acc: Accum): Soup {
  return {
    positions: new Float32Array(acc.positions),
    normals: new Float32Array(acc.normals),
    indices: new Uint32Array(acc.indices),
  };
}

const bakeSignature = (
  stems: readonly BakedStemRange[],
  leaves: readonly BakedLeafRange[],
  branches: Soup,
  leafSoup: Soup,
): string => {
  let hash = 0x811c9dc5;
  const byte = (value: number) => {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193);
  };
  const text = JSON.stringify({ stems, leaves });
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    byte(code & 0xff);
    byte(code >>> 8);
  }
  for (const array of [
    branches.positions,
    branches.normals,
    branches.indices,
    leafSoup.positions,
    leafSoup.normals,
    leafSoup.indices,
  ]) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (const value of bytes) byte(value);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

export const computeBakedTreeTopologySignature = (tree: Pick<BakedTree, "branches" | "leaves" | "topology">): string =>
  bakeSignature(tree.topology.stems, tree.topology.leaves, tree.branches, tree.leaves);

const boundsForSoups = (branches: Soup, leaves: Soup) => {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const positions of [branches.positions, leaves.positions]) {
    for (let index = 0; index < positions.length; index += 3) {
      min.x = Math.min(min.x, positions[index]!);
      min.y = Math.min(min.y, positions[index + 1]!);
      min.z = Math.min(min.z, positions[index + 2]!);
      max.x = Math.max(max.x, positions[index]!);
      max.y = Math.max(max.y, positions[index + 1]!);
      max.z = Math.max(max.z, positions[index + 2]!);
    }
  }
  if (!Number.isFinite(min.x)) {
    min.set(0, 0, 0);
    max.set(0, 0, 0);
  }
  return { min, max };
};

const copySoupRanges = <T extends BakedGeometryRange>(
  soup: Soup,
  ranges: readonly T[],
): { soup: Soup; ranges: Array<T & BakedGeometryRange> } => {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const copied: Array<T & BakedGeometryRange> = [];
  const rangeOrder = (left: BakedGeometryRange, right: BakedGeometryRange) =>
    left.indexStart - right.indexStart ||
    left.vertexStart - right.vertexStart ||
    Number(right.indexCount === 0) - Number(left.indexCount === 0);
  for (const range of [...ranges].sort(rangeOrder)) {
    const vertexStart = positions.length / 3;
    const indexStart = indices.length;
    const vertexEnd = range.vertexStart + range.vertexCount;
    const indexEnd = range.indexStart + range.indexCount;
    if (range.vertexStart < 0 || vertexEnd > soup.positions.length / 3 || range.indexStart < 0 || indexEnd > soup.indices.length) {
      throw new Error("baked geometry range exceeds its source soup");
    }
    for (let vertex = range.vertexStart; vertex < vertexEnd; vertex++) {
      const offset = vertex * 3;
      positions.push(soup.positions[offset]!, soup.positions[offset + 1]!, soup.positions[offset + 2]!);
      normals.push(soup.normals[offset]!, soup.normals[offset + 1]!, soup.normals[offset + 2]!);
    }
    for (let index = range.indexStart; index < indexEnd; index++) {
      const sourceIndex = soup.indices[index]!;
      if (sourceIndex < range.vertexStart || sourceIndex >= vertexEnd) {
        throw new Error("baked geometry range contains an out-of-range vertex reference");
      }
      indices.push(vertexStart + sourceIndex - range.vertexStart);
    }
    copied.push({ ...range, vertexStart, indexStart });
  }
  return {
    soup: {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
    },
    ranges: copied,
  };
};

/** Rebuild exact baked buffers from retained stable source identities. */
export const filterBakedTreeGeometry = (
  source: BakedTree,
  retainedStemIndices: ReadonlySet<number>,
  retainedLeafIndices: ReadonlySet<number>,
): BakedTree => {
  const retainedStems = source.topology.stems.filter((stem) => retainedStemIndices.has(stem.stemIndex));
  const branchCopy = copySoupRanges(source.branches, retainedStems.filter((stem) => stem.baked));
  const copiedStemByIndex = new Map(branchCopy.ranges.map((stem) => [stem.stemIndex, stem]));
  const stems: BakedStemRange[] = retainedStems.map((stem) => {
    const copied = copiedStemByIndex.get(stem.stemIndex);
    const copiedRange = copied
      ? {
          vertexStart: copied.vertexStart,
          vertexCount: copied.vertexCount,
          indexStart: copied.indexStart,
          indexCount: copied.indexCount,
        }
      : { vertexStart: 0, vertexCount: 0, indexStart: 0, indexCount: 0 };
    return {
      ...stem,
      parentStemIndex: stem.parentStemIndex !== null && retainedStemIndices.has(stem.parentStemIndex)
        ? stem.parentStemIndex
        : null,
      childStemIndices: stem.childStemIndices.filter((child) => retainedStemIndices.has(child)),
      ...copiedRange,
    };
  });
  const leafCopy = copySoupRanges(
    source.leaves,
    source.topology.leaves.filter((leaf) => retainedLeafIndices.has(leaf.leafIndex)),
  );
  const leaves = leafCopy.ranges as BakedLeafRange[];
  const bounds = boundsForSoups(branchCopy.soup, leafCopy.soup);
  const topology: BakedTreeTopology = { signature: "", stems, leaves };
  const result: BakedTree = { branches: branchCopy.soup, leaves: leafCopy.soup, ...bounds, topology };
  topology.signature = computeBakedTreeTopologySignature(result);
  return result;
};

// ── Public bake ─────────────────────────────────────────────────────────────

/**
 * Bake a generated TreeData into flat branch + leaf geometry (Y-up).
 */
export function bakeTree(tree: TreeData, options: BakeOptions = {}): BakedTree {
  const opts = { ...DEFAULTS, ...options };
  const params: TreeParams = tree.params;

  // ── branches ──
  const maxDepth = opts.maxBranchDepth;
  let stems =
    maxDepth < Infinity
      ? tree.stems.filter((s) => s.depth <= maxDepth)
      : tree.stems;
  if (stems.length > opts.maxStems) {
    stems = [...stems]
      .sort((a, b) => (a.depth !== b.depth ? a.depth - b.depth : b.radius - a.radius))
      .slice(0, opts.maxStems);
  }
  const branchAcc: Accum = { positions: [], normals: [], indices: [] };
  const samples = Math.max(1, Math.floor(opts.branchSamples));
  const bakedStemIndices = new Set(stems.map((stem) => stem.index));
  const stemRanges = new Map<number, BakedGeometryRange>();
  for (const stem of stems) {
    const vertexStart = branchAcc.positions.length / 3;
    const indexStart = branchAcc.indices.length;
    const radial = calcRadialSegments(stem, opts.radialSegments);
    bakeStem(stem, radial, samples, opts.branchCaps, branchAcc);
    stemRanges.set(stem.index, {
      vertexStart,
      vertexCount: branchAcc.positions.length / 3 - vertexStart,
      indexStart,
      indexCount: branchAcc.indices.length - indexStart,
    });
  }
  const bakedStems: BakedStemRange[] = tree.stems.map((stem) => ({
    stemIndex: stem.index,
    depth: stem.depth,
    parentStemIndex: stem.parentIndex,
    childStemIndices: stem.childIndices.slice(),
    baked: bakedStemIndices.has(stem.index),
    ...(stemRanges.get(stem.index) ?? { vertexStart: 0, vertexCount: 0, indexStart: 0, indexCount: 0 }),
  }));

  // ── leaves ──
  const leafAcc: Accum = { positions: [], normals: [], indices: [] };
  const leafRanges: BakedLeafRange[] = [];
  let leaves: Array<{ leaf: LeafData; sourceIndex: number }> = tree.leaves.map((leaf, sourceIndex) => ({ leaf, sourceIndex }));
  if (leaves.length > opts.maxLeaves) {
    const step = leaves.length / opts.maxLeaves;
    const sampled: typeof leaves = [];
    for (let i = 0; i < opts.maxLeaves; i++) {
      sampled.push(leaves[Math.floor(i * step)]!);
    }
    leaves = sampled;
  }
  if (leaves.length > 0) {
    const gScale = tree.treeScale / params.gScale;
    const leafShape = getLeafShape(params.leafShape);
    const blossomShape = getBlossomShape(params.blossomShape);
    const leafScaleMultiplier = opts.leafScaleMultiplier ?? 1;
    const blossomScaleMultiplier = opts.blossomScaleMultiplier ?? leafScaleMultiplier;
    const leafVerts = scaleShape(
      leafShape.vertices,
      gScale,
      params.leafScale * leafScaleMultiplier,
      params.leafScaleX,
    );
    const blossomVerts = scaleShape(
      blossomShape.vertices,
      gScale,
      (params.blossomScale || params.leafScale) * blossomScaleMultiplier,
      1,
    );
    for (let outputIndex = 0; outputIndex < leaves.length; outputIndex++) {
      const { leaf, sourceIndex } = leaves[outputIndex]!;
      const vertexStart = leafAcc.positions.length / 3;
      const indexStart = leafAcc.indices.length;
      if (leaf.isBlossom) {
        bakeLeaf(leaf, blossomVerts, blossomShape.faces, leafAcc);
      } else {
        bakeLeaf(leaf, leafVerts, leafShape.faces, leafAcc);
      }
      leafRanges.push({
        leafIndex: sourceIndex,
        attachmentId: `weber-penn:leaf-site:${outputIndex}`,
        parentStemIndex: leaf.parentStemIndex,
        parentAxialT: leaf.parentAxialT,
        isBlossom: leaf.isBlossom,
        vertexStart,
        vertexCount: leafAcc.positions.length / 3 - vertexStart,
        indexStart,
        indexCount: leafAcc.indices.length - indexStart,
      });
    }
  }

  const branches = branchAcc.positions.length ? toSoup(branchAcc) : emptySoup();
  const leafSoup = leafAcc.positions.length ? toSoup(leafAcc) : emptySoup();

  // ── bounds ──
  const { min, max } = boundsForSoups(branches, leafSoup);

  const topology: BakedTreeTopology = {
    signature: bakeSignature(bakedStems, leafRanges, branches, leafSoup),
    stems: bakedStems,
    leaves: leafRanges,
  };
  return { branches, leaves: leafSoup, min, max, topology };
}
