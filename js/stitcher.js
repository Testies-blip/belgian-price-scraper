/**
 * stitcher.js — Convert quantized image to embroidery stitch records
 *
 * Exports: generateStitches(indexMap, width, height, palette, opts)
 *   → Array of stitch records: { x, y, type }
 *     type: 'STITCH' | 'JUMP' | 'COLOR_CHANGE' | 'END'
 *   x, y are in DST units (0.1 mm each). Origin = top-left of design.
 *
 * Coordinate mapping:
 *   1 px = 0.2 mm = 2 DST units  (working resolution: 5 px/mm)
 *   DST Y-axis is inverted (positive = up), so we flip during conversion.
 */

'use strict';

const STITCH = 'STITCH';
const JUMP   = 'JUMP';
const COLOR_CHANGE = 'COLOR_CHANGE';
const END    = 'END';

/**
 * @param {Uint8Array} indexMap   one index per pixel (255 = transparent)
 * @param {number}     width      canvas width in pixels
 * @param {number}     height     canvas height in pixels
 * @param {number[][]} palette    array of [r,g,b] entries
 * @param {object}     opts
 * @param {number}     opts.pitchPx      scan-line pitch in pixels (density_mm * 5)
 * @param {number}     opts.stitchLenPx  stitch length in pixels (stitch_mm * 5)
 * @returns {Array<{x:number,y:number,type:string}>}
 */
function generateStitches(indexMap, width, height, palette, opts) {
  const { pitchPx, stitchLenPx } = opts;
  const k = palette.length;

  // Count pixels per color to sort largest-first
  const counts = new Int32Array(k);
  for (let i = 0; i < indexMap.length; i++) {
    if (indexMap[i] < k) counts[indexMap[i]]++;
  }
  const colorOrder = Array.from({ length: k }, (_, i) => i)
    .sort((a, b) => counts[b] - counts[a]);

  const records = [];
  let curX = 0, curY = 0;  // current needle position in DST units
  let firstColor = true;

  for (const colorIdx of colorOrder) {
    if (counts[colorIdx] === 0) continue;

    if (!firstColor) {
      records.push({ x: curX, y: curY, type: COLOR_CHANGE });
    }
    firstColor = false;

    let firstStitchOfColor = true;

    // Boustrophedon (snake) scan: left→right on even passes, right→left on odd
    let pass = 0;
    for (let row = 0; row < height; row += pitchPx) {
      // Collect all horizontal runs of this color on this row
      const runs = collectRuns(indexMap, width, row, colorIdx);
      if (runs.length === 0) continue;

      if (pass % 2 === 1) runs.reverse(); // right-to-left pass

      for (const run of runs) {
        const [xStart, xEnd] = pass % 2 === 0
          ? [run[0], run[1]]
          : [run[1], run[0]];

        // Stitch points along the run
        const pts = stitchesAlongRun(xStart, xEnd, stitchLenPx);

        for (const px of pts) {
          const dx = pxToDst(px);
          const dy = rowToDst(row, height);

          if (firstStitchOfColor) {
            // Jump to first stitch position
            emitMove(records, curX, curY, dx, dy, JUMP);
            curX = dx; curY = dy;
            firstStitchOfColor = false;
          } else {
            // Check if we need a jump (large gap)
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

  records.push({ x: curX, y: curY, type: END });
  return records;
}

/**
 * Find all contiguous horizontal pixel runs of colorIdx on a given row.
 * Returns array of [xStart, xEnd] (pixel indices, inclusive).
 */
function collectRuns(indexMap, width, row, colorIdx) {
  const runs = [];
  let inRun = false, runStart = 0;
  for (let x = 0; x < width; x++) {
    const isTarget = indexMap[row * width + x] === colorIdx;
    if (isTarget && !inRun) { inRun = true; runStart = x; }
    else if (!isTarget && inRun) { runs.push([runStart, x - 1]); inRun = false; }
  }
  if (inRun) runs.push([runStart, width - 1]);
  return runs;
}

/**
 * Produce stitch X-positions along a horizontal run.
 * Direction determined by whether xStart < xEnd.
 */
function stitchesAlongRun(xStart, xEnd, stitchLenPx) {
  const pts = [];
  const dir = xStart <= xEnd ? 1 : -1;
  const len = Math.abs(xEnd - xStart);
  const nStitches = Math.max(1, Math.round(len / stitchLenPx));
  for (let s = 0; s <= nStitches; s++) {
    pts.push(xStart + dir * Math.round((s / nStitches) * len));
  }
  return pts;
}

/** Convert pixel X to DST units (1px = 2 DST units) */
function pxToDst(px) { return px * 2; }

/**
 * Convert pixel row to DST Y.
 * DST Y positive = up, so we invert: top pixel → large Y, bottom → 0.
 */
function rowToDst(row, height) { return (height - 1 - row) * 2; }

/**
 * Emit a sequence of move records (JUMP or STITCH) to travel from
 * (fromX, fromY) to (toX, toY), splitting moves larger than ±121 DST units.
 */
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
