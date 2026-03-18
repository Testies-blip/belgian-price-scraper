/**
 * segmenter.js — BodyPix person segmentation wrapper
 *
 * Requires (loaded from CDN before this script):
 *   @tensorflow/tfjs
 *   @tensorflow-models/body-pix
 *
 * Exports (global):
 *   segmentImage(canvas)  →  Promise<SegmentResult>
 *
 * @typedef {object} SegmentResult
 * @property {Int32Array}  partMap          One BodyPix part ID per pixel (-1 = background)
 * @property {number}      width            canvas.width
 * @property {number}      height           canvas.height
 * @property {boolean}     personFound      true if any pixel has a body-part label
 * @property {Set<number>} detectedPartIds  Which part IDs (0-23) appear in the result
 */

'use strict';

let _bodyPixModel = null;   // cached model after first load
let _loadPromise  = null;   // in-flight load promise (prevents double-loading)

/**
 * Lazy-load BodyPix model (singleton).
 * Uses the lightweight MobileNetV1 variant (outputStride 16, multiplier 0.75)
 * — roughly 4 MB download, runs on CPU without GPU support.
 */
async function _loadBodyPix() {
  if (_bodyPixModel) return _bodyPixModel;
  if (_loadPromise)  return _loadPromise;

  if (typeof tf === 'undefined' || typeof bodyPix === 'undefined') {
    throw new Error(
      'TensorFlow.js and BodyPix must be loaded from CDN before calling segmentImage().'
    );
  }

  _loadPromise = bodyPix.load({
    architecture: 'MobileNetV1',
    outputStride: 16,
    multiplier:   0.75,
    quantBytes:   2,        // 2-byte weights: ~4 MB; fast on CPU
  }).then(model => {
    _bodyPixModel = model;
    _loadPromise  = null;
    return model;
  });

  return _loadPromise;
}

/**
 * Nearest-neighbour rescale of a part-ID map (Int32Array) from
 * (srcW × srcH) to (dstW × dstH).
 * Avoids the Canvas 2D API to prevent integer label values being
 * clipped or blended during drawImage / getImageData.
 */
function _rescalePartMap(srcData, srcW, srcH, dstW, dstH) {
  const out = new Int32Array(dstW * dstH);
  for (let dy = 0; dy < dstH; dy++) {
    const sy = Math.min(srcH - 1, Math.floor((dy / dstH) * srcH));
    for (let dx = 0; dx < dstW; dx++) {
      const sx = Math.min(srcW - 1, Math.floor((dx / dstW) * srcW));
      out[dy * dstW + dx] = srcData[sy * srcW + sx];
    }
  }
  return out;
}

/**
 * Segment the person in a canvas and return a partMap aligned to canvas dimensions.
 *
 * The returned partMap[y * width + x] is a 1-to-1 match with
 * lastQuantResult.indexMap[y * width + x], provided both use the same canvas.
 *
 * @param  {HTMLCanvasElement} canvas  The working canvas (same size as indexMap)
 * @returns {Promise<SegmentResult>}
 */
async function segmentImage(canvas) {
  const model = await _loadBodyPix();

  const seg = await model.segmentPersonParts(canvas, {
    internalResolution:    'medium',   // ~0.5× input: good speed/accuracy balance
    segmentationThreshold: 0.5,
    scoreThreshold:        0.3,
  });

  // Align segmentation output to our working canvas dimensions
  let partMap;
  if (seg.width === canvas.width && seg.height === canvas.height) {
    partMap = new Int32Array(seg.data);    // already correct size — just copy
  } else {
    partMap = _rescalePartMap(
      seg.data, seg.width, seg.height,
      canvas.width, canvas.height
    );
  }

  const detectedPartIds = new Set();
  for (let i = 0; i < partMap.length; i++) {
    if (partMap[i] >= 0) detectedPartIds.add(partMap[i]);
  }

  // Helpful debug log — lets users verify the part-ID mapping matches their model version
  if (detectedPartIds.size > 0) {
    console.log('[segmenter] Detected BodyPix part IDs:', [...detectedPartIds].sort((a, b) => a - b));
  }

  return {
    partMap,
    width:         canvas.width,
    height:        canvas.height,
    personFound:   detectedPartIds.size > 0,
    detectedPartIds,
  };
}
