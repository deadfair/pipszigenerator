/**
 * Kompatibilitasi teszt: a v2 pontosan ugyanazt a kodot es ugyanazt a
 * PDF417 szimbolumot allitja elo, mint a regi Angular app.
 *
 * A referencia a regi forrasban kommentkent szereplo, valos mintakod:
 *   BUDPSH201908011200202108011200419033840918781
 */
import PDF417 from '../src/vendor/pdf417.js';
import { buildBarcode } from '../src/core/barcode';
import { crc32 } from '../src/core/crc32';
import { dayOfYear, fieldsFor, render } from '../src/core/payload';
import { defaultConfig } from '../src/config';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'HIBA'}  ${label}${detail ? '  -- ' + detail : ''}`);
};

// --- 1. a kod szo szerint egyezik a regi mintaval ---------------------------
const REFERENCE = 'BUDPSH201908011200202108011200419033840918781';

const cfg = defaultConfig();
cfg.payload.prefix = 'BUDPSH';
cfg.payload.validFrom = '201908011200';
cfg.payload.validTo = '202108011200';

const day = dayOfYear(cfg.payload.validFrom);
check(day === 213, '2019-08-01 az ev 213. napja', String(day));

const f = fieldsFor(cfg.payload, 41903, day, 1);
check(f.crc === '3840918781', 'a CRC-32 egyezik a referenciaval', f.crc);
check(render(cfg.payload.template, f) === REFERENCE, 'a teljes kod karakterre egyezik', render(cfg.payload.template, f));

// A legacy `dayOfTheYear` a referenciapontot helyi idoben kepezte; a v2 vegig
// UTC-ben szamol. Ellenorizzuk, hogy CET/CEST-ben ez ugyanazt adja.
const legacyDayOfYear = (s: string) => {
  const d = s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  const now = new Date(d);
  const start = new Date(new Date(d).getFullYear(), 0, 0);
  return Math.floor((now.valueOf() - start.valueOf()) / 86_400_000);
};
let mismatches = 0;
for (let m = 1; m <= 12; m++) {
  for (const dd of [1, 15, 28]) {
    for (const y of [2019, 2020, 2024, 2026, 2028]) {
      const s = `${y}${String(m).padStart(2, '0')}${String(dd).padStart(2, '0')}0100`;
      if (dayOfYear(s) !== legacyDayOfYear(s)) mismatches++;
    }
  }
}
check(mismatches === 0, 'a napszamitas 180 datumon egyezik a legacy-vel (Europe/Budapest)', `${mismatches} elteres`);

// --- 2. a bitterkep egyezik a vendor nyers kimenetevel ----------------------
PDF417.ROWHEIGHT = cfg.barcode.rowHeight;
PDF417.QUIETH = cfg.barcode.quietH;
PDF417.QUIETV = cfg.barcode.quietV;
PDF417.init(REFERENCE, cfg.barcode.eccLevel, cfg.barcode.aspectRatio);
const raw = PDF417.getBarcodeArray();

const m = buildBarcode(REFERENCE, cfg.barcode);
check(m.cols === raw.num_cols && m.rows === raw.num_rows, `a matrix merete ${m.cols} x ${m.rows}`);

let diff = 0;
for (let r = 0; r < m.rows; r++) {
  for (let c = 0; c < m.cols; c++) {
    const packed = (m.data[r * m.bytesPerRow + (c >> 3)] >> (7 - (c & 7))) & 1;
    // A regi app pont igy dontotte el, mi fekete: `bcode[r][c] == 1`.
    // eslint-disable-next-line eqeqeq
    const expected = raw.bcode[r][c] == 1 ? 1 : 0;
    if (packed !== expected) diff++;
  }
}
check(diff === 0, 'a pakolt bitterkep modulrol modulra egyezik a vendor kimenetevel', `${diff} elteres`);

// --- 3. a szimbolum szerkezete ep -------------------------------------------
const rowBits = (r: number) => {
  let s = '';
  for (let c = 0; c < m.cols; c++) s += (m.data[r * m.bytesPerRow + (c >> 3)] >> (7 - (c & 7))) & 1;
  return s;
};
const START = '11111111010101000';
const STOP = '111111101000101001';
const quiet = cfg.barcode.quietV;
const dataRows = Array.from({ length: m.rows - 2 * quiet }, (_, i) => rowBits(i + quiet));
const inner = dataRows.map((s) => s.slice(cfg.barcode.quietH, s.length - cfg.barcode.quietH));
check(inner.every((s) => s.startsWith(START)), 'minden adatsor a PDF417 start-mintaval kezdodik');
check(inner.every((s) => s.endsWith(STOP)), 'minden adatsor a stop-mintaval vegzodik');
check(
  Array.from({ length: quiet }, (_, i) => rowBits(i)).every((s) => !s.includes('1')),
  'a felso csendes zona tiszta',
);
check(rowBits(0).length === m.cols, 'a sorhossz = oszlopszam');

// --- 4. a legacy geometria bitre valtozatlan --------------------------------
// A regi app skalaja: `rating = 108.3 / 1279` mm/px.
const rating = 108.3 / 1279;
const same = (mm: number, legacyPx: number, label: string) =>
  check(Math.abs(mm - legacyPx * rating) < 1e-12, label, `${legacyPx} px -> ${mm.toFixed(5)} mm`);

same(cfg.barcode.xMm, 468, 'vonalkod X valtozatlan');
same(cfg.barcode.yMm, 537, 'vonalkod Y valtozatlan');
same(cfg.barcode.moduleWidthMm, 6, 'modul szelesseg valtozatlan (bw = 6 px)');
same(cfg.barcode.moduleHeightMm, 3, 'modul magassag valtozatlan (bh = 3 px)');
same(cfg.texts[0].xMm, 181, 'sorszam X valtozatlan');
same(cfg.texts[0].yMm, 651, 'sorszam Y valtozatlan');
check(cfg.page.widthMm === 108.3 && cfg.page.heightMm === 78.3, 'lapmeret 108.3 x 78.3 mm');
check(cfg.texts[0].sizePt === 10.5, 'betumeret 10.5 pt');
check(cfg.texts[0].fontKey === 'vinci-light', 'betutipus Vinci Sans Light');
check(cfg.barcode.rowHeight === 4 && cfg.barcode.quietH === 2 && cfg.barcode.quietV === 2, 'TCPDF alapertekek (ROWHEIGHT 4, QUIET 2/2)');
check(cfg.barcode.aspectRatio === 2 && cfg.barcode.eccLevel === -1, 'oldalarany 2, automatikus ECC');

// --- 5. a regi CRC implementacio ugyanazt adja ------------------------------
const legacyCrc32 = (r: string) => {
  const o: number[] = [];
  for (let c = 0; c < 256; c++) {
    let a = c;
    for (let i = 0; i < 8; i++) a = 1 & a ? 3988292384 ^ (a >>> 1) : a >>> 1;
    o[c] = a;
  }
  let n = -1;
  for (let t = 0; t < r.length; t++) n = (n >>> 8) ^ o[255 & (n ^ r.charCodeAt(t))];
  return (-1 ^ n) >>> 0;
};
let crcDiff = 0;
for (let i = 1; i <= 5000; i++) if (crc32(String(i)) !== legacyCrc32(String(i))) crcDiff++;
check(crcDiff === 0, 'a CRC-32 5000 bemeneten egyezik a regi implementacioval');

console.log(`\n${failures === 0 ? 'A V2 KIMENETE KOMPATIBILIS A REGIVEL' : failures + ' ELLENORZES BUKOTT'}`);
process.exit(failures === 0 ? 0 : 1);
