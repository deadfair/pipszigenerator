import type { AppConfig, TextItem } from './config';
import type { BarcodeMatrix } from './core/barcode';
import { barcodeSizeMm } from './core/barcode';
import { ptToMm } from './core/units';
import { measure } from './pdf/document';

export interface Box {
  kind: 'barcode' | 'text';
  /** Szovegnel a `texts` tomb indexe. */
  index: number;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
}

export interface PreviewInput {
  cfg: AppConfig;
  matrix: BarcodeMatrix | null;
  /** Szovegmezo-indexenkent a mar kitoltott szoveg. */
  texts: string[];
  /** fontKey -> a PDF-be kerulo szelessegek, hogy az igazitas 1:1 legyen. */
  widths: Map<string, number[]>;
  background: CanvasImageSource | null;
  selected: Box | null;
}

/** Egy modulnyi terkep gyorsitotarazva, hogy huzas kozben ne kelljen ujrarajzolni. */
let moduleCanvas: HTMLCanvasElement | null = null;
let moduleKey = '';

function matrixToCanvas(m: BarcodeMatrix, color: string): HTMLCanvasElement {
  const key = m.cols + 'x' + m.rows + ':' + color + ':' + m.data.length + ':' + hash(m.data);
  if (moduleCanvas && moduleKey === key) return moduleCanvas;

  const c = document.createElement('canvas');
  c.width = m.cols;
  c.height = m.rows;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(m.cols, m.rows);
  const [r, g, b] = hexToRgb(color);
  for (let row = 0; row < m.rows; row++) {
    const base = row * m.bytesPerRow;
    for (let col = 0; col < m.cols; col++) {
      const on = (m.data[base + (col >> 3)] >> (7 - (col & 7))) & 1;
      const p = (row * m.cols + col) * 4;
      img.data[p] = r;
      img.data[p + 1] = g;
      img.data[p + 2] = b;
      img.data[p + 3] = on ? 255 : 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  moduleCanvas = c;
  moduleKey = key;
  return c;
}

function hash(data: Uint8Array): number {
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 16777619);
  return h >>> 0;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Kirajzolja a lapot es visszaadja a mozgathato elemek dobozait (mm-ben). */
export function drawPreview(canvas: HTMLCanvasElement, input: PreviewInput): Box[] {
  const { cfg } = input;
  // A rendelkezesre allo helyet a keret adja -- a canvas sajat merete ebbol jon.
  const frame = canvas.parentElement as HTMLElement | null;
  const available = frame ? frame.clientWidth - 28 : 0;
  const cssWidth = Math.max(180, available || 440);
  const scale = cssWidth / cfg.page.widthMm; // CSS px / mm
  const dpr = Math.min(window.devicePixelRatio || 1, 3);

  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cfg.page.heightMm * scale + 'px';
  canvas.width = Math.round(cfg.page.widthMm * scale * dpr);
  canvas.height = Math.round(cfg.page.heightMm * scale * dpr);

  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0); // 1 egyseg = 1 mm
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cfg.page.widthMm, cfg.page.heightMm);

  if (input.background && cfg.background.enabled) {
    ctx.globalAlpha = cfg.background.opacity;
    ctx.drawImage(input.background, 0, 0, cfg.page.widthMm, cfg.page.heightMm);
    ctx.globalAlpha = 1;
  }

  const boxes: Box[] = [];

  if (cfg.barcode.visible && input.matrix) {
    const { w, h } = barcodeSizeMm(input.matrix, cfg.barcode);
    const rotated = cfg.barcode.rotation === 90 || cfg.barcode.rotation === 270;
    const box: Box = {
      kind: 'barcode',
      index: 0,
      xMm: cfg.barcode.xMm,
      yMm: cfg.barcode.yMm,
      wMm: rotated ? h : w,
      hMm: rotated ? w : h,
    };
    boxes.push(box);

    const bmp = matrixToCanvas(input.matrix, cfg.barcode.color);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(box.xMm, box.yMm);
    switch (cfg.barcode.rotation) {
      case 90: ctx.translate(h, 0); ctx.rotate(Math.PI / 2); break;
      case 180: ctx.translate(w, h); ctx.rotate(Math.PI); break;
      case 270: ctx.translate(0, w); ctx.rotate(-Math.PI / 2); break;
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    ctx.restore();
  }

  cfg.texts.forEach((item, i) => {
    if (!item.enabled) return;
    const text = input.texts[i] ?? '';
    const sizeMm = ptToMm(item.sizePt);
    const widthMm = textWidthMm(text, item, input.widths);

    ctx.save();
    ctx.fillStyle = item.color;
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${sizeMm}px "${item.fontKey}", sans-serif`;
    const x = item.align === 'center' ? item.xMm - widthMm / 2 : item.align === 'right' ? item.xMm - widthMm : item.xMm;
    if (item.charSpacingPt) {
      let cursor = x;
      for (const ch of text) {
        ctx.fillText(ch, cursor, item.yMm);
        cursor += ctx.measureText(ch).width + ptToMm(item.charSpacingPt);
      }
    } else {
      ctx.fillText(text, x, item.yMm);
    }
    ctx.restore();

    boxes.push({
      kind: 'text',
      index: i,
      xMm: x,
      yMm: item.yMm - sizeMm * 0.75,
      wMm: Math.max(widthMm, 1),
      hMm: sizeMm,
    });
  });

  // Kijeloles-keret a legfelul rajzolt retegen, hogy semmit ne takarjon.
  if (input.selected) {
    const sel = boxes.find((b) => b.kind === input.selected!.kind && b.index === input.selected!.index);
    if (sel) {
      ctx.save();
      ctx.strokeStyle = '#5ac8a0';
      ctx.lineWidth = 0.25;
      ctx.setLineDash([1, 1]);
      ctx.strokeRect(sel.xMm, sel.yMm, sel.wMm, sel.hMm);
      ctx.restore();
    }
  }

  return boxes;
}

/** Ugyanaz a szelesseg-szamitas, mint a PDF-ben -- igy az elonezet nem hazudik. */
export function textWidthMm(text: string, item: TextItem, widths: Map<string, number[]>): number {
  const w = widths.get(item.fontKey);
  if (!w) return text.length * ptToMm(item.sizePt) * 0.5;
  return ptToMm(measure(text, w, item.sizePt, item.charSpacingPt));
}

/** A kurzor alatti legfelso doboz (a kesobb rajzoltak vannak felul). */
export function hitTest(boxes: Box[], xMm: number, yMm: number): Box | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    const pad = 0.6; // kis toleranciat adunk a vekony szovegeknek
    if (xMm >= b.xMm - pad && xMm <= b.xMm + b.wMm + pad && yMm >= b.yMm - pad && yMm <= b.yMm + b.hMm + pad) {
      return b;
    }
  }
  return null;
}
