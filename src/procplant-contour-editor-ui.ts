import {
  applyProcPlantCutoutContourEdits,
  getProcPlantCutoutContourIds,
  simplifyProcPlantCutoutContour,
  validateProcPlantCutoutContours,
  type ProcPlantCutout,
  type ProcPlantCutoutContourEditResult,
  type ProcPlantCutoutPoint,
} from "./procplant-cutout";

export interface ProcPlantContourEditorDialogOptions {
  title?: string;
  /** Optional source raster URL shown beneath the editable silhouette. */
  backgroundUrl?: string;
}

export interface ProcPlantFreehandContourOptions {
  /** Minimum normalized distance between retained pointer samples. */
  minimumPointSpacing?: number;
  /** Ramer-Douglas-Peucker tolerance in normalized cutout units. */
  simplificationTolerance?: number;
  /** Minimum normalized polygon area accepted as an intentional contour. */
  minimumArea?: number;
}

const DEFAULT_FREEHAND_OPTIONS: Required<ProcPlantFreehandContourOptions> = {
  minimumPointSpacing: 0.008,
  simplificationTolerance: 0.004,
  minimumArea: 0.0001,
};

const polygonArea = (points: readonly ProcPlantCutoutPoint[]) => Math.abs(points.reduce((area, point, index) => {
  const next = points[(index + 1) % points.length]!;
  return area + point.x * next.y - next.x * point.y;
}, 0) * 0.5);

/**
 * Converts raw normalized pointer samples into a deterministic, implicitly
 * closed contour suitable for the immutable cutout edit API.
 */
export const finalizeProcPlantFreehandContourStroke = (
  input: readonly ProcPlantCutoutPoint[],
  options: ProcPlantFreehandContourOptions = {},
): ProcPlantCutoutPoint[] => {
  const resolved = { ...DEFAULT_FREEHAND_OPTIONS, ...options };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`);
  }
  if (resolved.minimumArea === 0) throw new Error("minimumArea must be greater than zero");

  const sampled: ProcPlantCutoutPoint[] = [];
  for (const point of input) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error("Drawn contour contains a non-finite point");
    }
    const prior = sampled[sampled.length - 1];
    if (!prior || Math.hypot(point.x - prior.x, point.y - prior.y) >= resolved.minimumPointSpacing) {
      sampled.push({ x: point.x, y: point.y });
    }
  }
  if (
    sampled.length > 1 &&
    Math.hypot(sampled[0]!.x - sampled[sampled.length - 1]!.x, sampled[0]!.y - sampled[sampled.length - 1]!.y) <
      resolved.minimumPointSpacing
  ) sampled.pop();
  if (sampled.length < 3) throw new Error("Draw at least three distinct contour points");

  const simplified = simplifyProcPlantCutoutContour(sampled, resolved.simplificationTolerance);
  if (simplified.length < 3) throw new Error("Draw at least three distinct contour points");
  const issues = validateProcPlantCutoutContours([simplified], ["drawn contour"]);
  if (issues.length > 0) throw new Error(`Invalid drawn contour: ${issues.map((issue) => issue.message).join("; ")}`);
  if (polygonArea(simplified) < resolved.minimumArea) {
    throw new Error("Drawn contour is too small; draw a larger closed shape");
  }
  return simplified;
};

const svgElement = <K extends keyof SVGElementTagNameMap>(tag: K) =>
  document.createElementNS("http://www.w3.org/2000/svg", tag);

const midpoint = (a: ProcPlantCutoutPoint, b: ProcPlantCutoutPoint): ProcPlantCutoutPoint => ({
  x: (a.x + b.x) * 0.5,
  y: (a.y + b.y) * 0.5,
});

/**
 * Opens a dependency-free point editor and resolves with a validated immutable
 * cutout, or null when cancelled. The heavy editor module can be dynamically
 * imported so normal plant generation does not pay its startup cost.
 */
export const openProcPlantContourEditor = (
  source: ProcPlantCutout,
  options: ProcPlantContourEditorDialogOptions = {},
): Promise<ProcPlantCutoutContourEditResult | null> => new Promise((resolve) => {
  const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let working: ProcPlantCutoutContourEditResult = {
    cutout: structuredClone(source),
    contourIds: getProcPlantCutoutContourIds(source),
    issues: [],
    operationsApplied: 0,
  };
  let activeContourId = working.contourIds[0]!;
  let activePointIndex = 0;
  let dragging: { pointerId: number; contourId: string; pointIndex: number } | null = null;
  let drawMode = false;
  let drawingStroke: { pointerId: number; points: ProcPlantCutoutPoint[] } | null = null;
  let feedback: { text: string; error: boolean } | null = null;

  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", options.title ?? "Edit cutout contour");
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", zIndex: "1000", display: "grid", placeItems: "center",
    padding: "1rem", background: "rgb(5 16 13 / 0.76)", backdropFilter: "blur(4px)",
  });
  const panel = document.createElement("section");
  Object.assign(panel.style, {
    width: "min(92vw, 760px)", maxHeight: "92vh", overflow: "auto", padding: "1rem",
    borderRadius: "14px", background: "#f5f2e8", color: "#17251f", boxShadow: "0 24px 80px rgb(0 0 0 / 0.45)",
  });
  const heading = document.createElement("h2");
  heading.textContent = options.title ?? "Edit cutout contour";
  heading.style.margin = "0 0 0.35rem";
  const help = document.createElement("p");
  help.textContent = "Drag a point, or select one and insert/delete. Boundaries may nest but cannot cross.";
  help.id = `procplant-contour-editor-help-${source.id}`;
  help.style.margin = "0 0 0.7rem";
  const svg = svgElement("svg");
  svg.setAttribute("viewBox", "0 0 1 1");
  svg.setAttribute("aria-label", "Editable cutout silhouette");
  svg.setAttribute("aria-describedby", help.id);
  svg.setAttribute("tabindex", "0");
  Object.assign(svg.style, {
    display: "block", width: "100%", aspectRatio: "1", maxHeight: "62vh", background: "#d9e4da",
    border: "1px solid #80988b", borderRadius: "10px", touchAction: "none",
  });
  if (options.backgroundUrl) {
    const image = svgElement("image");
    image.setAttribute("href", options.backgroundUrl);
    image.setAttribute("width", "1");
    image.setAttribute("height", "1");
    image.setAttribute("preserveAspectRatio", "none");
    image.setAttribute("opacity", "0.55");
    svg.append(image);
  }
  const drawing = svgElement("g");
  drawing.setAttribute("transform", "translate(0 1) scale(1 -1)");
  svg.append(drawing);
  const status = document.createElement("output");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  Object.assign(status.style, { display: "block", minHeight: "1.4em", margin: "0.55rem 0", color: "#6b3025" });
  const controls = document.createElement("div");
  Object.assign(controls.style, { display: "flex", flexWrap: "wrap", gap: "0.5rem" });
  const button = (label: string) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    Object.assign(element.style, {
      border: "1px solid #678072", borderRadius: "999px", padding: "0.5rem 0.8rem",
      background: "#fff", color: "inherit", cursor: "pointer",
    });
    controls.append(element);
    return element;
  };
  const drawButton = button("Draw contour");
  drawButton.setAttribute("aria-pressed", "false");
  const insertButton = button("Insert after point");
  const deletePointButton = button("Delete point");
  const deleteContourButton = button("Delete contour");
  const cancelButton = button("Cancel");
  const saveButton = button("Apply contour");
  saveButton.style.background = "#1f684c";
  saveButton.style.color = "white";
  panel.append(heading, help, svg, status, controls);
  overlay.append(panel);
  document.body.append(overlay);

  const currentContourIndex = () => working.contourIds.indexOf(activeContourId);
  const render = () => {
    drawing.replaceChildren();
    for (let contourIndex = 0; contourIndex < working.cutout.contours.length; contourIndex++) {
      const contour = working.cutout.contours[contourIndex]!;
      const contourId = working.contourIds[contourIndex]!;
      const polygon = svgElement("polygon");
      polygon.setAttribute("points", contour.map((point) => `${point.x},${point.y}`).join(" "));
      polygon.setAttribute("fill", contourId === activeContourId ? "rgb(44 136 95 / 0.28)" : "rgb(31 64 50 / 0.12)");
      polygon.setAttribute("stroke", contourId === activeContourId ? "#1c6d4b" : "#587065");
      polygon.setAttribute("stroke-width", "0.004");
      polygon.setAttribute("vector-effect", "non-scaling-stroke");
      polygon.addEventListener("pointerdown", () => {
        if (drawMode) return;
        activeContourId = contourId;
        activePointIndex = Math.min(activePointIndex, contour.length - 1);
        render();
      });
      drawing.append(polygon);
      for (let pointIndex = 0; pointIndex < contour.length; pointIndex++) {
        const point = contour[pointIndex]!;
        const handle = svgElement("circle");
        handle.setAttribute("cx", String(point.x));
        handle.setAttribute("cy", String(point.y));
        handle.setAttribute("r", contourId === activeContourId && pointIndex === activePointIndex ? "0.014" : "0.010");
        handle.setAttribute("fill", contourId === activeContourId && pointIndex === activePointIndex ? "#ffb02e" : "#f8faf4");
        handle.setAttribute("stroke", "#173f31");
        handle.setAttribute("stroke-width", "0.003");
        handle.setAttribute("vector-effect", "non-scaling-stroke");
        handle.style.cursor = "grab";
        handle.addEventListener("pointerdown", (event) => {
          if (drawMode) return;
          event.stopPropagation();
          activeContourId = contourId;
          activePointIndex = pointIndex;
          dragging = { pointerId: event.pointerId, contourId, pointIndex };
          svg.setPointerCapture(event.pointerId);
          render();
        });
        drawing.append(handle);
      }
    }
    if (drawingStroke && drawingStroke.points.length > 0) {
      const preview = svgElement("path");
      const [first, ...rest] = drawingStroke.points;
      preview.setAttribute(
        "d",
        `M ${first!.x} ${first!.y}${rest.map((point) => ` L ${point.x} ${point.y}`).join("")}${rest.length > 0 ? ` L ${first!.x} ${first!.y}` : ""}`,
      );
      preview.setAttribute("fill", rest.length > 1 ? "rgb(255 176 46 / 0.18)" : "none");
      preview.setAttribute("stroke", "#9b4f00");
      preview.setAttribute("stroke-width", "0.006");
      preview.setAttribute("stroke-dasharray", "0.012 0.008");
      preview.setAttribute("vector-effect", "non-scaling-stroke");
      preview.setAttribute("pointer-events", "none");
      drawing.append(preview);
    }
    const contourIndex = currentContourIndex();
    const pointCount = contourIndex >= 0 ? working.cutout.contours[contourIndex]!.length : 0;
    insertButton.disabled = drawMode;
    deletePointButton.disabled = drawMode || pointCount <= 3;
    deleteContourButton.disabled = drawMode || working.cutout.contours.length <= 1;
    saveButton.disabled = drawMode;
    drawButton.textContent = drawMode ? "Cancel drawing" : "Draw contour";
    drawButton.setAttribute("aria-pressed", String(drawMode));
    help.textContent = drawMode
      ? "Press and drag over the image to trace a closed contour. Release to apply it; boundaries may nest but cannot cross."
      : "Drag a point, or select one and insert/delete. Boundaries may nest but cannot cross.";
    const defaultStatus = drawMode
      ? drawingStroke
        ? `Drawing contour: ${drawingStroke.points.length} sampled point${drawingStroke.points.length === 1 ? "" : "s"}. Release to close it.`
        : "Draw mode active. Press and drag over the image, or choose Cancel drawing."
      : `${working.cutout.contours.length} contour${working.cutout.contours.length === 1 ? "" : "s"}; ${pointCount} points in selected contour.`;
    status.textContent = feedback?.text ?? defaultStatus;
    status.style.color = feedback?.error ? "#8b1f11" : "#31483d";
  };

  const pointFromPointer = (event: PointerEvent, clampToBounds = true): ProcPlantCutoutPoint => {
    const rect = svg.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(1, rect.width);
    const y = 1 - (event.clientY - rect.top) / Math.max(1, rect.height);
    return {
      x: clampToBounds ? Math.max(0, Math.min(1, x)) : x,
      y: clampToBounds ? Math.max(0, Math.min(1, y)) : y,
    };
  };
  const nextDrawnContourId = () => {
    let sequence = 1;
    let candidate = `${source.id}:drawn:${sequence}`;
    while (working.contourIds.includes(candidate)) {
      sequence++;
      candidate = `${source.id}:drawn:${sequence}`;
    }
    return candidate;
  };
  const cancelDrawing = (message = "Contour drawing cancelled.") => {
    if (drawingStroke && svg.hasPointerCapture(drawingStroke.pointerId)) {
      svg.releasePointerCapture(drawingStroke.pointerId);
    }
    drawingStroke = null;
    drawMode = false;
    feedback = { text: message, error: false };
    render();
    drawButton.focus();
  };
  svg.addEventListener("pointerdown", (event) => {
    if (!drawMode || drawingStroke || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = null;
    feedback = null;
    drawingStroke = { pointerId: event.pointerId, points: [pointFromPointer(event, false)] };
    svg.setPointerCapture(event.pointerId);
    render();
  }, { capture: true });
  svg.addEventListener("pointermove", (event) => {
    if (drawingStroke?.pointerId === event.pointerId) {
      event.preventDefault();
      const point = pointFromPointer(event, false);
      const prior = drawingStroke.points[drawingStroke.points.length - 1]!;
      if (Math.hypot(point.x - prior.x, point.y - prior.y) >= DEFAULT_FREEHAND_OPTIONS.minimumPointSpacing) {
        drawingStroke.points.push(point);
        feedback = null;
        render();
      }
      return;
    }
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    try {
      working = applyProcPlantCutoutContourEdits(working.cutout, [{
        kind: "move-point",
        contourId: dragging.contourId,
        pointIndex: dragging.pointIndex,
        point: pointFromPointer(event),
      }], { contourIds: working.contourIds });
      activeContourId = dragging.contourId;
      activePointIndex = dragging.pointIndex;
      feedback = null;
      render();
    } catch (error) {
      feedback = { text: error instanceof Error ? error.message : String(error), error: true };
      render();
    }
  });
  svg.addEventListener("pointerup", (event) => {
    if (drawingStroke?.pointerId === event.pointerId) {
      const rawPoints = [...drawingStroke.points, pointFromPointer(event, false)];
      drawingStroke = null;
      try {
        const points = finalizeProcPlantFreehandContourStroke(rawPoints);
        const contourId = nextDrawnContourId();
        working = applyProcPlantCutoutContourEdits(working.cutout, [{ kind: "add-contour", contourId, points }], {
          contourIds: working.contourIds,
        });
        activeContourId = contourId;
        activePointIndex = 0;
        drawMode = false;
        feedback = {
          text: `Added contour with ${points.length} vertices. Its island or hole role was rebuilt from containment.`,
          error: false,
        };
      } catch (error) {
        feedback = { text: error instanceof Error ? error.message : String(error), error: true };
      }
      render();
      if (!drawMode) drawButton.focus();
      return;
    }
    if (dragging?.pointerId === event.pointerId) dragging = null;
  });
  svg.addEventListener("pointercancel", (event) => {
    if (drawingStroke?.pointerId === event.pointerId) {
      drawingStroke = null;
      feedback = { text: "The pointer stroke was cancelled. Draw again or choose Cancel drawing.", error: true };
      render();
      return;
    }
    if (dragging?.pointerId === event.pointerId) dragging = null;
  });

  insertButton.addEventListener("click", () => {
    const contourIndex = currentContourIndex();
    if (contourIndex < 0) return;
    const contour = working.cutout.contours[contourIndex]!;
    const after = Math.min(activePointIndex, contour.length - 1);
    working = applyProcPlantCutoutContourEdits(working.cutout, [{
      kind: "insert-point",
      contourId: activeContourId,
      afterPointIndex: after,
      point: midpoint(contour[after]!, contour[(after + 1) % contour.length]!),
    }], { contourIds: working.contourIds });
    activePointIndex = after + 1;
    feedback = null;
    render();
  });
  deletePointButton.addEventListener("click", () => {
    const contourIndex = currentContourIndex();
    if (contourIndex < 0) return;
    working = applyProcPlantCutoutContourEdits(working.cutout, [{
      kind: "delete-point", contourId: activeContourId, pointIndex: activePointIndex,
    }], { contourIds: working.contourIds });
    activePointIndex = Math.max(0, activePointIndex - 1);
    feedback = null;
    render();
  });
  deleteContourButton.addEventListener("click", () => {
    const priorIndex = currentContourIndex();
    working = applyProcPlantCutoutContourEdits(working.cutout, [{
      kind: "delete-contour", contourId: activeContourId,
    }], { contourIds: working.contourIds });
    activeContourId = working.contourIds[Math.min(Math.max(0, priorIndex), working.contourIds.length - 1)]!;
    activePointIndex = 0;
    feedback = null;
    render();
  });
  drawButton.addEventListener("click", () => {
    if (drawMode) {
      cancelDrawing();
      return;
    }
    dragging = null;
    drawMode = true;
    feedback = { text: "Draw mode active. Press and drag over the image; release to close the contour.", error: false };
    render();
  });
  const finish = (result: ProcPlantCutoutContourEditResult | null) => {
    overlay.remove();
    resolve(result);
    if (priorFocus?.isConnected) priorFocus.focus();
  };
  cancelButton.addEventListener("click", () => finish(null));
  saveButton.addEventListener("click", () => finish(working));
  overlay.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (drawMode || drawingStroke) cancelDrawing();
    else finish(null);
  });
  render();
  saveButton.focus();
});
