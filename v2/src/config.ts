/**
 * A legacy Angular verzio minden merete egy ~300 DPI-s, 1279 x 925 px-es
 * tervrajz pixel-koordinataja volt, es a `rating = 108.3 / 1279` szammal
 * valtotta mm-re. Az alapertelmezeseket pontosan ezzel a skalaval szamoljuk,
 * igy a v2 geometriaja bitre ugyanaz, mint a regie.
 *
 * (Ez effektive 299.97 DPI. A felulet px <-> mm valtoja ettol fuggetlenul a
 * kerek 300-at hasznalja alapbol -- az elteres 468 px-en 4 mikrometer.)
 */
const LEGACY_RATING = 108.3 / 1279;
export const LEGACY_DPI = 300;
const px = (v: number) => v * LEGACY_RATING;

export type Unit = 'mm' | 'px';
export type Align = 'left' | 'center' | 'right';
export type Rotation = 0 | 90 | 180 | 270;
export type SizeMode = 'module' | 'box';

export interface FontDef {
  key: string;
  label: string;
  /** TTF utvonal a /public alatt. Feltoltott fontnal ures. */
  url: string;
}

/**
 * Minden font TrueType (glyf) es a projektbol jon -- nincs PDF base-14 fallback.
 * Igy a kimenet minden nyomdaban ugyanugy nez ki, es a szelessegeket mindig a
 * tenyleges fontbol olvassuk (kozepre/jobbra igazitas is pontos).
 */
export const BUILTIN_FONTS: FontDef[] = [
  { key: 'vinci-light', label: 'Vinci Sans Light  (legacy)', url: 'fonts/Vinci_Sans_Light.ttf' },
  { key: 'vinci-regular', label: 'Vinci Sans Regular', url: 'fonts/Vinci_Sans_Regular.ttf' },
  { key: 'vinci-medium', label: 'Vinci Sans Medium', url: 'fonts/Vinci_Sans_Medium.ttf' },
  { key: 'vinci-bold', label: 'Vinci Sans Bold', url: 'fonts/Vinci_Sans_Bold.ttf' },
  { key: 'vinci-italic', label: 'Vinci Sans Italic', url: 'fonts/Vinci_Sans_Italic.ttf' },
  { key: 'sansation-light', label: 'Sansation Light', url: 'fonts/Sansation_Light.ttf' },
  { key: 'sansation-regular', label: 'Sansation Regular', url: 'fonts/Sansation_Regular.ttf' },
  { key: 'sansation-bold', label: 'Sansation Bold', url: 'fonts/Sansation_Bold.ttf' },
];

/** Futasidoben feltoltott .ttf fajlok (kulcs: `custom:<nev>`). */
export const customFonts = new Map<string, { def: FontDef; buffer: ArrayBuffer }>();

export function allFonts(): FontDef[] {
  return [...BUILTIN_FONTS, ...[...customFonts.values()].map((c) => c.def)];
}

export const fontByKey = (key: string) =>
  allFonts().find((f) => f.key === key) ?? BUILTIN_FONTS[0];

export interface PageConfig {
  widthMm: number;
  heightMm: number;
  /** Csak a px <-> mm atszamitashoz kell a felulet. A PDF mindig mm/pt. */
  dpi: number;
}

export interface PayloadConfig {
  prefix: string;
  validFrom: string;
  validTo: string;
  serialFrom: number;
  serialTo: number;
  /** Sorszam nullaval feltoltve ennyi jegyre (legacy: 5). 0 = nincs feltoltes. */
  serialPad: number;
  crcEnabled: boolean;
  /** CRC nullaval feltoltve ennyi jegyre. Legacy: 0 (nyers decimalis). */
  crcPad: number;
  /** Placeholderek: {prefix} {from} {to} {serial} {serialRaw} {crc} {dayOfYear} */
  template: string;
}

export interface BarcodeConfig {
  visible: boolean;
  /** -1 = automatikus. 0..8 = fix hibajavitasi szint. */
  eccLevel: number;
  aspectRatio: number;
  /** Egy PDF417 sor magassaga modulban (TCPDF ROWHEIGHT, alap 4). */
  rowHeight: number;
  quietH: number;
  quietV: number;
  sizeMode: SizeMode;
  xMm: number;
  yMm: number;
  /** sizeMode = 'module': egy modul (legkisebb fekete negyzet) merete. */
  moduleWidthMm: number;
  moduleHeightMm: number;
  /** sizeMode = 'box': a teljes szimbolum ebbe a dobozba feszul. */
  widthMm: number;
  heightMm: number;
  rotation: Rotation;
  color: string;
}

export interface TextItem {
  id: string;
  label: string;
  enabled: boolean;
  /** Ugyanazok a placeholderek mint a payload template-ben. */
  template: string;
  fontKey: string;
  sizePt: number;
  xMm: number;
  /** Az alapvonal (baseline) helye a lap tetejetol -- ahogy a jsPDF is szamolta. */
  yMm: number;
  align: Align;
  color: string;
  charSpacingPt: number;
}

export interface BackgroundConfig {
  enabled: boolean;
  /** A kep neve, csak kijelzeshez. */
  name: string;
  /** data: URL. Egyetlen PDF objektumkent kerul be, minden lap ugyanazt hasznalja. */
  dataUrl: string;
  opacity: number;
}

export interface OutputConfig {
  fileName: string;
  /** 0 = egyetlen PDF. >0 = ennyi laponkent kulon fajl. */
  pagesPerFile: number;
  /** Tomorites: a PDF tartalom-streamekre. Kikapcsolva gyorsabb, bekapcsolva kisebb. */
  compress: boolean;
  title: string;
}

export interface AppConfig {
  page: PageConfig;
  payload: PayloadConfig;
  barcode: BarcodeConfig;
  texts: TextItem[];
  background: BackgroundConfig;
  output: OutputConfig;
  unit: Unit;
}

/** A legacy app pontos beallitasai, mm-re atszamolva. */
export function defaultConfig(): AppConfig {
  return {
    unit: 'mm',
    page: { widthMm: 108.3, heightMm: 78.3, dpi: LEGACY_DPI },
    payload: {
      prefix: 'BUDPSH',
      validFrom: '202602010100',
      validTo: '202802010100',
      serialFrom: 2001,
      serialTo: 4000,
      serialPad: 5,
      crcEnabled: true,
      crcPad: 0,
      template: '{prefix}{from}{to}{serial}{crc}',
    },
    barcode: {
      visible: true,
      eccLevel: -1,
      aspectRatio: 2,
      rowHeight: 4,
      quietH: 2,
      quietV: 2,
      sizeMode: 'module',
      xMm: px(468),
      yMm: px(537),
      moduleWidthMm: px(6),
      moduleHeightMm: px(3),
      widthMm: px(642),
      heightMm: px(180),
      rotation: 0,
      color: '#000000',
    },
    texts: [
      {
        id: 'serial',
        label: 'Sorszam',
        enabled: true,
        template: '{serial}',
        fontKey: 'vinci-light',
        sizePt: 10.5,
        xMm: px(181),
        yMm: px(651),
        align: 'left',
        color: '#000000',
        charSpacingPt: 0,
      },
    ],
    background: { enabled: false, name: '', dataUrl: '', opacity: 1 },
    output: {
      fileName: 'pipszi_{from}-{to}',
      pagesPerFile: 0,
      compress: true,
      title: 'PIPSZI',
    },
  };
}
