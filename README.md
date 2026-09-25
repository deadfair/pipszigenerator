# PipsziGenerator

Két verzió él egymás mellett ebben a mappában:

| | |
|---|---|
| **[`v2/`](v2/) – az új generátor** | Egy kattintás, és letöltődik a teljes PDF. 2000 lap ~0,5 mp alatt. Minden paraméter állítható (lapméret, vonalkód helye/mérete/forgatása, tetszőleges számú szövegmező, betűtípusok). Vite + TypeScript, futásidejű függőség nélkül. |
| `src/` – a régi Angular app | Az eredeti, html2canvas + jsPDF alapú, másodpercenként egy lapot renderelő megoldás. Érintetlen, referenciának megmarad. |

## Az új verzió indítása

```bash
cd v2
npm install
npm run dev        # http://127.0.0.1:4200
```

A részletes elemzés (mi mit csinált a régiben, mit vettem át szó szerint, mi
lett gyorsabb és miért) a **[`v2/README.md`](v2/README.md)**-ben van.

## A régi verzió indítása

```bash
npm install
npm start          # ng serve, http://localhost:4200
```
