/**
 * Leaf Class (leaf/blossom placement) for the Weber & Penn tree algorithm.
 * Vendored from hyperscape/packages/procgen/src/core/Leaf.ts (placement subset;
 * the TSL-bound transform/bend math is omitted — leaf cards are baked directly).
 */

import type * as THREE from "three";
import type { LeafData } from "./types";
import type { Stem } from "./Stem";

export class Leaf {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  right: THREE.Vector3;
  isBlossom: boolean;
  parentStem: Stem;
  parentOffset: number;

  constructor(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    right: THREE.Vector3,
    parentStem: Stem,
    parentOffset: number,
    isBlossom = false,
  ) {
    this.position = position.clone();
    this.direction = direction.clone().normalize();
    this.right = right.clone().normalize();
    this.parentStem = parentStem;
    this.parentOffset = parentOffset;
    this.isBlossom = isBlossom;
  }

  toData(index: number): LeafData {
    if (this.parentStem.index < 0) {
      throw new Error("[Leaf.toData] parent stem must have a stable index");
    }
    return {
      index,
      parentStemIndex: this.parentStem.index,
      parentOffset: this.parentOffset,
      parentAxialT: this.parentStem.length > 0
        ? Math.max(0, Math.min(1, this.parentOffset / this.parentStem.length))
        : 0,
      position: this.position.clone(),
      direction: this.direction.clone(),
      right: this.right.clone(),
      isBlossom: this.isBlossom,
    };
  }
}
