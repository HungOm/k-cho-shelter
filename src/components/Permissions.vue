<script setup>
/**
 * Who is allowed to do what.
 *
 * On a phone this is a role at a time — "what can a Helper do?" — because a
 * four-by-thirty grid is unusable with a thumb, and picking the person first
 * is how anyone actually thinks about it. A wide screen gets the full matrix.
 *
 * Everything here is a convenience. The server decides again on every request,
 * so a toggle drawn wrongly costs a confusing screen, never access.
 */
import { ref, computed, onMounted } from 'vue'
import { api, toast, isSuper } from '../lib/store.js'
import { ROLE_WORDS, ROLE_BLURB } from '../lib/format.js'
import Empty from './ui/Empty.vue'


const data = ref(null)
const role = ref('recorder')
const saving = ref('')
const wide = ref(false)
/*
 * "Show only those" — the banner counts what differs from the normal setting,
 * and over thirty rows a count you cannot reach is a fact rather than a tool.
 * Off by default: the whole grid is the answer to "what can a Helper do", and
 * opening on a filtered view would answer a different question silently.
 */
const onlyChanged = ref(false)

onMounted(async () => {
  wide.value = window.matchMedia('(min-width: 900px)').matches
  await load()
})

async function load() {
  try {
    data.value = await api('list_permissions', {})
  } catch (err) {
    toast(err.message, 'bad', err.code)
    data.value = { roles: [], actions: [] }
  }
}

const groups = computed(() => {
  if (!data.value) return []
  const out = []
  for (const a of data.value.actions) {
    if (onlyChanged.value && !rowChanged(a)) continue
    let g = out.find(x => x.name === a.group)
    if (!g) { g = { name: a.group, actions: [] }; out.push(g) }
    g.actions.push(a)
  }
  return out
})

const changedCount = computed(() =>
  (data.value?.actions || []).filter(a =>
    data.value.roles.some(r => !a.sup && a.current[r] !== a.defaults[r])).length)

function locked(a, r) {
  return a.sup || (a.lockedFor || []).includes(r)
}
function changed(a, r) {
  return !a.sup && a.current[r] !== a.defaults[r]
}
/** Does this row differ from the normal setting for ANY kind of user? */
function rowChanged(a) {
  return (data.value?.roles || []).some(r => changed(a, r))
}

/*
 * WHY THIS SWITCH CANNOT BE PRESSED — the sentence, or '' when it can.
 *
 * `permissionui` is the rule: a control somebody cannot use is shown disabled
 * with the reason on it, never hidden and never enabled-then-refused. This
 * screen was the one place in the app that disabled a control and said nothing,
 * which is the half-compliance that looks fine to whoever can press it. A
 * viewer opening Access saw thirty dead switches and no statement anywhere that
 * they were dead on purpose.
 *
 * The order matters and is not alphabetical. It answers the most specific
 * question first: a locked action is locked for everybody including the System
 * Admin, so telling an ordinary helper "only the System Admin can change this"
 * would be false — the System Admin cannot change it either.
 */
function why(a, r) {
  if (a.sup) return 'System Admin only — this one cannot be given to another kind of user'
  if ((a.lockedFor || []).includes(r)) {
    return `Always allowed for ${ROLE_WORDS[r] || r} — turning it off would lock them out of their own screen`
  }
  if (!isSuper.value) return 'Only the System Admin can change what people may do'
  if (saving.value === a.action + ':' + r) return 'Saving\u2026'
  return ''
}

/*
 * And what it does when it CAN be pressed. A title that only appears on the
 * dead switches teaches people that a tooltip means "no", so the working ones
 * say what they would do — which the matrix needs anyway, because a bare switch
 * in a grid of four columns has no label of its own.
 */
function switchTitle(a, r) {
  const blocked = why(a, r)
  if (blocked) return blocked
  const verb = a.current[r] ? 'Turn off' : 'Turn on'
  return `${verb}: ${a.label} \u2014 for ${ROLE_WORDS[r] || r}`
}

async function toggle(a, r) {
  if (locked(a, r) || !isSuper.value) return
  const key = a.action + ':' + r
  const was = a.current[r]
  a.current[r] = !was            // optimistic; the screen reacts at once
  saving.value = key
  try {
    await api('set_permission', { action: a.action, role: r, allowed: !was })
  } catch (err) {
    a.current[r] = was           // put it back — the server said no
    toast(err.message, 'bad', err.code)
  } finally {
    saving.value = ''
  }
}
</script>

<template>
  <!-- Dense: an organiser screen, read many rows at a time at a desk. The class
       is half the switch; the other half is a >= 1024px media query in
       style.css, so this is an ordinary 17px screen with 52px targets on a
       phone. --tap is never overridden. -->
  <div class="dense">
    <h1>Who can do what</h1>
    <p class="muted">
      Turn any feature on or off for each kind of user. Changes take effect within a minute.
    </p>

    <div v-if="!isSuper" class="note warn">
      Only the System Admin can change these. You are seeing them as they stand.
    </div>

    <div v-if="!data" class="card"><div class="skel" style="height:40px"></div></div>

    <template v-else-if="data.actions.length">
      <!--
        WHAT DIFFERS, AND A WAY TO REACH IT. The count alone was a fact nobody
        could act on: thirty-odd rows across four columns, one of them changed,
        and no way to find it but reading. The filter is the other half of the
        sentence.

        The bar down the left rather than another tinted box, per the alert
        rule — this sits directly above a stack of cards and a fourth rounded
        rectangle in that stack reads as one more equal thing.
      -->
      <div v-if="changedCount" class="note info bar">
        <span class="grow">
          <b>{{ changedCount }}</b>
          {{ changedCount === 1 ? 'feature differs' : 'features differ' }}
          from the normal setting &mdash; marked below.
        </span>
        <button class="btn sm ghost" :class="{ on: onlyChanged }"
                :aria-pressed="onlyChanged"
                :title="onlyChanged
                  ? 'Show every feature again'
                  : 'Hide everything that is still set the normal way'"
                @click="onlyChanged = !onlyChanged">
          {{ onlyChanged ? 'Show all' : 'Show only those' }}
        </button>
      </div>

      <!-- phone: one role at a time -->
      <template v-if="!wide">
        <div class="rolepick">
          <button v-for="r in data.roles" :key="r"
                  :class="['rolebtn', { on: role === r }]" @click="role = r">
            <b>{{ ROLE_WORDS[r] || r }}</b>
            <small>{{ ROLE_BLURB[r] }}</small>
          </button>
        </div>

        <div v-for="g in groups" :key="g.name" class="card">
          <h3>{{ g.name }}</h3>
          <div v-for="a in g.actions" :key="a.action" class="line">
            <div class="grow">
              <span class="t">
                {{ a.label }}
                <span v-if="a.danger" class="pill bad">destroys data</span>
                <span v-if="changed(a, role)" class="pill info">changed</span>
              </span>
              <span v-if="a.sup" class="d">System Admin only — cannot be given away</span>
              <span v-else-if="(a.lockedFor || []).includes(role)" class="d">
                Always allowed — turning this off would lock everyone out
              </span>
            </div>
            <!-- Disabled with the reason on it, never hidden. `permissionui`. -->
            <button :class="['sw', { on: a.current[role], locked: locked(a, role) }]"
                    :disabled="locked(a, role) || !isSuper || saving === a.action + ':' + role"
                    :title="switchTitle(a, role)"
                    :aria-label="a.label" @click="toggle(a, role)">
              <i></i>
            </button>
          </div>
        </div>
      </template>

      <!-- desktop: the whole matrix -->
      <template v-else>
        <div v-for="g in groups" :key="g.name" class="card">
          <h3>{{ g.name }}</h3>
          <div class="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Feature</th>
                  <th v-for="r in data.roles" :key="r" class="rolecol">{{ ROLE_WORDS[r] || r }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="a in g.actions" :key="a.action">
                  <td>
                    {{ a.label }}
                    <span v-if="a.danger" class="pill bad">destroys data</span>
                    <span v-if="a.sup" class="pill">System Admin only</span>
                    <!--
                      THE MATRIX HAD THIS IN COLOUR ONLY. `.sw.moved` draws a
                      blue outline round the switch and nothing else, so on this
                      view "changed from the normal setting" was carried by a
                      2px ring — invisible to anyone who cannot separate it from
                      the teal, and invisible to everyone in a photograph of the
                      screen. The phone view has had the word since it was
                      written; this one is the copy that drifted.
                    -->
                    <span v-if="rowChanged(a)" class="pill info">changed</span>
                  </td>
                  <td v-for="r in data.roles" :key="r" class="rolecol">
                    <button :class="['sw', { on: a.current[r], locked: locked(a, r), moved: changed(a, r) }]"
                            :disabled="locked(a, r) || !isSuper || saving === a.action + ':' + r"
                            :title="switchTitle(a, r)"
                            :aria-label="`${a.label} for ${ROLE_WORDS[r]}`" @click="toggle(a, r)">
                      <i></i>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </template>

    <Empty v-else art="🔑" title="Nothing to show">
      The list of features could not be loaded.
    </Empty>

    <!--
      A FILTER THAT HIDES EVERYTHING MUST SAY SO. `groups` is empty either
      because nothing loaded or because "Show only those" is on and the one
      changed row is in a group the eye has already scrolled past — and those
      two look identical. This branch exists so the second one never reads as
      the first.
    -->
    <p v-if="data && data.actions.length && onlyChanged && !groups.length" class="muted">
      Nothing differs from the normal setting.
      <button class="btn sm ghost" @click="onlyChanged = false">Show all</button>
    </p>
  </div>
</template>

<style scoped>
.rolepick { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
.rolebtn {
  text-align: left; padding: 14px; border-radius: var(--r-sm);
  border: 1.5px solid var(--border); background: var(--surface); cursor: pointer;
  transition: border-color .14s, background .14s;
}
.rolebtn.on { border-color: var(--brand); background: var(--brand-soft); }
.rolebtn b { display: block; font-size: .98rem; }
.rolebtn small { display: block; color: var(--muted); font-size: .8rem; margin-top: 2px; line-height: 1.3; }

.line {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 0; border-bottom: 1px solid var(--border); min-height: 64px;
}
.line:last-child { border-bottom: 0; }
.line .t { display: block; font-weight: 650; }
.line .d { display: block; font-size: .84rem; color: var(--muted); margin-top: 3px; }

/* the switch */
.sw {
  flex: 0 0 auto; width: 56px; height: 32px; padding: 0;
  border-radius: 999px; border: 0; cursor: pointer;
  background: var(--surface-2); box-shadow: inset 0 0 0 1.5px var(--border);
  transition: background .16s var(--ease), box-shadow .16s;
}
.sw > i {
  display: block; width: 24px; height: 24px; margin: 4px; border-radius: 50%;
  background: var(--muted); transition: transform .16s var(--ease), background .16s;
}
.sw.on { background: var(--brand); box-shadow: none; }
.sw.on > i { transform: translateX(24px); background: #fff; }
.sw.moved { outline: 2px solid var(--info); outline-offset: 2px; }
.sw:disabled { opacity: .4; cursor: not-allowed; }
.sw.locked { opacity: .3; }

.rolecol { text-align: center; width: 120px; }
.rolecol .sw { margin: 0 auto; }

/*
 * The alert as a bar rather than a fifth rounded box. Scoped here rather than
 * added to `.note` in style.css, which another session is holding this round.
 */
.note.bar {
  display: flex; align-items: center; gap: 12px;
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
  border-left: 3px solid currentColor;
}
/* The filter is a state, so it shows one — a ghost button that stays pressed
   reads as a toggle rather than as something you clicked a moment ago. */
.note.bar .btn.on {
  background: var(--info-soft); border-color: currentColor; color: inherit; font-weight: 650;
}
</style>
