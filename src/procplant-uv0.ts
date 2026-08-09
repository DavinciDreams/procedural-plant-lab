import * as THREE from "three";

export const PROCPLANT_UV0_CONTRACT = "procplants.geometry-uv0" as const;
export const PROCPLANT_UV0_VERSION = 1 as const;

export interface ProcPlantUv0Contract {
  contract: typeof PROCPLANT_UV0_CONTRACT;
  version: typeof PROCPLANT_UV0_VERSION;
  attribute: "uv";
  texCoord: 0;
  origin: "upper-left";
}

export const validateProcPlantGeometryUv0 = (geometry: THREE.BufferGeometry, label = "geometry") => {
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  if (!position || position.itemSize !== 3 || position.count === 0) {
    throw new Error(`${label}.position must contain xyz vertices`);
  }
  if (!uv || uv.itemSize !== 2 || uv.count !== position.count) {
    throw new Error(`${label}.uv must contain one UV0 pair per position vertex`);
  }
  for (let index = 0; index < uv.count; index++) {
    const u = uv.getX(index);
    const v = uv.getY(index);
    if (!Number.isFinite(u) || !Number.isFinite(v) || Math.abs(u) > 1e6 || Math.abs(v) > 1e6) {
      throw new Error(`${label}.uv[${index}] must be finite and bounded`);
    }
  }
  return position.count;
};

/** Stamp a UV0 contract only after validating authored coordinates; no UVs are generated. */
export const declareProcPlantGeometryUv0 = (geometry: THREE.BufferGeometry): ProcPlantUv0Contract => {
  validateProcPlantGeometryUv0(geometry);
  const contract: ProcPlantUv0Contract = {
    contract: PROCPLANT_UV0_CONTRACT,
    version: PROCPLANT_UV0_VERSION,
    attribute: "uv",
    texCoord: 0,
    origin: "upper-left",
  };
  geometry.userData.procplantUv0 = contract;
  return contract;
};

export const requireProcPlantGeometryUv0 = (geometry: THREE.BufferGeometry, label = "geometry") => {
  const contract = geometry.userData.procplantUv0 as Partial<ProcPlantUv0Contract> | undefined;
  if (contract?.contract !== PROCPLANT_UV0_CONTRACT || contract.version !== PROCPLANT_UV0_VERSION ||
    contract.attribute !== "uv" || contract.texCoord !== 0 || contract.origin !== "upper-left") {
    throw new Error(`${label} is missing the explicit ${PROCPLANT_UV0_CONTRACT}@${PROCPLANT_UV0_VERSION} contract`);
  }
  return validateProcPlantGeometryUv0(geometry, label);
};
