<script setup>
/**
 * WHICH PICTURE TO PUT ON THE TICKET.
 *
 * The pictures this raffle already has: its logo, from Setup, and every
 * artwork uploaded to this studio. Each is shown as itself — the choice is
 * between pictures, and a list of their names is a list somebody has to open
 * one by one (UI-STANDARD R4).
 *
 * WHY ONLY THESE. A placed picture is stored as the ADDRESS of something
 * already uploaded, never as its bytes: a design is JSON with a size limit,
 * and one photograph pasted in would be larger than everything else in it.
 * Uploading any picture from here needs a place on the server to put it,
 * which is its own piece of work (STUDIO-ESSENTIALS Phase 7) — so this offers
 * what is already stored, and says so.
 */
import Sheet from '../ui/Sheet.vue'

defineProps({
  /** [{ src, name, kind }] — kind is 'logo' or 'artwork'. */
  pictures: { type: Array, required: true },
})
const emit = defineEmits(['pick', 'close'])
</script>

<template>
  <Sheet title="Place a picture" subtitle="The raffle's logo and its uploaded artwork" wide @close="emit('close')">
    <div class="pics">
      <button v-for="p in pictures" :key="p.src" type="button" class="pic"
              :title="`Place ${p.name}, then draw where it goes`" @click="emit('pick', p.src)">
        <span class="frame"><img :src="p.src" alt="" loading="lazy"></span>
        <span class="pname">{{ p.name }}</span>
      </button>
    </div>
    <p class="say">Pick one, then draw its box on the ticket. A logo is fitted whole; change it in the panel.</p>
    <template #actions>
      <button class="btn ghost" type="button" @click="emit('close')">Cancel</button>
    </template>
  </Sheet>
</template>

<style scoped>
.pics { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: var(--sp-5) }
.pic {
  display: flex; flex-direction: column; gap: var(--sp-3); padding: var(--sp-4);
  border: var(--rule) solid var(--border); border-radius: var(--r-md);
  background: var(--surface); cursor: pointer; text-align: left;
}
.pic:hover { border-color: var(--brand) }
.pic:focus-visible { outline: 2px solid var(--brand); outline-offset: var(--rule) }
/* The picture on the paper colour, whatever the theme, because it will sit on
   a printed ticket and must be judged against paper, not a dark panel. */
.frame {
  display: grid; place-items: center; height: 96px; overflow: hidden;
  background: var(--paper); border-radius: var(--r-xs);
}
.frame img { max-width: 100%; max-height: 100%; object-fit: contain; display: block }
.pname { font-size: var(--fs-xs); color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.say { margin: var(--sp-5) 0 0; font-size: var(--fs-2xs); color: var(--muted) }
</style>
