import type { ProcPlantMaterialKtx2Encoder } from "../src/procplant-material-ktx2";

export const PROCPLANT_KTX2_ENCODER_PACKAGE = "ktx2-encoder@0.6.0" as const;
export const PROCPLANT_KTX2_BASIS_COMMIT = "1b33fd5098c6e7b58324146b8f5518cbb4cdfb72" as const;
export const PROCPLANT_KTX2_WASM_SHA256 = "9807719e87cf3d979b0d69ae7112eb88aec6a0e0206c0b2d00dc0bed0d581b80" as const;

let encoderModule: Promise<typeof import("ktx2-encoder")> | undefined;

/** Exact-pinned, lazy Node/build adapter. It never shells out and is not exported in the browser library. */
export const createProcPlantKtx2NodeEncoder = (): ProcPlantMaterialKtx2Encoder => ({
  id: "ktx2-encoder",
  version: `0.6.0+basis-${PROCPLANT_KTX2_BASIS_COMMIT.slice(0, 12)}`,
  async encode(request) {
    encoderModule ??= import("ktx2-encoder");
    const { encodeToKTX2 } = await encoderModule;
    const bytes = await encodeToKTX2(request.rgba, {
      imageDecoder: async (rgba) => ({ data: rgba.slice(), width: request.width, height: request.height }),
      isKTX2File: true,
      isUASTC: request.policy.codec === "uastc",
      generateMipmap: request.policy.mipmaps,
      isPerceptual: request.policy.colorSpace === "srgb",
      isSetKTX2SRGBTransferFunc: request.policy.colorSpace === "srgb",
      isNormalMap: request.policy.normalMapPreset,
      needSupercompression: request.policy.uastcZstd,
      enableRDO: request.policy.uastcRdo,
      qualityLevel: request.policy.etc1sQuality,
      compressionLevel: request.policy.etc1sCompressionLevel,
      uastcLDRQualityLevel: request.policy.uastcQuality,
      outputBufferSize: Math.min(request.maxOutputBytes, Math.max(65_536, request.rgba.byteLength * 2)),
      enableDebug: false,
    });
    if (bytes.byteLength > request.maxOutputBytes) throw new Error(`KTX2 encoder output exceeds maxOutputBytes (${bytes.byteLength} > ${request.maxOutputBytes})`);
    return bytes;
  },
});
