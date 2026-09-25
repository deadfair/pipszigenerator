import { customFonts, fontByKey, type FontDef } from './config';
import { parseTtf } from './pdf/ttf';

interface LoadedFont {
  buffer: ArrayBuffer;
  /** WinAnsi szelessegek -- ugyanazok, amiket a PDF is hasznal. */
  widths: number[];
}

const cache = new Map<string, Promise<LoadedFont>>();

/**
 * Egy font betoltese es regisztralasa a bongeszoben.
 * A `FontFace` csaladneve maga a font kulcsa, igy az elonezet canvas-e ugyanazt
 * a betutipust rajzolja, amit a PDF is beagyaz.
 */
export function loadFont(key: string): Promise<LoadedFont> {
  const existing = cache.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const buffer = await fetchFont(fontByKey(key), key);
    const widths = parseTtf(buffer).widths;
    try {
      const face = new FontFace(key, buffer);
      await face.load();
      document.fonts.add(face);
    } catch {
      // Az elonezet ilyenkor tartalek betutipussal rajzol; a PDF valtozatlan.
    }
    return { buffer, widths };
  })();

  cache.set(key, promise);
  return promise;
}

async function fetchFont(def: FontDef, key: string): Promise<ArrayBuffer> {
  const custom = customFonts.get(key);
  if (custom) return custom.buffer;
  if (key.startsWith('custom:')) {
    // A feltoltott fontot nem mentjuk el, csak a rá mutato hivatkozast.
    throw new Error(`A(z) "${key.slice(7)}" betutipus az oldal ujratoltesevel elveszett -- huzd be megegyszer a .ttf fajlt.`);
  }
  const res = await fetch(new URL(def.url, document.baseURI));
  if (!res.ok) throw new Error(`Nem toltheto be a font: ${def.url} (HTTP ${res.status})`);
  return res.arrayBuffer();
}

/** Futasidoben feltoltott .ttf regisztralasa. */
export async function addCustomFont(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  parseTtf(buffer); // korai hiba, ha nem hasznalhato TrueType
  const key = 'custom:' + file.name.replace(/\.[^.]+$/, '');
  customFonts.set(key, { def: { key, label: file.name + '  (feltöltött)', url: '' }, buffer });
  cache.delete(key);
  await loadFont(key);
  return key;
}

/** A megadott kulcsok nyers TTF-jei -- ezt kapja meg a worker. */
export async function bufferMap(keys: Iterable<string>): Promise<Record<string, ArrayBuffer>> {
  const out: Record<string, ArrayBuffer> = {};
  for (const key of new Set(keys)) out[key] = (await loadFont(key)).buffer;
  return out;
}
