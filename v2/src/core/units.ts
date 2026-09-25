/** Hosszmertek-valtok. Belul MINDEN milimeterben van tarolva. */

export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;

export const mmToPt = (mm: number) => (mm * PT_PER_INCH) / MM_PER_INCH;
export const ptToMm = (pt: number) => (pt * MM_PER_INCH) / PT_PER_INCH;

export const pxToMm = (px: number, dpi: number) => (px * MM_PER_INCH) / dpi;
export const mmToPx = (mm: number, dpi: number) => (mm * dpi) / MM_PER_INCH;

/** Szam kerekitese n tizedesre, lebego-pontos szemet nelkul. */
export const round = (v: number, n = 4) => {
  const f = 10 ** n;
  return Math.round(v * f) / f;
};
