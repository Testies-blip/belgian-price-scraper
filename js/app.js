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

// ── State ─────────────────────────────────────────────────────────────────────
let loadedImage = null;   // HTMLImageElement
let currentFile = null;   // File object (for filename)

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

/** Draw original image onto the original-canvas preview */
function renderOriginal(img) {
  const MAX = 300;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  origCanvas.width  = Math.round(img.width  * scale);
  origCanvas.height = Math.round(img.height * scale);
  origCanvas.getContext('2d').drawImage(img, 0, 0, origCanvas.width, origCanvas.height);
}

/** Quantize image and draw quantized preview + palette swatches */
function runQuantize(img) {
  setStatus('Quantizing…');
  exportBtn.disabled = true;

  // Use setTimeout to allow the browser to repaint before heavy work
  setTimeout(() => {
    try {
      const { canvas } = buildWorkingCanvas(img);
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const k = clampInt(Number(colorsInput.value), 2, 16);

      const { palette, indexMap } = quantizeImage(imageData, k);

      // Draw quantized preview
      drawQuantizedPreview(imageData, palette, indexMap, canvas.width, canvas.height);

      // Swatches
      renderSwatches(palette, indexMap);

      previewSection.classList.remove('hidden');
      exportBtn.disabled = false;
      setStatus(`Ready — ${palette.length} colors, ${canvas.width}×${canvas.height} px working size`);
    } catch (err) {
      setStatus('Error: ' + err.message, 'error');
    }
  }, 20);
}

/**
 * Build the working canvas at target resolution (5 px/mm).
 * Stores width and height for use in stitch generation.
 */
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

function drawQuantizedPreview(origImageData, palette, indexMap, w, h) {
  quantCanvas.width = w; quantCanvas.height = h;
  const ctx = quantCanvas.getContext('2d');
  const out = ctx.createImageData(w, h);
  for (let i = 0; i < indexMap.length; i++) {
    const ci = indexMap[i];
    if (ci === 255) {
      out.data[i*4] = 255; out.data[i*4+1] = 255;
      out.data[i*4+2] = 255; out.data[i*4+3] = 255;
    } else {
      const [r, g, b] = palette[ci];
      out.data[i*4] = r; out.data[i*4+1] = g;
      out.data[i*4+2] = b; out.data[i*4+3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

function renderSwatches(palette, indexMap) {
  const counts = new Array(palette.length).fill(0);
  for (const idx of indexMap) { if (idx < palette.length) counts[idx]++; }
  const total = counts.reduce((a, b) => a + b, 0);

  swatchContainer.innerHTML = '';
  palette.forEach(([r, g, b], i) => {
    const pct = total > 0 ? Math.round((counts[i] / total) * 100) : 0;
    const div = document.createElement('div');
    div.className = 'swatch';
    div.innerHTML = `
      <span class="swatch-color" style="background:rgb(${r},${g},${b})"></span>
      <span>${pct}%</span>`;
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

      const k          = clampInt(Number(colorsInput.value), 2, 16);
      const densityMm  = Math.max(0.2, Math.min(2.0, Number(densityInput.value) || 0.4));
      const stitchMm   = Math.max(1.0, Math.min(6.0,  Number(stitchInput.value)  || 3.0));
      const PX_PER_MM  = 5;
      const pitchPx    = Math.max(1, Math.round(densityMm * PX_PER_MM));
      const stitchLenPx= Math.max(1, Math.round(stitchMm  * PX_PER_MM));

      const { palette, indexMap } = quantizeImage(imageData, k);
      const records = generateStitches(
        indexMap, canvas.width, canvas.height, palette,
        { pitchPx, stitchLenPx }
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
