# PIPSZI generátor v2

Egy kattintás → letöltődik a teljes PDF. 2000 lap ~0,5 másodperc alatt, 1,2 MB.

```bash
cd v2
npm install
npm run dev        # http://127.0.0.1:4200
```

Minden helyben fut, internet nem kell. Tesztek: `npm test`.

---

## Mit csinált a régi verzió, és miért volt lassú

A `src/app/app.component.ts` egy Angular 13 app volt, ami laponként így dolgozott:

1. `setInterval(1000)` → megnyomta a „1 Léptetés” gombot **másodpercenként egyszer**
2. `openPDF()` → **html2canvas**-szal képernyőképet csinált a `#htmlData` div-ről
3. a PNG data-URL-t **raszteres képként** tette a jsPDF lapjára
4. a vezérlés fake `.click()`-ekkel pattogott az Angular komponens és az
   `index.html`-be írt globális `generate()` függvény között

Ebből jött a lassúság: a `setInterval` miatt a 2000 lap **legalább 33 perc**,
plusz a html2canvas laponkénti költsége. És mivel minden lap egy önálló PNG volt,
a fájl is nagyra hízott, a vonalkód pedig raszterizálva ment nyomdába.

Amit viszont **jól** csinált, és amit szó szerint átvettem:

| érték | honnan | v2-ben |
|---|---|---|
| lapméret 108,3 × 78,3 mm | `new jsPDF('l','mm',[108.3, 78.3])` | `page.widthMm/heightMm` |
| `rating = 108.3 / 1279` | egy ~300 DPI-s, 1279 px széles tervrajz skálája | az alapértelmezések ezzel a pontos aránnyal számolnak |
| vonalkód helye 468 / 537 px | `addImage(..., rating*468, rating*537, ...)` | `barcode.xMm/yMm` |
| modulméret 6 × 3 px | `bw = 6; bh = 3` az `index.html`-ben | `barcode.moduleWidthMm/moduleHeightMm` |
| sorszám helye 181 / 651 px | `PDF.text(text, rating*181, rating*651)` | `texts[0].xMm/yMm` |
| 10,5 pt Vinci Sans Light | `setFontSize(10.5)`, `setFont('Vinci_Sans_Light')` | `texts[0].sizePt/fontKey` |
| PDF417 paraméterek | TCPDF-port alapértékei (ROWHEIGHT 4, quiet 2/2, arány 2, auto ECC) | `barcode.*` |

### A kód tartalma

```
BUDPSH 201908011200 202108011200 41903 3840918781
└prefix┘└──kezdet──┘└───vég────┘└sorsz┘└──CRC-32─┘
```

A CRC nem magára a kódra megy, hanem erre: `crc32(String(sorszám + évNapja(kezdet)))`
— decimálisan összeadva, nullás feltöltés nélkül. A `test/compat.ts` a régi
forrásban kommentként meghagyott valós mintakódon ellenőrzi, hogy a v2
karakterre ugyanazt adja.

### Két hiba, amit közben javítottam

- **`dayOfTheYear()`** UTC-ben parsolta a dátumot, de helyi időben képezte a
  referenciapontot. UTC+1/+2-ben (nálad) ez jó, de negatív időzónában egy nappal
  kevesebbet adott volna → más CRC. A v2 végig UTC-ben számol; a teszt 180
  dátumon igazolja, hogy Budapesten az eredmény változatlan.
- **A html2canvas fix 645 × 200 px-es ablakot vágott ki.** A szimbólum 642 px
  széles volt, tehát épphogy belefért — de ha a kód egy karakterrel hosszabb
  lett volna (pl. 10 jegyű CRC helyett 9 jegyű után újra 10), a vonalkód
  **jobb széle levágódott volna**. A v2 mindig a teljes szimbólumot rajzolja, és
  ki is írja a méretét, illetve szól, ha kilóg a lapról.

---

## Hogyan lett gyors

A html2canvas + jsPDF + DOM-pingpong helyett minden egy **Web Workerben** fut,
és a PDF-et egy célra írt, függőség nélküli író állítja elő (`src/pdf/`).

A lényegi trükk: a vonalkód **1 bites `/ImageMask` XObject**-ként kerül a lapra.

- laponként ~800 byte (107 × 56 bit), nem egy 645 × 200 px-es PNG
- a PDF-olvasó a maszkot **interpoláció nélkül** skálázza → nyomtatásban éles,
  bármilyen felbontáson; pont ezt a formát várják a nyomdai RIP-ek is
- nem kell canvas, nem kell PNG-kódolás, nem kell DOM

A sorszám pedig **valódi szöveg** beágyazott TrueType fonttal, nem kép — tehát
kereshető és kijelölhető a PDF-ben.

Mért eredmények (Node 24, ugyanaz a kód, ami a böngészőben fut):

| lapszám | tömörítve | tömörítés nélkül |
|---|---|---|
| 2 000 | 0,55 s · 1,23 MB | 0,22 s · 2,7 MB |
| 5 000 | 1,44 s · 3,76 MB | 0,57 s · 6,87 MB |

### Miért saját PDF-író, és nem jsPDF / pdf-lib

Egyik sem tud 1 bites image maskot. Náluk két út lenne: laponként PNG (lassú és
nagy, ez volt a régi megoldás baja), vagy laponként ~1500 vektor téglalap
(sok ezer lapnál kezelhetetlen fájlméret). A saját író ~350 sor, nincs
függősége, és pontosan azt írja ki, amit ez a feladat igényel.

---

## Mi állítható

Minden szám mm-ben **vagy** px-ben adható meg (fejlécben a váltó) — a px a
`Referencia DPI` mezőhöz igazodik, ami alapból 300, szóval a régi tervrajz
pixelkoordinátái közvetlenül beírhatók.

- **Kód tartalma** — prefix, két érvényességi dátum, sorszám-tartomány, a sorszám
  hány jegyű legyen, CRC ki/be és hány jegyű, és egy szabad **kódsablon**
  (`{prefix} {from} {to} {serial} {serialRaw} {crc} {dayOfYear} {page}`)
- **Lap** — szélesség, magasság, referencia DPI
- **Vonalkód** — X, Y, méretezés modulméret szerint *vagy* fix dobozba feszítve,
  forgatás (0/90/180/270), szín, hibajavítási szint, oldalarány, sormagasság,
  csendes zóna vízszintesen és függőlegesen
- **Szövegmezők** — tetszőleges számú; mindegyiknek saját tartalma (sablon),
  betűtípusa, mérete, X/Y, igazítása (bal/közép/jobb), színe és betűköze
- **Betűtípus** — a projekt 8 fontja (Vinci Sans ×5, Sansation ×3), vagy húzz be
  egy saját `.ttf`-et az ablakba
- **Háttérkép** — előnézethez és/vagy a PDF-be ágyazva (egyetlen képobjektum,
  akkor sem duplázódik, ha 10 000 lap van)
- **Kimenet** — fájlnév sablon, hány lap kerüljön egy fájlba (0 = mind egybe),
  tömörítés, PDF cím

Az előnézetben a **vonalkód és a szövegek egérrel húzhatók**, nyílbillentyűkkel
0,1 mm-enként (Shift-tel 1 mm) tologathatók. A beállítások automatikusan
mentődnek a böngészőben, és JSON-ba exportálhatók / onnan visszatölthetők.

### A betűtípusokról

A régi kód base64-be ágyazva hurcolt egy 679 kB-os `vinci.ts`-t és egy 144 kB-os
`Sansations.ts`-t. Itt a `.ttf`-ek a `public/fonts/` alatt vannak, és futásidőben
töltődnek be — így ugyanaz a fájl szolgálja ki az előnézet canvasát (`FontFace`)
és a PDF beágyazást, tehát **amit látsz, az kerül a PDF-be**.

A PDF-be a teljes TTF megy be `/FontFile2`-ként, `/WinAnsiEncoding`-gal; a
karakterszélességeket a `src/pdf/ttf.ts` olvassa ki a font `hmtx`/`cmap`
tábláiból, ezért a közép- és jobbra igazítás a tizedmilliméter pontos.
Subsetelés nincs — nem kell: a font egyszer kerül be, akárhány lap használja.

---

## Felépítés

```
src/
  config.ts              a teljes beállítás-modell + a legacy alapértékek
  core/crc32.ts          CRC-32, a régivel bitre azonos
  core/payload.ts        évNapja, mezők, sablon-kitöltés, validáció
  core/barcode.ts        PDF417 → pakolt bitmátrix
  core/units.ts          mm / pt / px váltók
  pdf/writer.ts          objektumok, streamek, xref, Flate
  pdf/ttf.ts             TrueType olvasó (szélességek + font-leíró)
  pdf/document.ts        lapok, fontok, ImageMask, szöveg, háttér
  worker/                a generálási futószalag (nem blokkolja a felületet)
  preview.ts             canvas előnézet + húzás
  form.ts                deklaratív űrlapgenerátor
  main.ts                összeszerelés
  vendor/pdf417.js       az eredeti bcmath-js + TCPDF PDF417-port
public/fonts/            a projekt .ttf fájljai
test/                    compat / variants / smoke / verify
```

A `vendor/pdf417.js` szándékosan az **eredeti** kódolóalgoritmus, két apró,
`[pipszi-v2]`-vel jelölt módosítással (strict mode alatt deklarálni kellett a
korábban implicit globálisokat, és az `ecl = ecl || -1` a 0-s hibajavítási
szintet is automatikusra váltotta). Így a legenerált szimbólum garantáltan
ugyanaz, mint a régi appban.

## Tesztek

```bash
npm test
```

- `compat.ts` — a kód és a szimbólum karakterre/modulra egyezik a régivel,
  a start/stop minták a helyükön vannak, a geometria változatlan
- `variants.ts` — forgatás, dobozos méretezés, CRC-feltöltés, több szövegmező
  igazítással, vonalkód nélküli lap, tömörítés nélkül, eltérő lapméret
- `smoke.ts` — teljesítménymérés + minta-PDF (`test/out.pdf`)
- `verify.ts` — a kész PDF szerkezeti ellenőrzése: xref-eltolások, stream
  hosszak, a beágyazott font, és az ImageMask bitről bitre összevetése
  egy függetlenül újraszámolt mátrixszal
