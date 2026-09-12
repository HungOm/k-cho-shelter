<script setup>
/**
 * The frame around every screen.
 *
 * Phone: a title bar and big bottom tabs, thumb-reachable.
 * Desktop: a permanent sidebar with room for labels and live counts, so a
 * wide screen shows more rather than the same column stretched across it.
 */
import { ref, computed } from 'vue'
import { state, isAdmin, go, attention } from '../lib/store.js'
import Bi from './ui/Bi.vue'

const SCREENS = [
  { id: 'home',   icon: '🏠', label: 'Home',    roles: ['admin', 'recorder', 'agent', 'viewer'] },
  { id: 'search', icon: '🔍', label: 'Find',    roles: ['admin', 'recorder', 'agent', 'viewer'] },
  { id: 'sell',   icon: '🎟️', label: 'Sell',    roles: ['admin', 'recorder', 'agent'] },
  { id: 'books',  icon: '📚', label: 'Books',   roles: ['admin', 'recorder'] },
  { id: 'agents', icon: '👥', label: 'Sellers', roles: ['admin', 'recorder'] },
  { id: 'money',  icon: '💰', label: 'Money',   roles: ['admin', 'recorder', 'viewer'] },
  { id: 'draw',   icon: '🏆', label: 'Draw',    roles: ['admin', 'recorder', 'viewer'] },
  { id: 'admin',  icon: '⚙️', label: 'Setup',   roles: ['admin'] },
  // Super admin only, so it is filtered by more than role — see `visible`.
  { id: 'permissions', icon: '🔑', label: 'Access', roles: ['admin'], sup: true },
  { id: 'approvals', icon: '🖐️', label: 'Approvals', roles: ['admin', 'recorder', 'agent'] }
]

const visible = computed(() => SCREENS.filter(s =>
  s.roles.includes(state.user?.role) && (!s.sup || state.user?.isSuperAdmin)))

/**
 * Eight tabs overflow a phone: on a 390px screen the last two sit off-screen
 * behind a scroll nobody discovers. Four plus a More sheet keeps everything
 * reachable and every label readable.
 */
const PRIMARY = ['home', 'search', 'sell', 'books']
const mainTabs = computed(() => visible.value.filter(s => PRIMARY.includes(s.id)))
const moreTabs = computed(() => visible.value.filter(s => !PRIMARY.includes(s.id)))

const badges = computed(() => ({
  agents: state.overdue.length,
  draw: state.totals?.missingContact || 0,
  approvals: state.pendingApprovals || 0
}))

const moreBadge = computed(() =>
  moreTabs.value.reduce((n, s) => n + (badges.value[s.id] || 0), 0))
const moreActive = computed(() => moreTabs.value.some(s => s.id === state.screen))

const showMore = ref(false)
function pick(id) { showMore.value = false; go(id) }

const roleWord = computed(() => ({
  admin: 'Organiser', recorder: 'Helper', agent: 'Seller who signs in', viewer: 'Can only look'
}[state.user?.role] || state.user?.role))

defineEmits(['signout'])
</script>

<template>
  <div class="shell">
    <!-- desktop sidebar -->
    <aside class="sidebar noprint">
      <div class="brand">
        <span class="mark">🎟️</span>
        <span class="grow">
          <b>{{ state.cfg?.eventName || "K'Cho Shelter" }}</b>
          <small>{{ state.cfg?.orgName }}</small>
        </span>
      </div>

      <nav>
        <button v-for="s in visible" :key="s.id"
                :class="['navitem', { on: state.screen === s.id }]"
                @click="go(s.id)">
          <span class="ic">{{ s.icon }}</span>
          <Bi class="grow" :text="s.label" />
          <span v-if="badges[s.id]" class="pill bad">{{ badges[s.id] }}</span>
        </button>
      </nav>

      <div class="who">
        <div class="grow">
          <b>{{ state.user?.name }}</b>
          <small><Bi :text="roleWord" /></small>
        </div>
        <button class="btn sm ghost" @click="$emit('signout')" title="Sign out"><Bi text="Leave" /></button>
      </div>
    </aside>

    <div class="main">
      <!-- phone title bar -->
      <header class="appbar noprint">
        <span class="mark">🎟️</span>
        <span class="grow">
          <b>{{ state.cfg?.eventName || "K'Cho Shelter" }}</b>
          <small>{{ state.user?.name }} · {{ roleWord }}</small>
        </span>
        <button class="btn sm ghost" @click="$emit('signout')"><Bi text="Leave" /></button>
      </header>

      <main class="content">
        <slot />
      </main>

      <!-- phone tabs: four, plus everything else behind More -->
      <nav class="tabs noprint">
        <button v-for="s in mainTabs" :key="s.id"
                :class="['tab', { on: state.screen === s.id }]"
                @click="go(s.id)">
          <span class="ic">
            {{ s.icon }}
            <i v-if="badges[s.id]" class="dot"></i>
          </span>
          <Bi :text="s.label" class="mid" />
        </button>
        <button v-if="moreTabs.length" :class="['tab', { on: moreActive }]"
                @click="showMore = true" aria-label="More screens">
          <span class="ic">
            ⋯
            <i v-if="moreBadge" class="dot"></i>
          </span>
          <Bi text="More" class="mid" />
        </button>
      </nav>

      <!-- the rest, as a sheet -->
      <Transition name="pop">
        <div v-if="showMore" class="moreback noprint" @click.self="showMore = false">
          <div class="moresheet">
            <h3><Bi text="More" /></h3>
            <button v-for="s in moreTabs" :key="s.id"
                    :class="['morerow', { on: state.screen === s.id }]"
                    @click="pick(s.id)">
              <span class="ic">{{ s.icon }}</span>
              <Bi class="grow" :text="s.label" />
              <span v-if="badges[s.id]" class="pill bad">{{ badges[s.id] }}</span>
              <span class="chev">›</span>
            </button>
            <button class="btn block" @click="showMore = false">Close</button>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.shell { display: flex; min-height: 100dvh; }

/* ---------- sidebar (desktop only) ---------- */
.sidebar { display: none; }

.brand { display: flex; align-items: center; gap: 11px; padding: 20px 18px 16px; }
.brand .mark { font-size: 1.6rem; }
.brand b { display: block; font-size: 1rem; line-height: 1.25; }
.brand small { display: block; color: var(--muted); font-size: .78rem; }

.sidebar nav { display: flex; flex-direction: column; gap: 3px; padding: 6px 12px; flex: 1; }
.navitem {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 12px 14px; border: 0; border-radius: var(--r-sm);
  background: none; cursor: pointer; font-weight: 650; font-size: 1rem;
  color: var(--muted); text-align: left; transition: background .14s, color .14s;
}
.navitem:hover { background: var(--surface-2); color: var(--text); }
.navitem.on { background: var(--brand-soft); color: var(--brand); }
.navitem .ic { font-size: 1.25rem; line-height: 1; flex: 0 0 26px; text-align: center; }
.navitem :deep(.bi) { align-items: flex-start; }

.who {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 16px; border-top: 1px solid var(--border);
}
.who b { display: block; font-size: .95rem; }
.who small { display: block; color: var(--muted); font-size: .8rem; }

/* ---------- main column ---------- */
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }

.appbar {
  position: sticky; top: 0; z-index: 20;
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.appbar .mark { font-size: 1.35rem; }
.appbar b { display: block; font-size: .98rem; line-height: 1.2;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.appbar small { display: block; color: var(--muted); font-size: .78rem; }

.content {
  flex: 1; width: 100%; max-width: 860px; margin: 0 auto;
  padding: 18px 16px calc(96px + env(safe-area-inset-bottom));
}

/* ---------- tabs (phone only) ---------- */
.tabs {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 20;
  display: flex; gap: 2px; padding: 7px 6px max(7px, env(safe-area-inset-bottom));
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: blur(12px);
  border-top: 1px solid var(--border);
  overflow-x: auto; scrollbar-width: none;
}
.tabs::-webkit-scrollbar { display: none; }
.tab {
  flex: 1 0 auto; min-width: 66px; min-height: 54px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  background: none; border: 0; border-radius: var(--r-sm);
  color: var(--muted); font-size: .76rem; font-weight: 700; cursor: pointer;
  transition: color .14s, background .14s;
}
.tab.on { color: var(--brand); background: var(--brand-soft); }
.tab .ic { position: relative; font-size: 1.35rem; line-height: 1.1; }
.tab .dot {
  position: absolute; top: -1px; right: -5px;
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--bad); border: 2px solid var(--surface);
}

/* ---------- the More sheet ---------- */
.moreback {
  position: fixed; inset: 0; z-index: 30;
  background: rgba(10, 13, 18, .5); backdrop-filter: blur(3px);
  display: flex; align-items: flex-end;
}
.moresheet {
  width: 100%; background: var(--surface);
  border-radius: 22px 22px 0 0; padding: 20px 16px calc(20px + env(safe-area-inset-bottom));
  box-shadow: var(--shadow-lg);
}
.morerow {
  display: flex; align-items: center; gap: 14px; width: 100%;
  min-height: 60px; padding: 12px 14px; margin-bottom: 4px;
  border: 0; border-radius: var(--r-sm); background: none;
  font-size: 1.05rem; font-weight: 650; cursor: pointer; text-align: left;
}
.morerow:hover { background: var(--surface-2); }
.morerow.on { background: var(--brand-soft); color: var(--brand); }
.morerow .ic { font-size: 1.4rem; }
.morerow .chev { color: var(--muted); font-size: 1.4rem; }

/* ---------- wide screens: swap tabs for the sidebar ---------- */
@media (min-width: 900px) {
  .moreback { display: none; }
  .sidebar {
    display: flex; flex-direction: column;
    width: 246px; flex: 0 0 246px;
    background: var(--surface); border-right: 1px solid var(--border);
    position: sticky; top: 0; height: 100dvh;
  }
  .appbar, .tabs { display: none; }
  .content { padding: 28px 32px 48px; max-width: 1100px; margin: 0; }
}

@media (min-width: 1400px) {
  .content { max-width: 1280px; }
}
</style>
