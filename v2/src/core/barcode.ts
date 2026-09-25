import PDF417 from '../vendor/pdf417.js';
import type { BarcodeConfig } from '../config';

export interface BarcodeMatrix {
  cols: number;
  rows: number;
  bytesPerRow: number;
  /** Soronkent byte-hataria igazitva, MSB elol. Beallitott bit = fekete modul. */
  data: Uint8Array;
}

/**
 * PDF417 szimbolum eloallitasa. A kodolas ugyanaz a TCPDF-port, amit a legacy
 * app is hasznalt, igy a leolvasott tartalom es a szimbolum alakja valtozatlan.
 * Kimenet: pakolt bitterkep -- ebbol lesz a PDF-ben 1 bites ImageMask.
 */
export function buildBarcode(text: string, cfg: BarcodeConfig): BarcodeMatrix {
  PDF417.ROWHEIGHT = cfg.rowHeight;
  PDF417.QUIETH = cfg.quietH;
  PDF417.QUIETV = cfg.quietV;
  PDF417.init(text, cfg.eccLevel, cfg.aspectRatio);
  const bc = PDF417.getBarcodeArray();

  const cols = bc.num_cols;
  const rows = bc.num_rows;
  const bytesPerRow = (cols + 7) >> 3;
  const data = new Uint8Array(bytesPerRow * rows);

  let dark = 0;
  for (let r = 0; r < rows; r++) {
    const src = bc.bcode[r];
    const base = r * bytesPerRow;
    for (let c = 0; c < cols; c++) {
      // A vendor a modulsorokat binaris STRINGbol bontja szet, igy az elemek
      // '0'/'1' karakterek -- a csendes zonak viszont szam 0-k. Ezert `== 1`.
      // eslint-disable-next-line eqeqeq
      if (src[c] == 1) {
        data[base + (c >> 3)] |= 0x80 >> (c & 7);
        dark++;
      }
    }
  }
  if (dark === 0) throw new Error('A PDF417 kodolas ures szimbolumot adott vissza.');
  return { cols, rows, bytesPerRow, data };
}

/** A szimbolum kirajzolt merete mm-ben az aktualis meretezesi mod szerint. */
export function barcodeSizeMm(m: BarcodeMatrix, cfg: BarcodeConfig): { w: number; h: number } {
  if (cfg.sizeMode === 'box') return { w: cfg.widthMm, h: cfg.heightMm };
  return { w: m.cols * cfg.moduleWidthMm, h: m.rows * cfg.moduleHeightMm };
}
