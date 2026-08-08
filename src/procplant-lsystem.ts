import * as THREE from "three";

export const PROCPLANT_LSYSTEM_CONTRACT = "procplants.lsystem" as const;
export const PROCPLANT_LSYSTEM_VERSION = 1 as const;

export interface ProcPlantLSystemToken {
  symbol: string;
  parameters?: number[];
}

export interface ProcPlantLSystemSuccessor {
  weight?: number;
  tokens: ProcPlantLSystemToken[];
}

export interface ProcPlantLSystemRule {
  predecessor: string;
  successors: ProcPlantLSystemSuccessor[];
}

export interface ProcPlantLSystemProgram {
  contract: typeof PROCPLANT_LSYSTEM_CONTRACT;
  version: typeof PROCPLANT_LSYSTEM_VERSION;
  axiom: ProcPlantLSystemToken[];
  rules: ProcPlantLSystemRule[];
  iterations: number;
  seed: number;
  maxTokens?: number;
}

export interface ProcPlantLSystemInterpretOptions {
  step?: number;
  angle?: number;
  radius?: number;
  radiusDecay?: number;
  tropism?: [number, number, number];
  tropismStrength?: number;
  maxSegments?: number;
}

export interface ProcPlantLSystemNode {
  id: string;
  position: [number, number, number];
  radius: number;
  branchOrder: number;
}

export interface ProcPlantLSystemSegment {
  id: string;
  startNodeId: string;
  endNodeId: string;
  parentSegmentId: string | null;
  branchOrder: number;
}

export interface ProcPlantLSystemAttachment {
  id: string;
  kind: "leaf";
  parentSegmentId: string | null;
  position: [number, number, number];
  tangent: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
}

export interface ProcPlantLSystemResult {
  contract: typeof PROCPLANT_LSYSTEM_CONTRACT;
  version: typeof PROCPLANT_LSYSTEM_VERSION;
  seed: number;
  tokens: ProcPlantLSystemToken[];
  nodes: ProcPlantLSystemNode[];
  segments: ProcPlantLSystemSegment[];
  attachments: ProcPlantLSystemAttachment[];
}

const cloneTokens = (tokens: readonly ProcPlantLSystemToken[]) => tokens.map((token) => ({
  symbol: token.symbol,
  ...(token.parameters ? { parameters: [...token.parameters] } : {}),
}));

/** Parse compact symbols such as `F(1)[+(0.4)F(0.8)]L`. */
export const parseProcPlantLSystemTokens = (source: string): ProcPlantLSystemToken[] => {
  const tokens: ProcPlantLSystemToken[] = [];
  let index = 0;
  while (index < source.length) {
    if (/\s/.test(source[index]!)) {
      index++;
      continue;
    }
    let symbol: string;
    if ("[]+-&^\\/|!".includes(source[index]!)) {
      symbol = source[index++]!;
    } else if (/[A-Za-z_]/.test(source[index]!)) {
      const start = index++;
      while (index < source.length && /[A-Za-z0-9_-]/.test(source[index]!)) index++;
      symbol = source.slice(start, index);
    } else {
      throw new Error(`invalid L-system token at character ${index}: ${source[index]}`);
    }
    let parameters: number[] | undefined;
    if (source[index] === "(") {
      const close = source.indexOf(")", index + 1);
      if (close < 0) throw new Error(`unterminated L-system parameters for ${symbol}`);
      const body = source.slice(index + 1, close).trim();
      parameters = body
        ? body.split(",").map((value) => {
            const numeric = Number(value.trim());
            if (!Number.isFinite(numeric)) throw new Error(`non-finite L-system parameter for ${symbol}`);
            return numeric;
          })
        : [];
      index = close + 1;
    }
    tokens.push({ symbol, ...(parameters ? { parameters } : {}) });
  }
  return tokens;
};

const randomFromSeed = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const validateProgram = (program: ProcPlantLSystemProgram) => {
  if (program.contract !== PROCPLANT_LSYSTEM_CONTRACT || program.version !== PROCPLANT_LSYSTEM_VERSION) {
    throw new Error("unsupported L-system contract or version");
  }
  if (!Number.isInteger(program.iterations) || program.iterations < 0 || program.iterations > 16) {
    throw new Error("L-system iterations must be an integer in [0, 16]");
  }
  if (!Number.isInteger(program.seed) || program.seed < 0 || program.seed > 0xffffffff) {
    throw new Error("L-system seed must be a uint32");
  }
  const predecessors = new Set<string>();
  for (const rule of program.rules) {
    if (!rule.predecessor || predecessors.has(rule.predecessor)) throw new Error(`duplicate or empty L-system rule: ${rule.predecessor}`);
    predecessors.add(rule.predecessor);
    if (rule.successors.length === 0) throw new Error(`${rule.predecessor} needs a successor`);
    for (const successor of rule.successors) {
      const weight = successor.weight ?? 1;
      if (!Number.isFinite(weight) || weight <= 0) throw new Error(`${rule.predecessor} successor weight must be positive`);
    }
  }
};

export const expandProcPlantLSystem = (program: ProcPlantLSystemProgram): ProcPlantLSystemToken[] => {
  validateProgram(program);
  const maxTokens = Math.max(1, Math.min(2_000_000, Math.round(program.maxTokens ?? 250_000)));
  const rules = new Map(program.rules.map((rule) => [rule.predecessor, rule]));
  const random = randomFromSeed(program.seed);
  let tokens = cloneTokens(program.axiom);
  for (let iteration = 0; iteration < program.iterations; iteration++) {
    const next: ProcPlantLSystemToken[] = [];
    for (const token of tokens) {
      const rule = rules.get(token.symbol);
      if (!rule) next.push({ symbol: token.symbol, ...(token.parameters ? { parameters: [...token.parameters] } : {}) });
      else {
        const total = rule.successors.reduce((sum, successor) => sum + (successor.weight ?? 1), 0);
        let cursor = random() * total;
        let selected = rule.successors.at(-1)!;
        for (const successor of rule.successors) {
          cursor -= successor.weight ?? 1;
          if (cursor <= 0) {
            selected = successor;
            break;
          }
        }
        next.push(...cloneTokens(selected.tokens));
      }
      if (next.length > maxTokens) throw new Error(`L-system expansion exceeds ${maxTokens} tokens`);
    }
    tokens = next;
  }
  return tokens;
};

interface TurtleState {
  position: THREE.Vector3;
  orientation: THREE.Quaternion;
  radius: number;
  nodeIndex: number;
  parentSegmentIndex: number | null;
  branchOrder: number;
}

const cloneState = (state: TurtleState): TurtleState => ({
  position: state.position.clone(),
  orientation: state.orientation.clone(),
  radius: state.radius,
  nodeIndex: state.nodeIndex,
  parentSegmentIndex: state.parentSegmentIndex,
  branchOrder: state.branchOrder,
});

const vectorTuple = (vector: THREE.Vector3): [number, number, number] => [vector.x, vector.y, vector.z];

export const interpretProcPlantLSystem = (
  tokens: readonly ProcPlantLSystemToken[],
  seed = 1,
  options: ProcPlantLSystemInterpretOptions = {},
): ProcPlantLSystemResult => {
  const step = Math.max(1e-5, options.step ?? 0.3);
  const angle = options.angle ?? Math.PI / 6;
  const initialRadius = Math.max(1e-5, options.radius ?? 0.08);
  const radiusDecay = THREE.MathUtils.clamp(options.radiusDecay ?? 0.965, 0.01, 1);
  const maxSegments = Math.max(1, Math.min(1_000_000, Math.round(options.maxSegments ?? 100_000)));
  const tropism = new THREE.Vector3(...(options.tropism ?? [0, 1, 0]));
  if (tropism.lengthSq() > 0) tropism.normalize();
  const tropismStrength = THREE.MathUtils.clamp(options.tropismStrength ?? 0, 0, 1);
  const nodes: ProcPlantLSystemNode[] = [{ id: "node:000000", position: [0, 0, 0], radius: initialRadius, branchOrder: 0 }];
  const segments: ProcPlantLSystemSegment[] = [];
  const attachments: ProcPlantLSystemAttachment[] = [];
  let state: TurtleState = {
    position: new THREE.Vector3(),
    orientation: new THREE.Quaternion(),
    radius: initialRadius,
    nodeIndex: 0,
    parentSegmentIndex: null,
    branchOrder: 0,
  };
  const stack: TurtleState[] = [];
  const axis = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const tangent = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();

  const rotateLocal = (localAxis: THREE.Vector3, radians: number) => {
    axis.copy(localAxis).applyQuaternion(state.orientation).normalize();
    rotation.setFromAxisAngle(axis, radians);
    state.orientation.premultiply(rotation).normalize();
  };

  for (const token of tokens) {
    const value = token.parameters?.[0];
    if (token.symbol === "F" || token.symbol === "f") {
      const distance = Math.max(0, value ?? step);
      tangent.set(0, 1, 0).applyQuaternion(state.orientation).normalize();
      const nextPosition = state.position.clone().addScaledVector(tangent, distance);
      if (token.symbol === "F") {
        if (segments.length >= maxSegments) throw new Error(`L-system interpretation exceeds ${maxSegments} segments`);
        const nextNodeIndex = nodes.length;
        const nextRadius = Math.max(1e-5, state.radius * (token.parameters?.[1] ?? radiusDecay));
        nodes.push({
          id: `node:${nextNodeIndex.toString().padStart(6, "0")}`,
          position: vectorTuple(nextPosition),
          radius: nextRadius,
          branchOrder: state.branchOrder,
        });
        const segmentIndex = segments.length;
        segments.push({
          id: `segment:${segmentIndex.toString().padStart(6, "0")}`,
          startNodeId: nodes[state.nodeIndex]!.id,
          endNodeId: nodes[nextNodeIndex]!.id,
          parentSegmentId: state.parentSegmentIndex === null ? null : segments[state.parentSegmentIndex]!.id,
          branchOrder: state.branchOrder,
        });
        state.nodeIndex = nextNodeIndex;
        state.parentSegmentIndex = segmentIndex;
        state.radius = nextRadius;
      } else {
        const nextNodeIndex = nodes.length;
        nodes.push({
          id: `node:${nextNodeIndex.toString().padStart(6, "0")}`,
          position: vectorTuple(nextPosition),
          radius: state.radius,
          branchOrder: state.branchOrder,
        });
        state.nodeIndex = nextNodeIndex;
        state.parentSegmentIndex = null;
      }
      state.position.copy(nextPosition);
      if (tropismStrength > 0 && tropism.lengthSq() > 0) {
        tangent.lerp(tropism, tropismStrength).normalize();
        state.orientation.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
      }
    } else if (token.symbol === "+") rotateLocal(new THREE.Vector3(0, 0, 1), value ?? angle);
    else if (token.symbol === "-") rotateLocal(new THREE.Vector3(0, 0, 1), -(value ?? angle));
    else if (token.symbol === "&") rotateLocal(new THREE.Vector3(1, 0, 0), value ?? angle);
    else if (token.symbol === "^") rotateLocal(new THREE.Vector3(1, 0, 0), -(value ?? angle));
    else if (token.symbol === "\\") rotateLocal(new THREE.Vector3(0, 1, 0), value ?? angle);
    else if (token.symbol === "/") rotateLocal(new THREE.Vector3(0, 1, 0), -(value ?? angle));
    else if (token.symbol === "|") rotateLocal(new THREE.Vector3(0, 0, 1), Math.PI);
    else if (token.symbol === "[") {
      stack.push(cloneState(state));
      state.branchOrder++;
    } else if (token.symbol === "]") {
      const restored = stack.pop();
      if (!restored) throw new Error("L-system turtle stack underflow");
      state = restored;
    } else if (token.symbol === "!") {
      state.radius = Math.max(1e-5, value ?? state.radius);
    } else if (token.symbol === "L") {
      tangent.set(0, 1, 0).applyQuaternion(state.orientation).normalize();
      right.set(1, 0, 0).applyQuaternion(state.orientation).projectOnPlane(tangent).normalize();
      up.crossVectors(tangent, right).normalize();
      const attachmentIndex = attachments.length;
      attachments.push({
        id: `leaf:${attachmentIndex.toString().padStart(6, "0")}`,
        kind: "leaf",
        parentSegmentId: state.parentSegmentIndex === null ? null : segments[state.parentSegmentIndex]!.id,
        position: vectorTuple(state.position),
        tangent: vectorTuple(tangent),
        right: vectorTuple(right),
        up: vectorTuple(up),
      });
    }
  }
  if (stack.length > 0) throw new Error("L-system turtle stack is not balanced");
  return {
    contract: PROCPLANT_LSYSTEM_CONTRACT,
    version: PROCPLANT_LSYSTEM_VERSION,
    seed: seed >>> 0,
    tokens: cloneTokens(tokens),
    nodes,
    segments,
    attachments,
  };
};

export const runProcPlantLSystem = (
  program: ProcPlantLSystemProgram,
  options: ProcPlantLSystemInterpretOptions = {},
) => interpretProcPlantLSystem(expandProcPlantLSystem(program), program.seed, options);
