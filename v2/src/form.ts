import { mmToPx, pxToMm, round } from './core/units';
import type { AppConfig, Unit } from './config';

/**
 * Pici, deklarativ urlap-generator. Minden mezo egy `path`-on keresztul
 * olvassa/irja a konfiguraciot, igy nincs kezzel kotott input-halo, es a
 * mertekegyseg-valtas egy helyen intezheto.
 */

export type FieldKind = 'text' | 'number' | 'length' | 'select' | 'checkbox' | 'color' | 'textarea';

export interface FieldSpec {
  path: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  step?: number;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  /** `select`-nel: az ertek szamkent kerul a konfigba (pl. forgatas, ECC szint). */
  numeric?: boolean;
  /** Csak akkor latszik, ha ez igaz az aktualis konfigra. */
  visible?: (cfg: AppConfig) => boolean;
  /** Teljes sor szelessegben. */
  wide?: boolean;
}

export const getPath = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], obj);

export function setPath(obj: unknown, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce<Record<string, unknown>>(
    (acc, key) => acc[key] as Record<string, unknown>,
    obj as Record<string, unknown>,
  );
  target[last] = value;
}

export interface FormContext {
  cfg: AppConfig;
  unit: Unit;
  onChange: () => void;
}

/** Egy mezo DOM-ja. A visszaadott `sync` frissiti a megjelenitett erteket. */
export function buildField(spec: FieldSpec, ctx: FormContext): { el: HTMLElement; sync: () => void } {
  const wrap = document.createElement('div');
  wrap.className = 'field' + (spec.kind === 'checkbox' ? ' check' : '') + (spec.wide ? ' full' : '');

  const id = 'f_' + spec.path.replace(/\W/g, '_');
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = spec.label;

  let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  if (spec.kind === 'select') {
    const sel = document.createElement('select');
    for (const opt of spec.options ?? []) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      sel.append(o);
    }
    input = sel;
  } else if (spec.kind === 'textarea') {
    input = document.createElement('textarea');
  } else {
    const inp = document.createElement('input');
    inp.type =
      spec.kind === 'checkbox' ? 'checkbox' : spec.kind === 'color' ? 'color' : spec.kind === 'text' ? 'text' : 'number';
    if (spec.kind === 'number' || spec.kind === 'length') {
      inp.step = String(spec.step ?? (spec.kind === 'length' ? 0.001 : 1));
      if (spec.min !== undefined) inp.min = String(spec.min);
      if (spec.max !== undefined) inp.max = String(spec.max);
    }
    input = inp;
  }
  input.id = id;

  if (spec.kind === 'checkbox') {
    wrap.append(input, label);
  } else {
    wrap.append(label, spec.kind === 'length' ? wrapUnit(input, ctx) : input);
  }
  if (spec.hint) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = spec.hint;
    wrap.append(hint);
  }

  const read = () => {
    wrap.hidden = spec.visible ? !spec.visible(ctx.cfg) : false;
    const holder = input.parentElement;
    if (spec.kind === 'length' && holder instanceof HTMLElement) {
      holder.dataset.unit = ctx.unit === 'px' ? 'px' : 'mm';
    }
    // Eppen szerkesztett mezobe nem irunk vissza: elugrana a kurzor, es a
    // felig begepelt szam (pl. "45.") kerekitve visszairodna.
    if (document.activeElement === input) return;

    const raw = getPath(ctx.cfg, spec.path);
    switch (spec.kind) {
      case 'checkbox':
        (input as HTMLInputElement).checked = Boolean(raw);
        break;
      case 'length': {
        const mm = Number(raw);
        (input as HTMLInputElement).value = String(
          ctx.unit === 'px' ? round(mmToPx(mm, ctx.cfg.page.dpi), 1) : round(mm, 3),
        );
        break;
      }
      default:
        input.value = String(raw ?? '');
    }
  };

  const write = () => {
    switch (spec.kind) {
      case 'checkbox':
        setPath(ctx.cfg, spec.path, (input as HTMLInputElement).checked);
        break;
      case 'number':
        setPath(ctx.cfg, spec.path, clamp(Number(input.value), spec));
        break;
      case 'length': {
        const shown = Number(input.value);
        setPath(ctx.cfg, spec.path, ctx.unit === 'px' ? pxToMm(shown, ctx.cfg.page.dpi) : shown);
        break;
      }
      default:
        setPath(ctx.cfg, spec.path, spec.numeric ? Number(input.value) : input.value);
    }
    ctx.onChange();
  };

  input.addEventListener(spec.kind === 'text' || spec.kind === 'textarea' ? 'input' : 'change', write);
  if (spec.kind === 'number' || spec.kind === 'length') input.addEventListener('input', write);

  read();
  return { el: wrap, sync: read };
}

function clamp(value: number, spec: FieldSpec): number {
  if (!Number.isFinite(value)) return spec.min ?? 0;
  if (spec.min !== undefined && value < spec.min) return spec.min;
  if (spec.max !== undefined && value > spec.max) return spec.max;
  return value;
}

function wrapUnit(input: HTMLElement, ctx: FormContext): HTMLElement {
  const holder = document.createElement('div');
  holder.className = 'unit-suffix';
  holder.dataset.unit = ctx.unit === 'px' ? 'px' : 'mm';
  holder.append(input);
  return holder;
}

/** Cimkezett mezocsoport. */
export function buildSection(
  title: string,
  note: string,
  specs: FieldSpec[],
  ctx: FormContext,
): { el: HTMLElement; sync: () => void } {
  const fs = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = title;
  if (note) {
    const n = document.createElement('span');
    n.className = 'legend-note';
    n.textContent = note;
    legend.append(n);
  }
  const grid = document.createElement('div');
  grid.className = 'grid';
  const syncs = specs.map((spec) => {
    const field = buildField(spec, ctx);
    grid.append(field.el);
    return field.sync;
  });
  fs.append(legend, grid);
  return { el: fs, sync: () => syncs.forEach((s) => s()) };
}
