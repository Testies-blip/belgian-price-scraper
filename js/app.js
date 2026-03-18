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

// ── State ─────────────────────────────────────────────────────────────────────
let loadedImage     = null;   // HTMLImageElement
let currentFile     = null;   // File object (for filename)
let lastQuantResult = null;   // { palette, indexMap, width, height } cached after quantize
let skipColors      = new Set();  // color indices excluded from stitching
let outlineOnly     = false;      // stitch outlines instead of fills

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

      lastQuantResult = { palette, indexMap, width: canvas.width, height: canvas.height };

      drawQuantizedPreview(palette, indexMap, canvas.width, canvas.height, skipColors);
      renderSwatches(palette, indexMap, skipColors);

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

function renderSwatches(palette, indexMap, skippedColors) {
  const counts = new Array(palette.length).fill(0);
  for (const idx of indexMap) { if (idx < palette.length) counts[idx]++; }
  const total = counts.reduce((a, b) => a + b, 0);

  swatchContainer.innerHTML = '';
  palette.forEach(([r, g, b], i) => {
    const pct     = total > 0 ? Math.round((counts[i] / total) * 100) : 0;
    const skipped = skippedColors.has(i);
    const div = document.createElement('div');
    div.className = 'swatch' + (skipped ? ' swatch--skipped' : '');
    div.title = skipped ? 'Excluded from stitching' : '';
    div.innerHTML = `
      <span class="swatch-color" style="background:rgb(${r},${g},${b});${skipped ? 'opacity:0.35' : ''}"></span>
      <span style="${skipped ? 'text-decoration:line-through;opacity:0.5' : ''}">${pct}%</span>`;
    swatchContainer.appendChild(div);
  });
}

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
      const records = generateStitches(
        indexMap, canvas.width, canvas.height, palette,
        { pitchPx, stitchLenPx, skipColors, outlineOnly, minRegionPx: 40 }
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
      const v = clampInt(Number(colorsInput.value) + 2, 2, 16);
      colorsInput.value = v;
      changes.push(`colors → ${v}`);
      needsRequantize = true;
    } else if (intDown) {
      const v = clampInt(Number(colorsInput.value) - 2, 2, 16);
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
      const v = Math.min(500, Math.round(Number(widthInput.value) * 1.25));
      widthInput.value = v;
      changes.push(`width → ${v} mm`);
      needsRequantize = true;
    } else if (intSmaller || (intDown && subSize)) {
      const v = Math.max(10, Math.round(Number(widthInput.value) * 0.75));
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
      // "more dense" = smaller pitch number
      const dir = (intFiner || (subDensity && intDown)) ? 0.7 : 1.4;
      const v = Math.max(0.2, Math.min(2.0, parseFloat((Number(densityInput.value) * dir).toFixed(1))));
      densityInput.value = v;
      changes.push(`density → ${v} mm`);
    } else if (intLoose || (subDensity && intUp)) {
      const v = Math.min(2.0, parseFloat((Number(densityInput.value) * 1.4).toFixed(1)));
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
      const v = Math.min(6.0, parseFloat((Number(stitchInput.value) * 1.3).toFixed(1)));
      stitchInput.value = v;
      changes.push(`stitch length → ${v} mm`);
    } else if (intShorter || (subStitch && intDown)) {
      const v = Math.max(1.0, parseFloat((Number(stitchInput.value) * 0.7).toFixed(1)));
      stitchInput.value = v;
      changes.push(`stitch length → ${v} mm`);
    }
  }

  // ── Result ──────────────────────────────────────────────────────────────────
  if (changes.length === 0) {
    showFeedback(
      'Not understood — try describing what to change, e.g. "remove the background", ' +
      '"draw just the edges", "I want 10 thread colors", "make the design bigger", ' +
      '"tighter rows", "use longer stitches", "set width to 120mm".',
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
      const { palette, indexMap, width, height } = lastQuantResult;
      drawQuantizedPreview(palette, indexMap, width, height, skipColors);
      renderSwatches(palette, indexMap, skipColors);
      exportBtn.disabled = false;
      setStatus('Preview updated');
    }
  }
}

function showFeedback(msg, cls) {
  requestFeedback.textContent = msg;
  requestFeedback.className = 'request-feedback' + (cls ? ' ' + cls : '');
}

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
[widthInput, colorsInput, densityInput, stitchInput].forEach(el => {
  el.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (loadedImage) { exportBtn.disabled = true; runQuantize(loadedImage); }
    }, 400);
  });
});
