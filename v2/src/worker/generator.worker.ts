/// <reference lib="webworker" />
import { PdfDocument, type FontHandle, type PageSpec, type TextDraw } from '../pdf/document';
import { buildBarcode, barcodeSizeMm } from '../core/barcode';
import { dayOfYear, fieldsFor, render, pageCount } from '../core/payload';
import type { AppConfig } from '../config';
import type { WorkerRequest, WorkerResponse, GenerateRequest } from './protocol';

const post = (msg: WorkerResponse, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(msg, transfer ?? []);

let cancelled = false;

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  if (ev.data.type === 'cancel') {
    cancelled = true;
    return;
  }
  cancelled = false;
  try {
    await generate(ev.data);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

async function generate(req: GenerateRequest): Promise<void> {
  const cfg = req.config;
  const total = pageCount(cfg.payload);
  if (total === 0) throw new Error('Nincs generalando lap (ures sorszam-tartomany).');

  const day = dayOfYear(cfg.payload.validFrom);
  const perFile = cfg.output.pagesPerFile > 0 ? cfg.output.pagesPerFile : total;
  const fileCount = Math.ceil(total / perFile);

  const started = performance.now();
  let done = 0;
  let bytes = 0;
  let lastReport = 0;

  for (let fileIndex = 0; fileIndex < fileCount; fileIndex++) {
    const firstSerial = cfg.payload.serialFrom + fileIndex * perFile;
    const lastSerial = Math.min(firstSerial + perFile - 1, cfg.payload.serialTo);

    const doc = new PdfDocument({
      widthMm: cfg.page.widthMm,
      heightMm: cfg.page.heightMm,
      compress: cfg.output.compress,
      title: cfg.output.title,
    });

    // Fontok: csak az engedelyezett szovegmezokhoz tartozok, egyszer mindegyik.
    const handles = new Map<string, FontHandle>();
    for (const item of cfg.texts) {
      if (!item.enabled || handles.has(item.fontKey)) continue;
      const buffer = req.fonts[item.fontKey];
      if (!buffer) throw new Error(`Hianyzik a font: ${item.fontKey}`);
      handles.set(item.fontKey, await doc.addFont(buffer));
    }

    if (req.background) {
      await doc.setBackground(
        new Uint8Array(req.background.rgb),
        req.background.width,
        req.background.height,
        req.background.opacity,
      );
    }

    for (let serial = firstSerial; serial <= lastSerial; serial++) {
      if (cancelled) {
        post({ type: 'cancelled' });
        return;
      }

      const pageNo = serial - cfg.payload.serialFrom + 1;
      const fields = fieldsFor(cfg.payload, serial, day, pageNo);
      const spec: PageSpec = { texts: [] };

      if (cfg.barcode.visible) {
        const matrix = buildBarcode(render(cfg.payload.template, fields), cfg.barcode);
        const { w, h } = barcodeSizeMm(matrix, cfg.barcode);
        spec.barcode = {
          matrix,
          xMm: cfg.barcode.xMm,
          yMm: cfg.barcode.yMm,
          widthMm: w,
          heightMm: h,
          rotation: cfg.barcode.rotation,
          color: cfg.barcode.color,
        };
      }

      for (const item of cfg.texts) {
        if (!item.enabled) continue;
        const draw: TextDraw = {
          text: render(item.template, fields),
          font: handles.get(item.fontKey)!,
          sizePt: item.sizePt,
          xMm: item.xMm,
          yMm: item.yMm,
          align: item.align,
          color: item.color,
          charSpacingPt: item.charSpacingPt,
        };
        spec.texts.push(draw);
      }

      await doc.addPage(spec);
      done++;

      const now = performance.now();
      if (now - lastReport > 120) {
        lastReport = now;
        post({ type: 'progress', done, total, elapsedMs: now - started });
        // Egy makrotaszk-korre atadjuk a vezerlest, kulonben a 'cancel' uzenet
        // csak a futas vegen jutna el ide (tomorites nelkul nincs igazi await).
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    const blob = doc.finish();
    bytes += blob.size;
    post({
      type: 'file',
      blob,
      name: fileName(cfg, fileIndex, fileCount, firstSerial, lastSerial),
      index: fileIndex,
      of: fileCount,
      pages: lastSerial - firstSerial + 1,
    });
  }

  post({ type: 'progress', done, total, elapsedMs: performance.now() - started });
  post({
    type: 'done',
    pages: done,
    files: fileCount,
    bytes,
    elapsedMs: performance.now() - started,
  });
}

function fileName(
  cfg: AppConfig,
  index: number,
  count: number,
  firstSerial: number,
  lastSerial: number,
): string {
  const base = cfg.output.fileName
    .replace(/\{from\}/g, String(firstSerial))
    .replace(/\{to\}/g, String(lastSerial))
    .replace(/\{prefix\}/g, cfg.payload.prefix)
    .replace(/\{validFrom\}/g, cfg.payload.validFrom)
    .replace(/\{validTo\}/g, cfg.payload.validTo)
    .replace(/\{part\}/g, String(index + 1))
    .replace(/[\\/:*?"<>|]/g, '_');
  const suffix = count > 1 && !cfg.output.fileName.includes('{part}')
    ? `_${String(index + 1).padStart(String(count).length, '0')}`
    : '';
  return `${base}${suffix}.pdf`;
}
