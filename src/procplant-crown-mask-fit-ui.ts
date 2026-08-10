import {
  PROCPLANT_CROWN_MASK_MAX_DIMENSION,
  fitProcPlantCrownMask,
  type ProcPlantCrownMaskFitResult,
  type ProcPlantCrownMaskWorldBounds,
} from "./procplant-crown-mask-fit";
import "./procplant-crown-mask-fit-ui.css";

export interface ProcPlantCrownMaskFitUiOptions {
  container: HTMLElement;
  initialBounds: ProcPlantCrownMaskWorldBounds;
  onApply: (result: ProcPlantCrownMaskFitResult) => void;
  onClose: () => void;
}

export interface ProcPlantCrownMaskFitUi {
  dispose: () => void;
}

const makeNumberInput = (
  labelText: string,
  value: number,
  minimum: number,
  maximum: number,
  step: number,
) => {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "number";
  input.value = String(value);
  input.min = String(minimum);
  input.max = String(maximum);
  input.step = String(step);
  input.required = true;
  label.append(input);
  return { label, input };
};

const finiteInput = (input: HTMLInputElement, label: string) => {
  const value = Number(input.value);
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
};

/**
 * Mounts the lazy, browser-only 2D alpha-mask authoring surface. The image
 * supplies X/Y occupancy only; world scale and depth remain explicit inputs.
 */
export const createProcPlantCrownMaskFitUi = (
  options: ProcPlantCrownMaskFitUiOptions,
): ProcPlantCrownMaskFitUi => {
  const { container } = options;
  let disposed = false;
  let decodeRequest = 0;
  let source: { width: number; height: number; alpha: Uint8Array; pixels: ImageData } | null = null;
  let result: ProcPlantCrownMaskFitResult | null = null;

  container.replaceChildren();
  container.classList.add("crown-mask-fit-editor");
  container.dataset.ready = "false";

  const title = document.createElement("h3");
  title.id = "crownMaskFitTitle";
  title.textContent = "Fit filled crown silhouette";
  container.setAttribute("aria-labelledby", title.id);

  const explanation = document.createElement("p");
  explanation.id = "crownMaskFitDescription";
  explanation.textContent = "Choose a transparent PNG or WebP containing one filled silhouette. The image supplies frontal X/Y occupancy; center, scale, and depth are authored assumptions, not metric reconstruction.";

  const fileLabel = document.createElement("label");
  fileLabel.className = "crown-mask-file";
  fileLabel.textContent = "Crown silhouette file";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/webp";
  fileInput.setAttribute("aria-describedby", explanation.id);
  fileLabel.append(fileInput);

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "No crown silhouette loaded");

  const controls = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = "Explicit fit bounds";
  controls.append(legend);
  const center = options.initialBounds.center.map((value, index) =>
    makeNumberInput(`Center ${"XYZ"[index]}`, value, -1_000_000, 1_000_000, 0.05));
  const dimensionLabels = ["Width", "Height", "Depth"] as const;
  const dimensions = options.initialBounds.dimensions.map((value, index) =>
    makeNumberInput(dimensionLabels[index]!, value, 0.01, 10_000, 0.05));
  const threshold = makeNumberInput("Alpha threshold", 0.5, 0, 1, 0.01);
  const bands = makeNumberInput("Ellipsoid bands", 8, 1, 16, 1);
  const grid = document.createElement("div");
  grid.className = "crown-mask-fit-grid";
  grid.append(...center.map((entry) => entry.label), ...dimensions.map((entry) => entry.label), threshold.label, bands.label);
  controls.append(grid);

  const status = document.createElement("output");
  status.className = "crown-mask-fit-status";
  status.setAttribute("aria-live", "polite");
  status.textContent = "Choose a filled alpha silhouette to begin.";

  const actions = document.createElement("div");
  actions.className = "button-row crown-mask-fit-actions";
  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview bounded fit";
  previewButton.disabled = true;
  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.textContent = "Apply Crown";
  applyButton.disabled = true;
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  actions.append(previewButton, applyButton, closeButton);
  container.append(title, explanation, fileLabel, canvas, controls, status, actions);

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2D canvas is required for crown-mask fitting");

  const clearResult = () => {
    result = null;
    applyButton.disabled = true;
    delete container.dataset.fitHash;
    delete container.dataset.bandCount;
    delete container.dataset.foregroundPixels;
    delete container.dataset.depthPolicy;
  };

  const readBounds = (): ProcPlantCrownMaskWorldBounds => ({
    center: center.map((entry, index) => finiteInput(entry.input, `center ${"XYZ"[index]}`)) as [number, number, number],
    dimensions: dimensions.map((entry) => finiteInput(entry.input, entry.label.firstChild?.textContent ?? "dimension")) as [number, number, number],
  });

  const drawPreview = (fit: ProcPlantCrownMaskFitResult | null) => {
    if (!source) return;
    context.putImageData(source.pixels, 0, 0);
    if (fit) {
      context.save();
      context.strokeStyle = "#ffd66b";
      context.lineWidth = Math.max(1, Math.min(source.width, source.height) / 160);
      for (const band of fit.bands) {
        const [left, right] = band.sourceColumns;
        const [top, bottom] = band.sourceRows;
        context.strokeRect(left, top, right - left + 1, bottom - top + 1);
      }
      context.restore();
    }
  };

  const preview = () => {
    clearResult();
    if (!source) {
      status.textContent = "Choose a crown silhouette before previewing.";
      return;
    }
    try {
      const fit = fitProcPlantCrownMask(
        { width: source.width, height: source.height, alpha: source.alpha },
        {
          threshold: finiteInput(threshold.input, "alpha threshold"),
          bands: finiteInput(bands.input, "ellipsoid bands"),
          bounds: readBounds(),
        },
      );
      result = fit;
      applyButton.disabled = false;
      container.dataset.fitHash = fit.source.hash;
      container.dataset.bandCount = String(fit.audit.bandCount);
      container.dataset.foregroundPixels = String(fit.source.foregroundPixels);
      container.dataset.depthPolicy = fit.audit.depthPolicy;
      drawPreview(fit);
      status.textContent = `${fit.source.foregroundPixels.toLocaleString()} foreground pixels fit into ${fit.audit.bandCount} bounded ellipsoids. Depth uses the explicit authored bounds.`;
    } catch (error) {
      drawPreview(null);
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  };

  const onFileChange = async () => {
    const request = ++decodeRequest;
    clearResult();
    source = null;
    previewButton.disabled = true;
    container.dataset.ready = "false";
    const file = fileInput.files?.[0];
    if (!file) {
      status.textContent = "Choose a filled alpha silhouette to begin.";
      return;
    }
    if (file.size > 16 * 1024 * 1024) {
      status.textContent = "Crown silhouette file exceeds the 16 MiB authoring limit.";
      return;
    }
    if (file.type !== "image/png" && file.type !== "image/webp") {
      status.textContent = "Crown silhouette must be a PNG or WebP with alpha.";
      return;
    }
    status.textContent = "Decoding bounded alpha silhouette…";
    try {
      const bitmap = await createImageBitmap(file);
      if (disposed || request !== decodeRequest) {
        bitmap.close();
        return;
      }
      if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width > PROCPLANT_CROWN_MASK_MAX_DIMENSION || bitmap.height > PROCPLANT_CROWN_MASK_MAX_DIMENSION) {
        bitmap.close();
        throw new Error(`crown silhouette dimensions must be within 1–${PROCPLANT_CROWN_MASK_MAX_DIMENSION} pixels per axis`);
      }
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      context.clearRect(0, 0, bitmap.width, bitmap.height);
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const alpha = new Uint8Array(canvas.width * canvas.height);
      for (let index = 0; index < alpha.length; index++) alpha[index] = pixels.data[index * 4 + 3]!;
      source = { width: canvas.width, height: canvas.height, alpha, pixels };
      previewButton.disabled = false;
      container.dataset.ready = "true";
      canvas.setAttribute("aria-label", `${canvas.width} by ${canvas.height} crown silhouette preview`);
      preview();
    } catch (error) {
      if (disposed || request !== decodeRequest) return;
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  };

  const invalidate = () => {
    if (!source) return;
    clearResult();
    drawPreview(null);
    status.textContent = "Fit inputs changed. Preview the bounded fit before applying.";
  };
  const fitInputs = [...center, ...dimensions, threshold, bands].map((entry) => entry.input);
  fileInput.addEventListener("change", onFileChange);
  for (const input of fitInputs) input.addEventListener("input", invalidate);
  previewButton.addEventListener("click", preview);
  applyButton.addEventListener("click", () => {
    if (!result) return;
    options.onApply(result);
    status.textContent = `Applied ${result.audit.bandCount} crown volumes; the fitted crown now persists through the existing URL and JSON authoring state.`;
  });
  closeButton.addEventListener("click", options.onClose);

  return {
    dispose: () => {
      disposed = true;
      decodeRequest++;
      container.replaceChildren();
      container.classList.remove("crown-mask-fit-editor");
      delete container.dataset.ready;
      delete container.dataset.fitHash;
      delete container.dataset.bandCount;
      delete container.dataset.foregroundPixels;
      delete container.dataset.depthPolicy;
    },
  };
};
