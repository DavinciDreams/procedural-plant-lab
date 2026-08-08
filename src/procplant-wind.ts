import * as THREE from "three";

export const PROCPLANT_SWAY_ATTRIBUTE = "procplantSway";
export const PROCPLANT_INSTANCE_SWAY_ATTRIBUTE = "procplantInstanceSway";
export const PROCPLANT_WIND_PHASE_ATTRIBUTE = "procplantWindPhase";

export interface ProcPlantWindUniforms {
  time: { value: number };
  strength: { value: number };
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

const windVertexTransform = `
#include <begin_vertex>
float procplantInstanceSwayValue = 1.0;
float procplantWindPhaseValue = 0.0;
#ifdef USE_INSTANCING
procplantInstanceSwayValue = ${PROCPLANT_INSTANCE_SWAY_ATTRIBUTE};
procplantWindPhaseValue = ${PROCPLANT_WIND_PHASE_ATTRIBUTE};
#endif
float procplantSwayValue = clamp(${PROCPLANT_SWAY_ATTRIBUTE} * procplantInstanceSwayValue, 0.0, 1.5);
float procplantWindWave = sin(procplantWindTime * 1.35 + procplantWindPhaseValue + position.y * 0.72);
float procplantWindCross = cos(procplantWindTime * 0.91 + procplantWindPhaseValue * 1.37 + position.x * 0.34);
float procplantWindAmplitude = procplantWindStrength * procplantSwayValue;
transformed.x += procplantWindWave * procplantWindAmplitude;
transformed.z += procplantWindCross * procplantWindAmplitude * 0.42;
`;

type WindShader = Parameters<THREE.MeshLambertMaterial["onBeforeCompile"]>[0];

export const installProcPlantWindShader = <T extends THREE.Material>(
  material: T,
  uniforms: ProcPlantWindUniforms,
): T => {
  material.onBeforeCompile = ((shader: WindShader) => {
    shader.uniforms.procplantWindTime = uniforms.time;
    shader.uniforms.procplantWindStrength = uniforms.strength;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${windVertexDeclarations}`)
      .replace("#include <begin_vertex>", windVertexTransform);
  }) as T["onBeforeCompile"];
  material.customProgramCacheKey = () => "procplant-wind-v1";
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

export const createProcPlantWindShadowMaterials = (uniforms: ProcPlantWindUniforms) => ({
  depth: installProcPlantWindShader(
    new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    uniforms,
  ),
  distance: installProcPlantWindShader(new THREE.MeshDistanceMaterial(), uniforms),
});
