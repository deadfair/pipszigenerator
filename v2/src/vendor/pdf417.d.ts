export interface BarcodeArray {
  num_rows: number;
  num_cols: number;
  bcode: number[][];
}

declare const PDF417: {
  ROWHEIGHT: number;
  QUIETH: number;
  QUIETV: number;
  init(code: string, ecl?: number, aspectratio?: number): void;
  getBarcodeArray(): BarcodeArray;
};

export default PDF417;
