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

// ── State ─────────────────────────────────────────────────────────────────────
let loadedImage     = null;   // HTMLImageElement
let currentFile     = null;   // File object (for filename)
let lastQuantResult = null;   // { palette, indexMap, width, height } cached after quantize
let skipColors      = new Set();  // color indices excluded from stitching
let outlineOnly     = false;      // stitch outlines instead of fills

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

// ── File handling ─────────────────────────────────────────────────────────────
function handleFile(file) {
  currentFile = file;
  skipColors.clear();
  outlineOnly = false;
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
  exportBtn.disabled = true;

  setTimeout(() => {
    try {
      const { canvas } = buildWorkingCanvas(img);
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const k = clampInt(Number(colorsInput.value), 2, 16);

      let { palette, indexMap } = quantizeImage(imageData, k);

      // Smooth out anti-alias noise: replace each pixel with the majority color
      // in its 3×3 neighbourhood (one pass is enough to remove 1-pixel speckles)
      indexMap = smoothIndexMap(indexMap, canvas.width, canvas.height, k);

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
      updateStitchPreview();

      previewSection.classList.remove('hidden');
      requestBox.classList.remove('hidden');
      exportBtn.disabled = false;
      setStatus(`Ready — ${palette.length} colors, ${canvas.width}×${canvas.height} px working size`);
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

function buildWorkingCanvas(img) {
  const targetMm  = Math.max(10, Math.min(500, Number(widthInput.value) || 100));
  const PX_PER_MM = 5;
  const scale     = (targetMm * PX_PER_MM) / Math.max(img.width, img.height);
  const w = Math.round(img.width  * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return { canvas, w, h };
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

function renderSwatches(palette, indexMap, skippedColors, colorNames = []) {
  const counts = new Array(palette.length).fill(0);
  for (const idx of indexMap) { if (idx < palette.length) counts[idx]++; }
  const total = counts.reduce((a, b) => a + b, 0);

  swatchContainer.innerHTML = '';
  palette.forEach(([r, g, b], i) => {
    const pct     = total > 0 ? Math.round((counts[i] / total) * 100) : 0;
    const skipped = skippedColors.has(i);
    const name    = colorNames[i] || '';
    const div = document.createElement('div');
    div.className = 'swatch' + (skipped ? ' swatch--skipped' : '');
    div.title = name
      ? `${name} — ${skipped ? 'click to restore' : 'click to remove'}`
      : (skipped ? 'Click to restore thread' : 'Click to remove thread');
    div.dataset.colorIdx = i;
    div.innerHTML = `
      <span class="swatch-color" style="background:rgb(${r},${g},${b});${skipped ? 'opacity:0.35' : ''}"></span>
      <span class="swatch-info${skipped ? ' swatch-info--skip' : ''}">
        ${name ? `<span class="swatch-name">${name}</span>` : ''}
        <span class="swatch-pct">${pct}%</span>
      </span>`;
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
  if (!lastQuantResult) return;
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

// Click on a palette swatch → toggle that thread
swatchContainer.addEventListener('click', e => {
  const swatch = e.target.closest('[data-color-idx]');
  if (!swatch) return;
  const ci = parseInt(swatch.dataset.colorIdx, 10);
  if (!isNaN(ci)) toggleColor(ci);
});

// ── Export ────────────────────────────────────────────────────────────────────
function runExport() {
  if (!loadedImage) return;
  setStatus('Generating stitches…');
  exportBtn.disabled = true;

  setTimeout(() => {
    try {
      const { canvas } = buildWorkingCanvas(loadedImage);
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const k           = clampInt(Number(colorsInput.value), 2, 16);
      const densityMm   = Math.max(0.2, Math.min(2.0, Number(densityInput.value) || 0.4));
      const stitchMm    = Math.max(1.0, Math.min(6.0,  Number(stitchInput.value)  || 3.0));
      const PX_PER_MM   = 5;
      const pitchPx     = Math.max(1, Math.round(densityMm * PX_PER_MM));
      const stitchLenPx = Math.max(1, Math.round(stitchMm  * PX_PER_MM));

      let { palette, indexMap } = quantizeImage(imageData, k);
      indexMap = smoothIndexMap(indexMap, canvas.width, canvas.height, k);
      const fillAngleDeg = clampInt(Number(angleInput.value), 0, 89);
      const records = generateStitches(
        indexMap, canvas.width, canvas.height, palette,
        { pitchPx, stitchLenPx, skipColors, outlineOnly, minRegionPx: 40, fillAngleDeg }
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

      if (matchedIndices.size > 0) {
        if (keepOnly) {
          skipColors.clear();
          colorNames.forEach((_, i) => { if (!matchedIndices.has(i)) skipColors.add(i); });
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

  // ── Reset to defaults ────────────────────────────────────────────────────────
  if (/\b(reset\s+(all|everything)|start\s+over)\b/.test(t) ||
      (t.trim() === 'reset' && changes.length === 0)) {
    widthInput.value   = 100;
    colorsInput.value  = 6;
    densityInput.value = 0.3;
    stitchInput.value  = 2.5;
    angleInput.value   = 45;
    skipColors.clear();
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
    { pitchPx, stitchLenPx, skipColors, outlineOnly, minRegionPx: 40, fillAngleDeg }
  );

  // Rebuild the same color order as stitcher.js (sorted by pixel count desc)
  const k = palette.length;
  const counts = new Array(k).fill(0);
  for (let i = 0; i < indexMap.length; i++) {
    if (indexMap[i] < k) counts[indexMap[i]]++;
  }
  const colorOrder = Array.from({ length: k }, (_, i) => i)
    .filter(i => counts[i] > 0 && !skipColors.has(i))
    .sort((a, b) => counts[b] - counts[a]);

  renderStitchPreview(records, palette, colorOrder, width, height);
}

/**
 * Draw the stitch records onto the stitch preview canvas.
 * Stitches are drawn as coloured lines; jump moves are skipped.
 * A subtle 10 mm grid is rendered behind the stitches.
 *
 * @param {Array}    records     Output of generateStitches()
 * @param {number[][]} palette   [r,g,b] entries
 * @param {number[]} colorOrder  Palette indices in the order they appear in records
 * @param {number}   w           Working canvas width in pixels
 * @param {number}   h           Working canvas height in pixels
 */
function renderStitchPreview(records, palette, colorOrder, w, h) {
  stitchCanvas.width  = w;
  stitchCanvas.height = h;
  const ctx = stitchCanvas.getContext('2d');

  // Fabric-coloured background
  ctx.fillStyle = '#faf8f5';
  ctx.fillRect(0, 0, w, h);

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

  // Draw stitches, batched by color phase for performance
  let phase      = 0;
  let prevX      = 0;
  let prevY      = 0;
  let prevIsJump = true; // true = previous position came from a JUMP (start fresh sub-path)

  ctx.lineWidth  = 1.2;
  ctx.lineCap    = 'round';
  ctx.lineJoin   = 'round';

  // Start first path
  const firstColor = palette[colorOrder[0]] || [0, 0, 0];
  ctx.strokeStyle = `rgb(${firstColor[0]},${firstColor[1]},${firstColor[2]})`;
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
        const [r, g, b] = palette[colorOrder[phase]] || [0, 0, 0];
        ctx.strokeStyle = `rgb(${r},${g},${b})`;
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

// ── Undo / redo ───────────────────────────────────────────────────────────────

function captureState() {
  return {
    widthMm:    widthInput.value,
    numColors:  colorsInput.value,
    densityMm:  densityInput.value,
    stitchMm:   stitchInput.value,
    fillAngle:  angleInput.value,
    skipColors: new Set(skipColors),
    outlineOnly,
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
  outlineOnly = snap.outlineOnly;
  if (snap.quantResult) {
    lastQuantResult = {
      ...snap.quantResult,
      colorNames: snap.quantResult.palette.map(namedColorOf),
    };
    const { palette, indexMap, width, height, colorNames } = lastQuantResult;
    drawQuantizedPreview(palette, indexMap, width, height, skipColors);
    renderSwatches(palette, indexMap, skipColors, colorNames);
    updateStitchPreview();
    previewSection.classList.remove('hidden');
    requestBox.classList.remove('hidden');
    exportBtn.disabled = false;
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

// Re-run quantize preview when settings change (debounced)
let debounceTimer;
let debounceUndoPushed = false;   // true = undo already saved for this edit session
[widthInput, colorsInput, densityInput, stitchInput, angleInput].forEach(el => {
  el.addEventListener('input', () => {
    // Capture the state once, BEFORE any keystroke in this editing session changes it
    if (!debounceUndoPushed && loadedImage && lastQuantResult) {
      pushUndo();
      debounceUndoPushed = true;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceUndoPushed = false;
      if (loadedImage) { exportBtn.disabled = true; runQuantize(loadedImage); }
    }, 400);
  });
});
