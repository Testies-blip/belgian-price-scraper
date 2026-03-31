/**
 * quantize.js — K-means color quantization
 * Reduces an RGBA pixel array to k representative colors.
 *
 * Exports: quantizeImage(imageData, k) → { palette, indexMap }
 *   palette  — Array of k [r,g,b] entries
 *   indexMap — Uint8Array, one index per pixel (same length as imageData.data / 4)
 */

'use strict';

/**
 * Main entry point.
 * @param {ImageData} imageData
 * @param {number} k  number of colors (2–16)
 * @returns {{ palette: number[][], indexMap: Uint8Array }}
 */
function quantizeImage(imageData, k) {
  const data = imageData.data;
  const n = data.length / 4;

  // Collect opaque pixels
  const pixels = [];
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] >= 128) {
      pixels.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
    }
  }

  if (pixels.length === 0) {
    return { palette: [[255, 255, 255]], indexMap: new Uint8Array(n) };
  }

  // Clamp k to number of unique colors
  k = Math.min(k, pixels.length);

  // Init centers using k-means++ seeding
  const centers = kmeansInit(pixels, k);

  // Run k-means iterations
  const MAX_ITER = 20;
  let assignments = new Int32Array(pixels.length);

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let changed = false;

    // Assignment step
    for (let i = 0; i < pixels.length; i++) {
      const best = nearestCenter(pixels[i], centers);
      if (best !== assignments[i]) { assignments[i] = best; changed = true; }
    }
    if (!changed) break;

    // Update step
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]); // r, g, b, count
    for (let i = 0; i < pixels.length; i++) {
      const c = assignments[i];
      sums[c][0] += pixels[i][0];
      sums[c][1] += pixels[i][1];
      sums[c][2] += pixels[i][2];
      sums[c][3]++;
    }
    for (let c = 0; c < k; c++) {
      if (sums[c][3] > 0) {
        centers[c] = [
          Math.round(sums[c][0] / sums[c][3]),
          Math.round(sums[c][1] / sums[c][3]),
          Math.round(sums[c][2] / sums[c][3]),
        ];
      }
    }
  }

  // Build indexMap for every pixel (including transparent → index 255 sentinel)
  const indexMap = new Uint8Array(n).fill(255);
  let pi = 0;
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] >= 128) {
      indexMap[i] = assignments[pi++];
    }
  }

  return { palette: centers, indexMap };
}

function kmeansInit(pixels, k) {
  const centers = [];
  // First center: random pixel
  centers.push([...pixels[Math.floor(Math.random() * pixels.length)]]);

  for (let c = 1; c < k; c++) {
    // Compute squared distances to nearest existing center
    const dists = pixels.map(p => {
      let min = Infinity;
      for (const ctr of centers) {
        const d = colorDist2(p, ctr);
        if (d < min) min = d;
      }
      return min;
    });
    // Weighted random selection
    const total = dists.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let chosen = 0;
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i];
      if (r <= 0) { chosen = i; break; }
    }
    centers.push([...pixels[chosen]]);
  }
  return centers;
}

function nearestCenter(pixel, centers) {
  let best = 0, bestDist = Infinity;
  for (let c = 0; c < centers.length; c++) {
    const d = colorDist2(pixel, centers[c]);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

function colorDist2(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}
