import { PdfWriter, latin1, pdfString, num, rgb, deflate } from './writer';
import { parseTtf, unicodeToWinAnsi, type EmbeddedFont } from './ttf';
import { mmToPt } from '../core/units';
import type { BarcodeMatrix } from '../core/barcode';
import type { Align, Rotation } from '../config';

export interface FontHandle {
  /** Eroforras-nev a lap Resources szotaraban, pl. `/F0`. */
  res: string;
  id: number;
  widths: number[];
}

export interface TextDraw {
  text: string;
  font: FontHandle;
  sizePt: number;
  /** mm, a lap bal szeletol. */
  xMm: number;
  /** mm, a lap tetejetol az alapvonalig (ahogy a jsPDF `text()` is szamolta). */
  yMm: number;
  align: Align;
  color: string;
  charSpacingPt: number;
}

export interface BarcodeDraw {
  matrix: BarcodeMatrix;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  rotation: Rotation;
  color: string;
}

export interface PageSpec {
  barcode?: BarcodeDraw;
  texts: TextDraw[];
}

interface BackgroundRes {
  id: number;
  gsId: number | null;
}

export interface DocumentOptions {
  widthMm: number;
  heightMm: number;
  compress: boolean;
  title: string;
}

export class PdfDocument {
  private w = new PdfWriter();
  private catalogId: number;
  private pagesId: number;
  private infoId: number;
  private pageIds: number[] = [];
  private fonts: FontHandle[] = [];
  private background: BackgroundRes | null = null;
  private wPt: number;
  private hPt: number;

  constructor(private opts: DocumentOptions) {
    this.catalogId = this.w.allocId();
    this.pagesId = this.w.allocId();
    this.infoId = this.w.allocId();
    this.wPt = mmToPt(opts.widthMm);
    this.hPt = mmToPt(opts.heightMm);
  }

  /** TTF beagyazasa. Egy fontot eleg egyszer felvenni, barhany lap hasznalhatja. */
  async addFont(buffer: ArrayBuffer): Promise<FontHandle> {
    const font: EmbeddedFont = parseTtf(buffer);
    const fileId = this.w.allocId();
    const descId = this.w.allocId();
    const fontId = this.w.allocId();

    const packed = this.opts.compress ? await deflate(font.data) : null;
    this.w.writeStream(
      fileId,
      '/Length1 ' + font.data.length + (packed ? '/Filter/FlateDecode' : ''),
      packed ?? font.data,
    );

    this.w.writeObject(
      descId,
      '<</Type/FontDescriptor/FontName/' + font.postScriptName +
        '/Flags ' + font.flags +
        '/FontBBox [' + font.bbox.map(num).join(' ') + ']' +
        '/ItalicAngle ' + num(font.italicAngle) +
        '/Ascent ' + font.ascent +
        '/Descent ' + font.descent +
        '/CapHeight ' + font.capHeight +
        '/StemV ' + font.stemV +
        '/FontFile2 ' + fileId + ' 0 R>>',
    );

    this.w.writeObject(
      fontId,
      '<</Type/Font/Subtype/TrueType/BaseFont/' + font.postScriptName +
        '/FirstChar 32/LastChar 255' +
        '/Widths [' + font.widths.slice(32, 256).join(' ') + ']' +
        '/Encoding/WinAnsiEncoding' +
        '/FontDescriptor ' + descId + ' 0 R>>',
    );

    const handle: FontHandle = { res: 'F' + this.fonts.length, id: fontId, widths: font.widths };
    this.fonts.push(handle);
    return handle;
  }

  /**
   * Hatterkep (pl. a nyomdai alap) beagyazasa. Egyetlen kep-objektum, amire
   * minden lap hivatkozik -- akkor sem duplazodik, ha 10 000 lap van.
   */
  async setBackground(rgbData: Uint8Array, width: number, height: number, opacity: number): Promise<void> {
    const id = this.w.allocId();
    const packed = await deflate(rgbData);
    this.w.writeStream(
      id,
      '/Type/XObject/Subtype/Image/Width ' + width + '/Height ' + height +
        '/ColorSpace/DeviceRGB/BitsPerComponent 8' +
        (packed ? '/Filter/FlateDecode' : ''),
      packed ?? rgbData,
    );

    let gsId: number | null = null;
    if (opacity < 1) {
      gsId = this.w.allocId();
      this.w.writeObject(gsId, '<</Type/ExtGState/ca ' + num(opacity) + '/CA ' + num(opacity) + '>>');
    }
    this.background = { id, gsId };
  }

  /** Egy lap kiirasa. A hivo ciklusa csak ezt hivja laponkent. */
  async addPage(spec: PageSpec): Promise<void> {
    const parts: string[] = [];
    const xobjects: string[] = [];

    if (this.background) {
      const { id, gsId } = this.background;
      xobjects.push('/Bg ' + id + ' 0 R');
      parts.push(
        'q' + (gsId ? ' /Gs0 gs' : '') +
          ' ' + num(this.wPt) + ' 0 0 ' + num(this.hPt) + ' 0 0 cm /Bg Do Q',
      );
    }

    let maskId: number | null = null;
    if (spec.barcode) {
      maskId = this.w.allocId();
      xobjects.push('/Bc ' + maskId + ' 0 R');
      parts.push(this.barcodeOps(spec.barcode));
    }

    for (const t of spec.texts) {
      if (t.text === '') continue;
      parts.push(this.textOps(t));
    }

    const contentId = this.w.allocId();
    const raw = latin1(parts.join('\n') + '\n');
    const packed = this.opts.compress ? await deflate(raw) : null;
    this.w.writeStream(contentId, packed ? '/Filter/FlateDecode' : '', packed ?? raw);

    if (spec.barcode && maskId !== null) {
      const m = spec.barcode.matrix;
      // 1 bites ImageMask: /Decode [1 0] miatt az 1-es bit a festett (fekete) modul.
      const packedMask = this.opts.compress ? await deflate(m.data) : null;
      this.w.writeStream(
        maskId,
        '/Type/XObject/Subtype/Image/Width ' + m.cols + '/Height ' + m.rows +
          '/ImageMask true/Decode [1 0]/BitsPerComponent 1' +
          (packedMask ? '/Filter/FlateDecode' : ''),
        packedMask ?? m.data,
      );
    }

    const fontRes = this.fonts.length
      ? '/Font <<' + this.fonts.map((f) => '/' + f.res + ' ' + f.id + ' 0 R').join('') + '>>'
      : '';
    const gs = this.background?.gsId ? '/ExtGState <</Gs0 ' + this.background.gsId + ' 0 R>>' : '';
    const xo = xobjects.length ? '/XObject <<' + xobjects.join('') + '>>' : '';

    const pageId = this.w.allocId();
    this.w.writeObject(
      pageId,
      '<</Type/Page/Parent ' + this.pagesId + ' 0 R' +
        '/MediaBox [0 0 ' + num(this.wPt) + ' ' + num(this.hPt) + ']' +
        '/Resources <<' + xo + fontRes + gs + '/ProcSet [/PDF/Text/ImageB/ImageC]>>' +
        '/Contents ' + contentId + ' 0 R>>',
    );
    this.pageIds.push(pageId);
  }

  private barcodeOps(b: BarcodeDraw): string {
    const w = mmToPt(b.widthMm);
    const h = mmToPt(b.heightMm);
    // 90/270 foknal a befoglalo doboz oldalai felcserelodnek.
    const boxH = b.rotation === 90 || b.rotation === 270 ? w : h;
    // A konfig a lap tetejetol meri az y-t, a PDF az aljatol.
    const bx = mmToPt(b.xMm);
    const by = this.hPt - mmToPt(b.yMm) - boxH;

    let cm: number[];
    switch (b.rotation) {
      case 90:  cm = [0, w, -h, 0, bx + h, by]; break;
      case 180: cm = [-w, 0, 0, -h, bx + w, by + h]; break;
      case 270: cm = [0, -w, h, 0, bx, by + w]; break;
      default:  cm = [w, 0, 0, h, bx, by]; break;
    }
    return 'q ' + rgb(b.color) + ' rg ' + cm.map(num).join(' ') + ' cm /Bc Do Q';
  }

  private textOps(t: TextDraw): string {
    const encoded = toWinAnsi(t.text);
    const width = measure(encoded, t.font.widths, t.sizePt, t.charSpacingPt);
    let x = mmToPt(t.xMm);
    if (t.align === 'center') x -= width / 2;
    else if (t.align === 'right') x -= width;
    const y = this.hPt - mmToPt(t.yMm);

    return 'BT ' + rgb(t.color) + ' rg /' + t.font.res + ' ' + num(t.sizePt) + ' Tf' +
      (t.charSpacingPt ? ' ' + num(t.charSpacingPt) + ' Tc' : '') +
      ' 1 0 0 1 ' + num(x) + ' ' + num(y) + ' Tm ' + pdfString(encoded) + ' Tj ET';
  }

  /** Lezaras -- innentol a dokumentum nem bovitheto. */
  finish(): Blob {
    this.w.writeObject(
      this.pagesId,
      '<</Type/Pages/Count ' + this.pageIds.length +
        '/Kids [' + this.pageIds.map((id) => id + ' 0 R').join(' ') + ']>>',
    );
    this.w.writeObject(this.catalogId, '<</Type/Catalog/Pages ' + this.pagesId + ' 0 R>>');
    this.w.writeObject(
      this.infoId,
      '<</Title ' + pdfString(this.opts.title) +
        '/Producer (pipszi-generator v2)' +
        '/CreationDate ' + pdfString(pdfDate(new Date())) + '>>',
    );
    return this.w.finish(this.catalogId, this.infoId);
  }

  get pageCount(): number {
    return this.pageIds.length;
  }

  get byteLength(): number {
    return this.w.byteLength;
  }
}

/** Nem abrazolhato karakterek helyett `?`, hogy a PDF sose romoljon el. */
function toWinAnsi(s: string): string {
  let out = '';
  for (const ch of s) {
    const byte = unicodeToWinAnsi(ch.codePointAt(0)!);
    out += byte >= 0 ? String.fromCharCode(byte) : '?';
  }
  return out;
}

/** Szoveg szelessege pontban -- a kozepre/jobbra igazitashoz. */
export function measure(winAnsiText: string, widths: number[], sizePt: number, tracking: number): number {
  let total = 0;
  for (let i = 0; i < winAnsiText.length; i++) total += widths[winAnsiText.charCodeAt(i)] ?? 0;
  return (total / 1000) * sizePt + Math.max(0, winAnsiText.length - 1) * tracking;
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const tz = -d.getTimezoneOffset();
  const sign = tz >= 0 ? '+' : '-';
  return (
    'D:' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) +
    sign + p(Math.floor(Math.abs(tz) / 60)) + "'" + p(Math.abs(tz) % 60) + "'"
  );
}
