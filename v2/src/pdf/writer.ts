/**
 * Minimalis, streamelo PDF iro.
 *
 * Miert sajat es nem jsPDF/pdf-lib: a vonalkod igy 1 bites `/ImageMask`
 * XObject-kent kerul a lapra (lapenkent ~800 byte), nem pedig raszteres PNG-kent
 * vagy tobb ezer vektor teglalapkent. Ez egyszerre gyors, kicsi, es nyomtatasban
 * eles marad -- a PDF olvaso a maszkot interpolacio nelkul skalazza.
 *
 * Az objektumok irasuk sorrendjeben kerulnek a fajlba, a kereszthivatkozasi
 * tabla a vegen epul fel, igy semmit nem kell memoriaban tartani.
 */

/**
 * Latin-1 byte-ok. A PDF szintaxisa ASCII, a string literalok pedig
 * WinAnsi/PDFDocEncoding-ban vannak -- mindkettore ez a helyes kodolas.
 * (UTF-8 nem: az ekezetes cimet vagy a binaris jelolo-sort elrontana.)
 */
export function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** `(...)` literal PDF string, escape-elve. */
export function pdfString(s: string): string {
  return '(' + s.replace(/[\\()\r\n]/g, (c) =>
    c === '\r' ? '\\r' : c === '\n' ? '\\n' : '\\' + c) + ')';
}

/** Szam PDF-be: fix 4 tizedes, felesleges nullak nelkul. */
export function num(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const s = v.toFixed(4);
  return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
}

export class PdfWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;
  /** offsets[objectNumber] = byte-eltolas a fajl elejetol. */
  private offsets: number[] = [0];
  private nextId = 1;

  constructor(version = '1.7') {
    // A binaris jelolo-sor jelzi a feldolgozoknak, hogy a fajl nem csak ASCII.
    this.push(latin1('%PDF-' + version + '\n%\xE2\xE3\xCF\xD3\n'));
  }

  private push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  /** Lefoglal egy objektumszamot ugy, hogy a tartalma kesobb irodik ki. */
  allocId(): number {
    return this.nextId++;
  }

  /** Egyszeru (stream nelkuli) objektum. */
  writeObject(id: number, body: string): void {
    this.offsets[id] = this.length;
    this.push(latin1(id + ' 0 obj\n' + body + '\nendobj\n'));
  }

  /**
   * Stream objektum. A `dict` a `<<...>>` belseje, `/Length` nelkul -- azt
   * innen tesszuk hozza.
   */
  writeStream(id: number, dict: string, data: Uint8Array): void {
    this.offsets[id] = this.length;
    this.push(latin1(id + ' 0 obj\n<<' + dict + '/Length ' + data.length + '>>\nstream\n'));
    this.push(data);
    this.push(latin1('\nendstream\nendobj\n'));
  }

  /** Lezaras: xref tabla + trailer. A visszaadott Blob mar menthato. */
  finish(rootId: number, infoId: number | null): Blob {
    const size = this.nextId;
    const startxref = this.length;
    let xref = 'xref\n0 ' + size + '\n0000000000 65535 f \n';
    for (let i = 1; i < size; i++) {
      const off = this.offsets[i] ?? 0;
      xref += String(off).padStart(10, '0') + ' 00000 n \n';
    }
    const id = randomHexId();
    xref +=
      'trailer\n<</Size ' + size + '/Root ' + rootId + ' 0 R' +
      (infoId ? '/Info ' + infoId + ' 0 R' : '') +
      '/ID [<' + id + '> <' + id + '>]>>\n' +
      'startxref\n' + startxref + '\n%%EOF\n';
    this.push(latin1(xref));

    const blob = new Blob(this.chunks as BlobPart[], { type: 'application/pdf' });
    this.chunks = [];
    return blob;
  }

  get byteLength(): number {
    return this.length;
  }
}

function randomHexId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** `#rrggbb` -> PDF `r g b` (0..1). */
export function rgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '0 0 0';
  const v = parseInt(m[1], 16);
  return num(((v >> 16) & 255) / 255) + ' ' + num(((v >> 8) & 255) / 255) + ' ' + num((v & 255) / 255);
}

/**
 * Zlib (`/FlateDecode`) tomorites a beepitett CompressionStream API-val.
 * Ha a kornyezet nem tamogatja, `null`-t ad vissza -- a hivo ilyenkor
 * tomorites nelkul irja ki az adatot.
 */
export async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  // Friss nezet ugyanazon a bufferen -- nem masol, viszont a szuk `BufferSource`
  // tipusnak is megfelel.
  void writer.write(new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength));
  void writer.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buf);
}
