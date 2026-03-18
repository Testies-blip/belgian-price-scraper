/**
 * stitcher.js — Convert quantized image to embroidery stitch records
 *
 * Key quality improvements over v1:
 *   - Connected-component decomposition: each isolated region of a color is
 *     filled independently, eliminating cross-canvas jump stitches.
 *   - Minimum region filter: tiny pixel islands (anti-alias noise) are skipped.
 *   - Per-component bounding-box scan: only the rows that actually contain
 *     pixels are visited, making fills much tighter.
 */

'use strict';

const STITCH       = 'STITCH';
const JUMP         = 'JUMP';
const COLOR_CHANGE = 'COLOR_CHANGE';
const END          = 'END';

/**
 * @param {Uint8Array}  indexMap     one index per pixel (255 = transparent)
 * @param {number}      width
 * @param {number}      height
 * @param {number[][]}  palette      [r,g,b] entries
 * @param {object}      opts
 * @param {number}      opts.pitchPx        row pitch in pixels
 * @param {number}      opts.stitchLenPx    stitch length in pixels
 * @param {Set<number>} [opts.skipColors]   color indices to exclude
 * @param {boolean}     [opts.outlineOnly]  stitch boundary pixels only
 * @param {number}      [opts.minRegionPx]  drop components smaller than this
 */
function generateStitches(indexMap, width, height, palette, opts) {
  const {
    pitchPx,
    stitchLenPx,
    skipColors   = new Set(),
    outlineOnly  = false,
    minRegionPx  = 40,
  } = opts;
  const k = palette.length;

  // In outline mode use a finer pitch so the contour is continuous
  const effectivePitch = outlineOnly ? Math.max(1, Math.floor(pitchPx / 2)) : pitchPx;

  // Sort colors largest-first so the machine starts with big regions
  const counts = new Int32Array(k);
  for (let i = 0; i < indexMap.length; i++) {
    if (indexMap[i] < k) counts[indexMap[i]]++;
  }
  const colorOrder = Array.from({ length: k }, (_, i) => i)
    .sort((a, b) => counts[b] - counts[a]);

  const records = [];
  let curX = 0, curY = 0;
  let firstColor = true;

  for (const colorIdx of colorOrder) {
    if (counts[colorIdx] === 0 || skipColors.has(colorIdx)) continue;

    // Decompose into 4-connected components; discard tiny islands
    const components = findConnectedComponents(indexMap, width, height, colorIdx)
      .filter(c => c.size >= minRegionPx)
      .sort((a, b) => b.size - a.size);

    if (components.length === 0) continue;

    if (!firstColor) records.push({ x: curX, y: curY, type: COLOR_CHANGE });
    firstColor = false;

    for (const { mask, minRow, maxRow } of components) {
      const scanMask = outlineOnly ? buildEdgeMaskFromBinary(mask, width, height) : mask;

      let pass = 0;
      let firstStitchOfComponent = true;

      for (let row = minRow; row <= maxRow; row += effectivePitch) {
        const runs = collectRunsFromBinary(scanMask, width, row);
        if (runs.length === 0) continue;

        if (pass % 2 === 1) runs.reverse();

        for (const run of runs) {
          const [xStart, xEnd] = pass % 2 === 0
            ? [run[0], run[1]]
            : [run[1], run[0]];

          const pts = outlineOnly
            ? outlinePointsAlongRun(xStart, xEnd)
            : stitchesAlongRun(xStart, xEnd, stitchLenPx);

          for (const px of pts) {
            const dx = pxToDst(px);
            const dy = rowToDst(row, height);

            if (firstStitchOfComponent) {
              emitMove(records, curX, curY, dx, dy, JUMP);
              curX = dx; curY = dy;
              firstStitchOfComponent = false;
            } else {
              const distX = Math.abs(dx - curX);
              const distY = Math.abs(dy - curY);
              if (distX > 120 || distY > 120) {
                emitMove(records, curX, curY, dx, dy, JUMP);
              } else {
                records.push({ x: dx, y: dy, type: STITCH });
              }
              curX = dx; curY = dy;
            }
          }
        }
        pass++;
      }
    }
  }

  records.push({ x: curX, y: curY, type: END });
  return records;
}

// ── Connected components ───────────────────────────────────────────────────────

/**
 * Iterative DFS flood-fill to find all 4-connected components of colorIdx.
 * Returns array of { mask: Uint8Array, size, minRow, maxRow }.
 * Uses a shared `visited` buffer to avoid revisiting.
 */
function findConnectedComponents(indexMap, width, height, colorIdx) {
  const visited = new Uint8Array(width * height);
  const results  = [];

  for (let startIdx = 0; startIdx < width * height; startIdx++) {
    if (indexMap[startIdx] !== colorIdx || visited[startIdx]) continue;

    const mask   = new Uint8Array(width * height);
    const stack  = [startIdx];
    visited[startIdx] = 1;
    let size = 0, minRow = height, maxRow = 0;

    while (stack.length > 0) {
      const pos = stack.pop();
      mask[pos] = 1;
      size++;

      const py = Math.floor(pos / width);
      const px = pos % width;
      if (py < minRow) minRow = py;
      if (py > maxRow) maxRow = py;

      // 4-connected neighbours
      if (py > 0) {
        const n = pos - width;
        if (indexMap[n] === colorIdx && !visited[n]) { visited[n] = 1; stack.push(n); }
      }
      if (py < height - 1) {
        const n = pos + width;
        if (indexMap[n] === colorIdx && !visited[n]) { visited[n] = 1; stack.push(n); }
      }
      if (px > 0) {
        const n = pos - 1;
        if (indexMap[n] === colorIdx && !visited[n]) { visited[n] = 1; stack.push(n); }
      }
      if (px < width - 1) {
        const n = pos + 1;
        if (indexMap[n] === colorIdx && !visited[n]) { visited[n] = 1; stack.push(n); }
      }
    }

    results.push({ mask, size, minRow, maxRow });
  }

  return results;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Edge mask from a binary component mask */
function buildEdgeMaskFromBinary(mask, width, height) {
  const edge = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;
      const l = x > 0        ? mask[idx - 1]     : 0;
      const r = x < width-1  ? mask[idx + 1]     : 0;
      const u = y > 0        ? mask[idx - width]  : 0;
      const d = y < height-1 ? mask[idx + width]  : 0;
      if (!l || !r || !u || !d) edge[idx] = 1;
    }
  }
  return edge;
}

/** Edge mask from indexMap (kept for backward compat) */
function buildEdgeMask(indexMap, width, height, colorIdx) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (indexMap[y * width + x] !== colorIdx) continue;
      const l = x > 0        ? indexMap[y * width + x - 1]       : 255;
      const r = x < width-1  ? indexMap[y * width + x + 1]       : 255;
      const u = y > 0        ? indexMap[(y-1) * width + x]       : 255;
      const d = y < height-1 ? indexMap[(y+1) * width + x]       : 255;
      if (l !== colorIdx || r !== colorIdx || u !== colorIdx || d !== colorIdx) {
        mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

function collectRunsFromBinary(mask, width, row) {
  const runs = [];
  let inRun = false, runStart = 0;
  for (let x = 0; x < width; x++) {
    const isTarget = mask[row * width + x] === 1;
    if (isTarget && !inRun)      { inRun = true; runStart = x; }
    else if (!isTarget && inRun) { runs.push([runStart, x - 1]); inRun = false; }
  }
  if (inRun) runs.push([runStart, width - 1]);
  return runs;
}

function stitchesAlongRun(xStart, xEnd, stitchLenPx) {
  const pts = [];
  const dir = xStart <= xEnd ? 1 : -1;
  const len = Math.abs(xEnd - xStart);
  const n   = Math.max(1, Math.round(len / stitchLenPx));
  for (let s = 0; s <= n; s++) pts.push(xStart + dir * Math.round((s / n) * len));
  return pts;
}

function outlinePointsAlongRun(xStart, xEnd) {
  return xStart === xEnd ? [xStart] : [xStart, xEnd];
}

function pxToDst(px)          { return px * 2; }
function rowToDst(row, height) { return (height - 1 - row) * 2; }

function emitMove(records, fromX, fromY, toX, toY, type) {
  const MAX = 121;
  let cx = fromX, cy = fromY;
  while (cx !== toX || cy !== toY) {
    const dx = clamp(toX - cx, -MAX, MAX);
    const dy = clamp(toY - cy, -MAX, MAX);
    cx += dx; cy += dy;
    records.push({ x: cx, y: cy, type });
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
