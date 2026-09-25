/**
 * Minimalis TrueType olvaso -- annyit tud, amennyi egy `/FontFile2`-vel
 * beagyazott, `/WinAnsiEncoding`-os PDF TrueType fonthoz kell:
 * karakterszelessegek, font-leiro metrikak es a nyers TTF byte-ok.
 *
 * Nem subsetel: a teljes fajl egyszer kerul a dokumentumba (~180 kB), fuggetlenul
 * attol, hogy 1 vagy 100 000 lap hasznalja.
 */

export interface EmbeddedFont {
  postScriptName: string;
  unitsPerEm: number;
  bbox: [number, number, number, number];
  ascent: number;
  descent: number;
  capHeight: number;
  italicAngle: number;
  stemV: number;
  flags: number;
  /** WinAnsi kodpont (0..255) -> szelesseg 1000-es egysegben. */
  widths: number[];
  data: Uint8Array;
}

/** cp1252 elteresei a Latin-1-tol (0x80..0x9F). */
const CP1252_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};

export const winAnsiToUnicode = (code: number): number =>
  code >= 0x80 && code <= 0x9f ? (CP1252_HIGH[code] ?? 0) : code;

/** Unicode kodpont -> WinAnsi byte, vagy -1 ha nem abrazolhato. */
export function unicodeToWinAnsi(cp: number): number {
  if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) return cp;
  for (const [byte, uni] of Object.entries(CP1252_HIGH)) {
    if (uni === cp) return Number(byte);
  }
  return -1;
}

interface Table {
  offset: number;
  length: number;
}

export function parseTtf(buffer: ArrayBuffer): EmbeddedFont {
  const data = new Uint8Array(buffer);
  const v = new DataView(buffer);

  const tag = v.getUint32(0);
  if (tag === 0x4f54544f) {
    throw new Error('CFF/OpenType (OTTO) font nem tamogatott -- TrueType (glyf) kell.');
  }
  if (tag !== 0x00010000 && tag !== 0x74727565) {
    throw new Error('Ismeretlen font formatum.');
  }

  const tables = new Map<string, Table>();
  const numTables = v.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const name = String.fromCharCode(data[rec], data[rec + 1], data[rec + 2], data[rec + 3]);
    tables.set(name.trim(), { offset: v.getUint32(rec + 8), length: v.getUint32(rec + 12) });
  }
  const need = (name: string): Table => {
    const t = tables.get(name);
    if (!t) throw new Error("Hianyzo '" + name + "' tabla a fontban.");
    return t;
  };

  const head = need('head').offset;
  const unitsPerEm = v.getUint16(head + 18) || 1000;
  const scale = 1000 / unitsPerEm;
  const bbox: [number, number, number, number] = [
    Math.round(v.getInt16(head + 36) * scale),
    Math.round(v.getInt16(head + 38) * scale),
    Math.round(v.getInt16(head + 40) * scale),
    Math.round(v.getInt16(head + 42) * scale),
  ];
  const macStyle = v.getUint16(head + 44);

  const hhea = need('hhea').offset;
  let ascent = Math.round(v.getInt16(hhea + 4) * scale);
  let descent = Math.round(v.getInt16(hhea + 6) * scale);
  const numberOfHMetrics = v.getUint16(hhea + 34);

  const hmtx = need('hmtx').offset;
  const advance = (gid: number) => {
    const i = Math.min(gid, numberOfHMetrics - 1);
    return v.getUint16(hmtx + i * 4);
  };

  let capHeight = Math.round(ascent * 0.7);
  let usWeightClass = 400;
  const os2 = tables.get('OS/2');
  if (os2) {
    const o = os2.offset;
    const version = v.getUint16(o);
    usWeightClass = v.getUint16(o + 4) || 400;
    const typoAsc = v.getInt16(o + 68);
    const typoDesc = v.getInt16(o + 70);
    if (typoAsc) ascent = Math.round(typoAsc * scale);
    if (typoDesc) descent = Math.round(typoDesc * scale);
    if (version >= 2 && os2.length >= 90) {
      const cap = v.getInt16(o + 88);
      if (cap) capHeight = Math.round(cap * scale);
    }
  }

  let italicAngle = 0;
  let fixedPitch = false;
  const post = tables.get('post');
  if (post) {
    italicAngle = v.getInt32(post.offset + 4) / 65536;
    fixedPitch = v.getUint32(post.offset + 12) !== 0;
  }

  const cmap = readCmap(v, need('cmap').offset);
  const widths: number[] = new Array(256).fill(0);
  const missing = Math.round(advance(0) * scale);
  for (let code = 0; code < 256; code++) {
    const uni = winAnsiToUnicode(code);
    const gid = uni ? cmap.get(uni) ?? 0 : 0;
    widths[code] = gid ? Math.round(advance(gid) * scale) : missing;
  }

  const italic = italicAngle !== 0 || (macStyle & 2) !== 0;
  const flags = 32 | (italic ? 64 : 0) | (fixedPitch ? 1 : 0);

  return {
    postScriptName: readPostScriptName(v, data, tables.get('name')) || 'EmbeddedFont',
    unitsPerEm,
    bbox,
    ascent,
    descent,
    capHeight,
    italicAngle,
    stemV: Math.round(50 + (usWeightClass / 100) ** 2),
    flags,
    widths,
    data,
  };
}

function readPostScriptName(v: DataView, data: Uint8Array, table?: Table): string | null {
  if (!table) return null;
  const o = table.offset;
  const count = v.getUint16(o + 2);
  const stringOffset = v.getUint16(o + 4);
  let best: string | null = null;
  for (let i = 0; i < count; i++) {
    const rec = o + 6 + i * 12;
    if (v.getUint16(rec + 6) !== 6) continue; // nameID 6 = PostScript nev
    const platform = v.getUint16(rec);
    const len = v.getUint16(rec + 8);
    const off = o + stringOffset + v.getUint16(rec + 10);
    let s = '';
    if (platform === 3) {
      for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(v.getUint16(off + j));
    } else {
      for (let j = 0; j < len; j++) s += String.fromCharCode(data[off + j]);
    }
    s = s.replace(/[^\x21-\x7e]/g, '').replace(/[()<>[\]{}/%#]/g, '');
    if (s) {
      best = s;
      if (platform === 3) break;
    }
  }
  return best;
}

/** cmap -> unicode kodpont -> glyph id. 0/4/6/12 formatumot olvas. */
function readCmap(v: DataView, base: number): Map<number, number> {
  const numTables = v.getUint16(base + 2);
  const rank = (p: number, e: number) =>
    p === 3 && e === 10 ? 5 : p === 3 && e === 1 ? 4 : p === 0 ? 3 : p === 3 && e === 0 ? 2 : 1;

  let bestOffset = -1;
  let bestRank = 0;
  for (let i = 0; i < numTables; i++) {
    const rec = base + 4 + i * 8;
    const r = rank(v.getUint16(rec), v.getUint16(rec + 2));
    if (r > bestRank) {
      bestRank = r;
      bestOffset = base + v.getUint32(rec + 4);
    }
  }
  const map = new Map<number, number>();
  if (bestOffset < 0) return map;

  const format = v.getUint16(bestOffset);
  if (format === 0) {
    for (let c = 0; c < 256; c++) map.set(c, v.getUint8(bestOffset + 6 + c));
  } else if (format === 4) {
    const segCount = v.getUint16(bestOffset + 6) / 2;
    const ends = bestOffset + 14;
    const starts = ends + segCount * 2 + 2;
    const deltas = starts + segCount * 2;
    const ranges = deltas + segCount * 2;
    for (let s = 0; s < segCount; s++) {
      const end = v.getUint16(ends + s * 2);
      const start = v.getUint16(starts + s * 2);
      if (start > end) continue;
      const delta = v.getInt16(deltas + s * 2);
      const rangeOffset = v.getUint16(ranges + s * 2);
      for (let c = start; c <= end && c !== 0x10000; c++) {
        let gid: number;
        if (rangeOffset === 0) {
          gid = (c + delta) & 0xffff;
        } else {
          const gi = ranges + s * 2 + rangeOffset + (c - start) * 2;
          gid = v.getUint16(gi);
          if (gid !== 0) gid = (gid + delta) & 0xffff;
        }
        if (gid) map.set(c, gid);
      }
    }
  } else if (format === 6) {
    const first = v.getUint16(bestOffset + 6);
    const count = v.getUint16(bestOffset + 8);
    for (let i = 0; i < count; i++) map.set(first + i, v.getUint16(bestOffset + 10 + i * 2));
  } else if (format === 12) {
    const nGroups = v.getUint32(bestOffset + 12);
    for (let g = 0; g < nGroups; g++) {
      const rec = bestOffset + 16 + g * 12;
      const start = v.getUint32(rec);
      const end = v.getUint32(rec + 4);
      const startGid = v.getUint32(rec + 8);
      for (let c = start; c <= end && c - start < 0x10000; c++) map.set(c, startGid + (c - start));
    }
  }
  return map;
}
