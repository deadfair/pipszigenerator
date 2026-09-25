import { PdfDocument } from '../src/pdf/document';
import { buildBarcode, barcodeSizeMm } from '../src/core/barcode';
import { dayOfYear, fieldsFor, render } from '../src/core/payload';
import { defaultConfig } from '../src/config';
import { readFileSync, writeFileSync } from 'node:fs';

const PAGES = Number(process.env.PAGES ?? 2000);
const COMPRESS = process.env.COMPRESS !== '0';

async function main() {
  const cfg = defaultConfig();
  cfg.output.compress = COMPRESS;
  cfg.payload.serialTo = cfg.payload.serialFrom + PAGES - 1;

  const ttf = readFileSync('public/fonts/Vinci_Sans_Light.ttf');
  const buf = ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength) as ArrayBuffer;

  const t0 = performance.now();
  const doc = new PdfDocument({
    widthMm: cfg.page.widthMm, heightMm: cfg.page.heightMm,
    compress: cfg.output.compress, title: cfg.output.title,
  });
  const font = await doc.addFont(buf);
  const day = dayOfYear(cfg.payload.validFrom);

  for (let s = cfg.payload.serialFrom; s <= cfg.payload.serialTo; s++) {
    const f = fieldsFor(cfg.payload, s, day, s - cfg.payload.serialFrom + 1);
    const m = buildBarcode(render(cfg.payload.template, f), cfg.barcode);
    const size = barcodeSizeMm(m, cfg.barcode);
    if (s === cfg.payload.serialFrom) {
      console.log('payload   :', render(cfg.payload.template, f));
      console.log('matrix    :', m.cols, 'x', m.rows, '->', size.w.toFixed(3), 'x', size.h.toFixed(3), 'mm');
    }
    await doc.addPage({
      barcode: { matrix: m, xMm: cfg.barcode.xMm, yMm: cfg.barcode.yMm, widthMm: size.w, heightMm: size.h, rotation: 0, color: '#000000' },
      texts: [{ text: render('{serial}', f), font, sizePt: 10.5, xMm: cfg.texts[0].xMm, yMm: cfg.texts[0].yMm, align: 'left', color: '#000000', charSpacingPt: 0 }],
    });
  }
  const blob = doc.finish();
  const ms = performance.now() - t0;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  writeFileSync('test/out.pdf', bytes);
  console.log(`pages=${PAGES} compress=${COMPRESS} time=${ms.toFixed(0)}ms (${(ms / PAGES).toFixed(2)} ms/lap) size=${(bytes.length / 1048576).toFixed(2)} MB`);
}
main();
