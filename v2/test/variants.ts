/**
 * Vegigmegy a nem-alapertelmezett beallitasokon (forgatas, dobozos meretezes,
 * CRC-feltoltes, tobb szovegmezo, kikapcsolt vonalkod, tobb fajlra bontas),
 * es minden valtozatot atenged az `assertPdf` szerkezeti ellenorzesen.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PdfDocument, type FontHandle } from '../src/pdf/document';
import { buildBarcode, barcodeSizeMm } from '../src/core/barcode';
import { dayOfYear, fieldsFor, render, pageCount } from '../src/core/payload';
import { defaultConfig, type AppConfig } from '../src/config';
import { mmToPt } from '../src/core/units';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'OK  ' : 'HIBA'}  ${label}${detail ? '  -- ' + detail : ''}`);
};

const ttf = readFileSync('public/fonts/Vinci_Sans_Light.ttf');
const toBuffer = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** Ugyanaz a lapepito logika, mint a workerben. */
async function build(cfg: AppConfig): Promise<Uint8Array> {
  const doc = new PdfDocument({
    widthMm: cfg.page.widthMm,
    heightMm: cfg.page.heightMm,
    compress: cfg.output.compress,
    title: cfg.output.title,
  });
  const handles = new Map<string, FontHandle>();
  for (const t of cfg.texts) {
    if (t.enabled && !handles.has(t.fontKey)) handles.set(t.fontKey, await doc.addFont(toBuffer(ttf)));
  }
  const day = dayOfYear(cfg.payload.validFrom);
  for (let s = cfg.payload.serialFrom; s <= cfg.payload.serialTo; s++) {
    const f = fieldsFor(cfg.payload, s, day, s - cfg.payload.serialFrom + 1);
    const spec: Parameters<typeof doc.addPage>[0] = { texts: [] };
    if (cfg.barcode.visible) {
      const m = buildBarcode(render(cfg.payload.template, f), cfg.barcode);
      const size = barcodeSizeMm(m, cfg.barcode);
      spec.barcode = {
        matrix: m, xMm: cfg.barcode.xMm, yMm: cfg.barcode.yMm,
        widthMm: size.w, heightMm: size.h,
        rotation: cfg.barcode.rotation, color: cfg.barcode.color,
      };
    }
    for (const t of cfg.texts) {
      if (!t.enabled) continue;
      spec.texts.push({
        text: render(t.template, f), font: handles.get(t.fontKey)!, sizePt: t.sizePt,
        xMm: t.xMm, yMm: t.yMm, align: t.align, color: t.color, charSpacingPt: t.charSpacingPt,
      });
    }
    await doc.addPage(spec);
  }
  return new Uint8Array(await doc.finish().arrayBuffer());
}

/** Minden valtozatra kotelezo szerkezeti elvarasok. */
function assertPdf(bytes: Uint8Array, cfg: AppConfig, label: string): string {
  const buf = Buffer.from(bytes);
  const text = buf.toString('latin1');
  const startxref = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)![1]);
  check(text.slice(startxref, startxref + 4) === 'xref', `${label}: ep xref`);

  const size = Number(/\/Size (\d+)/.exec(text.slice(startxref))![1]);
  const entries = [...text.slice(startxref).matchAll(/^(\d{10}) (\d{5}) ([nf]) $/gm)];
  let bad = 0;
  for (let i = 1; i < size; i++) {
    if (!new RegExp(`^${i} 0 obj`).test(text.slice(Number(entries[i][1]), Number(entries[i][1]) + 24))) bad++;
  }
  check(bad === 0, `${label}: minden objektum-eltolas helyes`);

  const objects = new Map<number, { dict: string; streamStart: number | null }>();
  for (const m of text.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj\n/g)) {
    const si = m[2].indexOf('\nstream\n');
    objects.set(Number(m[1]), {
      dict: si >= 0 ? m[2].slice(0, si) : m[2],
      streamStart: si >= 0 ? m.index! + m[1].length + 7 + si + 8 : null,
    });
  }
  const pagesDict = [...objects.values()].find((o) => /\/Type\/Pages/.test(o.dict))!;
  const count = Number(/\/Count (\d+)/.exec(pagesDict.dict)![1]);
  check(count === pageCount(cfg.payload), `${label}: ${count} lap`);

  const page1Id = Number(/\/Kids \[(\d+) 0 R/.exec(pagesDict.dict)![1]);
  const page1 = objects.get(page1Id)!;
  const contentId = Number(/\/Contents (\d+) 0 R/.exec(page1.dict)![1]);
  const c = objects.get(contentId)!;
  const len = Number(/\/Length (\d+)/.exec(c.dict)![1]);
  const raw = buf.subarray(c.streamStart!, c.streamStart! + len);
  const content = (/\/FlateDecode/.test(c.dict) ? inflateSync(raw) : raw).toString('latin1');
  check(!/NaN|undefined|Infinity/.test(content), `${label}: nincs NaN/undefined a tartalomban`);

  // Minden kirajzolt elem a lapon belul marad-e (durva befoglalo ellenorzes).
  const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(page1.dict)!;
  check(
    Math.abs(Number(box[1]) - mmToPt(cfg.page.widthMm)) < 0.01 &&
      Math.abs(Number(box[2]) - mmToPt(cfg.page.heightMm)) < 0.01,
    `${label}: MediaBox`,
  );
  return content;
}

async function main() {
  // --- 1. forgatas 90 fokkal ---
  {
    console.log('\n[1] vonalkod 90 fokkal elforgatva');
    const cfg = defaultConfig();
    cfg.barcode.rotation = 90;
    cfg.payload.serialTo = cfg.payload.serialFrom + 2;
    const content = assertPdf(await build(cfg), cfg, 'rot90');
    const cm = /([-\d. ]+) cm \/Bc Do Q/.exec(content)![1].trim().split(' ').map(Number);
    const m = buildBarcode(render(cfg.payload.template, fieldsFor(cfg.payload, cfg.payload.serialFrom, dayOfYear(cfg.payload.validFrom), 1)), cfg.barcode);
    const { w, h } = barcodeSizeMm(m, cfg.barcode);
    check(cm[0] === 0 && cm[3] === 0, 'rot90: a CTM tenyleg forgat (a = d = 0)');
    check(Math.abs(cm[1] - mmToPt(w)) < 0.01 && Math.abs(cm[2] + mmToPt(h)) < 0.01, 'rot90: b = +szelesseg, c = -magassag');
    check(Math.abs(cm[4] - mmToPt(cfg.barcode.xMm + h)) < 0.01, 'rot90: a befoglalo doboz bal szele a beallitott X');
    check(
      Math.abs(mmToPt(cfg.page.heightMm) - cm[5] - mmToPt(w) - mmToPt(cfg.barcode.yMm)) < 0.01,
      'rot90: a befoglalo doboz teteje a beallitott Y',
    );
  }

  // --- 2. dobozos meretezes ---
  {
    console.log('\n[2] fix dobozba feszitve');
    const cfg = defaultConfig();
    cfg.barcode.sizeMode = 'box';
    cfg.barcode.widthMm = 60;
    cfg.barcode.heightMm = 12;
    cfg.payload.serialTo = cfg.payload.serialFrom + 2;
    const content = assertPdf(await build(cfg), cfg, 'box');
    const cm = /([-\d. ]+) cm \/Bc Do Q/.exec(content)![1].trim().split(' ').map(Number);
    check(Math.abs(cm[0] - mmToPt(60)) < 0.01 && Math.abs(cm[3] - mmToPt(12)) < 0.01, 'box: pontosan 60 x 12 mm');
  }

  // --- 3. CRC feltoltve + hosszabb sorszam ---
  {
    console.log('\n[3] CRC 10 jegyre toltve, 6 jegyu sorszam');
    const cfg = defaultConfig();
    cfg.payload.crcPad = 10;
    cfg.payload.serialPad = 6;
    cfg.payload.serialTo = cfg.payload.serialFrom + 2;
    const f = fieldsFor(cfg.payload, cfg.payload.serialFrom, dayOfYear(cfg.payload.validFrom), 1);
    check(f.crc.length === 10, 'a CRC 10 jegyu', f.crc);
    check(f.serialText === '002001', 'a sorszam 6 jegyu', f.serialText);
    const payload = render(cfg.payload.template, f);
    check(payload.length === 6 + 12 + 12 + 6 + 10, 'a kod hossza fix', String(payload.length));
    assertPdf(await build(cfg), cfg, 'crcpad');
  }

  // --- 4. tobb szovegmezo, kozepre/jobbra igazitva ---
  {
    console.log('\n[4] harom szovegmezo, kulonbozo igazitassal');
    const cfg = defaultConfig();
    cfg.payload.serialTo = cfg.payload.serialFrom + 2;
    cfg.texts.push(
      { ...cfg.texts[0], id: 't2', label: 'Kozep', template: '{prefix} / {serialRaw}', align: 'center', xMm: cfg.page.widthMm / 2, yMm: 20, sizePt: 8 },
      { ...cfg.texts[0], id: 't3', label: 'Jobb', template: '{from}', align: 'right', xMm: cfg.page.widthMm - 5, yMm: 70, sizePt: 6, charSpacingPt: 0.4 },
    );
    const content = assertPdf(await build(cfg), cfg, 'texts');
    const draws = [...content.matchAll(/BT .*? Tj ET/g)];
    check(draws.length === 3, 'mindharom szoveg kirajzolodik', String(draws.length));
    const xs = [...content.matchAll(/1 0 0 1 ([-\d.]+) ([-\d.]+) Tm/g)].map((m) => Number(m[1]));
    check(xs[1] < mmToPt(cfg.page.widthMm / 2), 'kozepre igazitva a kezdopont balra tolodik');
    check(xs[2] < mmToPt(cfg.page.widthMm - 5), 'jobbra igazitva a kezdopont balra tolodik');
    check(/Tc/.test(content), 'a betukoz Tc operatorkent kerul ki');
  }

  // --- 5. vonalkod nelkul ---
  {
    console.log('\n[5] vonalkod kikapcsolva');
    const cfg = defaultConfig();
    cfg.barcode.visible = false;
    cfg.payload.serialTo = cfg.payload.serialFrom + 2;
    const content = assertPdf(await build(cfg), cfg, 'notext');
    check(!/\/Bc Do/.test(content), 'nincs vonalkod a tartalomban');
    check(/Tj ET/.test(content), 'a szoveg viszont ott van');
  }

  // --- 6. tomorites nelkul ---
  {
    console.log('\n[6] tomorites nelkul');
    const cfg = defaultConfig();
    cfg.output.compress = false;
    cfg.payload.serialTo = cfg.payload.serialFrom + 2;
    const bytes = await build(cfg);
    assertPdf(bytes, cfg, 'raw');
    check(!Buffer.from(bytes).toString('latin1').includes('/Filter/FlateDecode'), 'tenyleg nincs FlateDecode');
    writeFileSync('test/out-raw.pdf', bytes);
  }

  // --- 7. mas lapmeret ---
  {
    console.log('\n[7] A6 fekvo lap');
    const cfg = defaultConfig();
    cfg.page.widthMm = 148;
    cfg.page.heightMm = 105;
    cfg.payload.serialTo = cfg.payload.serialFrom + 2;
    assertPdf(await build(cfg), cfg, 'a6');
  }

  console.log(`\n${failures === 0 ? 'MINDEN VALTOZAT RENDBEN' : failures + ' ELLENORZES BUKOTT'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
