/**
 * Bit-for-bit ugyanaz a CRC-32 (IEEE 802.3, reflektált, 0xEDB88320) mint a
 * legacy AppComponent.crc32() -- csak a 256 elemu tabla egyszer epul fel,
 * nem minden hivasnal ujra.
 */
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let c = 0; c < 256; c++) {
    let a = c;
    for (let f = 0; f < 8; f++) a = 1 & a ? 3988292384 ^ (a >>> 1) : a >>> 1;
    t[c] = a >>> 0;
  }
  return t;
})();

/** CRC-32 egy ASCII stringre, elojel nelkuli 32 bites szamkent. */
export function crc32(input: string): number {
  let n = -1;
  for (let i = 0; i < input.length; i++) {
    n = (n >>> 8) ^ TABLE[255 & (n ^ input.charCodeAt(i))];
  }
  return (-1 ^ n) >>> 0;
}
