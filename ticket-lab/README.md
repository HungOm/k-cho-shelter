# ticket-lab — where this went

This was a standalone pilot, built 2026-09-19, to answer one question before any
of it was wired to the app: **can a serial number be placed on the ticket artwork
exactly** — on the printed label's own baseline, at its cap height, clear of the
logo — for one number or a run of them.

It could, and the geometry it established is now part of the app. This folder is
what is left: the artwork, and a way to draw it from a terminal.

## Where each piece lives now

| was | is |
|---|---|
| `layout.js` — the measurements | `src/lib/ticketdesign.js` (`DEFAULT_DESIGN`), now scaled to whatever artwork is uploaded and overridable per template |
| `layout.js` — the placement maths | `src/lib/ticketart.js` (`place`, `placeFitted`, `placeBoth`) |
| `render.js` — the SVG overlay | `src/lib/ticketart.js` (`numberLayerSVG`) |
| `render.js` — the printable sheet | `src/lib/ticketsheet.js` |
| `serial.js` — number formatting | the app's own, `src/lib/books.js`, which the raffle already used |
| `tests/placement`, `tests/render` | `tests/ticketart.test.mjs` |
| `tests/appconfig` | `tests/seedagree.test.mjs` |
| `tests/isolation` | **deleted**, deliberately, in the commit that did the wiring — it existed to prove the lab was *not* connected, which stopped being true on purpose |
| `preview.html` | the Ticket design screen, `src/components/TicketDesign.vue` |

## What is still here, and why

`artwork/ticket-front.jpg` — the real ticket, 1600 × 517. Every measurement in
`DEFAULT_DESIGN` was read off this file by scanning its pixels.

`generate.mjs` — draws the artwork with real numbers on it, with no browser, no
sign-in and no database:

```bash
node ticket-lab/generate.mjs --from 1 --to 4
node ticket-lab/generate.mjs --number KS-03291 --guides --qr
```

It imports the same modules the app draws with, so a number that lands wrong
here is the geometry rather than the screen. It reads the **default** design,
not anything an organiser has saved — it has no database to read that from, and
that is the one way its output can differ from the app's.

`proof.py` — draws the placement JSON onto the artwork with a real Times New
Roman at full resolution, so the result can be checked zoomed in without a
browser rendering it:

```bash
node ticket-lab/generate.mjs --number KS-03291 --format json --out out/one.json
python3 ticket-lab/proof.py out/one.json out/proof.png --zoom   # needs Pillow
```

## If the artwork is replaced

Nothing here is the source of truth any more. The app accepts artwork on the
**Ticket design** screen, measures it, and scales the default placement to it —
an organiser who re-exports the ticket at print resolution does not have to place
the number again. The file in this folder is a copy kept for the proof renders
above.

The measurements themselves, and how they were taken, are documented at the top
of `src/lib/ticketdesign.js`.
