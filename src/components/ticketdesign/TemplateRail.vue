<script setup>
/**
 * THE ARTWORK THIS RAFFLE HAS, AND THE ONE IT PRINTS FROM.
 *
 * A template is recognised by its picture, so the picture is the control.
 * This was five lines of prose per template — name, pixels, kilobytes, date,
 * uploader — in a list whose whole job is "which of these is the ticket I
 * mean". The paperwork is on the tooltip, where it is still there for
 * whoever needs to check a file size before sending it to a printer.
 *
 * THE FILE INPUT LIVES HERE AND THE PARENT NEVER SEES A DOM NODE. It emits
 * the File somebody chose. The alternative — a ref passed down so the parent
 * can call .click() — makes the parent hold a handle to markup it no longer
 * owns, which is the coupling this split exists to remove.
 *
 * Uploading, choosing and removing are all the parent's: they call the
 * server and change which artwork the raffle prints from. This component
 * decides nothing, which is why it takes no design and no store.
 */
import { computed, ref } from 'vue'
import Icon from '../ui/Icon.vue'
import ToolButton from '../ui/ToolButton.vue'
import Section from './Section.vue'

const props = defineProps({
  templates: { type: Array, default: () => [] },
  activeId: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  note: { type: String, default: '' },
  /*
   * The ticket shapes this raffle accepts. They are already the list an upload
   * is validated against, so they are exactly the sizes a blank ticket may be
   * started at — offering anything else would produce a picture the uploader
   * then refuses.
   */
  sizes: { type: Array, default: () => [] },
})
const emit = defineEmits(['choose', 'remove', 'file', 'blank'])

/*
 * THE CEILING, SHOWN BEFORE IT IS HIT AND NOT ONLY WHEN IT REFUSES.
 *
 * `templates.ts` holds the real one — this number is a copy, so that the count
 * can read "3 of 4" while there is still room and the upload can be disabled
 * WITH ITS REASON rather than accepting a 4 MB file and refusing it after the
 * wait (R8, and permissionui's rule: disabled with the reason, never hidden,
 * never enabled-then-refused). templates.test.mjs pins the two together, which
 * is the only thing that keeps a duplicated constant honest.
 */
const MAX = 4
const full = computed(() => props.templates.length >= MAX)
const whyNoUpload = computed(() => {
  if (props.busy) return 'Working on the last one.'
  if (!full.value) return ''
  /* Short, because the count beside the heading has already said "4 of 4" and
     the server's own refusal carries the long form. Three lines of amber under
     a disabled button is the text bulk this screen is being cleared of. */
  return `${MAX} is the limit. Remove one to make room.`
})

/* The hidden input the button opens. It moved here with the markup that uses
 * it — a ref to a node the parent no longer renders is a handle to somebody
 * else's DOM. */
const fileInput = ref(null)

/* Bytes as a person reads them, on the tooltip beside each template. */
const kb = (n) => (n >= 1024 * 1024
  ? `${Math.round(n / 1024 / 1024 * 10) / 10} MB`
  : `${Math.round(n / 1024)} KB`)

/*
 * NAMING IS A STEP, NOT A BY-PRODUCT OF A FILENAME.
 *
 * The rail used to send `file.name` straight through, so the list read
 * "CEAM SHELTER Raffle Ticket Final draft 001 png" — whatever the export
 * dialog on somebody's computer happened to write, extension and all. That is
 * not a name; it is a filesystem's opinion, and it is the only thing a person
 * scanning this list has to tell two drafts apart by.
 *
 * The interaction is LibraryPanel's: a picture is chosen, a field opens for
 * the one thing that needs a word, Enter or Save confirms it. Two components
 * asking "keep this, and what do you call it" now ask it the same way.
 *
 * THE DEFAULT IS THE FILENAME, CLEANED — the extension dropped and separators
 * turned to spaces — because most uploads are not worth typing a name for and
 * the field is there for the one that is. Nothing is uploaded until this is
 * confirmed, so choosing the wrong file and cancelling costs nothing: the
 * input is reset so the SAME file can be chosen again.
 */
const pending = ref(null)
const name = ref('')

function onPick(e) {
  const file = e?.target?.files?.[0]
  e.target.value = ''
  if (!file) return
  pending.value = file
  name.value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
}
function cancelName() {
  pending.value = null
  name.value = ''
}
function confirmName() {
  if (!pending.value) return
  emit('file', { file: pending.value, name: name.value.trim() })
  pending.value = null
  name.value = ''
}
</script>

<template>
<aside class="rail">
  <div class="block grow">
    <!-- "2 of 4" rather than "2": a bare number answers how many there are,
         which nobody is asking. The question an artwork rail gets asked is
         whether another one will fit. -->
    <Section label="Templates" :count="`${templates.length} of ${MAX}`" />
    <ul class="tlist">
      <li v-for="t in templates" :key="t.id" :class="{ on: t.id === activeId }">
        <!--
          A PICTURE OF THE ARTWORK, NOT A DESCRIPTION OF IT. This was
          five lines of prose per template — name, pixels, kilobytes,
          date, uploader — in a list whose whole job is "which of these
          is the ticket I mean". A thumbnail answers that in one glance
          and the paperwork moves to the tooltip, where it is still
          there for whoever needs to check a file size.
        -->
        <div class="tthumb" :title="`${t.width} × ${t.height} px · ${kb(t.bytes)}`
               + (t.uploadedAt ? ` · uploaded ${String(t.uploadedAt).slice(0, 10)}` : '')
               + (t.uploadedBy ? ` by ${t.uploadedBy}` : '')">
          <!--
            GUARDED, BECAUSE AN EMPTY src IS NOT AN ABSENT ONE. `url` is
            `text not null default ''` in the schema and the server sends
            `String(r.url ?? '')`, so a row may legitimately carry a blank.
            `<img src="">` resolves against the page and draws the browser's
            BROKEN-IMAGE mark — the one state that looks like a bug in the
            artwork rather than a template without a picture.
          -->
          <img v-if="t.url" :src="t.url" :alt="t.name" loading="lazy">
          <span v-else class="nopic">no preview</span>
          <span v-if="t.id === activeId" class="pill ok">printing</span>
        </div>
        <b class="tname">{{ t.name }}</b>
        <!--
          THE WORDS SHRANK BECAUSE THE PICTURE ABOVE ALREADY SAID WHICH ONE.
          "Print from this one" names the template it sits under, which the
          thumbnail has already answered; the verb is the only part that was
          doing work. Remove has no word at all — it is the same icon-only
          control the layer list and the library use.
        -->
        <div class="trow">
          <button v-if="t.id !== activeId" class="btn sm" :disabled="busy"
                  :title="`Print tickets from ${t.name}`" @click="emit('choose', t.id)">
            <Icon name="print" :size="15" />Print from this
          </button>
          <ToolButton icon="trash" :label="`Remove ${t.name}`" :size="14" :disabled="busy"
                      hint="Takes the artwork out of the raffle. Tickets already printed are unaffected."
                      @click="emit('remove', t.id)" />
        </div>
      </li>
    </ul>
    <p v-if="!templates.length" class="tiny muted">
      Nothing uploaded yet, so tickets cannot be printed.
    </p>
  </div>

  <div class="block">
    <!-- NAMING IS THE ONE THING HERE THAT NEEDS A WORD, the same rule
         LibraryPanel's save uses: everything else is a click on a picture of
         itself, or in this case a click on a file dialog. -->
    <template v-if="pending">
      <input v-model="name" maxlength="60" placeholder="Call it something"
             @keyup.enter="confirmName" @keyup.esc="cancelName">
      <div class="row">
        <button class="btn sm ghost" @click="cancelName">Cancel</button>
        <button class="btn sm primary" :disabled="busy" @click="confirmName">
          <Icon name="upload" :size="15" />{{ busy ? 'Working…' : 'Save' }}
        </button>
      </div>
    </template>
    <template v-else>
      <button class="btn sm primary wide" :disabled="!!whyNoUpload"
              :title="whyNoUpload || 'Add another ticket picture to this raffle'"
              @click="fileInput?.click()">
        <Icon name="upload" :size="15" />Upload new artwork
      </button>
      <!-- The reason is on the button for a pointer and repeated here for a
           keyboard or a phone, which never see a `title`. It only appears when
           the control is actually dead, so it costs a line at the ceiling and
           nothing the rest of the time. -->
      <p v-if="full" class="tiny warn">{{ whyNoUpload }}</p>
    </template>
    <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp"
           :disabled="busy" @change="onPick" hidden>
    <!--
      THE SECOND ROUTE IN, and the one that was missing entirely.

      The studio places fields onto a picture, so a raffle whose artwork has not
      arrived could not begin: this panel offered an upload and nothing else,
      and the rest of the screen waits on a template existing. "Draw the ticket
      now, get the artwork later" was not a route the product had.

      What it makes is a REAL PNG at the chosen size, with a trim edge and the
      stub's perforation on it, sent through the same upload as any other
      picture — so nothing downstream knows it was generated, and artwork can
      replace it later without anything being unpicked.

      Only the sizes this raffle accepts are offered. Anything else would be
      drawn and then refused by the same check that guards an upload.
    -->
    <div v-if="sizes.length" class="blankstart">
      <p class="say">or start from a blank ticket</p>
      <button v-for="(sz, i) in sizes" :key="i" type="button"
              class="btn sm" :disabled="busy"
              :title="`A blank ${sz.label} ticket, with the trim edge and the stub's perforation drawn on it`"
              @click="emit('blank', sz)">
        {{ sz.label }}
      </button>
    </div>

    <p class="say"
       title="One blank ticket with its stub. SVG is refused, and the size is read from the file's own header — renaming a file will not get it past.">
      PNG, JPEG or WebP · up to 4 MB
    </p>
    <p v-if="error" class="note bad tiny">{{ error }}</p>
    <p v-if="note" class="note tiny">{{ note }}</p>
  </div>
</aside>
</template>

<style scoped src="./studio.css"></style>

<style scoped>
/* The second route sits under the first and reads as an alternative to it, not
   as a row of settings: one quiet sentence, then the sizes as things to press. */
.blankstart { margin-top: var(--sp-5); display: flex; flex-wrap: wrap; gap: var(--sp-3); }
.blankstart p { width: 100%; margin: 0 0 var(--sp-1); }
.tlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-5) }
/* Stranded in TicketDesign.vue when this file took the markup: a child's
 * markup does not inherit a parent's scoped styles, so these have been inert
 * since the extraction. Same cause as the verdict's status dot (3a70895). The
 * dead copies remain in the parent for whoever holds it next. */
.tlist p { margin: 0 }
.tlist li {
  border: var(--rule) solid var(--border); border-radius: var(--r-md);
  padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-1);
}
.tlist li.on { border-color: var(--brand); background: var(--brand-soft) }
.tthumb {
  position: relative; display: block; width: 100%; aspect-ratio: 1600 / 517;
  border: var(--rule) solid var(--border); border-radius: var(--r-sm);
  overflow: hidden; background: var(--surface-2);
}
.tthumb img { display: block; width: 100%; height: 100%; object-fit: cover }
/* Says which of the two silent states this is — a template with no picture,
   not an artwork rail that has broken. Quiet, because it is a fact about the
   row rather than something to act on. */
.nopic {
  display: flex; align-items: center; justify-content: center; height: 100%;
  font-size: var(--fs-3xs); color: var(--muted);
}
.tthumb .pill { position: absolute; left: 6px; top: 6px }
.tname { display: block; margin: var(--sp-3) 0 var(--sp-2); font-size: var(--fs-sm); line-height: 1.25 }
.trow { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap }
.block { display: flex; flex-direction: column; gap: var(--sp-4) }
.count { float: right; font-variant-numeric: tabular-nums; letter-spacing: 0 }
</style>
