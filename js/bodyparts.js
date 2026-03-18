/**
 * bodyparts.js — Body-part group map, NLP aliases, hat heuristic, and colour-merge
 *
 * BodyPix 2.x segmentPersonParts() part IDs (0-23):
 *   0  leftFace            1  rightFace
 *   2  leftUpperArmFront   3  leftUpperArmBack
 *   4  rightUpperArmFront  5  rightUpperArmBack
 *   6  leftLowerArmFront   7  leftLowerArmBack
 *   8  rightLowerArmFront  9  rightLowerArmBack
 *  10  leftHand           11  rightHand
 *  12  torsoFront         13  torsoBack
 *  14  leftUpperLegFront  15  leftUpperLegBack
 *  16  rightUpperLegFront 17  rightUpperLegBack
 *  18  leftLowerLegFront  19  leftLowerLegBack
 *  20  rightLowerLegFront 21  rightLowerLegBack
 *  22  leftFoot           23  rightFoot
 *
 * Exports (globals):
 *   BODY_GROUPS        — canonical group name → Set<partId>
 *   BODY_ALIASES       — user word → canonical group name (or 'hat')
 *   PART_LABELS        — canonical group name → display label string
 *   bodyGroupForWord(text)                   → { group, groupPartIds }
 *   getHatPixels(partMap, width, height)     → Set<pixelIndex>
 *   mergeRegionColors(indexMap, regionPixels, palette, targetN, targetColorWord, colorNames)
 *                                            → { mergedCount, keptIndices }
 */

'use strict';

// ── Body-part ID groups (defined top-to-bottom for natural display order) ────
//
// "torso" intentionally includes upper and lower arm IDs (2-9) because
// garments like shirts and jackets cover the arms as well as the trunk.
// Use "arms" for the arm-only group.
const BODY_GROUPS = {
  face:  new Set([0, 1]),
  torso: new Set([2, 3, 4, 5, 6, 7, 8, 9, 12, 13]),
  arms:  new Set([2, 3, 4, 5, 6, 7, 8, 9]),
  hands: new Set([10, 11]),
  legs:  new Set([14, 15, 16, 17, 18, 19, 20, 21]),
  feet:  new Set([22, 23]),
};

// ── NLP alias table ───────────────────────────────────────────────────────────
// Keys are words the user might naturally speak; values are canonical group names
// (or 'hat' for the geometry-based heuristic).
const BODY_ALIASES = {
  // hat — heuristic, not a native BodyPix class
  hat:      'hat',
  cap:      'hat',
  beanie:   'hat',
  helmet:   'hat',
  beret:    'hat',
  headwear: 'hat',
  headband: 'hat',
  // face / head
  face:  'face',
  head:  'face',
  cheek: 'face',
  chin:  'face',
  // torso (shirt / jacket / coat)
  shirt:   'torso',
  jacket:  'torso',
  coat:    'torso',
  vest:    'torso',
  sweater: 'torso',
  jersey:  'torso',
  hoodie:  'torso',
  blouse:  'torso',
  top:     'torso',
  torso:   'torso',
  body:    'torso',
  chest:   'torso',
  // arms / sleeves
  arm:     'arms',
  arms:    'arms',
  sleeve:  'arms',
  sleeves: 'arms',
  forearm: 'arms',
  // hands
  hand:   'hands',
  hands:  'hands',
  glove:  'hands',
  gloves: 'hands',
  // legs / pants / trousers
  pant:     'legs',
  pants:    'legs',
  trouser:  'legs',
  trousers: 'legs',
  leg:      'legs',
  legs:     'legs',
  jean:     'legs',
  jeans:    'legs',
  short:    'legs',
  shorts:   'legs',
  skirt:    'legs',
  legging:  'legs',
  leggings: 'legs',
  // feet / shoes
  shoe:    'feet',
  shoes:   'feet',
  boot:    'feet',
  boots:   'feet',
  foot:    'feet',
  feet:    'feet',
  sneaker: 'feet',
  sneakers:'feet',
  sock:    'feet',
  socks:   'feet',
};

// ── Human-readable labels for badge display ───────────────────────────────────
const PART_LABELS = {
  hat:   'hat',
  face:  'face',
  torso: 'jacket/shirt',
  arms:  'arms/sleeves',
  hands: 'hands',
  legs:  'pants',
  feet:  'shoes',
};

// ── NLP resolver ─────────────────────────────────────────────────────────────
/**
 * Given free-form command text, find the first body-part alias that matches
 * (word-boundary) and return the canonical group name + part-ID Set.
 *
 * Aliases are tested longest-first to prevent short words from shadowing
 * longer ones (e.g. "trouser" matching inside "trousers").
 *
 * @param  {string} text  The command text (case-insensitive)
 * @returns {{ group: string|null, groupPartIds: Set<number>|'hat'|null }}
 */
function bodyGroupForWord(text) {
  const sortedKeys = Object.keys(BODY_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of sortedKeys) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\b' + escaped + '\\b', 'i');
    if (re.test(text)) {
      const group = BODY_ALIASES[alias];
      return {
        group,
        groupPartIds: group === 'hat' ? 'hat' : BODY_GROUPS[group],
      };
    }
  }
  return { group: null, groupPartIds: null };
}

// ── Hat heuristic ─────────────────────────────────────────────────────────────
/**
 * Find pixel indices belonging to the "hat" region.
 *
 * BodyPix has no hat class — hat pixels are typically labelled as face (0/1)
 * or background (-1). The heuristic collects all pixels above the topmost face
 * row, within the person's horizontal bounding box.
 *
 * Fallback when no face is detected: top 15 % of the person's vertical extent.
 *
 * @param  {Int32Array} partMap
 * @param  {number}     width
 * @param  {number}     height
 * @returns {Set<number>}  Pixel indices for the hat region
 */
function getHatPixels(partMap, width, height) {
  // Find person bounding box and topmost face row in one pass
  let personMinX = width, personMaxX = -1;
  let personMinY = height, personMaxY = -1;
  let topmostFaceRow = height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = partMap[y * width + x];
      if (id < 0) continue;
      if (x < personMinX) personMinX = x;
      if (x > personMaxX) personMaxX = x;
      if (y < personMinY) personMinY = y;
      if (y > personMaxY) personMaxY = y;
      if ((id === 0 || id === 1) && y < topmostFaceRow) topmostFaceRow = y;
    }
  }

  if (personMaxX < 0) return new Set();   // no person detected

  const cutoffRow = (topmostFaceRow < height)
    ? topmostFaceRow                                              // anchor to face
    : Math.floor(personMinY + (personMaxY - personMinY) * 0.15); // fallback: top 15 %

  const hatPixels = new Set();
  for (let y = personMinY; y < cutoffRow; y++) {
    for (let x = personMinX; x <= personMaxX; x++) {
      hatPixels.add(y * width + x);
    }
  }
  return hatPixels;
}

// ── Colour-merge engine ───────────────────────────────────────────────────────
/**
 * Merge colours in a region down to `targetN` colours.
 * Modifies `indexMap` IN PLACE — caller must have already pushed undo state.
 *
 * @param {Uint8Array}   indexMap        Current pixel→palette mapping (255 = transparent)
 * @param {Set<number>}  regionPixels    Pixel indices to consider
 * @param {number[][]}   palette         [[r,g,b], …] palette entries
 * @param {number}       targetN         Max colours to keep in this region (≥ 1)
 * @param {string|null}  targetColorWord Force remapping toward this colour family name
 * @param {string[]}     colorNames      Palette colour-name strings (from colornames.js)
 * @returns {{ mergedCount: number, keptIndices: number[] }}
 */
function mergeRegionColors(indexMap, regionPixels, palette, targetN, targetColorWord, colorNames) {
  // 1. Tally palette indices present in region
  const freq = new Map();
  for (const i of regionPixels) {
    const ci = indexMap[i];
    if (ci === 255 || ci >= palette.length) continue;   // transparent / sentinel
    freq.set(ci, (freq.get(ci) || 0) + 1);
  }

  if (freq.size === 0) return { mergedCount: 0, keptIndices: [] };

  // 2. Sort by frequency descending
  const regionColors = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([ci]) => ci);

  // 3. Determine which indices to keep
  let keptIndices;
  if (targetColorWord && typeof paletteIndicesForColorWord === 'function') {
    // paletteIndicesForColorWord is a global from colornames.js
    const matches   = paletteIndicesForColorWord(targetColorWord, colorNames);
    const regionSet = new Set(regionColors);
    const inRegion  = matches.filter(ci => regionSet.has(ci));
    keptIndices = inRegion.length > 0
      ? inRegion.slice(0, targetN)
      : regionColors.slice(0, 1);   // fallback: dominant colour
  } else {
    const clampedN = Math.max(1, Math.min(targetN, regionColors.length));
    keptIndices    = regionColors.slice(0, clampedN);
  }

  const keptSet = new Set(keptIndices);

  // 4. Build nearest-kept remap table by RGB Euclidean distance
  function nearestKept(fromIdx) {
    const [fr, fg, fb] = palette[fromIdx];
    let bestIdx = keptIndices[0], bestD = Infinity;
    for (const ki of keptIndices) {
      const [kr, kg, kb] = palette[ki];
      const d = (fr - kr) ** 2 + (fg - kg) ** 2 + (fb - kb) ** 2;
      if (d < bestD) { bestD = d; bestIdx = ki; }
    }
    return bestIdx;
  }

  const remap = new Map();
  for (const ci of regionColors) {
    remap.set(ci, keptSet.has(ci) ? ci : nearestKept(ci));
  }

  // 5. Apply remap in place
  let mergedCount = 0;
  for (const i of regionPixels) {
    const ci = indexMap[i];
    if (ci === 255 || ci >= palette.length) continue;
    const remapped = remap.get(ci);
    if (remapped !== undefined && remapped !== ci) {
      indexMap[i] = remapped;
      mergedCount++;
    }
  }

  return { mergedCount, keptIndices };
}
