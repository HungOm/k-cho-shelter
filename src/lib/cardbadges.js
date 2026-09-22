/**
 * THE DEVICE ON A SUPPORTER'S CARD, PER CATEGORY AND PER RUNG.
 *
 * The ladder is configuration — five rungs whose NAMES an organiser writes,
 * from a preset or from scratch (see _shared/ranks.ts). This file is the other
 * half of that: what the card DRAWS beside the name, which cannot be a word
 * because the word is already there, and cannot be a colour because a card is
 * a picture already sent to somebody's chat and a colour baked into it is one
 * nobody can fix later.
 *
 * FOUR CATEGORIES, BECAUSE THE ORGANISATION IS FOUR THINGS. A shelter, a
 * refugee learning centre, a community centre and Christian fellowships — the
 * same people, four rooms. A raffle run by one of them should not send a card
 * drawn for another, and the four are the same four the rung presets already
 * name, so a raffle that picked its words has picked its pictures too.
 *
 * WHY A DEVICE THAT GROWS RATHER THAN FIVE UNRELATED DRAWINGS.
 *
 * Five separate pictures make five separate cards. One device that gains
 * something at each rung makes a LADDER, which is what this is: a doorway, a
 * house, a house with its roof drawn, a house with windows lit, a house with
 * an arm round it. A buyer who moves up a rung sees the same thing they had
 * with more of it, which is the only way a picture can say "further in"
 * without a caption saying so.
 *
 * WHAT THE SEAL DOES NOT CARRY IS THE NAME, and that is a constraint rather
 * than a preference. A rung name is free text up to 24 characters in whatever
 * language the organiser writes — Admin.vue refuses the 25th with "a card
 * holds 24". Twenty-four characters around a 150px ring is six pixels a letter,
 * and the Myanmar chain cannot be measured by this code at all: the bug that
 * printed "Klang" as "K l a n g" was an estimated x, and a configurable name
 * makes unknown width the normal case rather than the edge one. So the ring
 * carries the rung's POSITION — I to V — which is one glyph wide in every
 * language and cannot overflow, and the name is set beside the seal at a size
 * somebody can read.
 *
 * GEOMETRY IS A 24×24 BOX, stroke-drawn, no fills. The card scales it and sets
 * the colour; nothing here knows how big it will be or what it prints in. Round
 * joins and caps throughout, because these are shown at 40px in a chat
 * thumbnail as often as at 150px, and a mitre at that size reads as a burr.
 */

/** The five rung slots, in the order the ladder climbs. Mirrors SLOTS in ranks.ts. */
export const RUNGS = ['rung1', 'rung2', 'rung3', 'rung4', 'rung5']

/**
 * The rung's position as a reader sees it.
 *
 * Roman rather than Arabic, and it is not decoration: the card already carries
 * ticket numbers, a book number, a price and a year, all Arabic and all things
 * somebody checks. A fifth set of digits in a circle would read as another
 * quantity. I–V reads as a rank, which is what it is.
 */
export const RUNG_NUMERAL = ['I', 'II', 'III', 'IV', 'V']

/*
 * ONE DEVICE PER CATEGORY, FIVE STATES OF IT.
 *
 * Each path is drawn in a 24×24 box on a 2-unit stroke. They share a centre
 * and a weight so that a raffle changing category changes the picture and not
 * the card's texture.
 */
const SHELTER = [
  /* a doorway — the way in, before anybody is inside */
  'M9 21V10a3 3 0 0 1 6 0v11',
  /* the house itself */
  'M4 20v-9l8-6 8 6v9z',
  /* and its roof drawn over it */
  'M3 11l9-7 9 7M5 20v-8h14v8z',
  /* windows lit */
  'M3 11l9-7 9 7M5 20v-8h14v8zM9 13h2v2H9zM13 13h2v2h-2z',
  /* an arm round it */
  'M4 12l8-6 8 6M6 20v-7h12v7zM2 20a10 7 0 0 1 20 0',
]

const LEARNING = [
  /* a single leaf */
  'M7 4h10v16H7z',
  /* opened */
  'M12 6v14M12 6a7 4 0 0 0-8-1v13a7 4 0 0 1 8 1M12 6a7 4 0 0 1 8-1v13a7 4 0 0 0-8 1',
  /* and kept */
  'M12 6v14M12 6a7 4 0 0 0-8-1v13a7 4 0 0 1 8 1M12 6a7 4 0 0 1 8-1v13a7 4 0 0 0-8 1M16 4v7l2-2 2 2V4',
  /* more than one */
  'M4 8h11v12H4zM7 5h11v3M20 8v12h-5',
  /* and read by somebody */
  'M12 8v12M12 8a6 3 0 0 0-7-1v11a6 3 0 0 1 7 1M12 8a6 3 0 0 1 7-1v11a6 3 0 0 0-7 1M12 5V2M7 5L5 3M17 5l2-2',
]

const COMMUNITY = [
  /* one person */
  'M12 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 21v-3a6 6 0 0 1 12 0v3',
  /* two */
  'M9 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3 21v-3a6 6 0 0 1 12 0v3M17 6a2 2 0 1 0 0-4M21 21v-3a5 5 0 0 0-3-4',
  /* three */
  'M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6M7 20v-2a5 5 0 0 1 10 0v2M4 11a2 2 0 1 0 0-4M2 20v-2a4 4 0 0 1 2-3M20 11a2 2 0 1 0 0-4M22 20v-2a4 4 0 0 0-2-3',
  /* a circle of them */
  'M12 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4M19 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4M17 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4M7 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4M5 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  /* with something in the middle */
  'M12 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4M20 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4M17 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4M4 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4M12 11a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
]

const FELLOWSHIP = [
  /* a lit candle */
  'M12 21v-9M12 12a2 3 0 0 0 0-6 2 3 0 0 0 0 6M9 21h6',
  /* an arch */
  'M5 21V11a7 7 0 0 1 14 0v10z',
  /* an arch with a cross over it */
  'M6 21V12a6 6 0 0 1 12 0v9zM12 4V1M10 2h4',
  /* two, side by side */
  'M3 21v-7a4 4 0 0 1 8 0v7zM13 21v-7a4 4 0 0 1 8 0v7zM12 8V5M10 6h4',
  /* and light out of it */
  'M6 21V13a6 6 0 0 1 12 0v8zM12 5V2M6 7L4 5M18 7l2-2M3 12H1M23 12h-2',
]

/**
 * THE CATEGORIES, and the words they are the pictures for.
 *
 * `preset` is the id of the rung preset in _shared/ranks.ts that this category
 * belongs with — the only tie between the two files, and it is a string rather
 * than an import because this file must stay importable by the card renderer
 * without dragging a server module onto a page.
 *
 * `watermark` is the big faint device behind the card, which is always the
 * category's own fifth state: the fullest version of the thing, ghosted.
 */
export const CARD_CATEGORIES = [
  { id: 'shelter', preset: 'shelter', name: 'Shelter',
    what: 'a house, gaining its roof, its windows and an arm round it',
    rungs: SHELTER, watermark: SHELTER[4] },
  { id: 'learning', preset: 'learning', name: 'Learning centre',
    what: 'a book, opened, kept, stacked and read',
    rungs: LEARNING, watermark: LEARNING[4] },
  { id: 'community', preset: 'community', name: 'Community centre',
    what: 'one person, then more, then a circle with something in the middle',
    rungs: COMMUNITY, watermark: COMMUNITY[4] },
  { id: 'fellowship', preset: 'fellowship', name: 'Christian fellowship',
    what: 'a candle, an arch, a cross, two arches, and light out of it',
    rungs: FELLOWSHIP, watermark: FELLOWSHIP[4] },
]

/**
 * The category a card draws in, falling back to the first rather than to
 * nothing — a card with no device is a card with a hole in it, and an id this
 * bundle has never heard of is what a browser running yesterday's code sends.
 */
export function cardCategory(id) {
  const want = String(id ?? '').trim()
  return CARD_CATEGORIES.find((c) => c.id === want) || CARD_CATEGORIES[0]
}

/**
 * The device for one rung of one category.
 *
 * @param id     category id
 * @param slot   'rung1'…'rung5', or an index, or a Rank id from ranks.ts
 * @returns { path, numeral } — never null, because a band that resolved to
 *          nothing would draw an empty ring, which reads as a mistake rather
 *          than as an absence. A caller with no band draws no seal at all.
 */
export function rungBadge(id, slot) {
  const cat = cardCategory(id)
  const i = rungIndex(slot)
  return { path: cat.rungs[i], numeral: RUNG_NUMERAL[i] }
}

/**
 * WHICH RUNG, FROM WHATEVER THE CALLER HAS.
 *
 * The reply carries a Rank id, the studio has an index, and a preset has a
 * slot name. All three mean the same position and none of them is worth making
 * three call sites out of. Anything unrecognised is the bottom rung rather than
 * a throw: the worst outcome of guessing low is a modest picture on a generous
 * supporter's card, and the worst outcome of throwing is no card at all.
 */
export function rungIndex(slot) {
  if (typeof slot === 'number' && Number.isFinite(slot)) {
    return Math.max(0, Math.min(RUNGS.length - 1, Math.trunc(slot)))
  }
  const at = RUNGS.indexOf(String(slot ?? '').trim())
  return at < 0 ? 0 : at
}
