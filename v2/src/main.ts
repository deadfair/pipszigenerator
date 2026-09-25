import './style.css';
import { allFonts, defaultConfig, type AppConfig, type TextItem, type Unit } from './config';
import { buildField, buildSection, type FieldSpec, type FormContext } from './form';
import { buildBarcode, barcodeSizeMm, type BarcodeMatrix } from './core/barcode';
import { dayOfYear, fieldsFor, pageCount, render, validate } from './core/payload';
import { mmToPx, round } from './core/units';
import { addCustomFont, bufferMap, loadFont } from './fonts';
import { drawPreview, hitTest, type Box } from './preview';
import type { WorkerRequest, WorkerResponse } from './worker/protocol';

const STORAGE_KEY = 'pipszi.v2.config';

// ---------------------------------------------------------------- allapot ---

let cfg: AppConfig = loadConfig();
let matrix: BarcodeMatrix | null = null;
let matrixError = '';
let boxes: Box[] = [];
let selected: Box | null = null;
let backgroundImage: HTMLImageElement | null = null;
const fontWidths = new Map<string, number[]>();
let previewSerial = cfg.payload.serialFrom;

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
const settings = $<HTMLElement>('#settings');
const canvas = $<HTMLCanvasElement>('#preview');
const factsEl = $<HTMLDListElement>('#facts');
const logEl = $<HTMLUListElement>('#log');
const progressEl = $<HTMLDivElement>('#progress');
const generateBtn = $<HTMLButtonElement>('#btn-generate');
const cancelBtn = $<HTMLButtonElement>('#btn-cancel');
const serialInput = $<HTMLInputElement>('#preview-serial');

const ctx: FormContext = { cfg, unit: cfg.unit, onChange: onConfigChange };
const syncers: (() => void)[] = [];

// ------------------------------------------------------------ konfiguracio ---

function loadConfig(): AppConfig {
  const base = defaultConfig();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return mergeConfig(base, JSON.parse(raw));
  } catch {
    // Sérült mentés esetén csendben az alapértelmezéssel indulunk.
  }
  return base;
}

/** Mely mentesbol is csak az ismert kulcsokat vesszuk at -- igy a regi mentes nem tor el. */
function mergeConfig(base: AppConfig, saved: unknown): AppConfig {
  if (!saved || typeof saved !== 'object') return base;
  const s = saved as Partial<AppConfig>;
  const out: AppConfig = {
    ...base,
    page: { ...base.page, ...s.page },
    payload: { ...base.payload, ...s.payload },
    barcode: { ...base.barcode, ...s.barcode },
    background: { ...base.background, ...s.background, dataUrl: '' },
    output: { ...base.output, ...s.output },
    unit: s.unit === 'px' ? 'px' : 'mm',
    texts: Array.isArray(s.texts) && s.texts.length
      ? s.texts.map((t, i) => ({ ...base.texts[0], ...t, id: t?.id ?? 'text' + i }))
      : base.texts,
  };
  return out;
}

function saveConfig(): void {
  try {
    // A hatterkep data URL-je nem megy a localStorage-ba (nagy es amugy is egyszeri).
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...cfg, background: { ...cfg.background, dataUrl: '' } }));
  } catch {
    // Tele van a tarhely -- a munka ettol meg mukodik.
  }
}

// ------------------------------------------------------------------ urlap ---

const fontOptions = () => allFonts().map((f) => ({ value: f.key, label: f.label }));

const eccOptions = [
  { value: '-1', label: 'automatikus (ajánlott)' },
  ...Array.from({ length: 9 }, (_, i) => ({ value: String(i), label: `${i}. szint  (${2 << i} javító kódszó)` })),
];

function payloadSpecs(): FieldSpec[] {
  return [
    { path: 'payload.prefix', label: 'Név / előtag', kind: 'text', hint: 'a kód elején álló betűk' },
    { path: 'payload.validFrom', label: 'Érvényesség kezdete', kind: 'text', hint: 'ÉÉÉÉHHNNÓÓPP, pl. 202602010100' },
    { path: 'payload.validTo', label: 'Érvényesség vége', kind: 'text', hint: 'ÉÉÉÉHHNNÓÓPP' },
    { path: 'payload.serialFrom', label: 'Kezdő sorszám', kind: 'number', step: 1 },
    { path: 'payload.serialTo', label: 'Vég sorszám', kind: 'number', step: 1, hint: 'beleértve' },
    { path: 'payload.serialPad', label: 'Sorszám jegyei', kind: 'number', step: 1, min: 0, max: 20, hint: '0 = nincs nullás feltöltés' },
    { path: 'payload.crcEnabled', label: 'CRC-32 a kód végén', kind: 'checkbox' },
    {
      path: 'payload.crcPad',
      label: 'CRC jegyei',
      kind: 'number',
      step: 1,
      min: 0,
      max: 10,
      hint: '0 = nyers decimális (mint eddig)',
      visible: (c) => c.payload.crcEnabled,
    },
    {
      path: 'payload.template',
      label: 'Kód sablon',
      kind: 'text',
      wide: true,
      hint: '{prefix} {from} {to} {serial} {serialRaw} {crc} {dayOfYear} {page}',
    },
  ];
}

function pageSpecs(): FieldSpec[] {
  return [
    { path: 'page.widthMm', label: 'Lap szélesség', kind: 'length' },
    { path: 'page.heightMm', label: 'Lap magasság', kind: 'length' },
    { path: 'page.dpi', label: 'Referencia DPI', kind: 'number', step: 1, min: 1, hint: 'csak a px ↔ mm váltáshoz' },
  ];
}

function barcodeSpecs(): FieldSpec[] {
  return [
    { path: 'barcode.visible', label: 'Vonalkód a lapon', kind: 'checkbox' },
    { path: 'barcode.xMm', label: 'X (bal széltől)', kind: 'length' },
    { path: 'barcode.yMm', label: 'Y (felső széltől)', kind: 'length' },
    {
      path: 'barcode.sizeMode',
      label: 'Méretezés',
      kind: 'select',
      options: [
        { value: 'module', label: 'modulméret szerint (mint a régi)' },
        { value: 'box', label: 'fix dobozba feszítve' },
      ],
    },
    { path: 'barcode.moduleWidthMm', label: 'Modul szélesség (X-dim)', kind: 'length', visible: (c) => c.barcode.sizeMode === 'module' },
    { path: 'barcode.moduleHeightMm', label: 'Modul magasság', kind: 'length', visible: (c) => c.barcode.sizeMode === 'module' },
    { path: 'barcode.widthMm', label: 'Doboz szélesség', kind: 'length', visible: (c) => c.barcode.sizeMode === 'box' },
    { path: 'barcode.heightMm', label: 'Doboz magasság', kind: 'length', visible: (c) => c.barcode.sizeMode === 'box' },
    {
      path: 'barcode.rotation',
      label: 'Forgatás',
      kind: 'select',
      numeric: true,
      options: [0, 90, 180, 270].map((d) => ({ value: String(d), label: d + '°' })),
    },
    { path: 'barcode.color', label: 'Szín', kind: 'color' },
    { path: 'barcode.eccLevel', label: 'Hibajavítás', kind: 'select', numeric: true, options: eccOptions },
    { path: 'barcode.aspectRatio', label: 'Oldalarány', kind: 'number', step: 0.1, min: 0.1, hint: 'a kódoló ebből számol oszlopszámot' },
    { path: 'barcode.rowHeight', label: 'Sormagasság (modul)', kind: 'number', step: 1, min: 1, max: 20 },
    { path: 'barcode.quietH', label: 'Csendes zóna – oldalt', kind: 'number', step: 1, min: 0, max: 20 },
    { path: 'barcode.quietV', label: 'Csendes zóna – fent/lent', kind: 'number', step: 1, min: 0, max: 20 },
  ];
}

function backgroundSpecs(): FieldSpec[] {
  return [
    { path: 'background.enabled', label: 'Háttérkép a lapokon', kind: 'checkbox' },
    { path: 'background.opacity', label: 'Átlátszatlanság', kind: 'number', step: 0.05, min: 0, max: 1, visible: (c) => c.background.enabled },
  ];
}

function outputSpecs(): FieldSpec[] {
  return [
    { path: 'output.fileName', label: 'Fájlnév', kind: 'text', hint: '{from} {to} {part} {prefix} {validFrom}' },
    { path: 'output.title', label: 'PDF címe', kind: 'text' },
    { path: 'output.pagesPerFile', label: 'Lap / fájl', kind: 'number', step: 100, min: 0, hint: '0 = minden egy fájlban' },
    { path: 'output.compress', label: 'Tömörítés (kisebb fájl, kicsit lassabb)', kind: 'checkbox' },
  ];
}

function buildForm(): void {
  settings.replaceChildren();
  syncers.length = 0;

  const add = (title: string, note: string, specs: FieldSpec[]) => {
    const section = buildSection(title, note, specs, ctx);
    settings.append(section.el);
    syncers.push(section.sync);
    return section.el;
  };

  add('Kód tartalma', 'ez kerül a vonalkódba', payloadSpecs());
  add('Lap', '', pageSpecs());
  add('Vonalkód', 'PDF417', barcodeSpecs());
  settings.append(buildTextsSection());
  const bg = add('Háttérkép', 'előnézethez és/vagy a PDF-be', backgroundSpecs());
  bg.querySelector('.grid')!.append(buildBackgroundPicker());
  add('Kimenet', '', outputSpecs());
}

/** A szovegmezok szama valtozhat, ezert ez a szekcio kezzel epul. */
function buildTextsSection(): HTMLElement {
  const fs = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Szövegmezők';
  const note = document.createElement('span');
  note.className = 'legend-note';
  note.textContent = 'valódi, kereshető szöveg a PDF-ben – nem kép';
  legend.append(note);
  fs.append(legend);

  cfg.texts.forEach((item, index) => fs.append(buildTextItem(item, index)));

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'link';
  addBtn.textContent = '+ új szövegmező';
  addBtn.addEventListener('click', () => {
    const base = cfg.texts[0] ?? defaultConfig().texts[0];
    cfg.texts.push({ ...base, id: 'text' + Date.now(), label: 'Új mező', template: '{serialRaw}' });
    buildForm();
    onConfigChange();
  });
  fs.append(addBtn);
  return fs;
}

function buildTextItem(item: TextItem, index: number): HTMLElement {
  const box = document.createElement('div');
  box.className = 'text-item';

  const head = document.createElement('header');
  const enable = document.createElement('input');
  enable.type = 'checkbox';
  enable.checked = item.enabled;
  enable.addEventListener('change', () => {
    item.enabled = enable.checked;
    onConfigChange();
  });
  const name = document.createElement('input');
  name.type = 'text';
  name.value = item.label;
  name.addEventListener('input', () => {
    item.label = name.value;
    saveConfig();
  });
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'ghost';
  del.textContent = 'Törlés';
  del.disabled = cfg.texts.length < 2;
  del.addEventListener('click', () => {
    cfg.texts.splice(index, 1);
    selected = null;
    buildForm();
    onConfigChange();
  });
  head.append(enable, name, del);

  const grid = document.createElement('div');
  grid.className = 'grid';
  const specs: FieldSpec[] = [
    { path: `texts.${index}.template`, label: 'Tartalom', kind: 'text', wide: true, hint: '{serial} {serialRaw} {crc} {prefix} {from} {to} {page}' },
    { path: `texts.${index}.fontKey`, label: 'Betűtípus', kind: 'select', options: fontOptions() },
    { path: `texts.${index}.sizePt`, label: 'Méret (pt)', kind: 'number', step: 0.1, min: 0.5 },
    { path: `texts.${index}.xMm`, label: 'X', kind: 'length' },
    { path: `texts.${index}.yMm`, label: 'Y (alapvonal)', kind: 'length' },
    {
      path: `texts.${index}.align`,
      label: 'Igazítás',
      kind: 'select',
      options: [
        { value: 'left', label: 'balra (X = bal szél)' },
        { value: 'center', label: 'középre (X = közép)' },
        { value: 'right', label: 'jobbra (X = jobb szél)' },
      ],
    },
    { path: `texts.${index}.charSpacingPt`, label: 'Betűköz (pt)', kind: 'number', step: 0.05 },
    { path: `texts.${index}.color`, label: 'Szín', kind: 'color' },
  ];
  for (const spec of specs) {
    const field = buildField(spec, ctx);
    grid.append(field.el);
    syncers.push(field.sync);
  }

  box.append(head, grid);
  return box;
}

function buildBackgroundPicker(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.textContent = 'Kép fájl';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    cfg.background.dataUrl = await readAsDataUrl(file);
    cfg.background.name = file.name;
    cfg.background.enabled = true;
    backgroundImage = await loadImage(cfg.background.dataUrl);
    buildForm();
    onConfigChange();
  });
  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = cfg.background.name || 'nincs kiválasztva';
  wrap.append(label, input, hint);
  return wrap;
}

// -------------------------------------------------------------- elonezet ----

function recompute(): void {
  matrixError = '';
  matrix = null;
  if (!cfg.barcode.visible) return;
  try {
    matrix = buildBarcode(currentPayload(), cfg.barcode);
  } catch (err) {
    matrixError = err instanceof Error ? err.message : String(err);
  }
}

function currentFields() {
  const day = dayOfYear(cfg.payload.validFrom);
  const page = previewSerial - cfg.payload.serialFrom + 1;
  return fieldsFor(cfg.payload, previewSerial, day, page);
}

function currentPayload(): string {
  return render(cfg.payload.template, currentFields());
}

function redraw(): void {
  const fields = currentFields();
  boxes = drawPreview(canvas, {
    cfg,
    matrix,
    texts: cfg.texts.map((t) => render(t.template, fields)),
    widths: fontWidths,
    background: cfg.background.enabled ? backgroundImage : null,
    selected,
  });
  renderFacts(fields);
}

function renderFacts(fields: ReturnType<typeof currentFields>): void {
  const issues = validate(cfg.payload);
  const total = pageCount(cfg.payload);
  const payload = currentPayload();
  const rows: [string, string, string?][] = [];

  rows.push(['Kód', payload, issues.length ? 'bad' : '']);
  rows.push(['Kód hossza', `${payload.length} karakter`]);
  rows.push(['Lapok', `${total.toLocaleString('hu-HU')} db`, total === 0 ? 'bad' : '']);

  if (matrixError) {
    rows.push(['Vonalkód', matrixError, 'bad']);
  } else if (matrix) {
    const { w, h } = barcodeSizeMm(matrix, cfg.barcode);
    const rot = cfg.barcode.rotation === 90 || cfg.barcode.rotation === 270;
    const bw = rot ? h : w;
    const bh = rot ? w : h;
    rows.push(['Szimbólum', `${matrix.cols} × ${matrix.rows} modul`]);
    rows.push([
      'Mérete',
      `${round(w, 2)} × ${round(h, 2)} mm   (${Math.round(mmToPx(w, cfg.page.dpi))} × ${Math.round(mmToPx(h, cfg.page.dpi))} px @${cfg.page.dpi})`,
    ]);
    const overflowX = cfg.barcode.xMm + bw > cfg.page.widthMm + 0.01;
    const overflowY = cfg.barcode.yMm + bh > cfg.page.heightMm + 0.01;
    if (overflowX || overflowY) {
      rows.push(['Figyelem', 'a vonalkód kilóg a lapról', 'bad']);
    }
    // A PDF417 ajanlott sormagassaga a modulszelesseg legalabb 3-szorosa.
    const rowMm = h / matrix.rows;
    const xDim = w / matrix.cols;
    if (rowMm * cfg.barcode.rowHeight < xDim * 2.9) {
      rows.push([
        'Megjegyzés',
        `sormagasság / X-dim = ${round((rowMm * cfg.barcode.rowHeight) / xDim, 2)} (a szabvány ≥ 3-at ajánl)`,
        'warn',
      ]);
    }
  }

  for (const [i, item] of cfg.texts.entries()) {
    if (!item.enabled) continue;
    const text = render(item.template, fields);
    if (item.yMm > cfg.page.heightMm || item.xMm > cfg.page.widthMm) {
      rows.push([item.label || `Szöveg ${i + 1}`, 'a lapon kívülre esik', 'bad']);
    } else if (!text) {
      rows.push([item.label || `Szöveg ${i + 1}`, 'üres – nem kerül a PDF-be', 'warn']);
    }
  }

  for (const issue of issues) rows.push(['Hiba', issue.message, 'bad']);

  const estBytes = total * (cfg.output.compress ? 760 : 1400);
  rows.push(['Becsült méret', formatBytes(estBytes) + (cfg.background.enabled ? ' + háttérkép' : '')]);

  factsEl.replaceChildren();
  for (const [key, value, cls] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (cls) dd.className = cls;
    factsEl.append(dt, dd);
  }

  generateBtn.disabled = issues.length > 0 || total === 0 || Boolean(matrixError);
}

// ------------------------------------------------------------- huzas -------

let drag: { box: Box; offsetX: number; offsetY: number } | null = null;

function pointerToMm(ev: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((ev.clientX - rect.left) / rect.width) * cfg.page.widthMm,
    y: ((ev.clientY - rect.top) / rect.height) * cfg.page.heightMm,
  };
}

canvas.addEventListener('pointerdown', (ev) => {
  const { x, y } = pointerToMm(ev);
  const hit = hitTest(boxes, x, y);
  selected = hit;
  if (hit) {
    canvas.setPointerCapture(ev.pointerId);
    canvas.classList.add('dragging');
    const anchorX = hit.kind === 'barcode' ? cfg.barcode.xMm : cfg.texts[hit.index].xMm;
    const anchorY = hit.kind === 'barcode' ? cfg.barcode.yMm : cfg.texts[hit.index].yMm;
    drag = { box: hit, offsetX: x - anchorX, offsetY: y - anchorY };
  }
  redraw();
});

canvas.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const { x, y } = pointerToMm(ev);
  const nx = round(Math.max(0, x - drag.offsetX), 3);
  const ny = round(Math.max(0, y - drag.offsetY), 3);
  if (drag.box.kind === 'barcode') {
    cfg.barcode.xMm = nx;
    cfg.barcode.yMm = ny;
  } else {
    cfg.texts[drag.box.index].xMm = nx;
    cfg.texts[drag.box.index].yMm = ny;
  }
  syncers.forEach((s) => s());
  redraw();
});

const endDrag = (ev: PointerEvent) => {
  if (!drag) return;
  drag = null;
  canvas.classList.remove('dragging');
  canvas.releasePointerCapture(ev.pointerId);
  saveConfig();
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// Nyilbillentyukkel finomhangolas: 0.1 mm, Shift-tel 1 mm.
window.addEventListener('keydown', (ev) => {
  if (!selected || !ev.key.startsWith('Arrow')) return;
  if (document.activeElement && document.activeElement !== document.body) return;
  ev.preventDefault();
  const step = ev.shiftKey ? 1 : 0.1;
  const dx = (ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0) * step;
  const dy = (ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0) * step;
  if (selected.kind === 'barcode') {
    cfg.barcode.xMm = round(cfg.barcode.xMm + dx, 3);
    cfg.barcode.yMm = round(cfg.barcode.yMm + dy, 3);
  } else {
    const t = cfg.texts[selected.index];
    t.xMm = round(t.xMm + dx, 3);
    t.yMm = round(t.yMm + dy, 3);
  }
  syncers.forEach((s) => s());
  redraw();
  saveConfig();
});

// ------------------------------------------------------------ generalas ----

const worker = new Worker(new URL('./worker/generator.worker.ts', import.meta.url), { type: 'module' });
let running = false;
let filesWritten = 0;

worker.addEventListener('message', (ev: MessageEvent<WorkerResponse>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'progress': {
      const ratio = msg.total ? msg.done / msg.total : 0;
      progressEl.querySelector<HTMLElement>('.bar i')!.style.width = ratio * 100 + '%';
      const perPage = msg.done ? msg.elapsedMs / msg.done : 0;
      const left = Math.max(0, (msg.total - msg.done) * perPage);
      progressEl.querySelector('.progress-label')!.textContent =
        `${msg.done.toLocaleString('hu-HU')} / ${msg.total.toLocaleString('hu-HU')}` +
        (left > 400 ? `  ·  ~${(left / 1000).toFixed(1)} mp` : '');
      break;
    }
    case 'file':
      filesWritten++;
      download(msg.blob, msg.name);
      log(`${msg.name} – ${msg.pages.toLocaleString('hu-HU')} lap, ${formatBytes(msg.blob.size)}`, 'ok');
      break;
    case 'done':
      finish();
      log(
        `Kész: ${msg.pages.toLocaleString('hu-HU')} lap ${msg.files} fájlban, ` +
          `${formatBytes(msg.bytes)}, ${(msg.elapsedMs / 1000).toFixed(2)} mp ` +
          `(${(msg.elapsedMs / msg.pages).toFixed(2)} ms/lap)`,
        'ok',
      );
      break;
    case 'cancelled':
      finish();
      log(`Megszakítva${filesWritten ? ` (${filesWritten} fájl már letöltődött)` : ''}.`);
      break;
    case 'error':
      finish();
      log('Hiba: ' + msg.message, 'err');
      break;
  }
});

generateBtn.addEventListener('click', async () => {
  if (running) return;
  running = true;
  filesWritten = 0;
  generateBtn.disabled = true;
  cancelBtn.hidden = false;
  progressEl.hidden = false;
  logEl.replaceChildren();
  log(`Indul: ${pageCount(cfg.payload).toLocaleString('hu-HU')} lap…`);

  try {
    const request: WorkerRequest = {
      type: 'generate',
      config: JSON.parse(JSON.stringify(cfg)),
      fonts: await bufferMap(cfg.texts.filter((t) => t.enabled).map((t) => t.fontKey)),
      background: cfg.background.enabled && backgroundImage ? await backgroundRgb() : null,
    };
    worker.postMessage(request);
  } catch (err) {
    finish();
    log('Hiba: ' + (err instanceof Error ? err.message : String(err)), 'err');
  }
});

cancelBtn.addEventListener('click', () => worker.postMessage({ type: 'cancel' } satisfies WorkerRequest));

function finish(): void {
  running = false;
  cancelBtn.hidden = true;
  generateBtn.disabled = false;
}

/** A hatterkep a lap fizikai meretere raszterizalva, alfa nelkul. */
async function backgroundRgb() {
  const width = Math.round(mmToPx(cfg.page.widthMm, cfg.page.dpi));
  const height = Math.round(mmToPx(cfg.page.heightMm, cfg.page.dpi));
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, width, height);
  g.drawImage(backgroundImage!, 0, 0, width, height);
  const src = g.getImageData(0, 0, width, height).data;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < src.length; i += 4, j += 3) {
    rgb[j] = src[i];
    rgb[j + 1] = src[i + 1];
    rgb[j + 2] = src[i + 2];
  }
  return { rgb: rgb.buffer, width, height, opacity: cfg.background.opacity };
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function log(text: string, cls = ''): void {
  const li = document.createElement('li');
  li.textContent = text;
  if (cls) li.className = cls;
  logEl.prepend(li);
}

// ------------------------------------------------------------- vezerles ----

function onConfigChange(): void {
  previewSerial = clampSerial(previewSerial);
  serialInput.value = String(previewSerial);
  syncers.forEach((s) => s());
  recompute();
  redraw();
  saveConfig();
  void ensureFonts();
}

function clampSerial(value: number): number {
  const lo = Math.min(cfg.payload.serialFrom, cfg.payload.serialTo);
  const hi = Math.max(cfg.payload.serialFrom, cfg.payload.serialTo);
  return Math.min(hi, Math.max(lo, Number.isFinite(value) ? Math.round(value) : lo));
}

/** Betolti a hasznalt fontokat, majd ujrarajzol (a szelessegek megvaltoznak). */
async function ensureFonts(): Promise<void> {
  let changed = false;
  for (const item of cfg.texts) {
    if (fontWidths.has(item.fontKey)) continue;
    try {
      const { widths } = await loadFont(item.fontKey);
      fontWidths.set(item.fontKey, widths);
      changed = true;
    } catch (err) {
      log(`Font hiba (${item.fontKey}): ${err instanceof Error ? err.message : err}`, 'err');
    }
  }
  if (changed) redraw();
}

serialInput.addEventListener('input', () => {
  previewSerial = clampSerial(Number(serialInput.value));
  recompute();
  redraw();
});

for (const btn of document.querySelectorAll<HTMLButtonElement>('#unit-toggle button')) {
  btn.addEventListener('click', () => {
    cfg.unit = btn.dataset.unit as Unit;
    ctx.unit = cfg.unit;
    for (const b of document.querySelectorAll('#unit-toggle button')) b.classList.toggle('active', b === btn);
    syncers.forEach((s) => s());
    saveConfig();
  });
}

$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Visszaáll minden beállítás az eredeti (legacy) értékekre. Folytatod?')) return;
  cfg = defaultConfig();
  ctx.cfg = cfg;
  ctx.unit = cfg.unit;
  backgroundImage = null;
  previewSerial = cfg.payload.serialFrom;
  buildForm();
  onConfigChange();
});

$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ ...cfg, background: { ...cfg.background, dataUrl: '' } }, null, 2)], {
    type: 'application/json',
  });
  download(blob, 'pipszi-beallitasok.json');
});

$('#btn-import').addEventListener('click', () => $<HTMLInputElement>('#import-file').click());
$<HTMLInputElement>('#import-file').addEventListener('change', async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    cfg = mergeConfig(defaultConfig(), JSON.parse(await file.text()));
    ctx.cfg = cfg;
    ctx.unit = cfg.unit;
    previewSerial = cfg.payload.serialFrom;
    buildForm();
    onConfigChange();
    log('Beállítások betöltve: ' + file.name, 'ok');
  } catch (err) {
    log('Nem sikerült betölteni: ' + (err instanceof Error ? err.message : err), 'err');
  }
});

// ------------------------------------------------------------ segedletek ---

function formatBytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' kB';
  return (n / 1048576).toFixed(2) + ' MB';
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('A kép nem tölthető be.'));
    img.src = src;
  });
}

// ---------------------------------------------------------------- indulas ---

for (const b of document.querySelectorAll<HTMLButtonElement>('#unit-toggle button')) {
  b.classList.toggle('active', b.dataset.unit === cfg.unit);
}
buildForm();
onConfigChange();
window.addEventListener('resize', redraw);

// A feltoltott betutipus a szovegmezo-legordulokben jelenik meg.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = [...(e.dataTransfer?.files ?? [])].find((f) => /\.ttf$/i.test(f.name));
  if (!file) return;
  try {
    const key = await addCustomFont(file);
    fontWidths.delete(key);
    buildForm();
    onConfigChange();
    log('Betűtípus hozzáadva: ' + file.name + ' – válaszd ki egy szövegmezőnél.', 'ok');
  } catch (err) {
    log('Font hiba: ' + (err instanceof Error ? err.message : err), 'err');
  }
});
