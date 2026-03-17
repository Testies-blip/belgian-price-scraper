/**
 * dst.js — Encode stitch records into a Tajima DST binary file
 *
 * DST format:
 *   512-byte ASCII header (padded with 0x1A)
 *   3 bytes per stitch record
 *   End record: 0x00 0x00 0xF3
 *
 * Exports: encodeDST(records, designName) → Uint8Array
 */

'use strict';

/**
 * @param {Array<{x:number,y:number,type:string}>} records  output of generateStitches()
 * @param {string} designName  up to 16 chars
 * @returns {Uint8Array}
 */
function encodeDST(records, designName) {
  // --- Pass 1: compute stats needed for header ---
  let stitchCount = 0, colorChanges = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let lastX = 0, lastY = 0;
  let endX = 0, endY = 0;

  for (const r of records) {
    if (r.type === 'COLOR_CHANGE') { colorChanges++; continue; }
    if (r.type === 'END') { endX = r.x; endY = r.y; continue; }
    if (r.type === 'STITCH') stitchCount++;
    if (r.x < minX) minX = r.x;
    if (r.x > maxX) maxX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.y > maxY) maxY = r.y;
    lastX = r.x; lastY = r.y;
  }
  if (!isFinite(minX)) { minX = 0; maxX = 0; minY = 0; maxY = 0; }

  // --- Header (512 bytes) ---
  const name = (designName || 'DESIGN').substring(0, 16).padEnd(16, ' ');
  const headerStr = [
    `LA:${name}\r\n`,
    `ST:${String(stitchCount).padStart(7, '0')}\r\n`,
    `CO:${String(colorChanges).padStart(3, '0')}\r\n`,
    `+X:${String(maxX).padStart(5, '0')}\r\n`,
    `-X:${String(Math.abs(minX)).padStart(5, '0')}\r\n`,
    `+Y:${String(maxY).padStart(5, '0')}\r\n`,
    `-Y:${String(Math.abs(minY)).padStart(5, '0')}\r\n`,
    `AX:${formatSigned(endX)}\r\n`,
    `AY:${formatSigned(endY)}\r\n`,
    `MX:+00000\r\n`,
    `MY:+00000\r\n`,
    `PD:****\r\n`,
  ].join('');

  const header = new Uint8Array(512).fill(0x1A);
  for (let i = 0; i < headerStr.length && i < 512; i++) {
    header[i] = headerStr.charCodeAt(i);
  }

  // --- Pass 2: encode stitch records ---
  const stitchBytes = [];
  let prevX = 0, prevY = 0;

  for (const r of records) {
    if (r.type === 'END') {
      stitchBytes.push(0x00, 0x00, 0xF3);
      break;
    }

    const dx = r.x - prevX;
    const dy = r.y - prevY;
    prevX = r.x;
    prevY = r.y;

    let flag;
    switch (r.type) {
      case 'STITCH':       flag = 0x03; break;
      case 'JUMP':         flag = 0x83; break;
      case 'COLOR_CHANGE': flag = 0xC3; break;
      default:             flag = 0x03;
    }

    const bytes = encodeDSTRecord(dx, dy, flag);
    stitchBytes.push(...bytes);
  }

  // --- Combine ---
  const result = new Uint8Array(512 + stitchBytes.length);
  result.set(header, 0);
  result.set(new Uint8Array(stitchBytes), 512);
  return result;
}

/**
 * Encode one stitch record into 3 bytes using DST bit layout.
 *
 * Each axis uses 5 bit-positions with weights {+1,-1, +9,-9, +3,-3, +27,-27, +81,-81}
 * distributed across byte 0 and byte 1.  Byte 2 holds the flag.
 *
 * Bit layout (standard Tajima DST):
 *   Byte 0: [y+1][y-1][y+9][y-9][x-9][x+9][x-1][x+1]
 *   Byte 1: [y+3][y-3][y+27][y-27][x-27][x+27][x-3][x+3]
 *   Byte 2: flag  (with bits 7-6 controlling command type, bits 5-0 hold +81/-81)
 *
 * Simplified layout used here (matches most DST readers):
 *   Byte 0 bits [7..0]: y+1, y-1, y+9, y-9, x-9, x+9, x-1, x+1
 *   Byte 1 bits [7..0]: y+3, y-3, y+27, y-27, x-27, x+27, x-3, x+3
 *   Byte 2 = flag | (y+81 bit at 5 | y-81 bit at 4 | x-81 bit at 3 | x+81 bit at 2)
 */
function encodeDSTRecord(dx, dy, flag) {
  let b0 = 0, b1 = 0, b2 = flag;

  // Encode X
  let x = dx;
  if (x >= 81)  { b2 |= 0x04; x -= 81; }
  if (x <= -81) { b2 |= 0x08; x += 81; }
  if (x >= 27)  { b1 |= 0x04; x -= 27; }
  if (x <= -27) { b1 |= 0x08; x += 27; }
  if (x >= 9)   { b0 |= 0x04; x -= 9;  }
  if (x <= -9)  { b0 |= 0x08; x += 9;  }
  if (x >= 3)   { b1 |= 0x01; x -= 3;  }
  if (x <= -3)  { b1 |= 0x02; x += 3;  }
  if (x >= 1)   { b0 |= 0x01; x -= 1;  }
  if (x <= -1)  { b0 |= 0x02; x += 1;  }

  // Encode Y (positive Y = up in DST)
  let y = dy;
  if (y >= 81)  { b2 |= 0x20; y -= 81; }
  if (y <= -81) { b2 |= 0x10; y += 81; }
  if (y >= 27)  { b1 |= 0x20; y -= 27; }
  if (y <= -27) { b1 |= 0x10; y += 27; }
  if (y >= 9)   { b0 |= 0x20; y -= 9;  }
  if (y <= -9)  { b0 |= 0x10; y += 9;  }
  if (y >= 3)   { b1 |= 0x80; y -= 3;  }
  if (y <= -3)  { b1 |= 0x40; y += 3;  }
  if (y >= 1)   { b0 |= 0x80; y -= 1;  }
  if (y <= -1)  { b0 |= 0x40; y += 1;  }

  return [b0, b1, b2];
}

function formatSigned(n) {
  const sign = n >= 0 ? '+' : '-';
  return sign + String(Math.abs(n)).padStart(5, '0');
}
