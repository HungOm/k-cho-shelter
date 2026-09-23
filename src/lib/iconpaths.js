/*
 * THE DRAWINGS THEMSELVES — path data, and nothing that knows about Vue.
 *
 * These lived inside Icon.vue, which was right while a component was the only
 * thing that drew them. It stopped being right when the studio gained a tool
 * that PLACES an icon on a ticket: `ticketart.js` renders SVG for print and for
 * the picture a buyer is sent, it runs nowhere near a browser component, and
 * importing a .vue file to reach a table of strings would be a rendering
 * pipeline depending on a UI framework for its content.
 *
 * So the data is data. Icon.vue draws one of these; designelements.js places
 * one on a ticket; both read the same table, which is the property that stops a
 * mark in the studio being a different shape from the mark that prints.
 *
 * EVERY RULE ABOUT WHAT A DRAWING MAY BE STILL LIVES IN tests/icons.test.mjs,
 * which parses this file: strokes on the 24 grid only, path commands and
 * numbers only, no colour, no <text>, four marks at most. Adding one here is
 * adding one line — two spaces, the name, a colon, a single-quoted path — and
 * any other formatting makes it invisible to the parser and therefore untested.
 */

const PATHS = {
  // --- the app ---------------------------------------------------------
  home:      'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5M9.5 20v-6h5v6',
  search:    'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  ticket:    'M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5v2a2 2 0 0 0 0 4v2A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-2a2 2 0 0 0 0-4v-2ZM9.5 7v11',
  books:     'M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5v-13ZM9 4h4v16H9zM13 4h5.5A1.5 1.5 0 0 1 20 5.5v13A1.5 1.5 0 0 1 18.5 20H13z',
  people:    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.8c2.4.6 4 2.4 4 5.2',
  money:     'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v10M14.8 9.4c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2s1.2 2 2.8 2 2.8.8 2.8 2-1.2 2-2.8 2c-1.2 0-2.3-.5-2.8-1.4',
  trophy:    'M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4.5v1.5A3.5 3.5 0 0 0 7.6 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16.4 11M12 14v3.5M8.5 20.5h7L15 17.5H9l-.5 3Z',
  /*
   * REDRAWN, and the only existing drawing this change touches.
   *
   * The old gear was the forty-node arc-per-tooth kind. It is legible in the
   * sidebar at 22px and grey mush in a dense rail at 16, which is where the
   * studio needs it as `settings`. A rim, a hub and eight teeth carry the same
   * meaning and hold their shape all the way down.
   *
   * THE TEETH TOUCH THE RIM, and that is the whole drawing. The first attempt
   * here was a circle with eight strokes floating outside it, which is a SUN —
   * it was drawn, rendered, and read as brightness by the person who had just
   * drawn it. A tooth starts where the rim ends; a ray does not.
   */
  gear:      'M12 4.8a7.2 7.2 0 1 0 0 14.4 7.2 7.2 0 0 0 0-14.4ZM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6ZM12 4.8V2.4M12 19.2v2.4M4.8 12H2.4M19.2 12h2.4M6.9 6.9 5.2 5.2M17.1 17.1l1.7 1.7M17.1 6.9l1.7-1.7M6.9 17.1l-1.7 1.7',
  key:       'M14.5 3a6.5 6.5 0 0 1 2.4 12.5L15 21l-2.5-1.5L10 21l-1.5-3 2-2A6.5 6.5 0 0 1 14.5 3ZM15 8.5h.01',
  hand:      'M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5.3-3.2L4 15c-.4-.8-.1-1.8.7-2.2.8-.4 1.8-.1 2.2.7L8 15',
  more:      'M5 12h.01M12 12h.01M19 12h.01',
  clock:     'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  phoneOff:  'M3 3l18 18M9.5 4.5A15 15 0 0 0 19.5 14.5M8 13a15 15 0 0 0 3 3l1.5-1.5a1.5 1.5 0 0 1 1.6-.3l2 .8a1.5 1.5 0 0 1 1 1.4v2.3a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 4.3 6.5 1.5 1.5 0 0 1 5.8 5h2.3a1.5 1.5 0 0 1 1.4 1l.8 2a1.5 1.5 0 0 1-.3 1.6L8 13Z',
  check:     'M4.5 12.5 9.5 17.5 19.5 6.5',
  plus:      'M12 5v14M5 12h14',
  minus:     'M5 12h14',
  bookPlus:  'M5 5.5A1.5 1.5 0 0 1 6.5 4H19v12H6.5A1.5 1.5 0 0 0 5 17.5v-12ZM5 17.5A1.5 1.5 0 0 0 6.5 19H19M12 7.5v5M9.5 10h5',
  trash:     'M4.5 7h15M9.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12',
  arrowUp:   'M12 20V4.5M6 10.5 12 4.5l6 6',
  arrowDown: 'M12 4v15.5M18 13.5 12 19.5l-6-6',
  /* Back out of somewhere, rather than back one step in a list — it sits on
     "Exit studio", where the thing being left is a whole mode. */
  arrowLeft: 'M20 12H4.5M10.5 6 4.5 12l6 6',

  // --- the studio: what a ticket is made of ----------------------------
  /*
   * The element palette — text, picture, code — is three drawings that have to
   * be told apart at a glance in the same row. They are deliberately as
   * different from one another as the grid allows: a letterform, a framed
   * landscape, and the unmistakable corner squares of a QR code.
   */
  design:    'M4 20l1-3.6L14.9 6.6a1.9 1.9 0 0 1 2.7 2.7L7.6 19.1 4 20ZM13.4 8.1l2.5 2.5',
  type:      'M6 6h12M12 6v12M9.5 18h5',
  image:     'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-11ZM8.8 11a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6ZM4.6 16.2l4.4-3.7 3.5 3 3-2.5 4 3.6',
  code:      'M4.5 4.5h5v5h-5zM14.5 4.5h5v5h-5zM4.5 14.5h5v5h-5zM14.5 14.5h2v2h-2zM17.5 17.5h2v2h-2z',
  /*
   * `name` AND `label` WERE BEING ASKED FOR AND WERE NOT HERE.
   *
   * cardelements.js gives the digital card's parts a `kind`, and DigitalTab
   * draws that kind straight as an icon name — unlike the printed side, which
   * maps through KIND_ICON. Two of its kinds had no drawing, so the buyer's
   * name and every caption on the card have been rendering the `missing` mark
   * in the layer list AND in the inspector head, for as long as that tab has
   * been a designer.
   *
   * It survived because the test that should have caught it matched
   * `/^\s+name:/` against this FILE, which hits the prop declaration a few
   * lines above rather than the table below. Fixed in cardlayout.test.mjs at
   * the same commit; it parses the table now.
   *
   * `name` is ONE person over a written line — the buyer, and the line their
   * name is written on. `people` is two figures and means a group, which is
   * why this could not simply borrow it. `label` is the trade's own luggage
   * tag with its eyelet, which is a caption ABOUT something rather than the
   * something — the distinction the card makes between "Price" and the price.
   */
  name:      'M12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 16c0-2.4 2.6-4 6-4s6 1.6 6 4M5 20h14',
  label:     'M20.6 12.4 12.4 20.6a1.5 1.5 0 0 1-2.1 0l-6.2-6.2a1.5 1.5 0 0 1-.4-1.1l.4-6.3a1.5 1.5 0 0 1 1.4-1.4l6.3-.4a1.5 1.5 0 0 1 1.1.4l6.2 6.2a1.5 1.5 0 0 1 0 2.1ZM9 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',

  // --- the studio: placing it ------------------------------------------
  position:  'M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  size:      'M4 9.5V4h5.5M20 14.5V20h-5.5M5.2 5.2 10.4 10.4M18.8 18.8 13.6 13.6',
  align:     'M4.5 4v16M8.5 7.5h11M8.5 12h7.5M8.5 16.5h9.5',
  layers:    'M12 3.8 3.6 8.4 12 13l8.4-4.6L12 3.8ZM4.2 12.4 12 16.7l7.8-4.3',
  /*
   * SNAP is a horseshoe magnet, which is card 9b's own drawing and is the one
   * metaphor for this that nobody has to be taught. The alternative — two
   * boxes with a dashed line between them — is a picture of the RESULT, and at
   * 15px beside an 11px label it reads as a diagram rather than as a tool.
   *
   * Two arches and two pole faces: the legs stay open, because a closed
   * horseshoe is an arch and an arch is a bridge.
   */
  magnet:    'M5 17V10a7 7 0 0 1 14 0v7M9 17v-7a3 3 0 0 1 6 0v7M5 17h4M15 17h4',
  /*
   * GRID IS FOUR CROSSING LINES, AND NOT FOUR SQUARES, which is what the card
   * draws and what I drew first.
   *
   * Four equal panes is `ph-grid-four`, and in this app it collides: `code`
   * above is a QR, three large squares and two small, and at 15px in the same
   * screen — the rail lists "Check code" while the stage bar offers "Grid 2 mm"
   * — a reader has two arrangements of small squares to tell apart. That is
   * rule 1 of this set failing quietly: unmistakable beats handsome, and it has
   * to be unmistakable against the set's OWN neighbours, not in isolation.
   *
   * Lines are also the truer drawing. A grid is what a box snaps TO, and what
   * it snaps to is the lines, not the panes between them. Four marks, gaps of
   * about five grid units, which is coarse enough to hold at the small end.
   */
  grid:      'M4 9.5h16M4 14.5h16M9.5 4v16M14.5 4v16',
  /*
   * FIT is two walls and an arrow between them, not the four corner brackets
   * the rest of the world uses for "fit to frame". The control it belongs to
   * is fitToWidth: the ticket grows until it touches the sides of the sheet,
   * and the drawing says width rather than area.
   */
  fit:       'M4.5 5.5v13M19.5 5.5v13M8.5 12h7M10.2 9.8 8 12l2.2 2.2M13.8 9.8 16 12l-2.2 2.2',

  /*
   * THE TOOL RAIL, 2026-09-22. Five drawings the studio needed and did not have.
   *
   * Everything else the rail asks for was already here and unused — `position`
   * for move, `align`, `layers` for order, `hand` for pan, `size`, `type`,
   * `image`, `trash`, `arrowUp`/`arrowDown`. Eighteen drawings were waiting for
   * a toolbar that had never been built, which is why this group is five and
   * not twenty.
   *
   * `select` is the pointer every editor in the world draws, and that is the
   * argument for it: it is the one tool whose meaning a volunteer already
   * knows before they read anything. `shape` is a square and a circle
   * overlapping, not one or the other, because the tool places either. `lock`
   * is the padlock rather than a crossed-out handle — a locked element is not
   * a forbidden one, it is a fixed one. `distribute` is two rails with a box
   * between them, which is the space being shared rather than the objects.
   */
  select:    'M6.5 4 18 12.4h-5.6l2.6 6.1-2.4 1-2.6-6.1-3.5 3.6Z',
  shape:     'M4 4.5h9.5v9.5H4zM20 15a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z',
  duplicate: 'M9 3.5h10A1.5 1.5 0 0 1 20.5 5v10M5 7.5h9A1.5 1.5 0 0 1 15.5 9v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V9A1.5 1.5 0 0 1 5 7.5Z',
  lock:      'M6.5 10.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1ZM8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3',
  distribute:'M3.5 4.5v15M20.5 4.5v15M9 8.5h6v7H9z',
  /* The same, turned: even gaps DOWN rather than across. It borrowed `margins`,
     which is the print sheet's drawing for a page margin. */
  distributeV:'M4.5 3.5h15M4.5 20.5h15M8.5 9h7v6h-7z',

  // --- the studio: putting it on paper ---------------------------------
  print:     'M7.5 9.5v-5h9v5M7.5 17.5H6A1.6 1.6 0 0 1 4.4 16v-4.4A1.6 1.6 0 0 1 6 10h12a1.6 1.6 0 0 1 1.6 1.6V16a1.6 1.6 0 0 1-1.6 1.5h-1.5M7.5 14.5h9v5h-9z',
  paper:     'M6.5 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5ZM13.5 3.5V8h4.5',
  template:  'M4.5 5.5A1.5 1.5 0 0 1 6 4h12a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5v-13ZM4.5 9h15M9.5 9v11',
  margins:   'M4.5 4.5h15v15h-15zM8.5 8.5h7v7h-7z',
  /*
   * BLEED is eight crop marks and no box. That is what bleed IS — ink running
   * past a trim line that only exists on the printer's marks — and drawing a
   * rectangle would say the opposite of the thing named.
   */
  bleed:     'M9 3v5.5M15 3v5.5M3 9h5.5M15.5 9H21M3 15h5.5M15.5 15H21M9 15.5V21M15 15.5V21',
  preview:   'M2.8 12S6.4 5.8 12 5.8 21.2 12 21.2 12 17.6 18.2 12 18.2 2.8 12 2.8 12ZM12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z',
  /* The eye, struck through. There was no "not shown" drawing in the set, so a
   * visibility control had to borrow phoneOff -- a crossed-out HANDSET beside a
   * ticket field. The slash is the same M3 3l18 18 stroke phoneOff uses, so the
   * two read as one convention rather than two. */
  previewOff:'M3 3l18 18M10.6 6.1A7.6 7.6 0 0 1 12 5.8c5.6 0 9.2 6.2 9.2 6.2a17 17 0 0 1-2.8 3.4M6.5 8.1A17 17 0 0 0 2.8 12S6.4 18.2 12 18.2a8 8 0 0 0 3.2-.7M9.9 9.9a2.6 2.6 0 0 0 3.7 3.7',
  download:  'M12 4v10.5M8 11l4 4 4-4M4.5 17v1.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V17',
  /* download's own drawing with the arrow reversed, deliberately: the tray is
     the same tray, so "into the app" and "out of the app" read as one pair
     rather than as two unrelated marks. */
  upload:    'M12 15V4.5M8 8.5l4-4 4 4M4.5 17v1.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V17',

  // --- the studio: looking at it before it prints ----------------------
  /*
   * The two zooms are `search`'s magnifier with a bar added, deliberately and
   * not for want of an idea. A preview's zoom and the app's search are the same
   * gesture — make this bigger so I can see it — and drawing them from two
   * different shapes would say they were unrelated.
   */
  zoomIn:    'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4M11 8v6M8 11h6',
  zoomOut:   'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4M8 11h6',
  /*
   * ACTUAL SIZE IS THE PRINTER'S "1:1", AND IT IS THE ONE PLACE THIS SET
   * DRAWS CHARACTERS ON PURPOSE.
   *
   * Every metaphor available says the wrong thing. A magnifier with a 1 reads
   * as "zoom to 100% of the window", which is a claim about the browser; this
   * control claims the ticket on the glass is the size of the ticket in your
   * hand. 1:1 is the notation the trade already uses for exactly that, next to
   * the crop marks and the trim box, and somebody laying out a raffle ticket
   * has seen it.
   *
   * THE COST, STATED RATHER THAN HIDDEN: Burmese has its own digits (၁), so
   * this is the one drawing in the set that is not fully language-independent.
   * It is acceptable HERE because the ticket studio is an organiser's desk
   * tool. If this control ever reaches the seller's field screens, it needs a
   * label beside it rather than a redraw — a mark that reads as measurement to
   * one reader and as nothing to another is worse than a word.
   */
  actualSize:'M6.6 8.8 8.2 7.2v9.6M12 10.2h.01M12 14.6h.01M14.8 8.8 16.4 7.2v9.6',
  /*
   * The way in to calibration, so it has to read as MEASUREMENT and not as
   * settings — a browser cannot know a display's physical DPI, so "actual
   * size" is approximate until somebody holds a bank card against a bar on the
   * screen. Ticks of two lengths, because a ruler with even teeth is a comb.
   */
  ruler:     'M3.5 8.5h17v7h-17zM7 8.5v3M10.5 8.5v2M14 8.5v3M17.5 8.5v2',
  reset:     'M4.6 9.3A7.6 7.6 0 1 1 4.5 13M3.6 4v5.3h5.3',
  help:      'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.6 9.4A2.5 2.5 0 0 1 14.5 10c0 1.7-2.5 2.2-2.5 3.7M12 17h.01',
  /*
   * A VERDICT THAT IS NOT READY. The artwork verdict said ready or not-ready
   * with a coloured dot and nothing else, so the whole judgement rested on
   * telling green from amber — which is the one distinction a red-green eye
   * does not make, and which survives no grayscale screenshot. The shape
   * carries it now and the colour agrees with the shape.
   *
   * The stem and its point are the same two marks `help` uses, at the same
   * heights, so the two read as one family.
   */
  alert:     'M12 4.2 2.6 20.3h18.8L12 4.2ZM12 10v4M12 17.5h.01',

  /*
   * LINING THINGS UP — six drawings for six commands, because they were three
   * commands under three unrelated drawings (`align`, `position`, `size`) and
   * the other three were not offered at all. Each is the edge being lined up
   * to, drawn as the one long stroke, with two boxes of different lengths
   * touching it — so the drawing IS the result: a reader can see which edge
   * the boxes end up sharing without reading the word.
   */
  alignLeft:  'M4.5 4v16M8 7h11v3.5H8zM8 13.5h7V17H8z',
  alignCentre:'M12 4v16M6.5 7h11v3.5h-11zM8.5 13.5h7V17h-7z',
  alignRight: 'M19.5 4v16M5 7h11v3.5H5zM9 13.5h7V17H9z',
  alignTop:   'M4 4.5h16M7 8h3.5v11H7zM13.5 8H17v7h-3.5z',
  alignMiddle:'M4 12h16M7 6.5h3.5v11H7zM13.5 8.5H17v7h-3.5z',
  alignBottom:'M4 19.5h16M7 5h3.5v11H7zM13.5 9H17v7h-3.5z',
  /*
   * WHERE THE WORDS SIT INSIDE THEIR BOX — a different command from the six
   * above, so a different drawing: lines of type, not boxes against an edge.
   * The two inspectors said this one in words in one panel and in a single
   * repeated glyph in the other.
   */
  textLeft:   'M4.5 6.5h15M4.5 10.5h10M4.5 14.5h15M4.5 18.5h8',
  textCentre: 'M4.5 6.5h15M7 10.5h10M4.5 14.5h15M8 18.5h8',
  textRight:  'M4.5 6.5h15M9.5 10.5h10M4.5 14.5h15M11.5 18.5h8',
  /*
   * `layers` upside down: the closed sheet is the one that moved, and it is at
   * the bottom of the stack. `layers` itself stays "bring to front".
   */
  toBack:     'M4.2 4.4 12 8.7l7.8-4.3M12 11.8 3.6 16.4 12 21l8.4-4.6L12 11.8Z',
  /*
   * Moved here from Ink.vue, where it was the one drawing in the app written
   * inline in a component — outside this table and outside the rules above.
   */
  dropper:    'M15.5 3.5a2.1 2.1 0 0 1 3 3l-2 2 1 1-1.5 1.5-1-1L7 17.5 4 18l.5-3 8.5-8.5-1-1L13.5 4l1 1 1-1.5Z',
  /*
   * GROUPING. Two shapes inside the corners of one box, against the same two
   * shapes standing apart — so the pair reads as a before and after, and
   * neither can be taken for `duplicate`, which is two overlapping sheets.
   */
  group:      'M3.5 7V3.5H7M17 3.5h3.5V7M20.5 17v3.5H17M7 20.5H3.5V17M8 8h4v4H8zM12.5 12.5H16V16h-3.5z',
  ungroup:    'M4.5 4.5h6v6h-6zM13.5 13.5h6v6h-6z',
  /* A mirror line with a triangle and its reflection either side of it. */
  flipH:      'M12 4v16M9.5 7 4 17h5.5zM14.5 7l5.5 10h-5.5z',
  flipV:      'M4 12h16M7 9.5 17 4v5.5zM7 14.5l10 5.5v-5.5z',
  /* A disc, half of it hatched: the ticket as a grey press will print it. */
  greyscale:  'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 3v18M12 7h4.5M12 11h6.5M12 15h6M12 19h3',
  /* The pen: a fountain-pen nib, point down, with its breather hole and slit.
     The first drawing was a slanted pencil and sat beside `design` — also a
     slanted pencil — on the Draw rail, where the two could not be told apart. */
  pen:        'M12 21 6.5 11 12 3l5.5 8L12 21ZM12 21v-7.5M12 13.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z',
  /* A node on a curve with its two handles: what "edit the points" works on. */
  node:       'M3.5 17C7 17 8 7 12 7s5 10 8.5 10M10 5h4v4h-4zM5 7h5M14 7h5',
  /* An ellipse, wider than tall, so it reads as the Ellipse tool and not as a
     refresh arrow — which is what the tool borrowed until now. */
  ellipse: 'M12 5c4.97 0 9 3.13 9 7s-4.03 7-9 7-9-3.13-9-7 4.03-7 9-7Z',
  /* A chevron, pointing right: a folded group in the layer list. Turned a
     quarter down by the list when the group is open. */
  disclose: 'M9.5 5.5 16 12l-6.5 6.5',

  /*
   * NOT A DRAWING — what is shown when a name does not exist.
   *
   * It used to be `more`, the three-dot ellipsis, which is a real control in
   * the sidebar. A misspelt name therefore produced a plausible button that
   * did nothing unusual, and the mistake reached whoever was looking at the
   * screen rather than whoever typed it. A broken-edged box struck through is
   * not mistakable for anything this set intends, so it is visible the moment
   * it renders.
   *
   * THE STRIKE IS NOT DECORATION. Without it this was a dashed square, which
   * sat on the contact sheet looking like a perfectly reasonable crop tool —
   * a fallback that looks like an icon is the bug all over again, one step
   * along. Nothing else in the set is struck through.
   */
  missing:   'M5 5h3.5M13 5h3.5M19 7.5v3.5M19 15.5V19h-3.5M13 19H9.5M5 19v-3.5M5 11V7.5M6.5 17.5 17.5 6.5'
}

/*
 * One concept, one drawing. `settings` is what the studio's rail calls the
 * control the sidebar calls `gear`; both names point at the same path rather
 * than at two gears that would drift apart the first time either is touched.
 */
const ALIASES = { settings: 'gear' }

export { PATHS, ALIASES }

/** The drawing a name resolves to, following one alias, or '' for none. */
export function pathFor(name) {
  const key = String(name ?? '')
  return PATHS[key] || PATHS[ALIASES[key]] || ''
}
