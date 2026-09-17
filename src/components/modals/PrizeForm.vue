<script setup>
/**
 * Setting up a prize.
 *
 * WHAT THIS SCREEN IS FOR is describing an OFFER, not recording an event. Ten
 * consolation prizes are one prize with a quantity of ten, not ten entries —
 * an organiser saying "ten hampers" is describing one thing, and ten
 * near-identical rows is that sentence transcribed badly: renaming it means ten
 * edits, nine of which get forgotten.
 *
 * THE TWO FIELDS THAT LOOK LIKE ONE. The tier is the raffle term that gets read
 * out — Grand Prize, Second Prize, Consolation — and the name is the thing
 * itself. "Grand Prize — Toyota Hilux" is both; either alone leaves whoever is
 * announcing it guessing.
 *
 * WHY THE VALUE FIELD CHANGES SHAPE. A prize is worth a fixed amount, a share
 * of what has been collected, or nothing anybody has stated. Those need three
 * different questions, and asking "value?" for all three is how a donated
 * service with no agreed value ends up recorded as worth zero — which is a
 * valuation, not the absence of one.
 */
import { ref, computed, watch, onMounted } from 'vue'
import { state, api, toast, isSuper, drawChanged } from '../../lib/store.js'
import Sheet from '../ui/Sheet.vue'

const props = defineProps({ prize: Object })
const emit = defineEmits(['close', 'saved'])

const types = ref([])
const tier = ref('')
const name = ref('')
const description = ref('')
const typeId = ref('goods')
const value = ref('')
const quantity = ref(1)
const rank = ref(1)
const donor = ref('')
const active = ref(true)
const busy = ref(false)
const problem = ref('')
const addingType = ref(false)
const newTypeLabel = ref('')
const newTypeValuing = ref('fixed')

const currency = computed(() => state.cfg?.currency || '')
const editing = computed(() => !!props.prize?.prize_id)

/*
 * The raffle terms, offered rather than demanded. A list stops six organisers
 * inventing six spellings of "Consolation"; a free text box is still there
 * underneath because a raffle may perfectly well have a Best Dressed Prize.
 */
const TIERS = ['Grand Prize', 'Second Prize', 'Third Prize', 'Consolation Prize',
               'Early Bird Prize', 'Door Prize', 'Special Prize']

const chosenType = computed(() =>
  types.value.find(t => t.type_id === typeId.value) || {})
const valuing = computed(() => chosenType.value.valuing || 'fixed')

/** How many of this prize have already been given — it caps the quantity. */
const awarded = computed(() => Number(props.prize?.awarded || 0))

const canSave = computed(() =>
  !!tier.value.trim() && !!name.value.trim() && Number(quantity.value) >= 1 && !busy.value)

onMounted(async () => {
  if (props.prize) {
    tier.value = props.prize.tier || ''
    name.value = props.prize.name || ''
    description.value = props.prize.description || ''
    typeId.value = props.prize.type_id || 'goods'
    value.value = props.prize.value_amount ?? ''
    quantity.value = props.prize.quantity ?? 1
    rank.value = props.prize.rank ?? 1
    donor.value = props.prize.donor || ''
    active.value = props.prize.active !== false
  }
  try {
    const r = await api('list_prizes', {})
    types.value = (r.types || []).filter(t => t.active !== false)
    // Rank defaults below everything already on the board, so adding a prize
    // never silently displaces the Grand Prize from the top of it.
    if (!editing.value && r.prizes?.length) {
      rank.value = Math.max(...r.prizes.map(p => Number(p.rank) || 1)) + 1
    }
  } catch (err) { toast(err.message, 'bad', err.code) }
})

// A prize with nothing declared carries no figure at all, rather than a zero
// left behind in the box from before the type was changed.
watch(valuing, v => { if (v === 'none') value.value = '' })

async function save() {
  problem.value = ''
  busy.value = true
  try {
    const r = await api('upsert_prize', {
      prizeId: props.prize?.prize_id,
      tier: tier.value.trim(),
      name: name.value.trim(),
      description: description.value.trim(),
      typeId: typeId.value,
      value: valuing.value === 'none' ? 0 : Number(value.value || 0),
      quantity: Number(quantity.value),
      rank: Number(rank.value),
      donor: donor.value.trim(),
      active: active.value,
    })
    toast(`${r.tier} saved`, 'ok')
    drawChanged()
    emit('saved')
  } catch (err) {
    problem.value = explain(err)
  } finally { busy.value = false }
}

async function saveType() {
  if (!newTypeLabel.value.trim()) return
  busy.value = true
  try {
    const r = await api('upsert_prize_type', {
      label: newTypeLabel.value.trim(), valuing: newTypeValuing.value,
    })
    const listed = await api('list_prizes', {})
    types.value = (listed.types || []).filter(t => t.active !== false)
    typeId.value = r.typeId
    addingType.value = false
    newTypeLabel.value = ''
    toast(`${r.label} added`, 'ok')
  } catch (err) {
    problem.value = explain(err)
  } finally { busy.value = false }
}

async function remove() {
  problem.value = ''
  busy.value = true
  try {
    await api('remove_prize', { prizeId: props.prize.prize_id })
    toast(`${props.prize.tier} removed`, 'ok')
    drawChanged()
    emit('saved')
  } catch (err) {
    problem.value = explain(err)
  } finally { busy.value = false }
}

function explain(err) {
  switch (err.code) {
    case 'SUPER_ADMIN_ONLY':
      return err.message
    case 'NOT_FOUND':
      return 'That prize is no longer on the list.'
    default:
      return err.message
  }
}
</script>

<template>
  <Sheet :title="editing ? 'Change a prize' : 'Add a prize'"
         subtitle="What is on offer, how many of it, and what it is worth"
         @close="emit('close')">

    <div class="field">
      <label for="pt">What kind of prize is it? <span class="req">*</span></label>
      <input id="pt" v-model="tier" class="xl" list="prize-tiers"
             placeholder="e.g. Grand Prize" autocomplete="off">
      <datalist id="prize-tiers">
        <option v-for="t in TIERS" :key="t" :value="t"></option>
      </datalist>
      <p class="hint">The words that get read out on the night.</p>
    </div>

    <div class="field">
      <label for="pn">What is the prize? <span class="req">*</span></label>
      <input id="pn" v-model="name" class="xl" placeholder="e.g. Toyota Hilux"
             autocomplete="off">
      <p class="hint">The thing itself. It appears as “{{ tier || 'Grand Prize' }} — {{ name || 'Toyota Hilux' }}”.</p>
    </div>

    <div class="field">
      <label for="pq">How many of them? <span class="req">*</span></label>
      <input id="pq" v-model="quantity" class="xl" type="number" :min="Math.max(1, awarded)">
      <p v-if="awarded" class="hint">
        {{ awarded }} of these {{ awarded === 1 ? 'has' : 'have' }} already been given out,
        so this cannot go below {{ awarded }}.
      </p>
      <p v-else class="hint">Ten consolation prizes are one prize with ten of them, not ten prizes.</p>
    </div>

    <div class="field">
      <label for="py">What sort of thing is it?</label>
      <select id="py" v-model="typeId" class="xl">
        <option v-for="t in types" :key="t.type_id" :value="t.type_id">{{ t.label }}</option>
      </select>
      <button v-if="!addingType" class="btn sm" style="margin-top:8px"
              @click="addingType = true">Add another sort</button>
    </div>

    <!-- A new KIND of prize, without waiting for anybody to change the code. -->
    <div v-if="addingType" class="card" style="margin:0 0 14px">
      <div class="field">
        <label for="ntl">What is this sort of prize called?</label>
        <input id="ntl" v-model="newTypeLabel" placeholder="e.g. Experience day" autocomplete="off">
      </div>
      <div class="field">
        <label for="ntv">How is it valued?</label>
        <select id="ntv" v-model="newTypeValuing">
          <option value="fixed">A fixed amount of money</option>
          <option value="percent">A share of what is collected</option>
          <option value="none">Nothing stated</option>
        </select>
      </div>
      <div class="row" style="gap:8px">
        <button class="btn sm" @click="addingType = false">Cancel</button>
        <button class="btn sm primary" :disabled="!newTypeLabel.trim() || busy" @click="saveType">Add it</button>
      </div>
    </div>

    <!-- Three different questions, because they are three different things. -->
    <div v-if="valuing === 'fixed'" class="field">
      <label for="pv">What is one of them worth?</label>
      <input id="pv" v-model="value" class="xl" type="number" min="0" step="0.01"
             :placeholder="currency">
      <p class="hint">In {{ currency || 'the raffle’s currency' }}. Used for the prize board and the totals.</p>
    </div>

    <div v-else-if="valuing === 'percent'" class="field">
      <label for="pv">What share of the takings?</label>
      <input id="pv" v-model="value" class="xl" type="number" min="0" max="100" step="1"
             placeholder="50">
      <p class="hint">
        A percentage. The prize is not known until the selling stops, so it is worked
        out from the money actually handed in — never from what the tickets are worth.
      </p>
    </div>

    <div v-else class="note plain">
      Nothing is declared for this kind of prize. That is not the same as worth nothing:
      it will be left blank rather than counted as zero.
    </div>

    <div class="field">
      <label for="pr">Where does it come on the board?</label>
      <input id="pr" v-model="rank" class="xl" type="number" min="1">
      <p class="hint">
        1 is the Grand Prize. This is the order the board is read in — the draw itself
        usually runs the other way, consolation first, so the room is still there for
        the big one.
      </p>
    </div>

    <div class="field">
      <label for="pd">Who gave it?</label>
      <input id="pd" v-model="donor" placeholder="e.g. Hlaing Motors" autocomplete="off">
      <p class="hint">Optional. For the thank-you list.</p>
    </div>

    <div class="field">
      <label for="pdesc">Anything else about it?</label>
      <input id="pdesc" v-model="description" placeholder="Optional" autocomplete="off">
    </div>

    <label v-if="editing" class="check">
      <input type="checkbox" v-model="active">
      <span>Still being offered</span>
    </label>

    <div v-if="problem" class="note bad">{{ problem }}</div>

    <template #actions>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button v-if="editing && !awarded" class="btn danger" :disabled="busy" @click="remove">
        Remove
      </button>
      <button class="btn primary" :disabled="!canSave" @click="save">
        {{ busy ? 'Saving…' : 'Save' }}
      </button>
    </template>
  </Sheet>
</template>

<style scoped>
.note.plain { background: var(--surface-2); color: var(--muted); }
.check { display: flex; align-items: center; gap: 10px; margin: 4px 0 14px; }
</style>
