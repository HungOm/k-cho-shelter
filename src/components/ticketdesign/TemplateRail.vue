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
import { ref } from 'vue'

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

/* The hidden input the button opens. It moved here with the markup that uses
 * it — a ref to a node the parent no longer renders is a handle to somebody
 * else's DOM. */
const fileInput = ref(null)

/* Bytes as a person reads them, on the tooltip beside each template. */
const kb = (n) => (n >= 1024 * 1024
  ? `${Math.round(n / 1024 / 1024 * 10) / 10} MB`
  : `${Math.round(n / 1024)} KB`)

/* The event carries the File, not the input. */
function onPick(e) {
  const file = e?.target?.files?.[0]
  if (file) emit('file', e)
}
</script>

<template>
<aside class="rail">
  <div class="block grow">
    <h3 class="rubric">Templates <span class="count">{{ templates.length }}</span></h3>
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
          <img :src="t.url" :alt="t.name" loading="lazy">
          <span v-if="t.id === activeId" class="pill ok">printing</span>
        </div>
        <b class="tname">{{ t.name }}</b>
        <div class="trow">
          <button v-if="t.id !== activeId" class="btn sm" :disabled="busy"
                  @click="emit('choose', t.id)">Print from this one</button>
          <button class="btn sm ghost" :disabled="busy" @click="emit('remove', t.id)">Remove</button>
        </div>
      </li>
    </ul>
    <p v-if="!templates.length" class="tiny muted">
      Nothing uploaded yet, so tickets cannot be printed.
    </p>
  </div>

  <div class="block">
    <button class="btn sm primary wide" :disabled="busy" @click="fileInput?.click()">
      {{ busy ? 'Working…' : 'Upload new artwork' }}
    </button>
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
.blankstart { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
.blankstart p { width: 100%; margin: 0 0 2px; }
.tlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px }
/* Stranded in TicketDesign.vue when this file took the markup: a child's
 * markup does not inherit a parent's scoped styles, so these have been inert
 * since the extraction. Same cause as the verdict's status dot (3a70895). The
 * dead copies remain in the parent for whoever holds it next. */
.tlist p { margin: 0 }
.tlist li { border: 1px solid var(--border); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 3px }
.tlist li.on { border-color: var(--brand); background: var(--brand-soft) }
.tthumb {
  position: relative; display: block; width: 100%; aspect-ratio: 1600 / 517;
  border: 1px solid var(--border); border-radius: var(--r-sm);
  overflow: hidden; background: var(--surface-2);
}
.tthumb img { display: block; width: 100%; height: 100%; object-fit: cover }
.tthumb .pill { position: absolute; left: 6px; top: 6px }
.tname { display: block; margin: 6px 0 4px; font-size: .9rem; line-height: 1.25 }
.trow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap }
.block { display: flex; flex-direction: column; gap: 8px }
.count { float: right; font-variant-numeric: tabular-nums; letter-spacing: 0 }
</style>
