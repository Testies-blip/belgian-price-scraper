/**
 * app.js — UI orchestration for the Photo → Embroidery DST converter
 */

'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const dropZone        = document.getElementById('drop-zone');
const fileInput       = document.getElementById('file-input');
const previewSection  = document.getElementById('preview-section');
const origCanvas      = document.getElementById('original-canvas');
const quantCanvas     = document.getElementById('quantized-canvas');
const swatchContainer = document.getElementById('palette-swatches');
const stitchCanvas    = document.getElementById('stitch-canvas');
const exportBtn       = document.getElementById('export-btn');
const statusEl        = document.getElementById('status');
const widthInput      = document.getElementById('width-mm');
const colorsInput     = document.getElementById('num-colors');
const densityInput    = document.getElementById('density-mm');
const stitchInput     = document.getElementById('stitch-mm');
const requestBox      = document.getElementById('request-box');
const requestInput    = document.getElementById('request-input');
const requestBtn      = document.getElementById('request-btn');
const requestFeedback = document.getElementById('request-feedback');
const angleInput      = document.getElementById('fill-angle');
const undoBtn         = document.getElementById('undo-btn');
const redoBtn         = document.getElementById('redo-btn');
const chipsContainer  = document.getElementById('chips');
const segStatus       = document.getElementById('seg-status');
const segIcon         = document.getElementById('seg-icon');
const segText         = document.getElementById('seg-text');
const segParts        = document.getElementById('seg-parts');
const eraseBtn        = document.getElementById('erase-btn');
const copyNeighborBtn = document.getElementById('copy-neighbor-btn');
const eraseOverlay    = document.getElementById('erase-overlay');
const soloBtn         = document.getElementById('solo-btn');
const layerNav        = document.getElementById('layer-nav');
const layerPrevBtn    = document.getElementById('layer-prev-btn');
const layerNextBtn    = document.getElementById('layer-next-btn');
const layerColorDot   = document.getElementById('layer-color-dot');
const layerColorName  = document.getElementById('layer-color-name');
const layerIndexLabel = document.getElementById('layer-index-label');
const zoomInBtn         = document.getElementById('zoom-in-btn');
const zoomOutBtn        = document.getElementById('zoom-out-btn');
const zoomLabel         = document.getElementById('zoom-label');
const stitchScrollWrap  = document.getElementById('stitch-scroll-wrap');
const stitchCanvasWrapEl = document.getElementById('stitch-canvas-wrap');
const drawBtn           = document.getElementById('draw-btn');
const drawPanel         = document.getElementById('draw-panel');
const drawColorRow      = document.getElementById('draw-color-row');
const stage1El           = document.getElementById('stage-1');
const stage2El           = document.getElementById('stage-2');
const convertBtn         = document.getElementById('convert-btn');
const backBtn            = document.getElementById('back-btn');
const stage1Bar          = document.getElementById('stage1-bar');
const selectAreaBtn      = document.getElementById('select-area-btn');
const selectOverlayEl    = document.getElementById('select-overlay');
const selectionPanel     = document.getElementById('selection-panel');
const selectionCount     = document.getElementById('selection-count');
const selectionColorRow  = document.getElementById('selection-color-row');
const selectionCancelBtn = document.getElementById('selection-cancel-btn');
const selectionEraseBtn  = document.getElementById('selection-erase-btn');
const selectionMergeBtn      = document.getElementById('selection-merge-btn');
const selectionSelectAllBtn  = document.getElementById('selection-select-all-btn');
const selectionGrowBtn       = document.getElementById('selection-grow-btn');
const selectionShrinkBtn     = document.getElementById('selection-shrink-btn');
const stitchInfoEl           = document.getElementById('stitch-info');
const brightnessInput        = document.getElementById('brightness-val');
const contrastInput          = document.getElementById('contrast-val');
const threadAngleRows        = document.getElementById('thread-angle-rows');
const moveStitchBtn          = document.getElementById('move-stitch-btn');
const lassoBtn               = document.getElementById('lasso-btn');
const lassoActionBar         = document.getElementById('lasso-action-bar');
const lassoEraseBtn          = document.getElementById('lasso-erase-btn');
const lassoCancelBtn         = document.getElementById('lasso-cancel-btn');
const lassoColorSwatches     = document.getElementById('lasso-color-swatches');
const watermarkRange         = document.getElementById('watermark-opacity');

// ── Body-part NLP patterns ────────────────────────────────────────────────────
// Built from BODY_ALIASES defined in bodyparts.js (loaded before app.js).
// Aliases are sorted longest-first so longer keys shadow shorter prefix matches.
const _PART_RE_FRAG = Object.keys(BODY_ALIASES)
  .sort((a, b) => b.length - a.length)
  .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
// Pattern A — colour count: "the pants of the man are to be 1 color"
const _REGION_COUNT_RE = new RegExp(
  '\\b(?:make\\s+)?(?:the\\s+)?(' + _PART_RE_FRAG + ')\\b' +
  '[^.!?]*?\\b(\\d+)\\s+colou?rs?\\b', 'i'
);
// Pattern B — colour name: "pants are blue" / "jacket should be green"
const _REGION_COLOR_RE = new RegExp(
  '\\b(?:the\\s+)?(' + _PART_RE_FRAG + ')\\s+' +
  '(?:are?|is|should\\s+be|in|to\\s+be)\\s+' +
  '(?!\\d)([a-z]+(?:\\s+[a-z]+)?)', 'i'
);

// ── State ─────────────────────────────────────────────────────────────────────
let loadedImage     = null;   // HTMLImageElement
let currentFile     = null;   // File object (for filename)
let lastQuantResult = null;   // { palette, indexMap, width, height } cached after quantize
let lastSegResult   = null;   // SegmentResult from segmenter.js (or null)
let _segGeneration  = 0;      // incremented each time segmentation is kicked off
let skipColors      = new Set();  // color indices excluded from stitching
let outlineOnly     = false;      // stitch outlines instead of fills
let eraseAreaMode     = false;    // true while the drag-to-erase tool is active
let lassoMode         = false;    // true while the freehand lasso-erase tool is active
let _lassoDrag        = null;     // { points:[], rect, scaleX, scaleY } while drawing
let _lassoSelection   = null;     // finalized polygon points waiting for action
let copyNeighborMode  = false;    // true while the fill-neighbor tool is active
let _eraseDrag        = null;     // { startX, startY, rect, scaleX, scaleY } while dragging
let soloLayer         = null;     // null = show all layers; palette index = show only that layer
let zoomLevel         = 1.0;     // current zoom; one of ZOOM_STEPS
const ZOOM_STEPS      = [1, 1.5, 2, 3, 4];
let currentStage      = 1;       // 1 = Picture Enhancer, 2 = Stitch Converter
let selectAreaMode    = false;   // true while the flood-fill select tool is active
let selectedPixels    = null;    // Set<number> of selected pixel indices, or null
let mergeMode         = false;   // true while waiting for user to click a merge-target region
let lockedColors      = new Set(); // palette indices excluded from NLP / requantize recoloring
// Image pre-processing (applied in buildWorkingCanvas before quantize)
let brightnessAdjust  = 100;    // 50-150; 100 = neutral
let contrastAdjust    = 100;    // 50-150; 100 = neutral
let sharpness         = 0;      // -1 = blur, 0 = neutral, +1 = sharpen
let depixelateLevel   = 0;      // 0=off 1=light 2=medium 3=heavy — scale-down/up to remove pixel grid
let flipH             = false;
let flipV             = false;
let rotateCW          = 0;      // 0,1,2,3 × 90° clockwise
// Per-color stitch angle (Stage 2); keys are palette indices, values are degrees
let colorAngles       = {};
let colorFillTypes    = {};     // paletteIndex → 'satin'|'cross'|'outline' per-color fill type
// Thread catalog snapping
let threadSnap        = null;   // null or array of {code,name,r,g,b} — snapped threads
// Stitch preview overlays
let watermarkOpacity  = 0;      // 0–50 — opacity % of original image drawn under stitches
let lastWorkingCanvas = null;   // canvas after buildWorkingCanvas (for watermark alignment)
// Stitch records cache (enables move-stitch tool)
let lastStitchRecords = null;
let lastColorOrder    = null;
let moveMode          = false;
let _moveDrag         = null;   // { stitchIdx } while dragging
let drawMode          = false;    // true while draw/paint tool is active
let drawPaintColor    = 0;        // palette index to paint (255 = erase)
let drawBrushSize     = 1;        // brush square side: 1, 3 or 5 px
let _drawDrag         = null;     // { rect, scaleX, scaleY, erasing, prevX, prevY } while drawing

// ── Undo / redo state ─────────────────────────────────────────────────────────
const MAX_UNDO  = 20;
const undoStack = [];
const redoStack = [];

// ── Drop zone wiring ──────────────────────────────────────────────────────────
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
fileInput.addEventListener('change', e => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && (file.type === 'image/jpeg' || file.type === 'image/png')) {
    handleFile(file);
  } else {
    setStatus('Please drop a JPG or PNG file.', 'error');
  }
});

// ── Export button ─────────────────────────────────────────────────────────────
exportBtn.addEventListener('click', runExport);

// ── Stage navigation ───────────────────────────────────────────────────────────
convertBtn.addEventListener('click', enterStage2);
backBtn.addEventListener('click', enterStage1);

function renderThreadPanel() {
  if (!lastQuantResult) return;
  const { palette, colorNames = [] } = lastQuantResult;
  threadAngleRows.innerHTML = '';
  palette.forEach(([r, g, b], i) => {
    if (skipColors.has(i)) return;
    const row = document.createElement('div');
    row.className = 'thread-angle-row';
    const angle = colorAngles[i] !== undefined ? colorAngles[i] : '';
    const snap  = threadSnap ? threadSnap[i] : null;
    const ft = colorFillTypes[i] || 'satin';
    row.innerHTML = `
      <span class="thread-angle-swatch" style="background:rgb(${r},${g},${b})"></span>
      <span class="thread-angle-name">${snap ? `${snap.code} ${snap.name}` : (colorNames[i] || `Color ${i + 1}`)}</span>
      <input type="number" class="thread-angle-input" value="${angle}"
             min="0" max="89" step="15" placeholder="—"
             data-angle-idx="${i}" title="Fill angle for this thread (leave blank to use global)">
      <span class="thread-angle-label">°</span>
      <div class="thread-fill-btns">
        <button class="thread-fill-btn${ft==='satin'?' active':''}" data-fill-idx="${i}" data-fill-type="satin" title="Satin fill (parallel rows)">&#8801;</button>
        <button class="thread-fill-btn${ft==='cross'?' active':''}" data-fill-idx="${i}" data-fill-type="cross" title="Cross-hatch fill (two directions)">&#8862;</button>
        <button class="thread-fill-btn${ft==='outline'?' active':''}" data-fill-idx="${i}" data-fill-type="outline" title="Outline only">&#9633;</button>
      </div>`;
    threadAngleRows.appendChild(row);
  });
}

function enterStage2() {
  currentStage = 2;
  stage1El.classList.add('hidden');
  stage2El.classList.remove('hidden');
  renderThreadPanel();
  updateStitchPreview();
  exportBtn.disabled       = !lastQuantResult;
  eraseBtn.disabled        = !lastQuantResult;
  copyNeighborBtn.disabled = !lastQuantResult;
  soloBtn.disabled         = !lastQuantResult;
  drawBtn.disabled         = !lastQuantResult;
  moveStitchBtn.disabled   = !lastQuantResult;
  lassoBtn.disabled        = !lastQuantResult;
  applyZoom();
}

function enterStage1() {
  currentStage = 1;
  stage2El.classList.add('hidden');
  stage1El.classList.remove('hidden');
  // Deactivate all canvas tools so they don't linger on re-entry
  if (eraseAreaMode || copyNeighborMode) {
    eraseAreaMode    = false;
    copyNeighborMode = false;
    eraseBtn.classList.remove('active');
    copyNeighborBtn.classList.remove('active');
    clearEraseOverlay();
    _eraseDrag = null;
  }
  if (drawMode) {
    drawMode = false;
    drawBtn.classList.remove('active');
    drawPanel.classList.add('hidden');
    _drawDrag = null;
    eraseOverlay.classList.remove('active');
  }
  if (soloLayer !== null) {
    soloLayer = null;
    soloBtn.classList.remove('active');
    layerNav.classList.add('hidden');
  }
}

// ── File handling ─────────────────────────────────────────────────────────────
function handleFile(file) {
  currentFile = file;
  // Always return to stage 1 when a new file is loaded
  if (currentStage === 2) {
    currentStage = 1;
    stage2El.classList.add('hidden');
    stage1El.classList.remove('hidden');
  }
  stage1Bar.classList.add('hidden');
  convertBtn.disabled = true;
  exportBtn.disabled = true;
  selectAreaMode = false;
  selectAreaBtn.classList.remove('active');
  selectedPixels = null;
  selectionPanel.classList.add('hidden');
  selectOverlayEl.classList.remove('active');
  selectAreaBtn.disabled = true;
  skipColors.clear();
  lockedColors.clear();
  outlineOnly = false;
  brightnessAdjust = 100; brightnessInput.value = 100;
  contrastAdjust   = 100; contrastInput.value   = 100;
  sharpness = 0; depixelateLevel = 0;
  flipH = false; flipV = false; rotateCW = 0;
  colorAngles = {}; colorFillTypes = {}; threadSnap = null;
  watermarkOpacity = 0; if (watermarkRange) watermarkRange.value = 0;
  lastStitchRecords = null; lastColorOrder = null;
  lastSegResult = null;
  segStatus.classList.add('hidden');
  eraseAreaMode    = false;
  copyNeighborMode = false;
  eraseBtn.classList.remove('active');
  copyNeighborBtn.classList.remove('active');
  eraseOverlay.classList.remove('active');
  _eraseDrag = null;
  clearEraseOverlay();
  soloLayer = null;
  soloBtn.classList.remove('active');
  layerNav.classList.add('hidden');
  soloBtn.disabled = true;
  zoomLevel = 1.0;
  stitchCanvasWrapEl.style.width = '';
  zoomLabel.textContent = '100%';
  zoomInBtn.disabled  = true;
  zoomOutBtn.disabled = true;
  drawMode = false;
  drawBtn.classList.remove('active');
  drawPanel.classList.add('hidden');
  drawBtn.disabled = true;
  lassoMode = false;
  lassoBtn.classList.remove('active');
  lassoBtn.disabled = true;
  _lassoDrag = null;
  _lassoSelection = null;
  lassoActionBar.classList.add('hidden');
  _drawDrag = null;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      loadedImage = img;
      renderOriginal(img);
      runQuantize(img);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Area-select tool ──────────────────────────────────────────────────────────

selectAreaBtn.addEventListener('click', () => {
  selectAreaMode = !selectAreaMode;
  selectAreaBtn.classList.toggle('active', selectAreaMode);
  selectOverlayEl.classList.toggle('active', selectAreaMode || selectedPixels !== null);
  if (!selectAreaMode) clearSelection();
});

selectionCancelBtn.addEventListener('click', () => {
  selectAreaMode = false;
  selectAreaBtn.classList.remove('active');
  clearSelection();
});

selectionEraseBtn.addEventListener('click', () => {
  if (!selectedPixels || !lastQuantResult) return;
  pushUndo();
  const { indexMap } = lastQuantResult;
  for (const idx of selectedPixels) { indexMap[idx] = 255; }
  const n = selectedPixels.size;
  const { palette, width, height, colorNames = [] } = lastQuantResult;
  drawQuantizedPreview(palette, indexMap, width, height, skipColors);
  renderSwatches(palette, indexMap, skipColors, colorNames);
  clearSelection();
  setStatus(`Erased ${n.toLocaleString()} pixel${n !== 1 ? 's' : ''} — Ctrl+Z to undo`);
});

selectionMergeBtn.addEventListener('click', () => {
  if (!selectedPixels || !lastQuantResult) return;
  mergeMode = !mergeMode;
  selectionMergeBtn.classList.toggle('active', mergeMode);
  if (mergeMode) {
    setStatus('Click any region to recolor all its pixels to match the selected area\u2019s color');
  } else {
    setStatus(`${selectedPixels.size.toLocaleString()} pixel${selectedPixels.size !== 1 ? 's' : ''} selected`);
  }
});

/**
 * Click on the select overlay to flood-fill select a connected same-color region,
 * or (in merge mode) recolor all pixels of the clicked color to the selection's color.
 */
selectOverlayEl.addEventListener('click', e => {
  if (!selectAreaMode || !lastQuantResult) return;
  const rect = selectOverlayEl.getBoundingClientRect();
  const { indexMap, width, height, palette, colorNames = [] } = lastQuantResult;
  const px = Math.floor((e.clientX - rect.left) * (width  / rect.width));
  const py = Math.floor((e.clientY - rect.top)  * (height / rect.height));
  if (px < 0 || py < 0 || px >= width || py >= height) return;
  const clickedColor = indexMap[py * width + px];
  if (clickedColor === 255) return;  // transparent — nothing to act on

  if (mergeMode && selectedPixels) {
    // Find the color of the selected region (the first selected pixel's color index)
    const firstIdx = selectedPixels.values().next().value;
    const targetColorIdx = indexMap[firstIdx];
    if (clickedColor === targetColorIdx) {
      // Clicked same color — exit merge mode
      mergeMode = false;
      selectionMergeBtn.classList.remove('active');
      return;
    }
    pushUndo();
    let changed = 0;
    for (let i = 0; i < indexMap.length; i++) {
      if (indexMap[i] === clickedColor) { indexMap[i] = targetColorIdx; changed++; }
    }
    const srcLabel  = colorNames[clickedColor]  || `color ${clickedColor + 1}`;
    const destLabel = colorNames[targetColorIdx] || `color ${targetColorIdx + 1}`;
    drawQuantizedPreview(palette, indexMap, width, height, skipColors);
    renderSwatches(palette, indexMap, skipColors, colorNames);
    // Update the selection overlay because the indexMap changed
    selectedPixels = floodFill(
      firstIdx % width, (firstIdx / width) | 0, targetColorIdx, indexMap, width, height
    );
    drawSelectionOverlay();
    updateSelectionPanel();
    mergeMode = false;
    selectionMergeBtn.classList.remove('active');
    setStatus(`Merged ${srcLabel} into ${destLabel} (${changed.toLocaleString()} px) — Ctrl+Z to undo`);
    return;
  }

  selectedPixels = floodFill(px, py, clickedColor, indexMap, width, height);
  drawSelectionOverlay();
  selectionPanel.classList.remove('hidden');
  updateSelectionPanel();
  mergeMode = false;
  selectionMergeBtn.classList.remove('active');
  setStatus(`${selectedPixels.size.toLocaleString()} pixel${selectedPixels.size !== 1 ? 's' : ''} selected`);
});

/**
 * Recolor all selected pixels to newColorIdx, then clear the selection.
 */
function applyRecolorSelection(newColorIdx) {
  if (!selectedPixels || !lastQuantResult) return;
  pushUndo();
  const { indexMap, palette, width, height, colorNames = [] } = lastQuantResult;
  for (const idx of selectedPixels) { indexMap[idx] = newColorIdx; }
  const n = selectedPixels.size;
  const colorLabel = (lastQuantResult.colorNames || [])[newColorIdx] || `color ${newColorIdx + 1}`;
  drawQuantizedPreview(palette, indexMap, width, height, skipColors);
  renderSwatches(palette, indexMap, skipColors, colorNames);
  clearSelection();
  setStatus(`Recolored ${n.toLocaleString()} pixel${n !== 1 ? 's' : ''} to ${colorLabel} — Ctrl+Z to undo`);
}

/**
 * Clear the active selection: hide overlay and panel, reset state.
 */
function clearSelection() {
  selectedPixels = null;
  mergeMode = false;
  selectionMergeBtn.classList.remove('active');
  selectionPanel.classList.add('hidden');
  selectOverlayEl.classList.toggle('active', selectAreaMode);
  const ctx = selectOverlayEl.getContext('2d');
  ctx.clearRect(0, 0, selectOverlayEl.width, selectOverlayEl.height);
}

/**
 * Draw a semi-transparent dark mask over all non-selected pixels so the
 * selection stands out against the rest of the quantized preview.
 */
function drawSelectionOverlay() {
  if (!selectedPixels || !lastQuantResult) return;
  const { width, height } = lastQuantResult;
  selectOverlayEl.width  = width;
  selectOverlayEl.height = height;
  const ctx  = selectOverlayEl.getContext('2d');
  const data = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    if (!selectedPixels.has(i)) {
      data.data[i * 4 + 3] = 130;   // semi-transparent black dims unselected pixels
    }
  }
  ctx.putImageData(data, 0, 0);
  selectOverlayEl.classList.add('active');
}

/**
 * Rebuild the recolor swatch row and pixel-count label in the selection panel.
 */
function updateSelectionPanel() {
  if (!lastQuantResult || !selectedPixels) return;
  const { palette, colorNames = [] } = lastQuantResult;
  selectionCount.textContent = `${selectedPixels.size.toLocaleString()} px selected`;
  selectionColorRow.innerHTML = '';
  palette.forEach(([r, g, b], i) => {
    const el = document.createElement('span');
    el.className = 'selection-color-swatch';
    el.style.background = `rgb(${r},${g},${b})`;
    el.title = (colorNames[i] || `Color ${i + 1}`) + ' — click to recolor selection';
    el.addEventListener('click', () => applyRecolorSelection(i));
    selectionColorRow.appendChild(el);
  });
}

// ── Selection grow / shrink / select-all ──────────────────────────────────────

selectionSelectAllBtn.addEventListener('click', () => {
  if (!selectedPixels || !lastQuantResult) return;
  const { indexMap, width, height } = lastQuantResult;
  const firstIdx = selectedPixels.values().next().value;
  const targetColor = indexMap[firstIdx];
  const all = new Set();
  for (let p = 0; p < indexMap.length; p++) {
    if (indexMap[p] === targetColor) all.add(p);
  }
  selectedPixels = all;
  drawSelectionOverlay();
  updateSelectionPanel();
  setStatus(`All ${all.size.toLocaleString()} px of that color selected`);
});

selectionGrowBtn.addEventListener('click', () => {
  if (!selectedPixels || !lastQuantResult) return;
  const { indexMap, width, height } = lastQuantResult;
  const grown = new Set(selectedPixels);
  for (const idx of selectedPixels) {
    const x = idx % width, y = (idx / width) | 0;
    if (x > 0          && indexMap[idx - 1]     !== 255) grown.add(idx - 1);
    if (x < width - 1  && indexMap[idx + 1]     !== 255) grown.add(idx + 1);
    if (y > 0          && indexMap[idx - width]  !== 255) grown.add(idx - width);
    if (y < height - 1 && indexMap[idx + width]  !== 255) grown.add(idx + width);
  }
  selectedPixels = grown;
  drawSelectionOverlay();
  updateSelectionPanel();
  setStatus(`Grew selection to ${grown.size.toLocaleString()} px`);
});

selectionShrinkBtn.addEventListener('click', () => {
  if (!selectedPixels || !lastQuantResult) return;
  const { indexMap, width, height } = lastQuantResult;
  // Remove pixels that have any non-selected 4-neighbour
  const shrunk = new Set();
  for (const idx of selectedPixels) {
    const x = idx % width, y = (idx / width) | 0;
    const allIn = (x === 0          || selectedPixels.has(idx - 1))
               && (x === width - 1  || selectedPixels.has(idx + 1))
               && (y === 0          || selectedPixels.has(idx - width))
               && (y === height - 1 || selectedPixels.has(idx + width));
    if (allIn) shrunk.add(idx);
  }
  selectedPixels = shrunk;
  drawSelectionOverlay();
  updateSelectionPanel();
  setStatus(`Shrunk selection to ${shrunk.size.toLocaleString()} px`);
});

/**
 * Iterative flood fill (4-connected). Returns a Set of pixel indices.
 */
function floodFill(startX, startY, targetColor, indexMap, width, height) {
  const selected = new Set();
  const visited  = new Uint8Array(width * height);
  const stack    = [startY * width + startX];
  while (stack.length > 0) {
    const idx = stack.pop();
    if (visited[idx]) continue;
    visited[idx] = 1;
    if (indexMap[idx] !== targetColor) continue;
    selected.add(idx);
    const x = idx % width, y = (idx / width) | 0;
    if (x > 0)          stack.push(idx - 1);
    if (x < width - 1)  stack.push(idx + 1);
    if (y > 0)          stack.push(idx - width);
    if (y < height - 1) stack.push(idx + width);
  }
  return selected;
}

// ── Rendering helpers ─────────────────────────────────────────────────────────

function renderOriginal(img) {
  const MAX = 300;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  origCanvas.width  = Math.round(img.width  * scale);
  origCanvas.height = Math.round(img.height * scale);
  origCanvas.getContext('2d').drawImage(img, 0, 0, origCanvas.width, origCanvas.height);
}

function runQuantize(img) {
  setStatus('Quantizing…');
  convertBtn.disabled      = true;
  exportBtn.disabled       = true;
  selectAreaBtn.disabled   = true;
  eraseBtn.disabled        = true;
  copyNeighborBtn.disabled = true;
  soloBtn.disabled         = true;
  zoomInBtn.disabled       = true;
  zoomOutBtn.disabled      = true;
  drawBtn.disabled         = true;
  lassoBtn.disabled        = true;
  // Exit solo mode — palette/layout may change after re-quantize
  soloLayer = null;
  soloBtn.classList.remove('active');
  layerNav.classList.add('hidden');

  setTimeout(() => {
    try {
      const { canvas } = buildWorkingCanvas(img);
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const k = clampInt(Number(colorsInput.value), 2, 16);

      let { palette, indexMap } = quantizeImage(imageData, k);

      // Smooth out anti-alias noise; depixelate levels get many extra passes
      const totalSmooth = depixelateLevel > 0 ? depixelateLevel * 4 : 1;
      for (let p = 0; p < totalSmooth; p++) {
        indexMap = smoothIndexMap(indexMap, canvas.width, canvas.height, k);
      }

      // Auto-detect and skip the background when image is freshly loaded.
      // We only do this when skipColors is currently empty (i.e. the user hasn't
      // manually changed it yet), so explicit "restore background" still works.
      if (skipColors.size === 0) {
        const bgIdx = detectBgColor(indexMap, canvas.width, canvas.height, k);
        const bgCount = indexMap.reduce((n, c) => n + (c === bgIdx ? 1 : 0), 0);
        const total   = indexMap.reduce((n, c) => n + (c < k     ? 1 : 0), 0);
        // Auto-skip only when the corner color covers ≥25 % of all opaque pixels
        if (total > 0 && bgCount / total >= 0.25) skipColors.add(bgIdx);
      }

      const colorNames = palette.map(namedColorOf);
      lastQuantResult = { palette, indexMap, width: canvas.width, height: canvas.height, colorNames };

      drawQuantizedPreview(palette, indexMap, canvas.width, canvas.height, skipColors);
      renderSwatches(palette, indexMap, skipColors, colorNames);

      previewSection.classList.remove('hidden');
      requestBox.classList.remove('hidden');
      stage1Bar.classList.remove('hidden');
      convertBtn.disabled = false;
      // Clear any stale selection — indexMap just changed
      selectedPixels = null;
      selectionPanel.classList.add('hidden');
      selectOverlayEl.classList.toggle('active', selectAreaMode);
      selectOverlayEl.getContext('2d').clearRect(0, 0, selectOverlayEl.width, selectOverlayEl.height);
      selectAreaBtn.disabled = false;
      if (drawMode) updateDrawPanel();
      setStatus(`Ready — ${palette.length} colors, ${canvas.width}×${canvas.height} px working size`);
      lastSegResult = null;          // invalidate any stale segmentation from previous quantize
      triggerSegmentation(canvas);   // async, non-blocking
    } catch (err) {
      setStatus('Error: ' + err.message, 'error');
    }
  }, 20);
}

/**
 * 3×3 majority-vote smoothing: replace each pixel's color with the most
 * common color in its 3×3 neighbourhood. Removes 1-pixel anti-alias speckles.
 */
function smoothIndexMap(indexMap, width, height, k) {
  const out = new Uint8Array(indexMap.length);
  const counts = new Int32Array(k + 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ci = indexMap[y * width + x];
      if (ci >= k) { out[y * width + x] = 255; continue; }
      counts.fill(0);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
          const nc = indexMap[ny * width + nx];
          if (nc < k) counts[nc]++;
        }
      }
      let best = ci, bestCount = 0;
      for (let c = 0; c < k; c++) {
        if (counts[c] > bestCount) { bestCount = counts[c]; best = c; }
      }
      out[y * width + x] = best;
    }
  }
  return out;
}

/**
 * Find all 4-connected regions smaller than `threshold` pixels and
 * reassign each to the most common color among its immediate border neighbors.
 */
function mergeSmallRegions(indexMap, width, height, k, threshold) {
  const out = new Uint8Array(indexMap);
  const visited = new Uint8Array(indexMap.length);
  for (let start = 0; start < indexMap.length; start++) {
    if (visited[start] || indexMap[start] >= k) { visited[start] = 1; continue; }
    // BFS to find the connected component
    const color = indexMap[start];
    const region = [];
    const queue = [start];
    while (queue.length) {
      const idx = queue.pop();
      if (visited[idx]) continue;
      visited[idx] = 1;
      if (indexMap[idx] !== color) continue;
      region.push(idx);
      const x = idx % width, y = (idx / width) | 0;
      if (x > 0)          queue.push(idx - 1);
      if (x < width - 1)  queue.push(idx + 1);
      if (y > 0)          queue.push(idx - width);
      if (y < height - 1) queue.push(idx + width);
    }
    if (region.length >= threshold) continue;
    // Find dominant border color
    const neighborCount = new Int32Array(k);
    for (const idx of region) {
      const x = idx % width, y = (idx / width) | 0;
      const neighbors = [];
      if (x > 0)          neighbors.push(idx - 1);
      if (x < width - 1)  neighbors.push(idx + 1);
      if (y > 0)          neighbors.push(idx - width);
      if (y < height - 1) neighbors.push(idx + width);
      for (const n of neighbors) {
        const nc = indexMap[n];
        if (nc < k && nc !== color) neighborCount[nc]++;
      }
    }
    let bestColor = color, bestCount = 0;
    for (let c = 0; c < k; c++) {
      if (neighborCount[c] > bestCount) { bestCount = neighborCount[c]; bestColor = c; }
    }
    for (const idx of region) out[idx] = bestColor;
  }
  return out;
}

function buildWorkingCanvas(img) {
  const targetMm  = Math.max(10, Math.min(500, Number(widthInput.value) || 100));
  const PX_PER_MM = 5;
  const scale     = (targetMm * PX_PER_MM) / Math.max(img.width, img.height);
  // Scaled source dimensions (before rotation)
  const imgW = Math.round(img.width  * scale);
  const imgH = Math.round(img.height * scale);
  // Output dimensions swap when rotated 90° or 270°
  const needsSwap = rotateCW % 2 === 1;
  const w = needsSwap ? imgH : imgW;
  const h = needsSwap ? imgW : imgH;

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Apply flip + rotate transforms centered on the output canvas
  ctx.save();
  ctx.translate(w / 2, h / 2);
  if (rotateCW) ctx.rotate(rotateCW * Math.PI / 2);
  if (flipH) ctx.scale(-1, 1);
  if (flipV) ctx.scale(1, -1);
  ctx.drawImage(img, -imgW / 2, -imgH / 2, imgW, imgH);
  ctx.restore();

  // Apply brightness / contrast
  if (brightnessAdjust !== 100 || contrastAdjust !== 100) {
    const id = ctx.getImageData(0, 0, w, h);
    applyBrightnessContrast(id.data, brightnessAdjust, contrastAdjust);
    ctx.putImageData(id, 0, 0);
  }
  // Apply sharpen or blur (single pass from chip)
  if (sharpness !== 0) {
    const id = ctx.getImageData(0, 0, w, h);
    const out = applyConvolution(id.data, w, h, sharpness > 0 ? SHARPEN_KERNEL : BLUR_KERNEL);
    ctx.putImageData(new ImageData(out, w, h), 0, 0);
  }
  // Depixelate: scale down to stitch-grid resolution then smooth-upscale.
  // This completely eliminates the pixel-grid pattern regardless of stitch size.
  if (depixelateLevel > 0) {
    const blockSize = [0, 4, 6, 8][depixelateLevel];  // px per stitch at each level
    const sw = Math.max(4, Math.round(w / blockSize));
    const sh = Math.max(4, Math.round(h / blockSize));
    const small = document.createElement('canvas');
    small.width = sw; small.height = sh;
    const sCtx = small.getContext('2d');
    sCtx.imageSmoothingEnabled = true;
    sCtx.imageSmoothingQuality = 'high';
    sCtx.drawImage(canvas, 0, 0, sw, sh);     // average-down
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, w, h);          // smooth-upscale
  }

  lastWorkingCanvas = canvas;
  return { canvas, w, h };
}

// ── Image filter helpers ──────────────────────────────────────────────────────

const SHARPEN_KERNEL = [0, -1, 0, -1, 5, -1, 0, -1, 0];
const BLUR_KERNEL    = [1,  1, 1,  1, 1,  1, 1,  1, 1];   // divided by 9 inside fn

function applyBrightnessContrast(data, brightness, contrast) {
  const bDelta  = brightness - 100;
  const cFactor = contrast / 100;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = data[i + c];
      v = (v - 128) * cFactor + 128 + bDelta;
      data[i + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
}

function applyConvolution(data, w, h, kernel) {
  const out  = new Uint8ClampedArray(data.length);
  const kDiv = kernel.reduce((a, b) => a + b, 0) || 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const nx = Math.max(0, Math.min(w - 1, x + kx));
          const ny = Math.max(0, Math.min(h - 1, y + ky));
          const k  = kernel[(ky + 1) * 3 + (kx + 1)];
          const bi = (ny * w + nx) * 4;
          r += data[bi]     * k;
          g += data[bi + 1] * k;
          b += data[bi + 2] * k;
        }
      }
      const oi = (y * w + x) * 4;
      out[oi]     = Math.max(0, Math.min(255, Math.round(r / kDiv)));
      out[oi + 1] = Math.max(0, Math.min(255, Math.round(g / kDiv)));
      out[oi + 2] = Math.max(0, Math.min(255, Math.round(b / kDiv)));
      out[oi + 3] = data[oi + 3];
    }
  }
  return out;
}

function drawQuantizedPreview(palette, indexMap, w, h, skippedColors) {
  quantCanvas.width = w; quantCanvas.height = h;
  const ctx = quantCanvas.getContext('2d');
  const out = ctx.createImageData(w, h);
  for (let i = 0; i < indexMap.length; i++) {
    const ci = indexMap[i];
    if (ci === 255 || skippedColors.has(ci)) {
      // transparent or skipped → light gray checkerboard feel
      const checker = (Math.floor(i / w) + (i % w)) % 2 === 0 ? 220 : 200;
      out.data[i*4] = checker; out.data[i*4+1] = checker;
      out.data[i*4+2] = checker; out.data[i*4+3] = 255;
    } else {
      const [r, g, b] = palette[ci];
      out.data[i*4] = r; out.data[i*4+1] = g;
      out.data[i*4+2] = b; out.data[i*4+3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

// ── Thread catalog (Madeira Classic Polyester — curated subset) ──────────────
const MADEIRA_THREADS = [
  {code:'1000',name:'White',          r:255,g:255,b:255},
  {code:'1001',name:'Ecru',           r:242,g:232,b:210},
  {code:'1070',name:'Pale Yellow',    r:255,g:245,b:160},
  {code:'0114',name:'Yellow',         r:255,g:220,b:0  },
  {code:'0163',name:'Deep Yellow',    r:235,g:185,b:0  },
  {code:'0402',name:'Orange',         r:245,g:130,b:32 },
  {code:'0334',name:'Dark Orange',    r:210,g:80, b:10 },
  {code:'1308',name:'Salmon',         r:250,g:175,b:150},
  {code:'0811',name:'Light Pink',     r:255,g:190,b:200},
  {code:'0503',name:'Pink',           r:240,g:120,b:160},
  {code:'0508',name:'Hot Pink',       r:230,g:30, b:120},
  {code:'0600',name:'Red',            r:210,g:15, b:30 },
  {code:'0511',name:'Dark Red',       r:160,g:15, b:30 },
  {code:'0602',name:'Crimson',        r:185,g:10, b:60 },
  {code:'0709',name:'Burgundy',       r:120,g:10, b:50 },
  {code:'0808',name:'Mauve',          r:185,g:100,b:130},
  {code:'0906',name:'Lavender',       r:195,g:165,b:215},
  {code:'0910',name:'Purple',         r:130,g:60, b:170},
  {code:'0712',name:'Dark Purple',    r:80, g:20, b:120},
  {code:'1003',name:'Sky Blue',       r:160,g:210,b:245},
  {code:'1014',name:'Light Blue',     r:100,g:165,b:220},
  {code:'1005',name:'Blue',           r:30, g:100,b:190},
  {code:'1006',name:'Royal Blue',     r:15, g:55, b:170},
  {code:'1008',name:'Dark Blue',      r:10, g:30, b:130},
  {code:'1015',name:'Navy',           r:10, g:20, b:80 },
  {code:'1703',name:'Turquoise',      r:0,  g:185,b:210},
  {code:'1307',name:'Teal',           r:0,  g:130,b:140},
  {code:'1607',name:'Mint',           r:160,g:230,b:200},
  {code:'1502',name:'Light Green',    r:115,g:200,b:120},
  {code:'1305',name:'Green',          r:30, g:160,b:70 },
  {code:'1304',name:'Dark Green',     r:15, g:100,b:40 },
  {code:'1406',name:'Olive',          r:100,g:130,b:30 },
  {code:'1408',name:'Dark Olive',     r:70, g:90, b:20 },
  {code:'1912',name:'Khaki',          r:185,g:170,b:120},
  {code:'2011',name:'Tan',            r:200,g:160,b:100},
  {code:'2014',name:'Light Brown',    r:185,g:130,b:80 },
  {code:'2102',name:'Brown',          r:145,g:85, b:40 },
  {code:'2101',name:'Dark Brown',     r:95, g:50, b:20 },
  {code:'1911',name:'Beige',          r:225,g:205,b:165},
  {code:'1913',name:'Sand',           r:210,g:190,b:140},
  {code:'1910',name:'Silver',         r:190,g:190,b:195},
  {code:'1909',name:'Gray',           r:135,g:135,b:140},
  {code:'1908',name:'Dark Gray',      r:80, g:80, b:85 },
  {code:'1000B',name:'Black',         r:15, g:15, b:15 },
];

/**
 * For each palette color, find the nearest Madeira thread by Euclidean RGB distance.
 * Returns an array (same length as palette) of matched thread objects.
 */
function snapPaletteToThreads(palette) {
  return palette.map(([r, g, b]) => {
    let best = MADEIRA_THREADS[0], bestD = Infinity;
    for (const t of MADEIRA_THREADS) {
      const d = (r - t.r) ** 2 + (g - t.g) ** 2 + (b - t.b) ** 2;
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  });
}

function renderSwatches(palette, indexMap, skippedColors, colorNames = []) {
  const counts = new Array(palette.length).fill(0);
  for (const idx of indexMap) { if (idx < palette.length) counts[idx]++; }
  const total = counts.reduce((a, b) => a + b, 0);
  const n = palette.length;

  swatchContainer.innerHTML = '';
  palette.forEach(([r, g, b], i) => {
    const pct     = total > 0 ? Math.round((counts[i] / total) * 100) : 0;
    const skipped = skippedColors.has(i);
    const locked  = lockedColors.has(i);
    const name    = colorNames[i] || '';
    const snap    = threadSnap ? threadSnap[i] : null;
    const div = document.createElement('div');
    div.className = 'swatch' + (skipped ? ' swatch--skipped' : '') + (locked ? ' swatch--locked' : '');
    div.title = name
      ? `${name} — ${skipped ? 'click to restore' : 'click to remove'}`
      : (skipped ? 'Click to restore thread' : 'Click to remove thread');
    div.dataset.colorIdx = i;
    div.innerHTML = `
      <span class="swatch-reorder-btns">
        <button class="swatch-reorder-btn" data-reorder-up="${i}" title="Move up" ${i === 0 ? 'disabled' : ''}>&#9650;</button>
        <button class="swatch-reorder-btn" data-reorder-down="${i}" title="Move down" ${i === n - 1 ? 'disabled' : ''}>&#9660;</button>
      </span>
      <span class="swatch-color" style="background:rgb(${r},${g},${b});${skipped ? 'opacity:0.35' : ''}"></span>
      <span class="swatch-info${skipped ? ' swatch-info--skip' : ''}">
        ${name ? `<span class="swatch-name">${name}</span>` : ''}
        <span class="swatch-pct">${pct}%</span>
        ${snap ? `<span class="thread-snap-tag">${snap.code} ${snap.name}</span>` : ''}
      </span>
      <button class="swatch-lock-btn" data-lock-idx="${i}" title="${locked ? 'Locked — NLP commands won\'t change this color. Click to unlock.' : 'Lock this color to protect it from NLP changes'}">${locked ? '\uD83D\uDD12' : '\uD83D\uDD13'}</button>`;
    swatchContainer.appendChild(div);
  });
}

// ── Gum (thread toggle) ───────────────────────────────────────────────────────

/**
 * Toggle a color index in/out of skipColors, then refresh all previews.
 */
function toggleColor(ci) {
  if (!lastQuantResult) return;
  pushUndo();
  if (skipColors.has(ci)) {
    skipColors.delete(ci);
  } else {
    skipColors.add(ci);
  }
  const { palette, indexMap, width, height, colorNames = [] } = lastQuantResult;
  drawQuantizedPreview(palette, indexMap, width, height, skipColors);
  renderSwatches(palette, indexMap, skipColors, colorNames);
  updateStitchPreview();
  setStatus('Preview updated');
}

// Click on the stitch canvas → look up pixel → toggle that thread
stitchCanvas.addEventListener('click', e => {
  if (!lastQuantResult || eraseAreaMode || copyNeighborMode || drawMode || soloLayer !== null) return;
  const rect  = stitchCanvas.getBoundingClientRect();
  const scaleX = stitchCanvas.width  / rect.width;
  const scaleY = stitchCanvas.height / rect.height;
  const px = Math.round((e.clientX - rect.left) * scaleX);
  const py = Math.round((e.clientY - rect.top)  * scaleY);
  const { indexMap, width, height, palette } = lastQuantResult;
  if (px < 0 || py < 0 || px >= width || py >= height) return;
  const ci = indexMap[py * width + px];
  if (ci >= palette.length) return;   // transparent pixel
  toggleColor(ci);
});

// Click the lock button on a swatch — intercept before the swatch toggle fires
swatchContainer.addEventListener('click', e => {
  const lockBtn = e.target.closest('[data-lock-idx]');
  if (!lockBtn) return;
  e.stopPropagation();
  const ci = parseInt(lockBtn.dataset.lockIdx, 10);
  if (isNaN(ci) || !lastQuantResult) return;
  if (lockedColors.has(ci)) {
    lockedColors.delete(ci);
  } else {
    lockedColors.add(ci);
  }
  const { palette, indexMap, colorNames = [] } = lastQuantResult;
  renderSwatches(palette, indexMap, skipColors, colorNames);
}, true); // capture phase so it fires before the bubble handler below

// Click the reorder buttons on a swatch
swatchContainer.addEventListener('click', e => {
  const upBtn   = e.target.closest('[data-reorder-up]');
  const downBtn = e.target.closest('[data-reorder-down]');
  const btn = upBtn || downBtn;
  if (!btn) return;
  e.stopPropagation();
  if (!lastQuantResult) return;
  const i = parseInt((upBtn || downBtn).dataset[upBtn ? 'reorderUp' : 'reorderDown'], 10);
  const j = upBtn ? i - 1 : i + 1;
  if (j < 0 || j >= lastQuantResult.palette.length) return;
  swapPaletteColors(i, j);
}, true);

/**
 * Swap two palette entries and remap indexMap accordingly.
 * Updates skipColors, lockedColors, colorAngles, and threadSnap to match.
 */
function swapPaletteColors(i, j) {
  if (!lastQuantResult) return;
  pushUndo();
  const { palette, indexMap, colorNames } = lastQuantResult;

  // Swap palette + colorNames
  [palette[i], palette[j]] = [palette[j], palette[i]];
  [colorNames[i], colorNames[j]] = [colorNames[j], colorNames[i]];

  // Remap indexMap
  for (let p = 0; p < indexMap.length; p++) {
    if (indexMap[p] === i) indexMap[p] = j;
    else if (indexMap[p] === j) indexMap[p] = i;
  }

  // Remap Set/Map state
  function swapInSet(s) {
    const hadI = s.has(i), hadJ = s.has(j);
    if (hadI !== hadJ) {
      if (hadI) { s.delete(i); s.add(j); }
      else      { s.delete(j); s.add(i); }
    }
  }
  swapInSet(skipColors);
  swapInSet(lockedColors);

  const ai = colorAngles[i], aj = colorAngles[j];
  if (ai !== undefined) colorAngles[j] = ai; else delete colorAngles[j];
  if (aj !== undefined) colorAngles[i] = aj; else delete colorAngles[i];

  const fi = colorFillTypes[i], fj = colorFillTypes[j];
  if (fi !== undefined) colorFillTypes[j] = fi; else delete colorFillTypes[j];
  if (fj !== undefined) colorFillTypes[i] = fj; else delete colorFillTypes[i];

  if (threadSnap) [threadSnap[i], threadSnap[j]] = [threadSnap[j], threadSnap[i]];

  drawQuantizedPreview(palette, indexMap, lastQuantResult.width, lastQuantResult.height, skipColors);
  renderSwatches(palette, indexMap, skipColors, colorNames);
  if (currentStage === 2) renderThreadPanel();
  setStatus('Color order updated — Ctrl+Z to undo');
}

// Click on a palette swatch → toggle that thread (or switch solo layer when in solo mode)
swatchContainer.addEventListener('click', e => {
  const swatch = e.target.closest('[data-color-idx]');
  if (!swatch) return;
  if (e.target.closest('[data-lock-idx]')) return;  // handled above
  if (e.target.closest('[data-reorder-up]') || e.target.closest('[data-reorder-down]')) return;
  const ci = parseInt(swatch.dataset.colorIdx, 10);
  if (isNaN(ci)) return;
  if (soloLayer !== null) {
    // In solo mode: clicking a swatch jumps to viewing that color's layer
    if (!skipColors.has(ci) && lastQuantResult) {
      const order = getActiveColorOrder();
      if (order.includes(ci)) {
        soloLayer = ci;
        updateLayerNav();
        updateStitchPreview();
      }
    }
    return;
  }
  toggleColor(ci);
});

// ── Export ────────────────────────────────────────────────────────────────────
function runExport() {
  // Use lastQuantResult so the DST output is pixel-identical to the stitch preview.
  // Any edits the user made (gum tool, NLP region merges, colour commands) are
  // already baked into lastQuantResult.indexMap — no re-quantisation needed.
  if (!lastQuantResult) return;
  setStatus('Generating stitches…');
  exportBtn.disabled = true;

  setTimeout(() => {
    try {
      const { palette, indexMap, width, height } = lastQuantResult;

      // Mirror the exact same parameters used by updateStitchPreview()
      const densityMm   = Math.max(0.2, Math.min(2.0, Number(densityInput.value) || 0.3));
      const stitchMm    = Math.max(1.0, Math.min(6.0,  Number(stitchInput.value)  || 2.5));
      const PX_PER_MM   = 5;
      const pitchPx     = Math.max(1, Math.round(densityMm * PX_PER_MM));
      const stitchLenPx = Math.max(1, Math.round(stitchMm  * PX_PER_MM));
      const fillAngleDeg = clampInt(Number(angleInput.value), 0, 89);

      const records = generateStitches(
        indexMap, width, height, palette,
        { pitchPx, stitchLenPx, skipColors, outlineOnly, minRegionPx: 40, fillAngleDeg, colorAngles }
      );

      const stitchCount = records.filter(r => r.type === 'STITCH').length;
      const designName  = (currentFile ? currentFile.name.replace(/\.[^.]+$/, '') : 'design')
                          .substring(0, 16);

      const dstBytes = encodeDST(records, designName);
      downloadBlob(dstBytes, designName + '.dst', 'application/octet-stream');

      setStatus(`Done — ${stitchCount.toLocaleString()} stitches exported`, 'success');
      exportBtn.disabled = false;
    } catch (err) {
      setStatus('Export error: ' + err.message, 'error');
      exportBtn.disabled = false;
    }
  }, 20);
}

// ── Request box ───────────────────────────────────────────────────────────────
requestBtn.addEventListener('click', () => applyRequest(requestInput.value));
requestInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyRequest(requestInput.value); });

/**
 * Detect the background color index by sampling the four image corners.
 */
function detectBgColor(indexMap, width, height, k) {
  const cs = Math.max(2, Math.min(5, Math.floor(Math.min(width, height) / 6)));
  const counts = new Array(k).fill(0);
  for (let y = 0; y < cs; y++) {
    for (let x = 0; x < cs; x++) {
      [
        [x, y], [width - 1 - x, y],
        [x, height - 1 - y], [width - 1 - x, height - 1 - y],
      ].forEach(([px, py]) => {
        const ci = indexMap[py * width + px];
        if (ci < k) counts[ci]++;
      });
    }
  }
  return counts.indexOf(Math.max(...counts));
}

/**
 * Intent-based natural language parser.
 *
 * Instead of matching exact phrases, we detect:
 *   INTENT  — what the user wants to do (increase, decrease, remove, restore, set)
 *   SUBJECT — what they want to change (background, colors, size, density, stitch, outline)
 *
 * This lets arbitrary phrasings like "get rid of the background", "I want fewer thread
 * colors", "scale the design up", "make rows tighter", "draw just the edges" all work.
 */
function applyRequest(text) {
  if (!text.trim()) { showFeedback('Type a request first.', 'err'); return; }

  const t = text.toLowerCase().replace(/['"]/g, ' ').replace(/\s+/g, ' ').trim();
  const changes = [];
  let needsRequantize = false;
  let previewOnly     = false;

  // Speculatively save state for undo; reverted below if no change is actually made
  if (lastQuantResult) pushUndo();

  // ── Intent signals ──────────────────────────────────────────────────────────
  const intRemove  = /\b(remove|remov\w*|delete|erase|cut\s*out|take\s*out|get\s*rid|strip|hide|without|exclude|no\b|transparent|clear|drop)\b/.test(t);
  const intRestore = /\b(restore|add\s*back|put\s*back|bring\s*back|show|include|reset|keep)\b/.test(t) || /with\s+background/.test(t);
  const intUp      = /\b(more|increase|add|boost|raise|extra|higher|up\b|enlarge|expand|extend|widen|grow)\b/.test(t);
  const intDown    = /\b(less|decrease|fewer|reduce|lower|down\b|shrink|compress|compact|drop|cut|fewer)\b/.test(t);
  const intBigger  = /\b(bigger|larger|wider|taller|scale\s*up|zoom\s*in|make\s*it\s*(big|large))\b/.test(t);
  const intSmaller = /\b(smaller|narrower|shrink|scale\s*down|zoom\s*out|make\s*it\s*small)\b/.test(t);
  const intFiner   = /\b(finer|tighter|denser|closer|compact|more\s*dense|more\s*detail)\b/.test(t);
  const intLoose   = /\b(looser|coarser|sparser|wider\s*rows?|spread\s*out|less\s*dense|rougher)\b/.test(t);
  const intLonger  = /\b(longer|bigger\s*stitch|larger\s*stitch|extend\s*stitch)\b/.test(t);
  const intShorter = /\b(shorter|smaller\s*stitch|tinier|fine\s*stitch|mini)\b/.test(t);
  // Magnitude modifiers
  const intSlight  = /\b(slightly|a\s+bit|a\s+little|somewhat|marginally|gently|just\s+a\s+(bit|little))\b/.test(t);
  const intMuch    = /\b(much|a\s+lot|very|really|significantly|considerably|substantially|way\b)\b/.test(t);

  // ── Subject signals ─────────────────────────────────────────────────────────
  const subBackground = /\b(background|bg|backdrop|back\s*ground)\b/.test(t);
  const subColors     = /\b(colou?rs?|threads?|palette|tones?|shades?|hues?|tints?)\b/.test(t);
  const subSize       = /\b(size|wid(th|er?)|dimension|scale|big|larg|small|tall|height)\b/.test(t) && !subColors;
  const subDensity    = /\b(density|densit|row\s*spac|line\s*spac|row\s*pitch|fill\s*spac|rows?\b)\b/.test(t);
  const subStitch     = /\b(stitch(?:es)?(?:\s+length)?|stitch\s*size|stitch\s*len)\b/.test(t);
  const subOutline    = /\b(outline|contour|edges?|border|wireframe|sketch|trace|silhouette|perimeter|boundary|just\s*(the\s*)?lines?|lines?\s*only|only\s*lines?)\b/.test(t);
  const subFill       = /\b(fill(?:ed)?|solid|block|normal\s*mode|full\s*fill|go\s*back)\b/.test(t) || /^fill$/.test(t);

  // Numeric value anywhere in the text
  const numM = t.match(/\b(\d+(?:\.\d+)?)\b/);
  const num  = numM ? parseFloat(numM[1]) : null;
  // Explicit mm value (e.g. "150mm", "150 mm")
  const mmM  = t.match(/(\d+(?:\.\d+)?)\s*mm/);
  const mmVal = mmM ? parseFloat(mmM[1]) : null;

  // ── Background ──────────────────────────────────────────────────────────────
  if (subBackground) {
    if (intRemove || /\b(no|without|transparent|clear|erase)\b/.test(t)) {
      if (!lastQuantResult) { showFeedback('Load an image first.', 'err'); return; }
      const { indexMap, width, height, palette } = lastQuantResult;
      skipColors.add(detectBgColor(indexMap, width, height, palette.length));
      changes.push('background removed');
      previewOnly = true;
    } else if (intRestore || /\b(show|restore|back|reset|with)\b/.test(t)) {
      skipColors.clear();
      changes.push('background restored');
      previewOnly = true;
    }
  }

  // ── Outline / fill mode ─────────────────────────────────────────────────────
  if (subOutline && !subFill) {
    outlineOnly = true;
    changes.push('outline mode');
    previewOnly = true;
  } else if (subFill && !subOutline) {
    outlineOnly = false;
    changes.push('fill mode');
    previewOnly = true;
  }

  // ── Colors ──────────────────────────────────────────────────────────────────
  if (subColors) {
    if (num !== null && !subSize) {
      const v = clampInt(num, 2, 16);
      colorsInput.value = v;
      changes.push(`colors → ${v}`);
      needsRequantize = true;
    } else if (intUp) {
      const step = intSlight ? 1 : intMuch ? 4 : 2;
      const v = clampInt(Number(colorsInput.value) + step, 2, 16);
      colorsInput.value = v;
      changes.push(`colors → ${v}`);
      needsRequantize = true;
    } else if (intDown) {
      const step = intSlight ? 1 : intMuch ? 4 : 2;
      const v = clampInt(Number(colorsInput.value) - step, 2, 16);
      colorsInput.value = v;
      changes.push(`colors → ${v}`);
      needsRequantize = true;
    }
  }

  // ── Design size / width ─────────────────────────────────────────────────────
  // Explicit mm value takes priority
  if (mmVal !== null && !subDensity && !subStitch) {
    const v = Math.max(10, Math.min(500, mmVal));
    widthInput.value = v;
    changes.push(`width → ${v} mm`);
    needsRequantize = true;
  } else if (!subColors && !subDensity && !subStitch && (subSize || intBigger || intSmaller)) {
    if (intBigger || (intUp && subSize)) {
      const factor = intSlight ? 1.1 : intMuch ? 1.5 : 1.25;
      const v = Math.min(500, Math.round(Number(widthInput.value) * factor));
      widthInput.value = v;
      changes.push(`width → ${v} mm`);
      needsRequantize = true;
    } else if (intSmaller || (intDown && subSize)) {
      const factor = intSlight ? 0.9 : intMuch ? 0.65 : 0.75;
      const v = Math.max(10, Math.round(Number(widthInput.value) * factor));
      widthInput.value = v;
      changes.push(`width → ${v} mm`);
      needsRequantize = true;
    }
  }

  // ── Row density ─────────────────────────────────────────────────────────────
  if (subDensity || intFiner || intLoose) {
    // Explicit numeric density value
    const densNumM = t.match(/density\s+(\d+(?:\.\d+)?)/);
    if (densNumM) {
      const v = Math.max(0.2, Math.min(2.0, parseFloat(densNumM[1])));
      densityInput.value = v.toFixed(1);
      changes.push(`density → ${v.toFixed(1)} mm`);
    } else if (intFiner || (subDensity && (intUp || intDown && !intLoose))) {
      // "more dense" = smaller pitch number; apply magnitude
      const isFiner = intFiner || (subDensity && intDown);
      const dir = isFiner
        ? (intSlight ? 0.9 : intMuch ? 0.5 : 0.7)
        : (intSlight ? 1.1 : intMuch ? 2.0 : 1.4);
      const v = Math.max(0.2, Math.min(2.0, parseFloat((Number(densityInput.value) * dir).toFixed(1))));
      densityInput.value = v;
      changes.push(`density → ${v} mm`);
    } else if (intLoose || (subDensity && intUp)) {
      const factor = intSlight ? 1.1 : intMuch ? 2.0 : 1.4;
      const v = Math.min(2.0, parseFloat((Number(densityInput.value) * factor).toFixed(1)));
      densityInput.value = v;
      changes.push(`density → ${v} mm`);
    }
  }

  // ── Stitch length ────────────────────────────────────────────────────────────
  if (subStitch || intLonger || intShorter) {
    const stNumM = t.match(/stitch(?:\s+(?:length|size))?\s+(\d+(?:\.\d+)?)/);
    if (stNumM) {
      const v = Math.max(1.0, Math.min(6.0, parseFloat(stNumM[1])));
      stitchInput.value = v.toFixed(1);
      changes.push(`stitch length → ${v.toFixed(1)} mm`);
    } else if (intLonger || (subStitch && intUp)) {
      const factor = intSlight ? 1.1 : intMuch ? 1.6 : 1.3;
      const v = Math.min(6.0, parseFloat((Number(stitchInput.value) * factor).toFixed(1)));
      stitchInput.value = v;
      changes.push(`stitch length → ${v} mm`);
    } else if (intShorter || (subStitch && intDown)) {
      const factor = intSlight ? 0.9 : intMuch ? 0.5 : 0.7;
      const v = Math.max(1.0, parseFloat((Number(stitchInput.value) * factor).toFixed(1)));
      stitchInput.value = v;
      changes.push(`stitch length → ${v} mm`);
    }
  }

  // ── Fill angle ───────────────────────────────────────────────────────────────
  const subAngle = /\b(fill\s*angle|fill\s*dir|diagonal|horiz(?:ontal)?|angle\b)\b/.test(t);
  if (subAngle || /\b(diagonal|diag|45|slant|angled)\b/.test(t)) {
    if (/\b(horiz(?:ontal)?|straight|0|zero|flat)\b/.test(t)) {
      angleInput.value = 0;
      changes.push('fill angle → 0°');
      previewOnly = true;
    } else if (/\b(diag(?:onal)?|45|slant|angled)\b/.test(t) || (subAngle && intUp)) {
      angleInput.value = 45;
      changes.push('fill angle → 45°');
      previewOnly = true;
    } else if (numM && subAngle) {
      const v = Math.max(0, Math.min(89, Math.round(num)));
      angleInput.value = v;
      changes.push(`fill angle → ${v}°`);
      previewOnly = true;
    }
  }

  // ── Color-name targeting ──────────────────────────────────────────────────────
  // e.g. "remove the blue", "erase red threads", "keep only green and white"
  if (lastQuantResult && lastQuantResult.colorNames) {
    const colorNames = lastQuantResult.colorNames;
    // Check all family keys (+ "grey" alias) for word-boundary matches
    const ALL_FAMILY_KEYS = [...Object.keys(COLOR_FAMILIES), 'grey'];
    const foundFamilies = ALL_FAMILY_KEYS.filter(k =>
      new RegExp('\\b' + k + '\\b', 'i').test(t)
    ).map(f => f === 'grey' ? 'gray' : f);  // normalise grey → gray

    // Don't double-fire if the background handler already handled this intent
    const backgroundHandled = changes.some(c => c.includes('background'));

    if (foundFamilies.length > 0 && !backgroundHandled) {
      // Collect palette indices matching ANY spoken color word
      const matchedIndices = new Set();
      foundFamilies.forEach(w =>
        paletteIndicesForColorWord(w, colorNames).forEach(i => matchedIndices.add(i))
      );

      const keepOnly = /\b(keep\s+only|only\s+keep|show\s+only|only\s+show|just\s+keep|keep\s+just)\b/.test(t) ||
                       (/\bonly\b/.test(t) && intRestore && !intRemove);

      // Remove locked indices from matched set so they aren't affected
      lockedColors.forEach(i => matchedIndices.delete(i));

      if (matchedIndices.size > 0) {
        if (keepOnly) {
          skipColors.clear();
          colorNames.forEach((_, i) => { if (!matchedIndices.has(i) && !lockedColors.has(i)) skipColors.add(i); });
          changes.push(`kept only ${[...new Set(foundFamilies)].join(', ')}`);
          previewOnly = true;
        } else if (intRemove && !intRestore) {
          matchedIndices.forEach(i => skipColors.add(i));
          changes.push(`removed ${[...new Set(foundFamilies)].join(', ')}`);
          previewOnly = true;
        } else if (intRestore && !intRemove) {
          matchedIndices.forEach(i => skipColors.delete(i));
          changes.push(`restored ${[...new Set(foundFamilies)].join(', ')}`);
          previewOnly = true;
        }
      }
    }
  }

  // ── Thread index targeting ────────────────────────────────────────────────────
  // e.g. "remove thread 3", "restore color 1" (1-based user numbering)
  const threadIdxM = t.match(/\b(?:thread|colou?r|swatch)\s+#?(\d+)\b/i);
  if (threadIdxM && lastQuantResult && (intRemove || intRestore)) {
    const userIdx = parseInt(threadIdxM[1], 10);
    const ci = userIdx - 1;   // convert 1-based → 0-based
    if (ci >= 0 && ci < lastQuantResult.palette.length) {
      if (intRemove) {
        skipColors.add(ci);
        changes.push(`removed thread ${userIdx}`);
        previewOnly = true;
      } else {
        skipColors.delete(ci);
        changes.push(`restored thread ${userIdx}`);
        previewOnly = true;
      }
    }
  }

  // ── Body-part region commands ─────────────────────────────────────────────────
  // e.g. "the pants of the man are to be 1 color", "make the jacket 2 colours",
  //      "pants are blue", "jacket should be green"
  // Gated on segmentation having completed successfully AND dimensions matching.
  const _segReady = lastSegResult && lastSegResult.personFound && lastQuantResult &&
    lastSegResult.partMap.length === lastQuantResult.indexMap.length;

  if (_segReady) {
    // Compute total opaque pixel count once (used for coverage %)
    const _totalOpaque = lastQuantResult.indexMap.reduce(
      (n, c) => n + (c < lastQuantResult.palette.length ? 1 : 0), 0
    );

    // Pattern A — reduce a region to N colours
    const regionCountM = t.match(_REGION_COUNT_RE);
    if (regionCountM) {
      const partWord = regionCountM[1].toLowerCase();
      const targetN  = Math.max(1, Math.min(16, parseInt(regionCountM[2], 10)));
      const { group, groupPartIds } = bodyGroupForWord(partWord);
      if (group) {
        const regionPixels = getRegionPixels(groupPartIds, lastSegResult);
        if (regionPixels.size > 0) {
          const coverage = _totalOpaque > 0
            ? Math.round(regionPixels.size / _totalOpaque * 100) : 0;
          const { mergedCount } = mergeRegionColors(
            lastQuantResult.indexMap, regionPixels,
            lastQuantResult.palette, targetN, null, lastQuantResult.colorNames
          );
          const label = PART_LABELS[group] || group;
          // Always show coverage so the user can tell if detection was accurate
          const coverageNote = coverage > 55
            ? ` (⚠ ${coverage}% of image — detection may be imprecise)`
            : ` (${coverage}% of image)`;
          changes.push(mergedCount > 0
            ? `${label} → ${targetN} color${targetN !== 1 ? 's' : ''}${coverageNote}`
            : `${label} already ≤ ${targetN} color${targetN !== 1 ? 's' : ''}${coverageNote}`);
          previewOnly = true;
        } else {
          showFeedback(`No "${PART_LABELS[group] || group}" region detected — try a clearer photo.`, 'err');
        }
      }
    }

    // Pattern B — target a colour name within a region (only when Pattern A doesn't match)
    if (!regionCountM) {
      const regionColorM = t.match(_REGION_COLOR_RE);
      if (regionColorM) {
        const partWord  = regionColorM[1].toLowerCase();
        const colorWord = regionColorM[2].trim().toLowerCase();
        // Guard: ignore if colorWord looks like a lone digit (Pattern A overlap)
        if (!/^\d+$/.test(colorWord) && lastQuantResult.colorNames) {
          const { group, groupPartIds } = bodyGroupForWord(partWord);
          if (group) {
            const regionPixels = getRegionPixels(groupPartIds, lastSegResult);
            if (regionPixels.size > 0) {
              const coverage = _totalOpaque > 0
                ? Math.round(regionPixels.size / _totalOpaque * 100) : 0;
              const { mergedCount, keptIndices } = mergeRegionColors(
                lastQuantResult.indexMap, regionPixels,
                lastQuantResult.palette, 1, colorWord, lastQuantResult.colorNames
              );
              const label = PART_LABELS[group] || group;
              if (mergedCount > 0 || keptIndices.length > 0) {
                const coverageNote = coverage > 55
                  ? ` (⚠ ${coverage}% of image — detection may be imprecise)`
                  : ` (${coverage}% of image)`;
                changes.push(`${label} → ${colorWord}${coverageNote}`);
                previewOnly = true;
              } else {
                showFeedback(`Couldn't find "${colorWord}" in the ${label} region.`, 'err');
              }
            }
          }
        }
      }
    }
  } else if (lastSegResult && !lastSegResult.personFound && lastQuantResult &&
             (_REGION_COUNT_RE.test(t) || _REGION_COLOR_RE.test(t))) {
    if (lastQuantResult) { undoStack.pop(); updateUndoRedoBtns(); }
    showFeedback('No person was detected in this image — body-part commands are unavailable.', 'err');
    return;
  } else if (lastQuantResult && !lastSegResult &&
             (_REGION_COUNT_RE.test(t) || _REGION_COLOR_RE.test(t))) {
    // Segmentation not yet ready — revert speculative undo push and inform user
    if (lastQuantResult) { undoStack.pop(); updateUndoRedoBtns(); }
    showFeedback('Figure recognition is still loading — wait a moment and try again.', 'err');
    return;
  }

  // ── Depixelate ───────────────────────────────────────────────────────────────
  // Blurs raw pixels before quantize (blends blocky pixel-art squares) and adds
  // extra smooth passes after quantize (rounds colour-region boundaries).
  if (/\bdepixelate\b/.test(t)) {
    depixelateLevel = (depixelateLevel + 1) % 4;   // cycle: 0→1→2→3→0
    const lvlNames  = ['off', 'light (4 px grid)', 'medium (6 px grid)', 'heavy (8 px grid)'];
    changes.push('depixelate ' + lvlNames[depixelateLevel]);
    needsRequantize = true;
  }

  // ── Smooth edges ─────────────────────────────────────────────────────────────
  if (/\bsmooth\b/.test(t) && lastQuantResult) {
    const { indexMap, width, height, palette } = lastQuantResult;
    lastQuantResult.indexMap = smoothIndexMap(indexMap, width, height, palette.length);
    changes.push('edges smoothed');
    previewOnly = true;
  }

  // ── Clean small regions ───────────────────────────────────────────────────────
  if (/\bclean\b/.test(t) && lastQuantResult) {
    const { indexMap, width, height, palette } = lastQuantResult;
    lastQuantResult.indexMap = mergeSmallRegions(indexMap, width, height, palette.length, 80);
    changes.push('small regions merged');
    previewOnly = true;
  }

  // ── Flip ─────────────────────────────────────────────────────────────────────
  if (/\bflip\b/.test(t)) {
    if (/\bvert(ical)?\b/.test(t) || /\bflip\s+v\b/i.test(t)) {
      flipV = !flipV; changes.push(flipV ? 'flipped vertically' : 'flip V removed'); needsRequantize = true;
    } else {
      flipH = !flipH; changes.push(flipH ? 'flipped horizontally' : 'flip H removed'); needsRequantize = true;
    }
  }

  // ── Rotate ───────────────────────────────────────────────────────────────────
  if (/\brotate\b/.test(t) && !subAngle) {
    rotateCW = (rotateCW + 1) % 4;
    changes.push(`rotated ${rotateCW * 90}°`);
    needsRequantize = true;
  }

  // ── Sharpen / blur ───────────────────────────────────────────────────────────
  if (/\bsharpen\b/.test(t) && !/\bsmooth|blur\b/.test(t)) {
    sharpness = 1; changes.push('sharpened'); needsRequantize = true;
  }
  if (/\bblur\b/.test(t)) {
    sharpness = -1; changes.push('blurred'); needsRequantize = true;
  }

  // ── Snap to thread catalog ────────────────────────────────────────────────────
  if (/\bthread|snap\b/.test(t) && lastQuantResult) {
    threadSnap = snapPaletteToThreads(lastQuantResult.palette);
    // Replace palette colors with matched thread colors
    pushUndo();
    threadSnap.forEach(({ r, g, b }, i) => { lastQuantResult.palette[i] = [r, g, b]; });
    lastQuantResult.colorNames = lastQuantResult.palette.map(namedColorOf);
    changes.push('snapped to Madeira threads');
    previewOnly = true;
  }

  // ── Reset to defaults ────────────────────────────────────────────────────────
  if (/\b(reset\s+(all|everything)|start\s+over)\b/.test(t) ||
      (t.trim() === 'reset' && changes.length === 0)) {
    widthInput.value   = 100;
    colorsInput.value  = 6;
    densityInput.value = 0.3;
    stitchInput.value  = 2.5;
    angleInput.value   = 45;
    brightnessInput.value = 100; brightnessAdjust = 100;
    contrastInput.value   = 100; contrastAdjust   = 100;
    sharpness = 0; flipH = false; flipV = false; rotateCW = 0;
    depixelateLevel = 0;
    colorAngles = {}; colorFillTypes = {}; threadSnap = null;
    skipColors.clear();
    lockedColors.clear();
    outlineOnly        = false;
    changes.push('reset to defaults');
    needsRequantize    = true;
  }

  // ── Result ──────────────────────────────────────────────────────────────────
  if (changes.length === 0) {
    // Nothing matched — revert the speculative undo push
    if (lastQuantResult) { undoStack.pop(); updateUndoRedoBtns(); }
    showFeedback(
      'Not understood — try describing what to change, e.g. "remove the background", ' +
      '"draw just the edges", "I want 10 thread colors", "make the design bigger", ' +
      '"tighter rows", "use longer stitches", "set width to 120mm", "reset everything".',
      'err'
    );
    return;
  }

  showFeedback('Applied: ' + changes.join(', '), 'ok');
  requestInput.value = '';

  if (loadedImage) {
    exportBtn.disabled = true;
    if (needsRequantize) {
      runQuantize(loadedImage);
    } else if (previewOnly && lastQuantResult) {
      const { palette, indexMap, width, height, colorNames = [] } = lastQuantResult;
      drawQuantizedPreview(palette, indexMap, width, height, skipColors);
      renderSwatches(palette, indexMap, skipColors, colorNames);
      updateStitchPreview();
      exportBtn.disabled = false;
      setStatus('Preview updated');
    }
  }
}

// ── Stitch preview ────────────────────────────────────────────────────────────

/**
 * Regenerate stitch records from the cached quantize result and render them
 * onto the stitch preview canvas.
 */
function updateStitchPreview() {
  if (currentStage !== 2) return;
  if (!lastQuantResult) return;
  const { palette, indexMap, width, height } = lastQuantResult;

  const densityMm   = Math.max(0.2, Math.min(2.0, Number(densityInput.value) || 0.3));
  const stitchMm    = Math.max(1.0, Math.min(6.0,  Number(stitchInput.value) || 2.5));
  const PX_PER_MM   = 5;
  const pitchPx     = Math.max(1, Math.round(densityMm  * PX_PER_MM));
  const stitchLenPx = Math.max(1, Math.round(stitchMm   * PX_PER_MM));

  const fillAngleDeg = clampInt(Number(angleInput.value), 0, 89);
  const records = generateStitches(
    indexMap, width, height, palette,
    { pitchPx, stitchLenPx, skipColors, outlineOnly, minRegionPx: 40, fillAngleDeg, colorAngles, colorFillTypes }
  );
  lastStitchRecords = records;

  // Rebuild the same color order as stitcher.js (sorted by pixel count desc)
  const k = palette.length;
  const counts = new Array(k).fill(0);
  for (let i = 0; i < indexMap.length; i++) {
    if (indexMap[i] < k) counts[indexMap[i]]++;
  }
  const colorOrder = Array.from({ length: k }, (_, i) => i)
    .filter(i => counts[i] > 0 && !skipColors.has(i))
    .sort((a, b) => counts[b] - counts[a]);
  lastColorOrder = colorOrder;

  renderStitchPreview(records, palette, colorOrder, width, height, soloLayer);
  if (soloLayer !== null) updateLayerNav();

  // Update stitch count + physical size readout
  const stitchCount = records.filter(r => r.type === 'STITCH').length;
  const PX_PER_MM_DISPLAY = 5;
  const wMm = Math.round(width  / PX_PER_MM_DISPLAY);
  const hMm = Math.round(height / PX_PER_MM_DISPLAY);
  stitchInfoEl.textContent = `${wMm}\u2009\xd7\u2009${hMm}\u2009mm \u00b7 ${stitchCount.toLocaleString()} stitches`;
}

/**
 * Draw the stitch records onto the stitch preview canvas.
 * Stitches are drawn as coloured lines; jump moves are shown as gray dashes
 * (suppressed in solo mode for a cleaner single-layer view).
 * A subtle 10 mm grid is rendered behind the stitches.
 *
 * @param {Array}    records       Output of generateStitches()
 * @param {number[][]} palette     [r,g,b] entries
 * @param {number[]} colorOrder    Palette indices in the order they appear in records
 * @param {number}   w             Working canvas width in pixels
 * @param {number}   h             Working canvas height in pixels
 * @param {number|null} soloColorIdx  null = all layers; palette index = solo that layer
 */
function renderStitchPreview(records, palette, colorOrder, w, h, soloColorIdx = null) {
  stitchCanvas.width  = w;
  stitchCanvas.height = h;
  // Keep overlay dimensions in sync so coordinate mapping is always correct
  eraseOverlay.width  = w;
  eraseOverlay.height = h;
  const ctx = stitchCanvas.getContext('2d');

  // Fabric-coloured background
  ctx.fillStyle = '#faf8f5';
  ctx.fillRect(0, 0, w, h);

  // Optional: original-image watermark for alignment reference
  if (watermarkOpacity > 0 && lastWorkingCanvas) {
    ctx.save();
    ctx.globalAlpha = watermarkOpacity / 100;
    ctx.drawImage(lastWorkingCanvas, 0, 0, w, h);
    ctx.restore();
  }

  // Subtle 10 mm grid (50 px at 5 px/mm)
  const GRID = 50;
  ctx.strokeStyle = 'rgba(0,0,0,0.05)';
  ctx.lineWidth   = 0.5;
  for (let x = 0; x <= w; x += GRID) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y <= h; y += GRID) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  if (colorOrder.length === 0) return;

  // Helper: set strokeStyle for a given phase index, respecting solo mode.
  // Non-solo layers become fully transparent so their paths produce no visible output.
  const _setStroke = ph => {
    const palIdx = colorOrder[ph];
    if (soloColorIdx !== null && palIdx !== soloColorIdx) {
      ctx.strokeStyle = 'rgba(0,0,0,0)';
    } else {
      const [r, g, b] = palette[palIdx] || [0, 0, 0];
      ctx.strokeStyle = `rgb(${r},${g},${b})`;
    }
  };

  // ── Pass 1: jump moves as thin dashed gray lines ───────────────────────────
  // Suppressed in solo mode — jump lines clutter the single-layer view and
  // originate from all layers, not just the one being inspected.
  if (soloColorIdx === null) {
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.lineWidth   = 0.6;
    ctx.strokeStyle = 'rgba(150,150,150,0.45)';
    ctx.lineCap     = 'butt';
    ctx.beginPath();
    let jx = 0, jy = 0, wasJump = false;
    for (const rec of records) {
      if (rec.type === 'END') break;
      if (rec.type === 'COLOR_CHANGE') { wasJump = false; continue; }
      const cx = rec.x / 2;
      const cy = h - 1 - rec.y / 2;
      if (rec.type === 'JUMP') {
        if (!wasJump) ctx.moveTo(jx, jy);   // start jump path from last needle pos
        ctx.lineTo(cx, cy);
        wasJump = true;
      } else {
        wasJump = false;
      }
      jx = cx; jy = cy;
    }
    ctx.stroke();
    ctx.restore();  // also clears setLineDash
  }

  // ── Pass 2: actual stitches as solid coloured lines ────────────────────────
  let phase      = 0;
  let prevX      = 0;
  let prevY      = 0;
  let prevIsJump = true; // true = previous position came from a JUMP (start fresh sub-path)

  ctx.setLineDash([]);   // ensure solid lines (restore guard)
  ctx.lineWidth  = 1.2;
  ctx.lineCap    = 'round';
  ctx.lineJoin   = 'round';

  // Start first path with the appropriate color (or transparent if non-solo)
  _setStroke(phase);
  ctx.beginPath();

  for (const rec of records) {
    if (rec.type === 'END') {
      ctx.stroke();
      break;
    }

    if (rec.type === 'COLOR_CHANGE') {
      ctx.stroke();
      phase++;
      if (phase < colorOrder.length) {
        _setStroke(phase);
        ctx.beginPath();
      }
      prevIsJump = true;
      continue;
    }

    // DST coords → canvas pixel coords (flip Y axis)
    const cx = rec.x / 2;
    const cy = h - 1 - rec.y / 2;

    if (rec.type === 'JUMP') {
      prevX      = cx;
      prevY      = cy;
      prevIsJump = true;
      continue;
    }

    // STITCH: draw a line from the previous position
    if (prevIsJump) {
      // Start a new sub-path from the last known position (end of jump)
      ctx.moveTo(prevX, prevY);
      ctx.lineTo(cx, cy);
      prevIsJump = false;
    } else {
      ctx.lineTo(cx, cy);
    }
    prevX = cx;
    prevY = cy;
  }
}

function showFeedback(msg, cls) {
  requestFeedback.textContent = msg;
  requestFeedback.className = 'request-feedback' + (cls ? ' ' + cls : '');
}

// ── Erase-area tool ───────────────────────────────────────────────────────────

/**
 * Toggle the drag-to-erase mode on/off.
 */
eraseBtn.addEventListener('click', () => {
  eraseAreaMode = !eraseAreaMode;
  eraseBtn.classList.toggle('active', eraseAreaMode);
  // All three canvas tools are mutually exclusive
  if (eraseAreaMode && copyNeighborMode) {
    copyNeighborMode = false;
    copyNeighborBtn.classList.remove('active');
  }
  if (eraseAreaMode && drawMode) {
    drawMode = false;
    drawBtn.classList.remove('active');
    drawPanel.classList.add('hidden');
    _drawDrag = null;
  }
  eraseOverlay.classList.toggle('active', eraseAreaMode || copyNeighborMode || drawMode);
  if (!eraseAreaMode) {
    _eraseDrag = null;
    clearEraseOverlay();
  }
});

copyNeighborBtn.addEventListener('click', () => {
  copyNeighborMode = !copyNeighborMode;
  copyNeighborBtn.classList.toggle('active', copyNeighborMode);
  // All three canvas tools are mutually exclusive
  if (copyNeighborMode && eraseAreaMode) {
    eraseAreaMode = false;
    eraseBtn.classList.remove('active');
  }
  if (copyNeighborMode && drawMode) {
    drawMode = false;
    drawBtn.classList.remove('active');
    drawPanel.classList.add('hidden');
    _drawDrag = null;
  }
  eraseOverlay.classList.toggle('active', eraseAreaMode || copyNeighborMode || drawMode);
  if (!copyNeighborMode) {
    _eraseDrag = null;
    clearEraseOverlay();
  }
});

// ── Layer solo tool ───────────────────────────────────────────────────────────

/**
 * Returns non-skipped palette indices that have at least one pixel in the
 * current indexMap, sorted by pixel count descending (same order as stitcher).
 * @returns {number[]}
 */
function getActiveColorOrder() {
  if (!lastQuantResult) return [];
  const { palette, indexMap } = lastQuantResult;
  const k = palette.length;
  const counts = new Array(k).fill(0);
  for (let i = 0; i < indexMap.length; i++) {
    if (indexMap[i] < k) counts[indexMap[i]]++;
  }
  return Array.from({ length: k }, (_, i) => i)
    .filter(i => counts[i] > 0 && !skipColors.has(i))
    .sort((a, b) => counts[b] - counts[a]);
}

/**
 * Exit solo mode and return to showing all layers.
 */
function exitSoloMode() {
  soloLayer = null;
  soloBtn.classList.remove('active');
  layerNav.classList.add('hidden');
  updateStitchPreview();
}

/**
 * Refresh the layer navigation bar to reflect the current soloLayer.
 * Should be called whenever soloLayer changes or when the preview is re-rendered
 * while in solo mode.
 */
function updateLayerNav() {
  if (soloLayer === null || !lastQuantResult) return;
  const order = getActiveColorOrder();
  const pos = order.indexOf(soloLayer);
  if (pos === -1) { exitSoloMode(); return; }  // layer was removed — bail out

  const [r, g, b] = lastQuantResult.palette[soloLayer];
  layerColorDot.style.background = `rgb(${r},${g},${b})`;
  layerColorName.textContent = lastQuantResult.colorNames[soloLayer] || `Color ${soloLayer + 1}`;
  layerIndexLabel.textContent = `${pos + 1} / ${order.length}`;
  layerPrevBtn.disabled = pos === 0;
  layerNextBtn.disabled = pos === order.length - 1;
}

soloBtn.addEventListener('click', () => {
  if (soloLayer !== null) {
    exitSoloMode();
    return;
  }
  // Exit draw mode when entering solo
  if (drawMode) {
    drawMode = false;
    drawBtn.classList.remove('active');
    drawPanel.classList.add('hidden');
    _drawDrag = null;
    eraseOverlay.classList.remove('active');
  }
  const order = getActiveColorOrder();
  if (order.length === 0) return;
  soloLayer = order[0];
  soloBtn.classList.add('active');
  layerNav.classList.remove('hidden');
  updateLayerNav();
  updateStitchPreview();
});

layerPrevBtn.addEventListener('click', () => {
  const order = getActiveColorOrder();
  const pos = order.indexOf(soloLayer);
  if (pos > 0) {
    soloLayer = order[pos - 1];
    updateLayerNav();
    updateStitchPreview();
  }
});

layerNextBtn.addEventListener('click', () => {
  const order = getActiveColorOrder();
  const pos = order.indexOf(soloLayer);
  if (pos < order.length - 1) {
    soloLayer = order[pos + 1];
    updateLayerNav();
    updateStitchPreview();
  }
});

// ── Zoom tool ─────────────────────────────────────────────────────────────────

/**
 * Apply the current zoomLevel to the canvas-wrap and update the zoom UI.
 * At zoom=1 the canvas-wrap reverts to its natural 100% CSS width.
 * At zoom>1 it is given an explicit pixel width = scrollWrap.clientWidth × zoom,
 * causing the stitch-scroll-wrap to show scrollbars.
 */
function applyZoom() {
  if (zoomLevel === 1) {
    stitchCanvasWrapEl.style.width = '';   // let CSS handle 100%
  } else {
    stitchCanvasWrapEl.style.width =
      Math.round(stitchScrollWrap.clientWidth * zoomLevel) + 'px';
  }
  stitchScrollWrap.scrollLeft = 0;
  stitchScrollWrap.scrollTop  = 0;
  zoomLabel.textContent = Math.round(zoomLevel * 100) + '%';
  const idx = ZOOM_STEPS.indexOf(zoomLevel);
  zoomOutBtn.disabled = !lastQuantResult || idx <= 0;
  zoomInBtn.disabled  = !lastQuantResult || idx >= ZOOM_STEPS.length - 1;
}

zoomInBtn.addEventListener('click', () => {
  const idx = ZOOM_STEPS.indexOf(zoomLevel);
  if (idx < ZOOM_STEPS.length - 1) { zoomLevel = ZOOM_STEPS[idx + 1]; applyZoom(); }
});

zoomOutBtn.addEventListener('click', () => {
  const idx = ZOOM_STEPS.indexOf(zoomLevel);
  if (idx > 0) { zoomLevel = ZOOM_STEPS[idx - 1]; applyZoom(); }
});

// Ctrl+scroll over the stitch canvas → zoom in/out
stitchScrollWrap.addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;
  if (!lastQuantResult) return;
  e.preventDefault();
  const idx   = ZOOM_STEPS.indexOf(zoomLevel);
  const delta = e.deltaY < 0 ? 1 : -1;   // scroll-up = zoom in
  const newIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + delta));
  if (newIdx !== idx) { zoomLevel = ZOOM_STEPS[newIdx]; applyZoom(); }
}, { passive: false });

// ── Draw tool ─────────────────────────────────────────────────────────────────

drawBtn.addEventListener('click', () => {
  drawMode = !drawMode;
  drawBtn.classList.toggle('active', drawMode);
  if (drawMode) {
    // All three canvas tools are mutually exclusive
    eraseAreaMode = false;
    copyNeighborMode = false;
    eraseBtn.classList.remove('active');
    copyNeighborBtn.classList.remove('active');
    _eraseDrag = null;
    clearEraseOverlay();
    // Select first non-skipped color if current selection is invalid
    if (lastQuantResult) {
      const { palette } = lastQuantResult;
      if (drawPaintColor !== 255 && (drawPaintColor >= palette.length || skipColors.has(drawPaintColor))) {
        const first = Array.from({ length: palette.length }, (_, i) => i).find(i => !skipColors.has(i));
        if (first !== undefined) drawPaintColor = first;
      }
      updateDrawPanel();
    }
    drawPanel.classList.remove('hidden');
  } else {
    drawPanel.classList.add('hidden');
    _drawDrag = null;
  }
  eraseOverlay.classList.toggle('active', eraseAreaMode || copyNeighborMode || drawMode);
});

// Brush size buttons
drawPanel.querySelectorAll('.draw-brush-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    drawBrushSize = parseInt(btn.dataset.size, 10);
    drawPanel.querySelectorAll('.draw-brush-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

/**
 * Rebuild the color-swatch row in the draw panel to reflect the current palette.
 * Adds an eraser swatch (×) at the front, then one swatch per non-skipped color.
 */
function updateDrawPanel() {
  if (!lastQuantResult) return;
  const { palette, colorNames = [] } = lastQuantResult;
  drawColorRow.innerHTML = '';

  // Eraser swatch
  const eraserEl = document.createElement('span');
  eraserEl.className = 'draw-color-swatch eraser' + (drawPaintColor === 255 ? ' active' : '');
  eraserEl.title = 'Erase (set transparent)';
  eraserEl.textContent = '×';
  eraserEl.addEventListener('click', () => {
    drawPaintColor = 255;
    drawColorRow.querySelectorAll('.draw-color-swatch').forEach(s => s.classList.remove('active'));
    eraserEl.classList.add('active');
  });
  drawColorRow.appendChild(eraserEl);

  palette.forEach(([r, g, b], i) => {
    const el = document.createElement('span');
    el.className = 'draw-color-swatch' + (drawPaintColor === i ? ' active' : '');
    el.style.background = `rgb(${r},${g},${b})`;
    el.title = colorNames[i] || `Color ${i + 1}`;
    el.addEventListener('click', () => {
      drawPaintColor = i;
      drawColorRow.querySelectorAll('.draw-color-swatch').forEach(s => s.classList.remove('active'));
      el.classList.add('active');
    });
    drawColorRow.appendChild(el);
  });
}

/**
 * Paint a square brush of side `drawBrushSize` centred on (px, py) into indexMap.
 * colorIdx = 255 erases (makes transparent).
 */
function applyBrushPaint(px, py, colorIdx) {
  if (!lastQuantResult) return;
  const { indexMap, width, height } = lastQuantResult;
  const r = Math.floor(drawBrushSize / 2);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = px + dx, y = py + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      indexMap[y * width + x] = colorIdx;
    }
  }
}

/**
 * Bresenham line interpolation between (x0,y0) and (x1,y1), painting at each step.
 * Prevents gaps when the mouse moves faster than one pixel per event.
 */
function paintLine(x0, y0, x1, y1, colorIdx) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  for (;;) {
    applyBrushPaint(x, y, colorIdx);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 <  dx) { err += dx; y += sy; }
  }
}

/**
 * Start the erase drag.  We cache the bounding rect and scale factors here so
 * subsequent mousemove events don't need to recompute them on every pixel move.  We cache the bounding rect and scale factors here so
 * subsequent mousemove events don't need to recompute them on every pixel move.
 */
eraseOverlay.addEventListener('mousedown', e => {
  if ((!eraseAreaMode && !copyNeighborMode && !drawMode && !lassoMode) || !lastQuantResult) return;
  const rect   = eraseOverlay.getBoundingClientRect();
  const scaleX = lastQuantResult.width  / rect.width;
  const scaleY = lastQuantResult.height / rect.height;

  if (lassoMode) {
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top)  * scaleY;
    _lassoDrag = { points: [{ x: cx, y: cy }], rect, scaleX, scaleY };
    e.preventDefault();
    return;
  }

  if (drawMode) {
    const cx = Math.round((e.clientX - rect.left) * scaleX);
    const cy = Math.round((e.clientY - rect.top)  * scaleY);
    const erasing = e.button === 2;  // right-click = erase
    pushUndo();
    _drawDrag = { rect, scaleX, scaleY, erasing, prevX: cx, prevY: cy };
    applyBrushPaint(cx, cy, erasing ? 255 : drawPaintColor);
    const { palette, indexMap, width, height } = lastQuantResult;
    drawQuantizedPreview(palette, indexMap, width, height, skipColors);
    e.preventDefault();
    return;
  }

  _eraseDrag = {
    startX: Math.round((e.clientX - rect.left) * scaleX),
    startY: Math.round((e.clientY - rect.top)  * scaleY),
    rect, scaleX, scaleY,
  };
  e.preventDefault();
});

// Suppress context menu on right-click over overlay (used for erase in draw mode)
eraseOverlay.addEventListener('contextmenu', e => { if (drawMode) e.preventDefault(); });

/**
 * Update the selection rectangle while the mouse moves (even outside the overlay).
 */
document.addEventListener('mousemove', e => {
  if (lassoMode && _lassoDrag) {
    const { rect, scaleX, scaleY, points } = _lassoDrag;
    points.push({ x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY });
    drawLassoPath(points);
    return;
  }
  if (drawMode && _drawDrag) {
    const { rect, scaleX, scaleY, erasing } = _drawDrag;
    const cx = Math.round((e.clientX - rect.left) * scaleX);
    const cy = Math.round((e.clientY - rect.top)  * scaleY);
    paintLine(_drawDrag.prevX, _drawDrag.prevY, cx, cy, erasing ? 255 : drawPaintColor);
    _drawDrag.prevX = cx;
    _drawDrag.prevY = cy;
    const { palette, indexMap, width, height } = lastQuantResult;
    drawQuantizedPreview(palette, indexMap, width, height, skipColors);
    return;
  }
  if (!_eraseDrag || (!eraseAreaMode && !copyNeighborMode)) return;
  const { startX, startY, rect, scaleX, scaleY } = _eraseDrag;
  const curX = Math.round((e.clientX - rect.left) * scaleX);
  const curY = Math.round((e.clientY - rect.top)  * scaleY);
  drawEraseRect(startX, startY, curX, curY, eraseAreaMode);
});

/**
 * Finish the drag: dispatch to the active tool (erase, fill-neighbor, or draw).
 */
document.addEventListener('mouseup', e => {
  if (lassoMode && _lassoDrag) {
    const pts = _lassoDrag.points;
    _lassoDrag = null;
    if (pts.length >= 3) {
      _lassoSelection = pts;
      drawLassoPath(pts);          // keep the outline visible
      showLassoActionBar();
    } else {
      clearEraseOverlay();
    }
    return;
  }
  if (drawMode && _drawDrag) {
    _drawDrag = null;
    const { palette, indexMap, width, height, colorNames = [] } = lastQuantResult;
    renderSwatches(palette, indexMap, skipColors, colorNames);
    updateStitchPreview();
    setStatus('Draw applied — Ctrl+Z to undo');
    return;
  }
  if (!_eraseDrag || (!eraseAreaMode && !copyNeighborMode)) return;
  const { startX, startY, rect, scaleX, scaleY } = _eraseDrag;
  const endX = Math.round((e.clientX - rect.left) * scaleX);
  const endY = Math.round((e.clientY - rect.top)  * scaleY);
  const wasErase = eraseAreaMode;   // capture before clearing
  _eraseDrag = null;
  clearEraseOverlay();
  // Only act when the user dragged a meaningful area (> 2 px in any direction)
  if (Math.abs(endX - startX) > 2 || Math.abs(endY - startY) > 2) {
    if (wasErase) {
      applyAreaErase(startX, startY, endX, endY);
    } else {
      applyCopyNeighborColor(startX, startY, endX, endY);
    }
  }
  // Keep the active tool mode on — user clicks button again (or Escape) to exit
});

/**
 * Draw a dashed selection rectangle on the overlay canvas.
 * @param {boolean} isErase  true → red (erase), false → green (fill-neighbor)
 */
function drawEraseRect(x1, y1, x2, y2, isErase = true) {
  const ctx = eraseOverlay.getContext('2d');
  ctx.clearRect(0, 0, eraseOverlay.width, eraseOverlay.height);
  const rx = Math.min(x1, x2);
  const ry = Math.min(y1, y2);
  const rw = Math.abs(x2 - x1);
  const rh = Math.abs(y2 - y1);
  if (rw < 1 && rh < 1) return;
  const fillRgba   = isErase ? 'rgba(231,76,60,0.12)'  : 'rgba(39,174,96,0.12)';
  const strokeRgba = isErase ? 'rgba(231,76,60,0.9)'   : 'rgba(39,174,96,0.9)';
  ctx.fillStyle   = fillRgba;
  ctx.fillRect(rx, ry, rw, rh);
  ctx.strokeStyle = strokeRgba;
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
  ctx.setLineDash([]);
}

/** Clear the erase overlay canvas. */
function clearEraseOverlay() {
  eraseOverlay.getContext('2d').clearRect(0, 0, eraseOverlay.width, eraseOverlay.height);
}

/**
 * Set all indexMap pixels inside the rectangle to 255 (transparent / erased),
 * then refresh all three previews and push an undo snapshot.
 *
 * Coordinates are in working-canvas pixel space (same as indexMap).
 */
function applyAreaErase(x1, y1, x2, y2) {
  if (!lastQuantResult) return;
  pushUndo();
  const { indexMap, width, height, palette, colorNames = [] } = lastQuantResult;
  const xMin = Math.max(0,         Math.min(x1, x2));
  const xMax = Math.min(width - 1, Math.max(x1, x2));
  const yMin = Math.max(0,          Math.min(y1, y2));
  const yMax = Math.min(height - 1, Math.max(y1, y2));
  let changed = 0;
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      if (indexMap[y * width + x] !== 255) {
        indexMap[y * width + x] = 255;
        changed++;
      }
    }
  }
  if (changed === 0) {
    // Nothing was erased — revert the speculative undo push
    undoStack.pop();
    updateUndoRedoBtns();
    setStatus('Nothing to erase in that area');
    return;
  }
  drawQuantizedPreview(palette, indexMap, width, height, skipColors);
  renderSwatches(palette, indexMap, skipColors, colorNames);
  updateStitchPreview();
  setStatus(`Erased ${changed.toLocaleString()} pixel${changed !== 1 ? 's' : ''} — Ctrl+Z to undo`);
}

/** Ray-casting point-in-polygon test. */
function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (((yi > py) !== (yj > py)) && px < (xj - xi) * (py - yi) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Draw the freehand lasso outline on the erase overlay. */
function drawLassoPath(pts) {
  const ctx = eraseOverlay.getContext('2d');
  ctx.clearRect(0, 0, eraseOverlay.width, eraseOverlay.height);
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(231,76,60,0.9)';
  ctx.fillStyle   = 'rgba(231,76,60,0.10)';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * Show the lasso action bar populated with palette colour swatches.
 * Called after the user finishes drawing a selection.
 */
function showLassoActionBar() {
  if (!lastQuantResult) return;
  const { palette, colorNames = [] } = lastQuantResult;

  // Rebuild colour swatches
  lassoColorSwatches.innerHTML = '';
  palette.forEach((col, idx) => {
    if (skipColors.has(idx)) return;
    const [r, g, b] = col;
    const name = colorNames[idx] || `Color ${idx + 1}`;
    const sw = document.createElement('button');
    sw.className = 'lasso-swatch';
    sw.style.background = `rgb(${r},${g},${b})`;
    sw.title = `Recolor selection → ${name}`;
    sw.addEventListener('click', () => applyLassoAction(idx));
    lassoColorSwatches.appendChild(sw);
  });

  lassoActionBar.classList.remove('hidden');
}

/** Hide the action bar and clear the lasso selection state. */
function clearLassoSelection() {
  _lassoSelection = null;
  lassoActionBar.classList.add('hidden');
  clearEraseOverlay();
}

/**
 * Apply a lasso action to all pixels inside _lassoSelection.
 * targetIdx: palette index to assign (255 = erase/transparent).
 */
function applyLassoAction(targetIdx) {
  const pts = _lassoSelection;
  if (!lastQuantResult || !pts || pts.length < 3) return;
  pushUndo();
  const { indexMap, width, height, palette, colorNames = [] } = lastQuantResult;

  // Bounding box to limit the per-pixel loop
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const xMin = Math.max(0,          Math.floor(Math.min(...xs)));
  const xMax = Math.min(width - 1,  Math.ceil(Math.max(...xs)));
  const yMin = Math.max(0,          Math.floor(Math.min(...ys)));
  const yMax = Math.min(height - 1, Math.ceil(Math.max(...ys)));

  let changed = 0;
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const i = y * width + x;
      if (indexMap[i] !== targetIdx && pointInPolygon(x + 0.5, y + 0.5, pts)) {
        indexMap[i] = targetIdx;
        changed++;
      }
    }
  }

  clearLassoSelection();

  if (changed === 0) {
    undoStack.pop(); updateUndoRedoBtns();
    setStatus('No pixels changed inside lasso');
    return;
  }
  drawQuantizedPreview(palette, indexMap, width, height, skipColors);
  renderSwatches(palette, indexMap, skipColors, colorNames);
  updateStitchPreview();
  const action = targetIdx === 255 ? 'erased' : `recolored to ${colorNames[targetIdx] || `color ${targetIdx + 1}`}`;
  setStatus(`Lasso ${action} ${changed.toLocaleString()} pixel${changed !== 1 ? 's' : ''} — Ctrl+Z to undo`);
}

/**
 * Fill every pixel inside the rectangle with the most common color found in
 * the 1-pixel ring immediately outside the rectangle's border.
 *
 * This effectively "paints over" a selected area with the surrounding color,
 * making it blend into its background region.
 *
 * Coordinates are in working-canvas pixel space (same as indexMap).
 */
function applyCopyNeighborColor(x1, y1, x2, y2) {
  if (!lastQuantResult) return;
  pushUndo();
  const { indexMap, width, height, palette, colorNames = [] } = lastQuantResult;
  const xMin = Math.max(0,         Math.min(x1, x2));
  const xMax = Math.min(width - 1, Math.max(x1, x2));
  const yMin = Math.max(0,          Math.min(y1, y2));
  const yMax = Math.min(height - 1, Math.max(y1, y2));

  // Count color frequencies in the 1-pixel ring just outside the rectangle
  const colorCounts = new Array(palette.length).fill(0);

  // Top / bottom border rows
  for (let x = xMin; x <= xMax; x++) {
    if (yMin > 0) {
      const ci = indexMap[(yMin - 1) * width + x];
      if (ci < palette.length) colorCounts[ci]++;
    }
    if (yMax < height - 1) {
      const ci = indexMap[(yMax + 1) * width + x];
      if (ci < palette.length) colorCounts[ci]++;
    }
  }
  // Left / right border columns (including corners)
  for (let y = Math.max(0, yMin - 1); y <= Math.min(height - 1, yMax + 1); y++) {
    if (xMin > 0) {
      const ci = indexMap[y * width + (xMin - 1)];
      if (ci < palette.length) colorCounts[ci]++;
    }
    if (xMax < width - 1) {
      const ci = indexMap[y * width + (xMax + 1)];
      if (ci < palette.length) colorCounts[ci]++;
    }
  }

  // Find the most common neighboring color (ignoring transparent / erased pixels)
  let neighborColor = -1, maxCount = 0;
  for (let ci = 0; ci < palette.length; ci++) {
    if (colorCounts[ci] > maxCount) { maxCount = colorCounts[ci]; neighborColor = ci; }
  }

  if (neighborColor === -1) {
    undoStack.pop(); updateUndoRedoBtns();
    setStatus('No neighboring color found — try a larger area or near a colored region');
    return;
  }

  // Paint the neighbor color onto every pixel inside the rectangle
  let changed = 0;
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const idx = y * width + x;
      if (indexMap[idx] !== neighborColor) {
        indexMap[idx] = neighborColor;
        changed++;
      }
    }
  }

  if (changed === 0) {
    undoStack.pop(); updateUndoRedoBtns();
    setStatus('Area is already that color');
    return;
  }

  drawQuantizedPreview(palette, indexMap, width, height, skipColors);
  renderSwatches(palette, indexMap, skipColors, colorNames);
  updateStitchPreview();
  const colorLabel = colorNames[neighborColor] || `color ${neighborColor + 1}`;
  setStatus(`Filled ${changed.toLocaleString()} pixel${changed !== 1 ? 's' : ''} with ${colorLabel} — Ctrl+Z to undo`);
}

// ── Segmentation ──────────────────────────────────────────────────────────────

/**
 * Kick off BodyPix segmentation asynchronously (non-blocking).
 * Called after runQuantize() completes, passing the same working canvas.
 * Falls back gracefully when offline or when the CDN scripts have not loaded.
 *
 * @param {HTMLCanvasElement} canvas  The working canvas (same size as indexMap)
 */
async function triggerSegmentation(canvas) {
  // Guard: CDN scripts may not be available (e.g. offline or file:// without network)
  if (typeof bodyPix === 'undefined') return;

  // Capture this invocation's generation so we can detect if a newer call superseded us
  const gen = ++_segGeneration;
  showSegStatus('running', 'Recognising figure\u2026', []);

  try {
    const result = await segmentImage(canvas);   // from segmenter.js

    // Discard if a newer quantize + segmentation has been triggered while we awaited
    if (gen !== _segGeneration) return;

    // Validate that the partMap dimensions still match the current indexMap.
    // They can diverge when the user changes Width/Colors while segmentation is in flight.
    if (lastQuantResult &&
        (result.width !== lastQuantResult.width || result.height !== lastQuantResult.height)) {
      console.warn('[app] partMap dimensions mismatch indexMap — discarding stale segmentation');
      showSegStatus('none', 'Recognition outdated — reload image to re-detect', []);
      return;
    }

    lastSegResult = result;

    if (!result.personFound) {
      showSegStatus('none', 'No person detected', []);
      return;
    }

    const groups = getDetectedGroupNames(result.detectedPartIds, result);
    showSegStatus('done', 'Person detected:', groups.map(g => g.label));

  } catch (err) {
    if (gen !== _segGeneration) return;   // superseded — ignore the error too
    console.warn('[app] Segmentation failed:', err);
    lastSegResult = null;
    showSegStatus('none', 'Recognition unavailable', []);
  }
}

/**
 * Update the segmentation status bar UI.
 *
 * @param {'running'|'done'|'none'} state
 * @param {string}   message
 * @param {string[]} partLabels  Human-readable part labels for clickable badges
 */
function showSegStatus(state, message, partLabels) {
  segStatus.classList.remove('hidden', 'seg-running', 'seg-done', 'seg-none');
  segStatus.classList.add('seg-' + state);
  segIcon.textContent = state === 'running' ? '\u25CE'   // ◎ spinner
                      : state === 'done'    ? '\u2713'   // ✓
                      :                       '\u25CB';  // ○ empty
  segText.textContent = message;
  segParts.innerHTML  = '';
  partLabels.forEach(label => {
    const badge = document.createElement('span');
    badge.className   = 'seg-part-badge';
    badge.textContent = label;
    // Clicking a badge pre-fills the request input with a template command
    badge.addEventListener('click', () => {
      requestInput.value = `the ${label} in 1 color`;
      requestInput.focus();
    });
    segParts.appendChild(badge);
  });
}

/**
 * Determine which named body groups were actually detected.
 * Returns entries in top-to-bottom body order.
 *
 * @param {Set<number>}  detectedPartIds
 * @param {SegmentResult} segResult
 * @returns {Array<{key:string, label:string}>}
 */
function getDetectedGroupNames(detectedPartIds, segResult) {
  const found = [];

  // Hat first (heuristic — always check if there's something above the face)
  const hatPx = getHatPixels(segResult.partMap, segResult.width, segResult.height);
  if (hatPx.size > 0) found.push({ key: 'hat', label: PART_LABELS.hat });

  // Then check each BODY_GROUPS entry in insertion order (top → bottom)
  for (const [key, partSet] of Object.entries(BODY_GROUPS)) {
    for (const id of partSet) {
      if (detectedPartIds.has(id)) {
        found.push({ key, label: PART_LABELS[key] });
        break;
      }
    }
  }

  return found;
}

/**
 * Collect all pixel indices belonging to a body group.
 * For the 'hat' sentinel, delegates to getHatPixels() from bodyparts.js.
 *
 * @param {Set<number>|'hat'} groupPartIds  BodyPix part IDs or 'hat' sentinel
 * @param {SegmentResult}     segResult
 * @returns {Set<number>}  Pixel indices (working-canvas coordinate space)
 */
function getRegionPixels(groupPartIds, segResult) {
  if (groupPartIds === 'hat') {
    return getHatPixels(segResult.partMap, segResult.width, segResult.height);
  }
  const { partMap } = segResult;
  const pixels = new Set();
  for (let i = 0; i < partMap.length; i++) {
    if (groupPartIds.has(partMap[i])) pixels.add(i);
  }
  return pixels;
}

// ── Undo / redo ───────────────────────────────────────────────────────────────

function captureState() {
  return {
    widthMm:         widthInput.value,
    numColors:       colorsInput.value,
    densityMm:       densityInput.value,
    stitchMm:        stitchInput.value,
    fillAngle:       angleInput.value,
    skipColors:      new Set(skipColors),
    lockedColors:    new Set(lockedColors),
    outlineOnly,
    brightnessAdjust,
    contrastAdjust,
    sharpness,
    flipH, flipV, rotateCW,
    colorAngles:     { ...colorAngles },
    colorFillTypes:  { ...colorFillTypes },
    threadSnap:      threadSnap ? [...threadSnap] : null,
    depixelateLevel,
    watermarkOpacity,
    quantResult: lastQuantResult ? {
      palette:  lastQuantResult.palette.map(c => [...c]),
      indexMap: new Uint8Array(lastQuantResult.indexMap),  // snapshot copy
      width:    lastQuantResult.width,
      height:   lastQuantResult.height,
    } : null,
  };
}

function pushUndo() {
  undoStack.push(captureState());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  updateUndoRedoBtns();
}

function applySnapshot(snap) {
  clearTimeout(debounceTimer);
  debounceUndoPushed = false;
  widthInput.value   = snap.widthMm;
  colorsInput.value  = snap.numColors;
  densityInput.value = snap.densityMm;
  stitchInput.value  = snap.stitchMm;
  angleInput.value   = snap.fillAngle;
  skipColors.clear();
  snap.skipColors.forEach(ci => skipColors.add(ci));
  lockedColors.clear();
  if (snap.lockedColors) snap.lockedColors.forEach(ci => lockedColors.add(ci));
  outlineOnly = snap.outlineOnly;
  if (snap.brightnessAdjust !== undefined) { brightnessAdjust = snap.brightnessAdjust; brightnessInput.value = brightnessAdjust; }
  if (snap.contrastAdjust   !== undefined) { contrastAdjust   = snap.contrastAdjust;   contrastInput.value   = contrastAdjust; }
  if (snap.sharpness !== undefined) sharpness = snap.sharpness;
  if (snap.flipH !== undefined) flipH = snap.flipH;
  if (snap.flipV !== undefined) flipV = snap.flipV;
  if (snap.rotateCW !== undefined) rotateCW = snap.rotateCW;
  colorAngles    = snap.colorAngles    ? { ...snap.colorAngles }    : {};
  colorFillTypes = snap.colorFillTypes ? { ...snap.colorFillTypes } : {};
  threadSnap     = snap.threadSnap ? [...snap.threadSnap] : null;
  if (snap.depixelateLevel  !== undefined) depixelateLevel = snap.depixelateLevel;
  if (snap.watermarkOpacity !== undefined) {
    watermarkOpacity = snap.watermarkOpacity;
    if (watermarkRange) watermarkRange.value = watermarkOpacity;
  }
  if (snap.quantResult) {
    lastQuantResult = {
      ...snap.quantResult,
      colorNames: snap.quantResult.palette.map(namedColorOf),
    };
    const { palette, indexMap, width, height, colorNames } = lastQuantResult;
    drawQuantizedPreview(palette, indexMap, width, height, skipColors);
    renderSwatches(palette, indexMap, skipColors, colorNames);
    if (currentStage === 2) renderThreadPanel();
    updateStitchPreview();
    // Revalidate solo mode — the restored state may have removed the active layer
    if (soloLayer !== null) {
      const newOrder = getActiveColorOrder();
      if (!newOrder.includes(soloLayer)) {
        soloLayer = null;
        soloBtn.classList.remove('active');
        layerNav.classList.add('hidden');
      } else {
        updateLayerNav();
      }
    }
    if (drawMode) updateDrawPanel();
    previewSection.classList.remove('hidden');
    requestBox.classList.remove('hidden');
    stage1Bar.classList.remove('hidden');
    convertBtn.disabled = false;
    if (currentStage === 2) exportBtn.disabled = false;
  }
  setStatus('Restored');
}

function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(captureState());
  applySnapshot(undoStack.pop());
  updateUndoRedoBtns();
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(captureState());
  applySnapshot(redoStack.pop());
  updateUndoRedoBtns();
}

function updateUndoRedoBtns() {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

document.addEventListener('keydown', e => {
  // Solo mode: ArrowLeft / ArrowRight navigate between layers; Escape exits
  if (soloLayer !== null) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const order = getActiveColorOrder();
      const pos = order.indexOf(soloLayer);
      if (pos > 0) { soloLayer = order[pos - 1]; updateLayerNav(); updateStitchPreview(); }
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const order = getActiveColorOrder();
      const pos = order.indexOf(soloLayer);
      if (pos < order.length - 1) { soloLayer = order[pos + 1]; updateLayerNav(); updateStitchPreview(); }
      return;
    }
    if (e.key === 'Escape') { exitSoloMode(); return; }
  }
  // Escape cancels the area selection tool
  if (e.key === 'Escape' && (selectAreaMode || selectedPixels !== null)) {
    selectAreaMode = false;
    selectAreaBtn.classList.remove('active');
    clearSelection();
    return;
  }
  // Escape exits any active canvas-tool mode (and cancels any in-progress drag)
  if (e.key === 'Escape' && (eraseAreaMode || copyNeighborMode || drawMode || lassoMode || _lassoSelection)) {
    eraseAreaMode    = false;
    copyNeighborMode = false;
    eraseBtn.classList.remove('active');
    copyNeighborBtn.classList.remove('active');
    eraseOverlay.classList.remove('active');
    _eraseDrag = null;
    drawMode = false;
    drawBtn.classList.remove('active');
    drawPanel.classList.add('hidden');
    _drawDrag = null;
    lassoMode = false;
    lassoBtn.classList.remove('active');
    _lassoDrag = null;
    clearLassoSelection();
    return;
  }
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
});

// Quick-action chips — each chip passes its canned command string to applyRequest
chipsContainer.addEventListener('click', e => {
  const chip = e.target.closest('[data-cmd]');
  if (!chip) return;
  applyRequest(chip.dataset.cmd);
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function downloadBlob(data, filename, mime) {
  const blob = new Blob([data], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className   = 'status' + (cls ? ' ' + cls : '');
}

function clampInt(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(v) || lo));
}

// Settings change listeners (debounced)
let debounceTimer;
let debounceUndoPushed = false;   // true = undo already saved for this edit session

// Width and colors → re-quantize (stage 1 settings)
[widthInput, colorsInput].forEach(el => {
  el.addEventListener('input', () => {
    if (!debounceUndoPushed && loadedImage && lastQuantResult) {
      pushUndo();
      debounceUndoPushed = true;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceUndoPushed = false;
      if (loadedImage) {
        convertBtn.disabled = true;
        runQuantize(loadedImage);
      }
    }, 400);
  });
});

// Density, stitch length, fill angle → re-render stitch preview only (stage 2 settings)
[densityInput, stitchInput, angleInput].forEach(el => {
  el.addEventListener('input', () => {
    if (!debounceUndoPushed && loadedImage && lastQuantResult) {
      pushUndo();
      debounceUndoPushed = true;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceUndoPushed = false;
      if (currentStage === 2) updateStitchPreview();
    }, 400);
  });
});

// Brightness / contrast inputs → re-quantize (debounced)
[brightnessInput, contrastInput].forEach(el => {
  el.addEventListener('input', () => {
    brightnessAdjust = clampInt(Number(brightnessInput.value), 50, 150);
    contrastAdjust   = clampInt(Number(contrastInput.value),   50, 150);
    if (!debounceUndoPushed) { pushUndo(); debounceUndoPushed = true; }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceUndoPushed = false;
      if (loadedImage) runQuantize(loadedImage);
    }, 500);
  });
});

// Thread-angle inputs in Stage 2 panel → update colorAngles + re-render
threadAngleRows.addEventListener('input', e => {
  const input = e.target.closest('[data-angle-idx]');
  if (!input) return;
  const ci  = parseInt(input.dataset.angleIdx, 10);
  const raw = input.value.trim();
  if (raw === '') {
    delete colorAngles[ci];
  } else {
    colorAngles[ci] = Math.max(0, Math.min(89, parseInt(raw, 10) || 0));
  }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => updateStitchPreview(), 400);
});

// Fill-type buttons in Stage 2 thread panel
threadAngleRows.addEventListener('click', e => {
  const btn = e.target.closest('[data-fill-type]');
  if (!btn) return;
  const ci = parseInt(btn.dataset.fillIdx, 10);
  const ft = btn.dataset.fillType;
  if (ft === 'satin') delete colorFillTypes[ci]; else colorFillTypes[ci] = ft;
  // Update active state on sibling buttons
  btn.closest('.thread-fill-btns').querySelectorAll('.thread-fill-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.fillType === (colorFillTypes[ci] || 'satin'));
  });
  pushUndo();
  updateStitchPreview();
});

// Watermark opacity slider
watermarkRange.addEventListener('input', () => {
  watermarkOpacity = Number(watermarkRange.value);
  if (lastStitchRecords && lastColorOrder && lastQuantResult) {
    const { palette, width, height } = lastQuantResult;
    renderStitchPreview(lastStitchRecords, palette, lastColorOrder, width, height, soloLayer);
  }
});

// ── Move-stitch tool ──────────────────────────────────────────────────────────

lassoBtn.addEventListener('click', () => {
  lassoMode = !lassoMode;
  lassoBtn.classList.toggle('active', lassoMode);
  eraseOverlay.classList.toggle('active', eraseAreaMode || copyNeighborMode || drawMode || lassoMode);
  if (lassoMode) {
    if (eraseAreaMode)    eraseBtn.click();
    if (copyNeighborMode) copyNeighborBtn.click();
    if (drawMode)         drawBtn.click();
    if (moveMode)         moveStitchBtn.click();
    eraseOverlay.style.cursor = 'crosshair';
  } else {
    _lassoDrag = null;
    clearLassoSelection();
    eraseOverlay.style.cursor = '';
  }
});

lassoEraseBtn.addEventListener('click', () => applyLassoAction(255));
lassoCancelBtn.addEventListener('click', () => clearLassoSelection());

moveStitchBtn.addEventListener('click', () => {
  moveMode = !moveMode;
  moveStitchBtn.classList.toggle('active', moveMode);
  if (moveMode) {
    // Exit other exclusive tools
    if (eraseAreaMode)    eraseBtn.click();
    if (copyNeighborMode) copyNeighborBtn.click();
    if (drawMode)         drawBtn.click();
    if (lassoMode)        lassoBtn.click();
    stitchCanvas.style.cursor = 'crosshair';
  } else {
    stitchCanvas.style.cursor = '';
    _moveDrag = null;
  }
});

stitchCanvas.addEventListener('mousedown', e => {
  if (!moveMode || !lastStitchRecords || !lastQuantResult) return;
  const rect   = stitchCanvas.getBoundingClientRect();
  const scaleX = stitchCanvas.width  / rect.width;
  const scaleY = stitchCanvas.height / rect.height;
  const cx     = (e.clientX - rect.left)  * scaleX;
  const cy     = (e.clientY - rect.top)   * scaleY;
  const h      = stitchCanvas.height;

  let bestIdx = -1, bestDist = 12 * Math.max(scaleX, scaleY);
  for (let i = 0; i < lastStitchRecords.length; i++) {
    const r = lastStitchRecords[i];
    if (r.type !== 'STITCH') continue;
    const d = Math.hypot(r.x / 2 - cx, h - 1 - r.y / 2 - cy);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  if (bestIdx >= 0) { _moveDrag = { idx: bestIdx }; e.preventDefault(); }
}, { passive: false });

stitchCanvas.addEventListener('mousemove', e => {
  if (!_moveDrag || !lastStitchRecords || !lastQuantResult) return;
  const rect   = stitchCanvas.getBoundingClientRect();
  const scaleX = stitchCanvas.width  / rect.width;
  const scaleY = stitchCanvas.height / rect.height;
  const cx     = (e.clientX - rect.left)  * scaleX;
  const cy     = (e.clientY - rect.top)   * scaleY;
  const h      = stitchCanvas.height;

  const rec = lastStitchRecords[_moveDrag.idx];
  rec.x = Math.max(0, Math.round(cx * 2));
  rec.y = Math.max(0, Math.round((h - 1 - cy) * 2));

  const { palette, width, height } = lastQuantResult;
  renderStitchPreview(lastStitchRecords, palette, lastColorOrder, width, height, soloLayer);
});

stitchCanvas.addEventListener('mouseup', () => { _moveDrag = null; });
stitchCanvas.addEventListener('mouseleave', () => { _moveDrag = null; });
