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
  <div>
    <h1>Who can do what</h1>
    <p class="muted">
      Turn any feature on or off for each kind of user. Changes take effect within a minute.
    </p>

    <div v-if="!isSuper" class="note warn">
      Only the System Admin can change these. You are seeing them as they stand.
    </div>

    <div v-if="!data" class="card"><div class="skel" style="height:40px"></div></div>

    <template v-else-if="data.actions.length">
      <div v-if="changedCount" class="note info">
        <b>{{ changedCount }}</b> {{ changedCount === 1 ? 'feature has' : 'features have' }}
        been changed from the normal setting. Those are marked below.
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
            <button :class="['sw', { on: a.current[role], locked: locked(a, role) }]"
                    :disabled="locked(a, role) || !isSuper || saving === a.action + ':' + role"
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
                  </td>
                  <td v-for="r in data.roles" :key="r" class="rolecol">
                    <button :class="['sw', { on: a.current[r], locked: locked(a, r), moved: changed(a, r) }]"
                            :disabled="locked(a, r) || !isSuper || saving === a.action + ':' + r"
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
</style>
