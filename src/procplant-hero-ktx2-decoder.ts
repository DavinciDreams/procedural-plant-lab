import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import type { ProcPlantHeroKtx2Decoder } from "./procplant-hero-source-material";

const KTX2_IDENTIFIER = Uint8Array.of(0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a);
const basisTranscoderJsUrl = new URL("../node_modules/three/examples/jsm/libs/basis/basis_transcoder.js", import.meta.url).href;
const basisTranscoderWasmUrl = new URL("../node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm", import.meta.url).href;

export interface ProcPlantHeroKtx2DecoderHandle {
  id: "three-ktx2-loader+basis";
  decode: ProcPlantHeroKtx2Decoder;
  dispose(): void;
}

/** A short-lived decoder for the lazy imported-hero preview. */
export const createProcPlantHeroKtx2Decoder = (
  renderer: THREE.WebGLRenderer,
): ProcPlantHeroKtx2DecoderHandle => {
  if (!renderer?.capabilities || !renderer.getContext()) {
    throw new Error("Imported hero KTX2 preview requires an initialized Three WebGL renderer.");
  }
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (url.endsWith("/basis_transcoder.js")) return basisTranscoderJsUrl;
    if (url.endsWith("/basis_transcoder.wasm")) return basisTranscoderWasmUrl;
    return url;
  });
  const loader = new KTX2Loader(manager);
  loader.setTranscoderPath("/__procplants_basis__/");
  try {
    loader.detectSupport(renderer);
  } catch (error) {
    loader.dispose();
    throw new Error(`Imported hero KTX2 preview cannot detect renderer texture support: ${error instanceof Error ? error.message : String(error)}`);
  }
  let disposed = false;
  return {
    id: "three-ktx2-loader+basis",
    decode: async (bytes) => {
      if (disposed) throw new Error("Imported hero KTX2 decoder is already disposed.");
      if (bytes.byteLength < KTX2_IDENTIFIER.length || KTX2_IDENTIFIER.some((byte, index) => bytes[index] !== byte)) {
        throw new Error("Imported hero KTX2 image has an invalid identifier.");
      }
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: "image/ktx2" }));
      try {
        const texture = await loader.loadAsync(url);
        if (!(texture instanceof THREE.CompressedTexture) || texture.mipmaps.length === 0) {
          texture.dispose();
          throw new Error("Three KTX2Loader returned no compressed texture mip levels.");
        }
        texture.flipY = false;
        texture.needsUpdate = true;
        return texture;
      } catch (error) {
        throw new Error(`Imported hero KTX2 decode failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      loader.dispose();
    },
  };
};
