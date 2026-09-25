/**
 * Szerkezeti ellenorzes a generalt PDF-re: xref-eltolasok, stream hosszak,
 * a tartalom-stream operatorai, es a beagyazott ImageMask bitrol bitre
 * osszevetese a fuggetlenul ujraszamolt vonalkod-matrixszal.
 *
 *   npx esbuild test/verify.ts --bundle --platform=node --format=esm --outfile=test/verify.mjs
 *   node test/verify.mjs test/out.pdf
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { buildBarcode } from '../src/core/barcode';
import { dayOfYear, fieldsFor, render } from '../src/core/payload';
import { defaultConfig } from '../src/config';
import { mmToPt } from '../src/core/units';

const popcount = (b: number) => { let n = 0; while (b) { n += b & 1; b >>= 1; } return n; };

const file = process.argv[2] ?? 'test/out.pdf';
const buf = readFileSync(file);
const text = buf.toString('latin1');

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'HIBA'}  ${label}${detail ? '  -- ' + detail : ''}`);
  if (!ok) failures++;
};

// --- xref ------------------------------------------------------------------
const startxref = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)![1]);
check(text.slice(startxref, startxref + 4) === 'xref', 'startxref az xref tablara mutat');

const xrefBody = text.slice(startxref);
const size = Number(/\/Size (\d+)/.exec(xrefBody)![1]);
const entries = [...xrefBody.matchAll(/^(\d{10}) (\d{5}) ([nf]) $/gm)];
check(entries.length === size, `xref bejegyzesek szama = /Size (${size})`);

let badOffsets = 0;
for (let i = 1; i < size; i++) {
  const off = Number(entries[i][1]);
  if (!new RegExp(`^${i} 0 obj`).test(text.slice(off, off + 24))) badOffsets++;
}
check(badOffsets === 0, 'minden xref eltolas a sajat objektumara mutat', `${badOffsets} hibas`);

// --- objektumok ------------------------------------------------------------
interface Obj { id: number; dict: string; start: number; streamStart: number | null; }
const objects = new Map<number, Obj>();
for (const m of text.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj\n/g)) {
  const id = Number(m[1]);
  const body = m[2];
  const si = body.indexOf('\nstream\n');
  objects.set(id, {
    id,
    dict: si >= 0 ? body.slice(0, si) : body,
    start: m.index!,
    streamStart: si >= 0 ? m.index! + m[1].length + 7 + si + 8 : null,
  });
}
check(objects.size === size - 1, `${size - 1} objektum beolvasva`);

const streamOf = (o: Obj): Buffer => {
  const len = Number(/\/Length (\d+)/.exec(o.dict)![1]);
  const raw = buf.subarray(o.streamStart!, o.streamStart! + len);
  return /\/FlateDecode/.test(o.dict) ? inflateSync(raw) : Buffer.from(raw);
};

// --- katalogus / lapfa -----------------------------------------------------
const root = Number(/\/Root (\d+) 0 R/.exec(xrefBody)![1]);
const catalog = objects.get(root)!;
check(/\/Type\/Catalog/.test(catalog.dict), 'a /Root egy /Catalog');
const pagesId = Number(/\/Pages (\d+) 0 R/.exec(catalog.dict)![1]);
const pages = objects.get(pagesId)!;
const count = Number(/\/Count (\d+)/.exec(pages.dict)![1]);
const kids = [...pages.dict.matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
check(kids.length === count, `/Count (${count}) = a /Kids elemszama`);
check(kids.every((k) => objects.has(k) && /\/Type\/Page/.test(objects.get(k)!.dict)), 'minden Kid letezo /Page');

// --- font ------------------------------------------------------------------
const fontObj = [...objects.values()].find((o) => /\/Subtype\/TrueType/.test(o.dict))!;
check(!!fontObj, 'van beagyazott TrueType font');
const widths = /\/Widths \[([^\]]+)\]/.exec(fontObj.dict)![1].trim().split(/\s+/).map(Number);
check(widths.length === 224, '/Widths 224 elemu (FirstChar 32 .. LastChar 255)');
check(widths[16] > 0 && widths[25] > 0, 'a szamjegyek szelessege nem nulla', `'0'=${widths[16]} '9'=${widths[25]}`);
check(new Set(widths.slice(16, 26)).size === 1, 'a szamjegyek azonos szelessegűek (tabularis)', `${widths[16]}/1000 em`);
const descId = Number(/\/FontDescriptor (\d+) 0 R/.exec(fontObj.dict)![1]);
const desc = objects.get(descId)!;
const fileId = Number(/\/FontFile2 (\d+) 0 R/.exec(desc.dict)![1]);
const ttf = streamOf(objects.get(fileId)!);
check(Number(/\/Length1 (\d+)/.exec(objects.get(fileId)!.dict)![1]) === ttf.length, '/Length1 = a kicsomagolt TTF merete');
check(ttf.readUInt32BE(0) === 0x00010000, 'a beagyazott stream valodi TrueType');

// --- elso lap --------------------------------------------------------------
const cfg = defaultConfig();
const page1 = objects.get(kids[0])!;
const mediaBox = /\/MediaBox \[([^\]]+)\]/.exec(page1.dict)![1].split(' ').map(Number);
check(
  Math.abs(mediaBox[2] - mmToPt(cfg.page.widthMm)) < 0.01 &&
    Math.abs(mediaBox[3] - mmToPt(cfg.page.heightMm)) < 0.01,
  'a MediaBox 108.3 x 78.3 mm',
  `${mediaBox[2].toFixed(2)} x ${mediaBox[3].toFixed(2)} pt`,
);

const contentId = Number(/\/Contents (\d+) 0 R/.exec(page1.dict)![1]);
const content = streamOf(objects.get(contentId)!).toString('latin1');
console.log('\n--- 1. lap tartalom-streamje ---\n' + content + '-------------------------------\n');

const day = dayOfYear(cfg.payload.validFrom);
const f = fieldsFor(cfg.payload, cfg.payload.serialFrom, day, 1);
const expectedPayload = render(cfg.payload.template, f);
const expected = buildBarcode(expectedPayload, cfg.barcode);

// A vonalkod rajzolasa: `q <szin> rg <a b c d e f> cm /Bc Do Q`
const cm = /q ([\d.]+ [\d.]+ [\d.]+) rg ([-\d. ]+) cm \/Bc Do Q/.exec(content);
check(!!cm, 'a vonalkod ImageMask-kent, sajat CTM-mel kerul ki');
const [a, b, c, d, e, fy] = cm![2].trim().split(' ').map(Number);
check(b === 0 && c === 0, 'nincs elforgatas (rotation = 0)');
check(
  Math.abs(a - mmToPt(expected.cols * cfg.barcode.moduleWidthMm)) < 0.01 &&
    Math.abs(d - mmToPt(expected.rows * cfg.barcode.moduleHeightMm)) < 0.01,
  'a vonalkod merete = modulszam x modulmeret',
  `${a.toFixed(2)} x ${d.toFixed(2)} pt`,
);
check(Math.abs(e - mmToPt(cfg.barcode.xMm)) < 0.01, 'vonalkod X pozicioja', `${e.toFixed(2)} pt`);
check(
  Math.abs(mediaBox[3] - fy - d - mmToPt(cfg.barcode.yMm)) < 0.01,
  'vonalkod Y pozicioja a lap tetejetol merve',
  `${(mediaBox[3] - fy - d).toFixed(2)} pt = ${cfg.barcode.yMm.toFixed(3)} mm`,
);

const tm = /BT [\d. ]+ rg \/(F\d+) ([\d.]+) Tf 1 0 0 1 ([-\d.]+) ([-\d.]+) Tm \(([^)]*)\) Tj ET/.exec(content);
check(!!tm, 'a sorszam szovegkent (nem kepkent) kerul ki');
check(tm![5] === f.serialText, `a kiirt sorszam = "${f.serialText}"`);
check(Math.abs(Number(tm![2]) - cfg.texts[0].sizePt) < 0.001, 'fontmeret 10.5 pt');
check(
  Math.abs(mediaBox[3] - Number(tm![4]) - mmToPt(cfg.texts[0].yMm)) < 0.01,
  'szoveg alapvonala a lap tetejetol merve',
  `${cfg.texts[0].yMm.toFixed(3)} mm`,
);

// --- ImageMask bitrol bitre ------------------------------------------------
const maskId = Number(/\/XObject <<\/Bc (\d+) 0 R/.exec(page1.dict)![1]);
const mask = objects.get(maskId)!;
check(/\/ImageMask true/.test(mask.dict) && /\/BitsPerComponent 1/.test(mask.dict), '1 bites /ImageMask');
check(/\/Decode \[1 0\]/.test(mask.dict), '/Decode [1 0] -- a beallitott bit a fekete modul');
const w = Number(/\/Width (\d+)/.exec(mask.dict)![1]);
const h = Number(/\/Height (\d+)/.exec(mask.dict)![1]);
check(w === expected.cols && h === expected.rows, `maszk merete ${w} x ${h} modul`);
const maskData = streamOf(mask);
check(maskData.length === expected.data.length, 'maszk byte-hossz = sor x byte/sor');
let dark = 0;
for (const byte of maskData) dark += popcount(byte);
const ratio = dark / (w * h);
check(ratio > 0.2 && ratio < 0.8, 'a maszk nem ures es nem csupa fekete', `${(ratio * 100).toFixed(1)}% modul fekete`);
check(Buffer.from(expected.data).equals(maskData), 'a maszk bitrol bitre = az ujraszamolt PDF417 matrix');
console.log(`      payload: ${expectedPayload}`);

// --- egyediseg -------------------------------------------------------------
const seen = new Set<string>();
for (const kid of kids.slice(0, 50)) {
  const p = objects.get(kid)!;
  const mid = Number(/\/XObject <<\/Bc (\d+) 0 R/.exec(p.dict)![1]);
  seen.add(streamOf(objects.get(mid)!).toString('base64'));
}
check(seen.size === Math.min(50, kids.length), 'az elso 50 lap vonalkodja mind kulonbozo');

console.log(`\n${failures === 0 ? 'MINDEN ELLENORZES RENDBEN' : failures + ' ELLENORZES BUKOTT'}`);
process.exit(failures === 0 ? 0 : 1);
