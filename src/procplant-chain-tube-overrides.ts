import type {
  ProcPlantColonizationNode,
  ProcPlantSpaceColonizationResult,
} from "./procplant-space-colonization";

export const PROCPLANT_CHAIN_TUBE_OVERRIDE_CONTRACT = "procplants.chain-tube-overrides" as const;
export const PROCPLANT_CHAIN_TUBE_OVERRIDE_VERSION = 1 as const;
export const PROCPLANT_CHAIN_TUBE_OVERRIDE_MAX_CHAINS = 256 as const;
export const PROCPLANT_CHAIN_TUBE_OVERRIDE_MAX_SERIALIZED_CHARS = 65_536 as const;
export const PROCPLANT_CHAIN_TUBE_RADIUS_SCALE_MIN = 0.25 as const;
export const PROCPLANT_CHAIN_TUBE_RADIUS_SCALE_MAX = 4 as const;
export const PROCPLANT_CHAIN_TUBE_TAPER_SCALE_MIN = 0.1 as const;
export const PROCPLANT_CHAIN_TUBE_TAPER_SCALE_MAX = 2 as const;
export const PROCPLANT_CHAIN_TUBE_RADIAL_SEGMENTS_MIN = 3 as const;
export const PROCPLANT_CHAIN_TUBE_RADIAL_SEGMENTS_MAX = 12 as const;

export interface ProcPlantChainTubeTarget {
  genomeId: string;
  seed: number;
  graphSignature: string;
}

export interface ProcPlantChainTubeOverride {
  chainId: string;
  /** Uniform multiplier for every node radius in this maximal chain. */
  radiusScale?: number;
  /** Multiplier reached at the final node, linearly blended from 1 at the chain base. */
  taperScale?: number;
  /** Per-chain swept-tube radial resolution. */
  radialSegments?: number;
}

export interface ProcPlantChainTubeOverridePackage {
  contract: typeof PROCPLANT_CHAIN_TUBE_OVERRIDE_CONTRACT;
  version: typeof PROCPLANT_CHAIN_TUBE_OVERRIDE_VERSION;
  target: ProcPlantChainTubeTarget;
  overrides: readonly ProcPlantChainTubeOverride[];
}

export interface ProcPlantColonizationChain {
  id: string;
  startNodeId: string;
  endNodeId: string;
  nodeIds: readonly string[];
  branchOrder: number;
}

export interface ProcPlantColonizationChainSnapshot {
  target: ProcPlantChainTubeTarget;
  chains: readonly ProcPlantColonizationChain[];
}

const finiteInRange = (value: number, min: number, max: number, label: string) => {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be finite and within ${min}..${max}`);
  }
  return value;
};

const canonicalNumber = (value: number) => {
  if (!Number.isFinite(value)) throw new Error("colonization graph values must be finite");
  return Object.is(value, -0) ? "0" : value.toString();
};

const fnv1a64 = (value: string) => {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    let code = value.charCodeAt(index);
    hash ^= BigInt(code & 0xff);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    if (code > 0xff) {
      code >>>= 8;
      hash ^= BigInt(code & 0xff);
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
  }
  return hash.toString(16).padStart(16, "0");
};

export const procPlantColonizationGraphSignature = (
  growth: Pick<ProcPlantSpaceColonizationResult, "nodes" | "segments">,
) => {
  const nodes = [...growth.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const segments = [...growth.segments].sort((a, b) => a.id.localeCompare(b.id));
  const canonical = [
    ...nodes.map((node) => [
      "n", node.id, node.parentId ?? "", node.depth,
      canonicalNumber(node.position.x), canonicalNumber(node.position.y), canonicalNumber(node.position.z),
      canonicalNumber(node.radius), node.childCount,
    ].join("|")),
    ...segments.map((segment) => [
      "s", segment.id, segment.parentSegmentId ?? "", segment.startNodeId, segment.endNodeId, segment.depth,
    ].join("|")),
  ].join("\n");
  return `fnv1a64:${fnv1a64(canonical)}`;
};

const validateGraph = (growth: Pick<ProcPlantSpaceColonizationResult, "nodes" | "segments">) => {
  if (growth.nodes.length < 1) throw new Error("colonization graph must contain a root node");
  const nodeById = new Map<string, ProcPlantColonizationNode>();
  for (const node of growth.nodes) {
    if (!node.id || nodeById.has(node.id)) throw new Error(`duplicate or empty colonization node id: ${node.id}`);
    nodeById.set(node.id, node);
  }
  const roots = growth.nodes.filter((node) => node.parentId === null).sort((a, b) => a.id.localeCompare(b.id));
  if (roots.length !== 1) throw new Error("colonization graph must contain exactly one root node");
  const childrenById = new Map<string, string[]>();
  const incoming = new Set<string>();
  for (const segment of growth.segments) {
    if (!nodeById.has(segment.startNodeId) || !nodeById.has(segment.endNodeId)) {
      throw new Error(`colonization segment ${segment.id} references an unknown node`);
    }
    if (incoming.has(segment.endNodeId)) throw new Error(`colonization node ${segment.endNodeId} has multiple parents`);
    incoming.add(segment.endNodeId);
    const children = childrenById.get(segment.startNodeId) ?? [];
    children.push(segment.endNodeId);
    childrenById.set(segment.startNodeId, children);
  }
  for (const children of childrenById.values()) children.sort((a, b) => a.localeCompare(b));
  return { nodeById, childrenById, root: roots[0]! };
};

export const inspectProcPlantColonizationChains = (
  genomeId: string,
  seed: number,
  growth: Pick<ProcPlantSpaceColonizationResult, "nodes" | "segments">,
): ProcPlantColonizationChainSnapshot => {
  if (!genomeId.trim()) throw new Error("chain tube target genomeId is required");
  const { nodeById, childrenById, root } = validateGraph(growth);
  const graphSignature = procPlantColonizationGraphSignature(growth);
  const chains: ProcPlantColonizationChain[] = [];
  const visitedEdges = new Set<string>();
  const append = (startNodeId: string, firstChildId: string, branchOrder: number) => {
    const nodeIds = [startNodeId, firstChildId];
    let currentId = firstChildId;
    let children = childrenById.get(currentId) ?? [];
    while (children.length === 1) {
      const edge = `${currentId}\0${children[0]}`;
      if (visitedEdges.has(edge)) throw new Error("colonization graph must be acyclic");
      visitedEdges.add(edge);
      currentId = children[0]!;
      nodeIds.push(currentId);
      children = childrenById.get(currentId) ?? [];
    }
    if (!nodeById.has(currentId)) throw new Error(`unknown colonization chain node ${currentId}`);
    chains.push({
      id: `chain:${graphSignature.slice("fnv1a64:".length)}:${startNodeId}>${firstChildId}`,
      startNodeId,
      endNodeId: currentId,
      nodeIds,
      branchOrder,
    });
    for (const childId of children) {
      const edge = `${currentId}\0${childId}`;
      if (visitedEdges.has(edge)) throw new Error("colonization graph must be acyclic");
      visitedEdges.add(edge);
      append(currentId, childId, branchOrder + 1);
    }
  };
  for (const childId of childrenById.get(root.id) ?? []) {
    visitedEdges.add(`${root.id}\0${childId}`);
    append(root.id, childId, 0);
  }
  if (visitedEdges.size !== growth.segments.length) throw new Error("colonization graph must be connected to its root");
  return {
    target: { genomeId, seed: seed >>> 0, graphSignature },
    chains,
  };
};

const normalizedOverride = (value: ProcPlantChainTubeOverride): ProcPlantChainTubeOverride => {
  if (!value.chainId.trim()) throw new Error("chain tube override chainId is required");
  const radiusScale = value.radiusScale === undefined ? undefined : finiteInRange(
    value.radiusScale,
    PROCPLANT_CHAIN_TUBE_RADIUS_SCALE_MIN,
    PROCPLANT_CHAIN_TUBE_RADIUS_SCALE_MAX,
    "chain radiusScale",
  );
  const taperScale = value.taperScale === undefined ? undefined : finiteInRange(
    value.taperScale,
    PROCPLANT_CHAIN_TUBE_TAPER_SCALE_MIN,
    PROCPLANT_CHAIN_TUBE_TAPER_SCALE_MAX,
    "chain taperScale",
  );
  const radialSegments = value.radialSegments === undefined ? undefined : Math.round(finiteInRange(
    value.radialSegments,
    PROCPLANT_CHAIN_TUBE_RADIAL_SEGMENTS_MIN,
    PROCPLANT_CHAIN_TUBE_RADIAL_SEGMENTS_MAX,
    "chain radialSegments",
  ));
  if (value.radialSegments !== undefined && radialSegments !== value.radialSegments) {
    throw new Error("chain radialSegments must be an integer");
  }
  return { chainId: value.chainId, radiusScale, taperScale, radialSegments };
};

export const createProcPlantChainTubeOverridePackage = (
  target: ProcPlantChainTubeTarget,
  overrides: readonly ProcPlantChainTubeOverride[] = [],
): ProcPlantChainTubeOverridePackage => validateProcPlantChainTubeOverridePackage({
  contract: PROCPLANT_CHAIN_TUBE_OVERRIDE_CONTRACT,
  version: PROCPLANT_CHAIN_TUBE_OVERRIDE_VERSION,
  target: { ...target, seed: target.seed >>> 0 },
  overrides,
});

export const validateProcPlantChainTubeOverridePackage = (
  value: ProcPlantChainTubeOverridePackage,
  snapshot?: ProcPlantColonizationChainSnapshot,
): ProcPlantChainTubeOverridePackage => {
  if (value?.contract !== PROCPLANT_CHAIN_TUBE_OVERRIDE_CONTRACT || value.version !== PROCPLANT_CHAIN_TUBE_OVERRIDE_VERSION) {
    throw new Error("unsupported chain tube override contract or version");
  }
  if (!value.target?.genomeId?.trim() || !/^fnv1a64:[0-9a-f]{16}$/.test(value.target.graphSignature)) {
    throw new Error("invalid chain tube override target");
  }
  if (!Array.isArray(value.overrides) || value.overrides.length > PROCPLANT_CHAIN_TUBE_OVERRIDE_MAX_CHAINS) {
    throw new Error(`chain tube overrides exceed the ${PROCPLANT_CHAIN_TUBE_OVERRIDE_MAX_CHAINS} chain cap`);
  }
  if (snapshot && (
    snapshot.target.genomeId !== value.target.genomeId
    || snapshot.target.seed !== (value.target.seed >>> 0)
    || snapshot.target.graphSignature !== value.target.graphSignature
  )) throw new Error("chain tube override target does not match the compiled growth graph");
  const allowed = snapshot ? new Set(snapshot.chains.map((chain) => chain.id)) : null;
  const ids = new Set<string>();
  const overrides = value.overrides.map(normalizedOverride).map((override) => {
    if (ids.has(override.chainId)) throw new Error(`duplicate chain tube override: ${override.chainId}`);
    if (allowed && !allowed.has(override.chainId)) throw new Error(`unknown chain tube override: ${override.chainId}`);
    ids.add(override.chainId);
    return override;
  }).sort((a, b) => a.chainId.localeCompare(b.chainId));
  return {
    contract: PROCPLANT_CHAIN_TUBE_OVERRIDE_CONTRACT,
    version: PROCPLANT_CHAIN_TUBE_OVERRIDE_VERSION,
    target: { ...value.target, seed: value.target.seed >>> 0 },
    overrides,
  };
};

export const setProcPlantChainTubeOverride = (
  value: ProcPlantChainTubeOverridePackage,
  override: ProcPlantChainTubeOverride,
): ProcPlantChainTubeOverridePackage => {
  const normalized = normalizedOverride(override);
  const overrides = value.overrides.filter((entry) => entry.chainId !== normalized.chainId);
  if (normalized.radiusScale !== undefined || normalized.taperScale !== undefined || normalized.radialSegments !== undefined) {
    overrides.push(normalized);
  }
  return validateProcPlantChainTubeOverridePackage({ ...value, target: { ...value.target }, overrides });
};

export const removeProcPlantChainTubeOverride = (
  value: ProcPlantChainTubeOverridePackage,
  chainId: string,
): ProcPlantChainTubeOverridePackage => validateProcPlantChainTubeOverridePackage({
  ...value,
  target: { ...value.target },
  overrides: value.overrides.filter((entry) => entry.chainId !== chainId),
});

export const serializeProcPlantChainTubeOverridePackage = (value: ProcPlantChainTubeOverridePackage) => {
  const text = JSON.stringify(validateProcPlantChainTubeOverridePackage(value));
  if (text.length > PROCPLANT_CHAIN_TUBE_OVERRIDE_MAX_SERIALIZED_CHARS) {
    throw new Error(`serialized chain tube overrides exceed ${PROCPLANT_CHAIN_TUBE_OVERRIDE_MAX_SERIALIZED_CHARS} characters`);
  }
  return text;
};

export const deserializeProcPlantChainTubeOverridePackage = (text: string) => {
  if (text.length > PROCPLANT_CHAIN_TUBE_OVERRIDE_MAX_SERIALIZED_CHARS) {
    throw new Error(`serialized chain tube overrides exceed ${PROCPLANT_CHAIN_TUBE_OVERRIDE_MAX_SERIALIZED_CHARS} characters`);
  }
  return validateProcPlantChainTubeOverridePackage(JSON.parse(text) as ProcPlantChainTubeOverridePackage);
};
