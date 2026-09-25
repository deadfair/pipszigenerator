import { crc32 } from './crc32';
import type { PayloadConfig } from '../config';

/**
 * Az ev hanyadik napja (jan. 1. = 1) egy `YYYYMMDD...` kezdetu stringbol.
 *
 * A legacy `dayOfTheYear()` UTC-ben parsolta a datumot, de helyi idoben
 * kepezte a referenciapontot -- ez UTC-1 ora alatti zonakban egy nappal
 * kevesebbet adott. Itt vegig UTC-ben szamolunk: Europe/Budapest-en pontosan
 * ugyanaz az eredmeny (2019-08-01 -> 213), de mar gepfuggetlenul.
 */
export function dayOfYear(stringDate: string): number {
  const y = Number(stringDate.slice(0, 4));
  const m = Number(stringDate.slice(4, 6));
  const d = Number(stringDate.slice(6, 8));
  const now = Date.UTC(y, m - 1, d);
  const start = Date.UTC(y - 1, 11, 31);
  return Math.floor((now - start) / 86_400_000);
}

const pad = (value: string | number, len: number) =>
  len > 0 ? String(value).padStart(len, '0') : String(value);

export interface PayloadFields {
  serial: number;
  prefix: string;
  from: string;
  to: string;
  serialText: string;
  crc: string;
  dayOfYear: number;
  page: number;
}

/** A sorszamhoz tartozo osszes mezo. `day` kivulrol jon, hogy ne szamoljuk ujra laponkent. */
export function fieldsFor(cfg: PayloadConfig, serial: number, day: number, page: number): PayloadFields {
  const crc = cfg.crcEnabled ? pad(crc32(String(serial + day)), cfg.crcPad) : '';
  return {
    serial,
    prefix: cfg.prefix,
    from: cfg.validFrom,
    to: cfg.validTo,
    serialText: pad(serial, cfg.serialPad),
    crc,
    dayOfYear: day,
    page,
  };
}

const PLACEHOLDER = /\{(prefix|from|to|serial|serialRaw|crc|dayOfYear|page)\}/g;

/** Template kitoltese. Ismeretlen placeholder valtozatlanul marad. */
export function render(template: string, f: PayloadFields): string {
  return template.replace(PLACEHOLDER, (_, key: string) => {
    switch (key) {
      case 'prefix': return f.prefix;
      case 'from': return f.from;
      case 'to': return f.to;
      case 'serial': return f.serialText;
      case 'serialRaw': return String(f.serial);
      case 'crc': return f.crc;
      case 'dayOfYear': return String(f.dayOfYear);
      case 'page': return String(f.page);
      default: return '';
    }
  });
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export function validate(cfg: PayloadConfig): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!cfg.prefix) out.push({ field: 'prefix', message: 'A prefix nem lehet ures.' });
  for (const [field, label, value] of [
    ['validFrom', 'Ervenyesseg kezdete', cfg.validFrom],
    ['validTo', 'Ervenyesseg vege', cfg.validTo],
  ] as const) {
    if (!/^\d{12}$/.test(value)) {
      out.push({ field, message: `${label}: 12 szamjegy kell (YYYYMMDDHHmm).` });
    } else if (Number.isNaN(dayOfYear(value))) {
      out.push({ field, message: `${label}: ervenytelen datum.` });
    }
  }
  if (!Number.isInteger(cfg.serialFrom) || !Number.isInteger(cfg.serialTo)) {
    out.push({ field: 'serialFrom', message: 'A sorszamok egesz szamok kell legyenek.' });
  } else if (cfg.serialTo < cfg.serialFrom) {
    out.push({ field: 'serialTo', message: 'A veg sorszam nem lehet kisebb a kezdonel.' });
  }
  return out;
}

export const pageCount = (cfg: PayloadConfig) =>
  Math.max(0, Math.floor(cfg.serialTo) - Math.floor(cfg.serialFrom) + 1);
