/**
 * stitcher.js — Convert quantized image to embroidery stitch records
 *
 * Quality improvements:
 *   - Connected-component decomposition: each isolated region filled independently.
 *   - Nearest-neighbour component ordering: minimises jump travel within a color.
 *   - Minimum region filter: tiny pixel islands are skipped.
 *   - 45° diagonal fill (default): industry-standard angle, avoids fabric grain.
 *   - Lock stitches: 4 short back-and-forth stitches anchor thread at each start.
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
 * @param {number}      opts.pitchPx          row pitch in pixels
 * @param {number}      opts.stitchLenPx      stitch length in pixels
 * @param {Set<number>} [opts.skipColors]     color indices to exclude
 * @param {boolean}     [opts.outlineOnly]    stitch boundary pixels only (global)
 * @param {number}      [opts.minRegionPx]    drop components smaller than this
 * @param {number}      [opts.fillAngleDeg]   fill angle in degrees (0=horiz, 45=diag)
 * @param {object}      [opts.colorAngles]    { paletteIndex: angleDeg } per-color overrides
 * @param {object}      [opts.colorFillTypes] { paletteIndex: 'satin'|'cross'|'outline' }
 */
function generateStitches(indexMap, width, height, palette, opts) {
  const {
    pitchPx,
    stitchLenPx,
    skipColors     = new Set(),
    outlineOnly    = false,
    minRegionPx    = 40,
    fillAngleDeg   = 45,
    colorAngles    = {},
    colorFillTypes = {},
  } = opts;
  const k = palette.length;

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

    // Per-color fill angle and fill type
    const angleDeg  = (colorAngles[colorIdx] !== undefined) ? colorAngles[colorIdx] : fillAngleDeg;
    const fillType  = colorFillTypes[colorIdx] || 'satin';   // 'satin' | 'cross' | 'outline'
    const isOutline = outlineOnly || fillType === 'outline';
    const ePitch    = isOutline ? Math.max(1, Math.floor(pitchPx / 2)) : pitchPx;

    // Decompose into 4-connected components; discard tiny islands
    const components = findConnectedComponents(indexMap, width, height, colorIdx)
      .filter(c => c.size >= minRegionPx)
      .sort((a, b) => b.size - a.size);

    if (components.length === 0) continue;

    if (!firstColor) records.push({ x: curX, y: curY, type: COLOR_CHANGE });
    firstColor = false;

    // Order components by proximity to minimise jump travel
    const ordered = orderByProximity(components, curX, curY, height);

    for (const { mask, minRow, maxRow } of ordered) {
      const scanMask = isOutline ? buildEdgeMaskFromBinary(mask, width, height) : mask;
      const state    = { pass: 0, first: true, curX, curY };

      // Primary fill pass
      emitFillAtAngle(records, scanMask, width, height, minRow, maxRow,
                      angleDeg, ePitch, stitchLenPx, isOutline, state, indexMap);

      // Cross-hatch: second pass at the perpendicular angle
      if (fillType === 'cross') {
        const perpAngle = (angleDeg % 180 !== 0) ? 0 : 45;  // diag→horiz, horiz→diag
        state.pass = 0;  // reset alternating direction for the second direction
        emitFillAtAngle(records, scanMask, width, height, minRow, maxRow,
                        perpAngle, ePitch, stitchLenPx, isOutline, state, indexMap);
      }

      curX = state.curX;
      curY = state.curY;
    }
  }

  records.push({ x: curX, y: curY, type: END });
  return records;
}

/**
 * Emit stitches for one fill direction into records, updating state in-place.
 * state = { pass, first, curX, curY }
 */
/**
 * Walk a Bresenham line from DST point (x0,y0) to (x1,y1) and return true if
 * any pixel on the path is erased (indexMap === 255).  Used to prevent fill
 * stitches from bridging over erased/transparent areas.
 */
function segmentCrossesErasedPixels(x0dst, y0dst, x1dst, y1dst, indexMap, width, height) {
  // Convert DST coords → pixel coords (integer)
  let x = Math.round(x0dst / 2);
  let y = height - 1 - Math.round(y0dst / 2);
  const x1 = Math.round(x1dst / 2);
  const y1 = height - 1 - Math.round(y1dst / 2);
  const dx = Math.abs(x1 - x), dy = Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    if (x >= 0 && y >= 0 && x < width && y < height && indexMap[y * width + x] === 255) return true;
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 <  dx) { err += dx; y += sy; }
  }
  return false;
}

function emitFillAtAngle(records, scanMask, width, height, minRow, maxRow,
                         angleDeg, pitchPx, stitchLenPx, outlineOnly, state, indexMap) {
  const isDiag = (angleDeg % 180) !== 0;

  function emitPt(dstX, dstY) {
    if (state.first) {
      emitMove(records, state.curX, state.curY, dstX, dstY, JUMP);
      state.curX = dstX; state.curY = dstY;
      state.first = false;
      emitStartLock(records, state.curX, state.curY);
    } else {
      const farEnough = Math.abs(dstX - state.curX) > 120 || Math.abs(dstY - state.curY) > 120;
      const crossesGap = !farEnough && indexMap &&
                         segmentCrossesErasedPixels(state.curX, state.curY, dstX, dstY,
                                                    indexMap, width, height);
      if (farEnough || crossesGap) {
        emitMove(records, state.curX, state.curY, dstX, dstY, JUMP);
      } else {
        records.push({ x: dstX, y: dstY, type: STITCH });
      }
      state.curX = dstX; state.curY = dstY;
    }
  }

  if (isDiag) {
    // ── 45° anti-diagonal fill ────────────────────────────────────────────────
    const diagStep = Math.max(1, Math.round(pitchPx * Math.SQRT2));
    const dMin = minRow - (width - 1);
    const dMax = maxRow;

    for (let d = dMin; d <= dMax; d += diagStep) {
      const runs = collectRunsAlongAntiDiag(scanMask, width, height, d);
      if (runs.length === 0) continue;
      if (state.pass % 2 === 1) runs.reverse();

      for (const run of runs) {
        const [xS, xE] = state.pass % 2 === 0 ? run : [run[1], run[0]];
        const pts = outlineOnly
          ? (xS === xE
              ? [{ x: xS, y: xS + d }]
              : [{ x: xS, y: xS + d }, { x: xE, y: xE + d }])
          : stitchesAlongAntiDiag(xS, xE, d, stitchLenPx);
        for (const { x, y } of pts) emitPt(pxToDst(x), rowToDst(y, height));
      }
      state.pass++;
    }

  } else {
    // ── Horizontal fill (angle = 0°) ──────────────────────────────────────────
    for (let row = minRow; row <= maxRow; row += pitchPx) {
      const runs = collectRunsFromBinary(scanMask, width, row);
      if (runs.length === 0) continue;
      if (state.pass % 2 === 1) runs.reverse();

      for (const run of runs) {
        const [xStart, xEnd] = state.pass % 2 === 0 ? [run[0], run[1]] : [run[1], run[0]];
        const pts = outlineOnly
          ? outlinePointsAlongRun(xStart, xEnd)
          : stitchesAlongRun(xStart, xEnd, stitchLenPx);
        for (const px of pts) emitPt(pxToDst(px), rowToDst(row, height));
      }
      state.pass++;
    }
  }
}

// ── Connected components ───────────────────────────────────────────────────────

/**
 * Iterative DFS flood-fill to find all 4-connected components of colorIdx.
 * Returns array of { mask, size, minRow, maxRow, centX, centY }.
 */
function findConnectedComponents(indexMap, width, height, colorIdx) {
  const visited = new Uint8Array(width * height);
  const results  = [];

  for (let startIdx = 0; startIdx < width * height; startIdx++) {
    if (indexMap[startIdx] !== colorIdx || visited[startIdx]) continue;

    const mask   = new Uint8Array(width * height);
    const stack  = [startIdx];
    visited[startIdx] = 1;
    let size = 0, minRow = height, maxRow = 0, sumX = 0, sumY = 0;

    while (stack.length > 0) {
      const pos = stack.pop();
      mask[pos] = 1;
      size++;

      const py = Math.floor(pos / width);
      const px = pos % width;
      if (py < minRow) minRow = py;
      if (py > maxRow) maxRow = py;
      sumX += px;
      sumY += py;

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

    results.push({
      mask, size, minRow, maxRow,
      centX: Math.round(sumX / size),
      centY: Math.round(sumY / size),
    });
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

// ── Anti-diagonal fill helpers ─────────────────────────────────────────────────

/**
 * Collect contiguous runs along anti-diagonal y − x = d.
 * Returns [[xStart, xEnd], …] in ascending-x order.
 */
function collectRunsAlongAntiDiag(mask, width, height, d) {
  const runs = [];
  const xLo = Math.max(0, -d);
  const xHi = Math.min(width - 1, height - 1 - d);
  if (xLo > xHi) return runs;

  let inRun = false, runStart = 0;
  for (let x = xLo; x <= xHi; x++) {
    const isTarget = mask[(x + d) * width + x] === 1;
    if (isTarget && !inRun)      { inRun = true; runStart = x; }
    else if (!isTarget && inRun) { runs.push([runStart, x - 1]); inRun = false; }
  }
  if (inRun) runs.push([runStart, xHi]);
  return runs;
}

/**
 * Generate evenly-spaced stitch {x,y} points along anti-diagonal y = x + d.
 * Physical spacing is stitchLenPx pixels (not diagonal pixels).
 */
function stitchesAlongAntiDiag(xStart, xEnd, d, stitchLenPx) {
  const pts  = [];
  const dir  = xStart <= xEnd ? 1 : -1;
  const pixLen = Math.abs(xEnd - xStart) * Math.SQRT2; // diagonal length in px
  const n    = Math.max(1, Math.round(pixLen / stitchLenPx));
  const span = Math.abs(xEnd - xStart);
  for (let s = 0; s <= n; s++) {
    const x = xStart + dir * Math.round((s / n) * span);
    pts.push({ x, y: x + d });
  }
  return pts;
}

// ── Proximity ordering (#3) ────────────────────────────────────────────────────

/**
 * Greedy nearest-neighbour sort: visit the component whose centroid is closest
 * to the current needle position, reducing total jump travel.
 */
function orderByProximity(components, startX, startY, height) {
  if (components.length <= 1) return components;
  const rem     = components.slice();
  const ordered = [];
  let cx = startX, cy = startY;

  while (rem.length > 0) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < rem.length; i++) {
      const dstCx = pxToDst(rem[i].centX);
      const dstCy = rowToDst(rem[i].centY, height);
      const d = Math.abs(dstCx - cx) + Math.abs(dstCy - cy);
      if (d < bd) { bd = d; bi = i; }
    }
    const comp = rem.splice(bi, 1)[0];
    ordered.push(comp);
    cx = pxToDst(comp.centX);
    cy = rowToDst(comp.centY, height);
  }
  return ordered;
}

// ── Lock stitches (#2) ─────────────────────────────────────────────────────────

/**
 * Emit 4 short back-and-forth stitches (≈0.8 mm) to anchor the thread.
 * Called once after the JUMP to the start of each fill component.
 * Ends back at (x, y) so normal fill stitching continues uninterrupted.
 */
function emitStartLock(records, x, y) {
  const LOCK = 8; // 8 DST units = 0.8 mm
  records.push({ x: x + LOCK, y, type: STITCH });
  records.push({ x,           y, type: STITCH });
  records.push({ x: x + LOCK, y, type: STITCH });
  records.push({ x,           y, type: STITCH });
}
