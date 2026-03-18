/**
 * colornames.js — RGB-to-name lookup for palette colour labelling and NLP targeting
 *
 * Exports (as globals):
 *   namedColorOf([r,g,b])                          → nearest colour name string
 *   paletteIndicesForColorWord(word, colorNames)   → array of matching palette indices
 *   COLOR_FAMILIES                                 → family→fragments map (for NLP)
 */

'use strict';

// ── Lookup table (~90 entries covering common embroidery thread hues) ──────────
// Each entry: [r, g, b, 'name']
const COLOR_NAME_TABLE = [
  // whites & near-whites
  [255,255,255,'white'],     [255,250,250,'snow'],
  [255,255,240,'ivory'],     [253,245,230,'cream'],
  [245,245,220,'beige'],     [255,248,220,'cornsilk'],
  [255,228,196,'bisque'],    [250,240,230,'linen'],
  [255,239,213,'papaya whip'],[255,245,238,'seashell'],

  // blacks & grays
  [0,0,0,'black'],           [30,30,30,'charcoal'],
  [64,64,64,'very dark gray'],[105,105,105,'dim gray'],
  [128,128,128,'gray'],      [169,169,169,'dark gray'],
  [192,192,192,'silver'],    [211,211,211,'light gray'],
  [119,136,153,'slate gray'],[47,79,79,'dark slate gray'],

  // reds
  [255,0,0,'red'],           [220,20,60,'crimson'],
  [178,34,34,'firebrick'],   [139,0,0,'dark red'],
  [205,92,92,'indian red'],  [255,99,71,'tomato'],
  [188,74,60,'brick red'],

  // pinks
  [255,20,147,'deep pink'],  [255,105,180,'hot pink'],
  [255,182,193,'light pink'],[255,192,203,'pink'],
  [219,112,147,'pale violet red'],[199,21,133,'medium violet red'],

  // oranges & salmons
  [255,165,0,'orange'],      [255,140,0,'dark orange'],
  [255,69,0,'orange red'],   [255,127,80,'coral'],
  [250,128,114,'salmon'],    [233,150,122,'dark salmon'],
  [255,160,122,'light salmon'],

  // yellows & golds
  [255,255,0,'yellow'],      [255,215,0,'gold'],
  [240,230,140,'khaki'],     [189,183,107,'dark khaki'],
  [218,165,32,'goldenrod'],  [184,134,11,'dark goldenrod'],
  [205,133,63,'peru'],       [210,105,30,'chocolate'],

  // greens
  [0,255,0,'lime green'],    [0,128,0,'green'],
  [0,100,0,'dark green'],    [34,139,34,'forest green'],
  [50,205,50,'lime'],        [144,238,144,'light green'],
  [128,128,0,'olive'],       [107,142,35,'olive drab'],
  [154,205,50,'yellow green'],[46,139,87,'sea green'],
  [60,179,113,'medium sea green'],[0,250,154,'medium spring green'],

  // teals & cyans
  [0,255,255,'cyan'],        [0,128,128,'teal'],
  [0,139,139,'dark cyan'],   [64,224,208,'turquoise'],
  [32,178,170,'light sea green'],[127,255,212,'aquamarine'],
  [0,206,209,'dark turquoise'],[175,238,238,'pale turquoise'],

  // blues
  [0,0,255,'blue'],          [0,0,139,'dark blue'],
  [0,0,128,'navy'],          [0,0,205,'medium blue'],
  [65,105,225,'royal blue'], [30,144,255,'dodger blue'],
  [0,191,255,'deep sky blue'],[135,206,235,'sky blue'],
  [135,206,250,'light sky blue'],[100,149,237,'cornflower blue'],
  [70,130,180,'steel blue'], [176,196,222,'light steel blue'],
  [25,25,112,'midnight blue'],[173,216,230,'light blue'],

  // purples & violets
  [128,0,128,'purple'],      [148,0,211,'dark violet'],
  [153,50,204,'dark orchid'],[186,85,211,'medium orchid'],
  [147,112,219,'medium purple'],[238,130,238,'violet'],
  [255,0,255,'magenta'],     [75,0,130,'indigo'],
  [230,230,250,'lavender'],  [216,191,216,'thistle'],
  [221,160,221,'plum'],      [199,21,133,'fuchsia pink'],

  // browns & tans
  [139,69,19,'saddle brown'],[160,82,45,'sienna'],
  [210,180,140,'tan'],       [222,184,135,'burlywood'],
  [188,143,143,'rosy brown'],[101,67,33,'dark brown'],
  [165,42,42,'brown'],       [245,222,179,'wheat'],
  [255,222,173,'navajo white'],[255,228,181,'moccasin'],
];

/**
 * Return the nearest named colour to [r, g, b].
 * Uses squared Euclidean distance in RGB space.
 */
function namedColorOf([r, g, b]) {
  let best = 'unknown', bestD = Infinity;
  for (const [cr, cg, cb, name] of COLOR_NAME_TABLE) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

/**
 * Colour-family membership for NLP matching.
 * Keys are user-speakable single words; values list name fragments that belong.
 * "grey" is handled as an alias for "gray" at the call site.
 */
const COLOR_FAMILIES = {
  red:    ['red', 'crimson', 'firebrick', 'tomato', 'indian', 'brick'],
  pink:   ['pink', 'rose', 'salmon', 'hot pink', 'deep pink', 'light pink', 'fuchsia'],
  orange: ['orange', 'coral', 'amber'],
  yellow: ['yellow', 'gold', 'khaki', 'lemon', 'goldenrod', 'cornsilk'],
  green:  ['green', 'lime', 'olive', 'forest', 'sea green', 'spring'],
  teal:   ['teal', 'cyan', 'turquoise', 'aqua', 'aquamarine'],
  blue:   ['blue', 'navy', 'sky', 'cornflower', 'steel', 'dodger', 'midnight', 'royal', 'indigo'],
  purple: ['purple', 'violet', 'orchid', 'lavender', 'plum', 'thistle', 'magenta'],
  brown:  ['brown', 'sienna', 'chocolate', 'tan', 'burlywood', 'wheat', 'peru', 'saddle'],
  gray:   ['gray', 'grey', 'silver', 'slate', 'charcoal', 'dim gray', 'gainsboro'],
  white:  ['white', 'ivory', 'cream', 'snow', 'linen', 'bisque', 'beige', 'navajo', 'cornsilk', 'seashell'],
  black:  ['black', 'charcoal', 'very dark'],
};

/**
 * Given a user-spoken colour word (e.g. "blue", "red", "dark green") and the
 * array of names assigned to palette colours, return which palette indices match.
 *
 * Matching rules (checked in order):
 *   1. Direct:  assigned name equals, contains, or is contained by the spoken word
 *   2. Family:  both the spoken word and the assigned name belong to the same family
 */
function paletteIndicesForColorWord(word, colorNames) {
  const w = word.toLowerCase().replace(/grey/, 'gray').trim();
  const matches = new Set();

  colorNames.forEach((name, i) => {
    const n = name.toLowerCase();
    // Direct match
    if (n === w || n.includes(w) || w.includes(n)) {
      matches.add(i);
      return;
    }
    // Family match
    for (const [family, fragments] of Object.entries(COLOR_FAMILIES)) {
      const wordInFamily = family === w || fragments.some(f => w.includes(f) || f.includes(w));
      const nameInFamily = family === n || fragments.some(f => n.includes(f) || f.includes(n));
      if (wordInFamily && nameInFamily) { matches.add(i); break; }
    }
  });

  return [...matches];
}
