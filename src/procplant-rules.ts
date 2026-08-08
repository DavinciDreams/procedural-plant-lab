import type { ProcPlantGenome } from "./procplants";

export const PROCPLANT_RULES_CONTRACT = "procplants.macro-rules" as const;
export const PROCPLANT_RULES_VERSION = 1 as const;

export type ProcPlantRuleSeason = "spring" | "summer" | "autumn" | "winter";
export type ProcPlantRuleNumericInput =
  | "age"
  | "health"
  | "windExposure"
  | "wetness"
  | "snow"
  | "pruning"
  | "stylization"
  | "biomeAdaptation";
export type ProcPlantRuleInput = ProcPlantRuleNumericInput | "season";

export interface ProcPlantRuleContext {
  age: number;
  season: ProcPlantRuleSeason;
  health: number;
  windExposure: number;
  wetness: number;
  snow: number;
  pruning: number;
  stylization: number;
  biomeAdaptation: number;
}

export const DEFAULT_PROCPLANT_RULE_CONTEXT: ProcPlantRuleContext = {
  age: 1,
  season: "summer",
  health: 1,
  windExposure: 0,
  wetness: 0,
  snow: 0,
  pruning: 0,
  stylization: 0,
  biomeAdaptation: 0,
};

export const PROCPLANT_RULE_PATHS = [
  "nodeCount",
  "internode.base", "internode.tip", "internode.curve",
  "phyllotaxisAngle",
  "branchChance.base", "branchChance.tip", "branchChance.curve",
  "branchAngle.mean", "branchAngle.spread", "branchAngle.depthDecay",
  "apicalDominance",
  "leaf.length.base", "leaf.length.tip", "leaf.length.curve",
  "leaf.widthRatio", "leaf.density.base", "leaf.density.tip", "leaf.density.curve",
  "leaf.curl", "leaf.serration", "leaf.venation",
  "flower.whorls", "flower.petals", "flower.radius",
  "grass.blades", "grass.furBias", "grass.heightJitter",
  "fern.pinnae", "fern.leafletPairs", "fern.arch",
  "groundcover.radius", "groundcover.clusters", "groundcover.leavesPerCluster",
  "groundcover.height", "groundcover.flowerRate",
  "foliage.mass", "foliage.clusterDensity", "foliage.whorlDensity", "foliage.tipBias", "foliage.size",
  "clump.count", "clump.radius", "clump.jitter", "clump.scaleVar", "clump.lean", "clump.flowerDensity",
  "treeRealism.crownSpread", "treeRealism.crownTaper", "treeRealism.trunkFlare",
  "treeRealism.trunkBend", "treeRealism.branchGnarl", "treeRealism.windFlex", "treeRealism.colorVariance",
  "weberPenn.maxBranchDepth", "weberPenn.maxStems", "weberPenn.maxLeaves",
  "weberPenn.leafScaleMultiplier", "weberPenn.blossomScaleMultiplier",
  "weberPenn.radialSegments", "weberPenn.branchSamples",
  "branchModules.moduleBudget", "branchModules.levels", "branchModules.vigor",
  "branchModules.branchDensity", "branchModules.branchAngle", "branchModules.spread",
  "branchModules.droop", "branchModules.tropism", "branchModules.gnarliness",
  "branchModules.collisionBias", "branchModules.junctionBlend",
  "tree.crownStart", "tree.leafClusterScale", "tree.exposedTrunk",
  "lightResponse.shadeAvoidance", "lightResponse.leafBoostInShade",
  "lightResponse.branchSuppressionInShade", "lightResponse.phototropism",
] as const;

export type ProcPlantRulePath = typeof PROCPLANT_RULE_PATHS[number];

export type ProcPlantRuleOperand = number | {
  input: ProcPlantRuleNumericInput;
  scale?: number;
  offset?: number;
  invert?: boolean;
};

export type ProcPlantRuleAction =
  | { path: ProcPlantRulePath; op: "add" | "multiply" | "set"; value: ProcPlantRuleOperand }
  | { path: ProcPlantRulePath; op: "clamp"; min: number; max: number };

export interface ProcPlantRuleCondition {
  input: ProcPlantRuleInput;
  equals?: number | ProcPlantRuleSeason;
  min?: number;
  max?: number;
}

export interface ProcPlantMacroRule {
  name: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
  missingPath?: "skip" | "error";
  when?: ProcPlantRuleCondition[];
  actions: ProcPlantRuleAction[];
}

export interface ProcPlantRuleChange {
  rule: string;
  path: ProcPlantRulePath;
  operation: ProcPlantRuleAction["op"];
  before: number;
  after: number;
}

export interface ProcPlantRuleApplicationResult {
  contract: typeof PROCPLANT_RULES_CONTRACT;
  version: typeof PROCPLANT_RULES_VERSION;
  genome: ProcPlantGenome;
  context: ProcPlantRuleContext;
  appliedRules: string[];
  changes: ProcPlantRuleChange[];
}

const RULE_PATH_SET = new Set<string>(PROCPLANT_RULE_PATHS);
const NUMERIC_INPUTS: readonly ProcPlantRuleNumericInput[] = [
  "age", "health", "windExposure", "wetness", "snow", "pruning", "stylization", "biomeAdaptation",
];
const NUMERIC_INPUT_SET = new Set<string>(NUMERIC_INPUTS);
const INTEGER_PATHS = new Set<ProcPlantRulePath>([
  "nodeCount", "flower.whorls", "flower.petals", "grass.blades", "fern.pinnae", "fern.leafletPairs",
  "groundcover.clusters", "groundcover.leavesPerCluster", "clump.count", "weberPenn.maxBranchDepth",
  "weberPenn.maxStems", "weberPenn.maxLeaves", "weberPenn.radialSegments", "weberPenn.branchSamples",
  "branchModules.moduleBudget", "branchModules.levels",
]);

export class ProcPlantRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcPlantRuleError";
  }
}

const finite = (value: number, label: string) => {
  if (!Number.isFinite(value)) throw new ProcPlantRuleError(`${label} must be finite`);
};

const cloneGenome = (genome: ProcPlantGenome): ProcPlantGenome =>
  JSON.parse(JSON.stringify(genome)) as ProcPlantGenome;

const normalizeContext = (partial: Partial<ProcPlantRuleContext>): ProcPlantRuleContext => {
  const context = { ...DEFAULT_PROCPLANT_RULE_CONTEXT, ...partial };
  if (!["spring", "summer", "autumn", "winter"].includes(context.season)) {
    throw new ProcPlantRuleError("rule context season must be spring, summer, autumn, or winter");
  }
  for (const input of NUMERIC_INPUTS) {
    finite(context[input], `rule context ${input}`);
    context[input] = Math.max(0, Math.min(1, context[input]));
  }
  return context;
};

const validateOperand = (operand: ProcPlantRuleOperand, label: string) => {
  if (typeof operand === "number") {
    finite(operand, label);
    return;
  }
  if (!operand || typeof operand !== "object" || !NUMERIC_INPUT_SET.has(operand.input)) {
    throw new ProcPlantRuleError(`${label} must be a constant or safe numeric context operand`);
  }
  if (operand.scale !== undefined) finite(operand.scale, `${label}.scale`);
  if (operand.offset !== undefined) finite(operand.offset, `${label}.offset`);
  if (operand.invert !== undefined && typeof operand.invert !== "boolean") {
    throw new ProcPlantRuleError(`${label}.invert must be boolean`);
  }
};

export const validateProcPlantMacroRules = (rules: readonly ProcPlantMacroRule[]) => {
  const names = new Set<string>();
  for (const rule of rules) {
    if (!rule.name.trim()) throw new ProcPlantRuleError("macro rule name must not be empty");
    if (names.has(rule.name)) throw new ProcPlantRuleError(`duplicate macro rule name: ${rule.name}`);
    names.add(rule.name);
    if (rule.enabled !== undefined && typeof rule.enabled !== "boolean") {
      throw new ProcPlantRuleError(`${rule.name}.enabled must be boolean`);
    }
    if (rule.missingPath !== undefined && rule.missingPath !== "skip" && rule.missingPath !== "error") {
      throw new ProcPlantRuleError(`${rule.name}.missingPath must be skip or error`);
    }
    if (rule.priority !== undefined) finite(rule.priority, `${rule.name}.priority`);
    if (!Array.isArray(rule.actions) || rule.actions.length === 0) {
      throw new ProcPlantRuleError(`${rule.name}.actions must not be empty`);
    }
    for (const [index, condition] of (rule.when ?? []).entries()) {
      if (condition.input !== "season" && !NUMERIC_INPUT_SET.has(condition.input)) {
        throw new ProcPlantRuleError(`${rule.name}.when[${index}] uses an unsafe input`);
      }
      if (condition.input === "season" && condition.equals !== undefined &&
        !["spring", "summer", "autumn", "winter"].includes(String(condition.equals))) {
        throw new ProcPlantRuleError(`${rule.name}.when[${index}].equals is not a season`);
      }
      if (condition.input === "season" && (condition.min !== undefined || condition.max !== undefined)) {
        throw new ProcPlantRuleError(`${rule.name}.when[${index}] season cannot use numeric bounds`);
      }
      if (condition.input !== "season" && condition.equals !== undefined) {
        if (typeof condition.equals !== "number") {
          throw new ProcPlantRuleError(`${rule.name}.when[${index}].equals must be numeric`);
        }
        finite(condition.equals, `${rule.name}.when[${index}].equals`);
      }
      if (condition.min !== undefined) finite(condition.min, `${rule.name}.when[${index}].min`);
      if (condition.max !== undefined) finite(condition.max, `${rule.name}.when[${index}].max`);
      if (condition.min !== undefined && condition.max !== undefined && condition.min > condition.max) {
        throw new ProcPlantRuleError(`${rule.name}.when[${index}] min exceeds max`);
      }
    }
    for (const [index, action] of rule.actions.entries()) {
      if (!RULE_PATH_SET.has(action.path)) throw new ProcPlantRuleError(`${rule.name}.actions[${index}] uses unsafe path ${action.path}`);
      if (action.op === "clamp") {
        finite(action.min, `${rule.name}.actions[${index}].min`);
        finite(action.max, `${rule.name}.actions[${index}].max`);
        if (action.min > action.max) throw new ProcPlantRuleError(`${rule.name}.actions[${index}] clamp min exceeds max`);
      } else {
        validateOperand(action.value, `${rule.name}.actions[${index}].value`);
      }
    }
  }
};

const conditionMatches = (condition: ProcPlantRuleCondition, context: ProcPlantRuleContext) => {
  const value = context[condition.input];
  if (condition.equals !== undefined && value !== condition.equals) return false;
  if (typeof value === "number" && condition.min !== undefined && value < condition.min) return false;
  if (typeof value === "number" && condition.max !== undefined && value > condition.max) return false;
  return true;
};

const resolveOperand = (operand: ProcPlantRuleOperand, context: ProcPlantRuleContext) => {
  if (typeof operand === "number") return operand;
  const input = operand.invert ? 1 - context[operand.input] : context[operand.input];
  return (operand.offset ?? 0) + input * (operand.scale ?? 1);
};

const locateNumericPath = (genome: ProcPlantGenome, path: ProcPlantRulePath) => {
  const parts = path.split(".");
  let parent: Record<string, unknown> = genome as unknown as Record<string, unknown>;
  for (let index = 0; index < parts.length - 1; index++) {
    const next = parent[parts[index]!];
    if (!next || typeof next !== "object" || Array.isArray(next)) return null;
    parent = next as Record<string, unknown>;
  }
  const key = parts[parts.length - 1]!;
  return typeof parent[key] === "number" ? { parent, key, value: parent[key] as number } : null;
};

export const applyProcPlantMacroRules = (
  source: ProcPlantGenome,
  contextInput: Partial<ProcPlantRuleContext>,
  rules: readonly ProcPlantMacroRule[] = PROCPLANT_DEFAULT_MACRO_RULES,
): ProcPlantRuleApplicationResult => {
  validateProcPlantMacroRules(rules);
  const context = normalizeContext(contextInput);
  const genome = cloneGenome(source);
  const appliedRules: string[] = [];
  const changes: ProcPlantRuleChange[] = [];
  const ordered = [...rules].sort((a, b) =>
    (a.priority ?? 0) - (b.priority ?? 0) || a.name.localeCompare(b.name),
  );
  for (const rule of ordered) {
    if (rule.enabled === false || !(rule.when ?? []).every((condition) => conditionMatches(condition, context))) continue;
    appliedRules.push(rule.name);
    for (const action of rule.actions) {
      const located = locateNumericPath(genome, action.path);
      if (!located) {
        if (rule.missingPath === "error") throw new ProcPlantRuleError(`${rule.name} requires missing numeric path ${action.path}`);
        continue;
      }
      const before = located.value;
      let after: number;
      if (action.op === "clamp") after = Math.max(action.min, Math.min(action.max, before));
      else {
        const operand = resolveOperand(action.value, context);
        after = action.op === "add" ? before + operand : action.op === "multiply" ? before * operand : operand;
      }
      if (INTEGER_PATHS.has(action.path)) after = Math.round(after);
      finite(after, `${rule.name}.${action.path} result`);
      located.parent[located.key] = after;
      if (!Object.is(before, after)) changes.push({ rule: rule.name, path: action.path, operation: action.op, before, after });
    }
  }
  return {
    contract: PROCPLANT_RULES_CONTRACT,
    version: PROCPLANT_RULES_VERSION,
    genome,
    context,
    appliedRules,
    changes,
  };
};

const input = (
  name: ProcPlantRuleNumericInput,
  scale: number,
  offset = 0,
  invert = false,
): ProcPlantRuleOperand => ({ input: name, scale, offset, invert });

export const PROCPLANT_DEFAULT_MACRO_RULES: readonly ProcPlantMacroRule[] = [
  {
    name: "age-growth",
    description: "Scale architecture and organ size from juvenile to mature form.",
    priority: 10,
    actions: [
      { path: "nodeCount", op: "multiply", value: input("age", 0.65, 0.35) },
      { path: "leaf.length.base", op: "multiply", value: input("age", 0.48, 0.52) },
      { path: "leaf.length.tip", op: "multiply", value: input("age", 0.48, 0.52) },
      { path: "flower.radius", op: "multiply", value: input("age", 0.42, 0.58) },
      { path: "clump.count", op: "multiply", value: input("age", 0.7, 0.3) },
    ],
  },
  {
    name: "season-spring",
    priority: 20,
    when: [{ input: "season", equals: "spring" }],
    actions: [
      { path: "leaf.density.base", op: "multiply", value: 1.08 },
      { path: "leaf.density.tip", op: "multiply", value: 1.08 },
      { path: "flower.radius", op: "multiply", value: 1.08 },
    ],
  },
  {
    name: "season-summer",
    priority: 20,
    when: [{ input: "season", equals: "summer" }],
    actions: [
      { path: "leaf.density.base", op: "multiply", value: 1 },
      { path: "foliage.mass", op: "multiply", value: 1 },
    ],
  },
  {
    name: "season-autumn",
    priority: 20,
    when: [{ input: "season", equals: "autumn" }],
    actions: [
      { path: "leaf.density.base", op: "multiply", value: 0.72 },
      { path: "leaf.density.tip", op: "multiply", value: 0.64 },
      { path: "flower.radius", op: "multiply", value: 0.75 },
    ],
  },
  {
    name: "season-winter",
    priority: 20,
    when: [{ input: "season", equals: "winter" }],
    actions: [
      { path: "leaf.density.base", op: "multiply", value: 0.32 },
      { path: "leaf.density.tip", op: "multiply", value: 0.24 },
      { path: "flower.radius", op: "multiply", value: 0.35 },
      { path: "foliage.mass", op: "multiply", value: 0.45 },
    ],
  },
  {
    name: "health-vigor",
    priority: 30,
    actions: [
      { path: "branchChance.base", op: "multiply", value: input("health", 0.65, 0.35) },
      { path: "branchChance.tip", op: "multiply", value: input("health", 0.65, 0.35) },
      { path: "leaf.density.base", op: "multiply", value: input("health", 0.75, 0.25) },
      { path: "leaf.density.tip", op: "multiply", value: input("health", 0.75, 0.25) },
      { path: "foliage.mass", op: "multiply", value: input("health", 0.72, 0.28) },
    ],
  },
  {
    name: "wind-exposure",
    priority: 40,
    actions: [
      { path: "treeRealism.windFlex", op: "add", value: input("windExposure", 0.2) },
      { path: "treeRealism.windFlex", op: "clamp", min: 0, max: 1 },
      { path: "treeRealism.crownSpread", op: "multiply", value: input("windExposure", -0.18, 1) },
      { path: "branchAngle.spread", op: "add", value: input("windExposure", 0.12) },
    ],
  },
  {
    name: "wetness-response",
    priority: 50,
    actions: [
      { path: "leaf.curl", op: "add", value: input("wetness", 0.08) },
      { path: "leaf.curl", op: "clamp", min: 0, max: 1 },
      { path: "foliage.mass", op: "multiply", value: input("wetness", 0.15, 1) },
      { path: "groundcover.flowerRate", op: "multiply", value: input("wetness", 0.15, 1) },
    ],
  },
  {
    name: "snow-load",
    priority: 60,
    actions: [
      { path: "branchAngle.mean", op: "add", value: input("snow", 0.18) },
      { path: "treeRealism.crownSpread", op: "multiply", value: input("snow", -0.28, 1) },
      { path: "treeRealism.windFlex", op: "add", value: input("snow", -0.12) },
      { path: "treeRealism.windFlex", op: "clamp", min: 0, max: 1 },
    ],
  },
  {
    name: "pruning-response",
    priority: 70,
    actions: [
      { path: "branchChance.base", op: "multiply", value: input("pruning", -0.55, 1) },
      { path: "branchChance.tip", op: "multiply", value: input("pruning", -0.55, 1) },
      { path: "nodeCount", op: "multiply", value: input("pruning", -0.3, 1) },
      { path: "foliage.mass", op: "multiply", value: input("pruning", -0.24, 1) },
    ],
  },
  {
    name: "stylization",
    priority: 80,
    actions: [
      { path: "leaf.widthRatio", op: "multiply", value: input("stylization", 0.45, 1) },
      { path: "treeRealism.colorVariance", op: "add", value: input("stylization", 0.22) },
      { path: "treeRealism.colorVariance", op: "clamp", min: 0, max: 1 },
      { path: "treeRealism.branchGnarl", op: "add", value: input("stylization", 0.2) },
      { path: "treeRealism.branchGnarl", op: "clamp", min: 0, max: 1 },
    ],
  },
  {
    name: "biome-adaptation",
    priority: 90,
    actions: [
      { path: "lightResponse.phototropism", op: "add", value: input("biomeAdaptation", 0.18) },
      { path: "lightResponse.phototropism", op: "clamp", min: 0, max: 1 },
      { path: "lightResponse.leafBoostInShade", op: "add", value: input("biomeAdaptation", 0.16) },
      { path: "lightResponse.leafBoostInShade", op: "clamp", min: 0, max: 1 },
      { path: "internode.curve", op: "multiply", value: input("biomeAdaptation", 0.06, 1) },
    ],
  },
] as const;
