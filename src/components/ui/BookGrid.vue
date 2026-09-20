<script setup>
/**
 * The whole raffle as coloured squares.
 *
 * Six hundred rows in a table tell you nothing. Six hundred squares tell you at
 * a glance how much stock is still in the office and who is sitting on it.
 *
 * TWO THINGS ABOUT A BOOK, AND THE COLOUR ONLY EVER CARRIED ONE. Where the
 * paper is — office, seller, brought back, finished — is what the colour says,
 * and that is right: it is the question the grid exists for. What it could not
 * say is whether anything in the book has SOLD, and those are independent. A
 * book can come back with every ticket sold or with none, and until now both
 * drew the same brown square.
 *
 * That was reported the way such things always are: somebody sold a whole book,
 * looked at this grid, and saw nothing change. Nothing was broken — the sale was
 * recorded, the ticket list showed it, the book's own panel showed 10 of 10 —
 * and the one screen that shows the whole raffle had no way to draw it. A
 * screen that cannot show a thing that happened is indistinguishable from a
 * screen that did not hear about it.
 *
 * So the colour stays custody and the SALES are a mark on top: a ticked seal in
 * the corner when every ticket in the book has gone, a dot when some have. A
 * second colour scale would have meant choosing which of the two questions the
 * grid answers, and losing the other — which is exactly what happened the once
 * it was tried, and why the mark came back to the corner.
 */
import { computed } from 'vue'
import { bookShort, BOOK_WORDS } from '../../lib/format.js'
import { custodyOf } from '../../lib/books.js'
import Bi from './Bi.vue'

const props = defineProps({
  books: { type: Array, default: () => [] },
  limit: Number,
  /*
   * SELECTION IS OPT-IN, and that is what makes it safe to add.
   *
   * Left alone, a click opens the book exactly as it always has — which is what
   * Home wants, because a tile there is a shortcut into one book and nothing
   * else. The Books screen turns it on: a click there PICKS the book and raises
   * a bar naming it, so the things you can do to a book sit next to the book
   * rather than in a card of six buttons that has no idea which one you meant.
   *
   * Two emits rather than one flag on a shared emit, so a listener cannot be
   * wired to the wrong intention by accident.
   */
  selectable: Boolean,
  selected: { type: String, default: '' },
})
const emit = defineEmits(['pick', 'more', 'select'])

const shown = computed(() => props.limit ? props.books.slice(0, props.limit) : props.books)
const remaining = computed(() => props.limit ? Math.max(0, props.books.length - props.limit) : 0)

function label(b) {
  const bits = [b.book, BOOK_WORDS[b.status] || b.status]
  /*
   * Through custodyOf, so a tile and the sheet behind it answer this the same
   * way. It read b.agentName, which the ledger view joins on held_by_agent —
   * empty for an Offered book — so hovering an offered tile said "Book-009 ·
   * Waiting to be accepted" and stopped, exactly as the sheet did.
   *
   * CALLED WITHOUT THE AGENTS MAP, deliberately. This is a ui/ component that
   * takes its books as a prop and has no other business with global state;
   * importing the store to resolve a name coupled it to one and broke every
   * harness that renders it against a stub. So an offered tile names the seller
   * by id where the sheet names them in full — a tooltip is a hint and the sheet
   * is the answer, and tapping the tile is what opens it.
   */
  const who = custodyOf(b)
  if (who.has) bits.push(who.name)
  if (b.sold) bits.push(b.sold + ' of ' + (b.sold + (b.available ?? 0)) + ' sold')
  if (b.daysOverdue > 0) bits.push(b.daysOverdue + ' days late')
  return bits.join(' · ')
}

/**
 * How much of this book has gone: 'all', 'some', or nothing.
 *
 * `available` is what is left to sell in it, which is the only honest way to
 * ask "is it finished" — a book at the end of a part-released run holds fewer
 * than TICKETS_PER_BOOK, and counting against the setting would draw it as sold
 * out while four tickets were still in somebody's hand.
 *
 * A book with nothing sold and nothing available has not been released yet; it
 * gets no mark, because "sold out" and "not printed" must not look the same.
 */
function sales(b) {
  const sold = Number(b.sold ?? 0)
  if (!sold) return ''
  return Number(b.available ?? 0) > 0 ? 'some' : 'all'
}
</script>

<template>
  <div>
    <div class="grid">
      <button v-for="b in shown" :key="b.book"
              :class="['bk', 's-' + b.status, sales(b) && 'sold-' + sales(b),
                       { late: b.daysOverdue > 0, on: selectable && selected === b.book }]"
              :aria-pressed="selectable ? String(selected === b.book) : undefined"
              :title="label(b)"
              @click="emit(selectable ? 'select' : 'pick', b)">
        {{ bookShort(b.book) }}
      </button>
      <button v-if="remaining" class="bk more" @click="emit('more')" :title="remaining + ' more'">
        +{{ remaining }}
      </button>
    </div>
    <div class="keys">
      <span><i class="s-Unassigned"></i><Bi text="In the office" /></span>
      <span><i class="s-Offered"></i><Bi text="Waiting to be accepted" /></span>
      <span><i class="s-Out"></i><Bi text="With a seller" /></span>
      <span><i class="s-Returned"></i><Bi text="Brought back" /></span>
      <span><i class="s-Settled"></i><Bi text="Finished" /></span>
      <span><i class="s-Lost"></i><Bi text="Lost" /></span>
      <span><i class="late-key"></i><Bi text="Late" /></span>
      <span><i class="s-Returned sold-all"></i><Bi text="Every ticket sold" /></span>
      <span><i class="s-Returned sold-some"></i><Bi text="Some sold" /></span>
    </div>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(40px, 1fr)); gap: 5px; }
/*
 * THE CHOSEN TILE, marked with a ring OUTSIDE its own edge rather than by
 * changing its colour. The colour of a tile is its custody — the one thing this
 * grid exists to say — so selection cannot be allowed to borrow it. An offset
 * outline sits in the gap between tiles and reads at a glance without touching
 * what the square already means.
 */
.bk.on { outline: 3px solid var(--text); outline-offset: 2px; z-index: 1; }
.bk {
  aspect-ratio: 1; border: 0; border-radius: 7px; padding: 0;
  position: relative; --seal: 13px;
  display: grid; place-items: center; cursor: pointer;
  font-size: .68rem; font-weight: 700; color: #fff;
  /* The tile IS its number — six hundred of them read as a sequence, and a
     proportional face makes 111 narrower than 000 in a grid of equal squares. */
  font-family: var(--font-data);
  transition: transform .12s var(--ease), box-shadow .12s;
}
.bk:hover { transform: scale(1.22); z-index: 2; box-shadow: var(--shadow); }
.bk:active { transform: scale(1.05); }

/* Each custody state names its own colour, so the sold-out rule below can
   borrow it for the edge instead of repeating this list. */
.s-Unassigned { --custody: var(--border); background: var(--surface-2); color: var(--muted); box-shadow: inset 0 0 0 1px var(--border); }
/*
 * OFFERED IS THE OUT COLOUR, HOLLOW. A book being offered is on its way to that
 * seller and is not there yet, so it reads as the same custody with the fill
 * taken out — the dashes say "not settled" without inventing a seventh hue that
 * would be read as a seventh place a book can be.
 *
 * It had no style at all before this, so it fell through to the bare tile and
 * rendered as a washed-out blank: the one state that needed to stand out was
 * the only one that disappeared.
 */
/*
 * THE FIVE COLOURS ARE TOKENS NOW, declared in style.css. They were bare hexes
 * here, which meant the grid that shows the whole raffle never followed dark
 * mode — a daylight palette on a dark screen — and "with a seller" was a stock
 * blue that appeared nowhere else in the product. Each state still names its
 * colour exactly once, so the sales mark can borrow it.
 */
.s-Offered    { --custody: var(--custody-out); color: var(--custody-out); font-weight: 800;
                background: color-mix(in srgb, var(--custody-out) 18%, transparent);
                box-shadow: inset 0 0 0 2px var(--custody); }
.s-Out        { --custody: var(--custody-out); background: var(--custody); }
.s-Returned   { --custody: var(--custody-back); background: var(--custody); }
.s-Settled    { --custody: var(--custody-done); background: var(--custody); }
.s-Lost       { --custody: var(--custody-lost); background: var(--custody); }
.s-Void       { --custody: var(--custody-void); background: var(--custody); }
.more         { background: var(--brand-soft); color: var(--brand); }
.late { outline: 2.5px solid var(--bad); outline-offset: -2.5px; }

/*
 * THE SALES, DRAWN ON TOP OF THE CUSTODY COLOUR.
 *
 * A solid white band along the bottom for a book with nothing left in it, a
 * corner dot for one part sold. White rather than a colour of its own: every
 * custody colour in this grid is already a hue, and a seventh would be read as
 * a seventh place a book can be. A band is not a place, which is the point.
 *
 * IT WAS A THIN RING AND IT DID NOT READ. Reported twice, looking at Book-003 —
 * "same colour on the grid" — and the reporter was right in the only way that
 * counts: the mark was rendering correctly and nobody could see it. A 2px white
 * outline sits a few pixels from a rounded edge and competes with the bold
 * white numeral already in the middle of the tile, so it reads as part of the
 * text's noise rather than as a separate fact. A mark you have to be told to
 * look for is the same as no mark.
 *
 * The band is a contiguous shape with nothing else near it, and it makes the
 * progression from the part-sold dot obvious: a dot is some, a full bar is all.
 *
 * Drawn INSIDE the square, never as a border — these sit in a dense grid and a
 * border would shift every tile around it by a pixel, which reads as the grid
 * jittering when a sale lands.
 */
/*
 * A SEAL, WHICH IS THE FOURTH FORM THIS MARK HAS TAKEN.
 *
 * A 2px white ring, a solid white band, then a violet fill. The first two could
 * not be seen at all. The third could — and it cost the thing the grid is for:
 * with the fill spent on sales, custody had to move to the edge, so a sold-out
 * book that was finished drew as violet ringed in green. Somebody looking at
 * the real screen called it ugly, and they were describing a real fault rather
 * than a taste. Two full-strength hues on one 40px tile is a tile arguing with
 * itself, and a reader has to decode which half means what before they can read
 * either.
 *
 * SO THE FILL GOES BACK TO CUSTODY, where it was always legible, and the sales
 * become a seal in the corner: a white disc with a tick struck through it in
 * the tile's own colour. That fixes what killed the ring and the band without
 * spending the fill. Those failed because they were HAIRLINES — 2px of white a
 * few pixels from a rounded edge, competing with the bold numeral in the middle
 * of the tile. A disc is a solid shape with area, it sits in a corner where
 * nothing else is drawn, and it carries its own contrast in both directions:
 * white against every custody colour, and the custody colour again inside it.
 *
 * A tick is also the one mark nobody has to be taught. The legend still names
 * it, but a reader who never looks at the legend will read a ticked book as a
 * finished one, which is exactly what it is.
 *
 * Drawn INSIDE the square, never as a border — these sit in a dense grid and a
 * border would shift every tile around it by a pixel, which reads as the grid
 * jittering when a sale lands. Sized from --seal so the legend swatch can wear
 * a smaller copy of the same mark rather than an approximation of it.
 */
.bk.sold-all::after {
  content: ''; position: absolute; right: 2px; bottom: 2px;
  width: var(--seal); height: var(--seal); border-radius: 50%;
  background: #fff;
  /* A halo in the tile's own colour, because a book number is three digits and
     the seal sits on top of the last one. Without it the disc and the numeral
     collide and both get harder to read; with it the seal reads as sitting
     above the tile and the digit passes behind. */
  box-shadow: 0 0 0 2px var(--custody, #fff), 0 1px 2px rgba(0, 0, 0, .3);
}
/* The tick, centred on the disc and nudged down the way a handwritten one sits. */
.bk.sold-all::before {
  content: ''; position: absolute; z-index: 1;
  right: calc(2px + var(--seal) / 2 - var(--seal) * .11);
  bottom: calc(2px + var(--seal) / 2 - var(--seal) * .18);
  width: calc(var(--seal) * .22); height: calc(var(--seal) * .44);
  border: solid var(--custody, #333);
  border-width: 0 calc(var(--seal) * .13) calc(var(--seal) * .13) 0;
  transform: rotate(45deg);
}
.bk.sold-some::after {
  content: ''; position: absolute; right: 4px; bottom: 4px;
  width: 7px; height: 7px; border-radius: 50%;
  background: rgba(255, 255, 255, .9);
}
/*
 * The office tile is pale, so a white disc on it is invisible and a white dot
 * is too. Both marks invert there — and they invert through TOKENS rather than
 * a literal, because in dark mode --muted is the light one. A hardcoded white
 * tick would be a white tick on a light grey disc after dusk.
 */
.bk.s-Unassigned.sold-all::after { background: var(--muted); box-shadow: 0 0 0 2px var(--surface-2); }
.bk.s-Unassigned.sold-all::before { border-color: var(--surface-2); }
.bk.s-Unassigned.sold-some::after { background: var(--muted); }

/* The legend wears the same mark, smaller, rather than a drawing of it. */
.keys i.sold-all { position: relative; --seal: 9px; }
.keys i.sold-all::after {
  content: ''; position: absolute; right: 1px; bottom: 1px;
  width: var(--seal); height: var(--seal); border-radius: 50%;
  background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, .35);
}
.keys i.sold-all::before {
  content: ''; position: absolute; z-index: 1;
  right: calc(1px + var(--seal) / 2 - var(--seal) * .11);
  bottom: calc(1px + var(--seal) / 2 - var(--seal) * .18);
  width: calc(var(--seal) * .22); height: calc(var(--seal) * .44);
  border: solid var(--custody, #333);
  border-width: 0 calc(var(--seal) * .14) calc(var(--seal) * .14) 0;
  transform: rotate(45deg);
}
.keys i.sold-some { position: relative; }
.keys i.sold-some::after {
  content: ''; position: absolute; right: 1px; bottom: 1px;
  width: 4px; height: 4px; border-radius: 50%; background: rgba(255, 255, 255, .9);
}

.keys { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 14px;
  font-size: .85rem; color: var(--muted); }
.keys span { display: flex; align-items: center; gap: 6px; }
.keys :deep(.bi) { line-height: 1.2; }
.keys i { width: 13px; height: 13px; border-radius: 4px; display: inline-block; }
.keys i.late-key { outline: 2.5px solid var(--bad); outline-offset: -2.5px; background: transparent; }
</style>
