<script setup>
/**
 * Home answers two questions before you touch anything: how is the raffle
 * going, and what needs doing. Every attention row is a shortcut to the fix.
 */
import { state, overview, attention, gettingStarted, isAdmin, canWrite, go, refresh } from '../lib/store.js'
import Progress from './ui/Progress.vue'
import BookGrid from './ui/BookGrid.vue'
import Icon from './ui/Icon.vue'
import Bi from './ui/Bi.vue'

const emit = defineEmits(['issue', 'add-agent', 'open-book', 'sell-book'])

function doStep(action) {
  if (action === 'add-agent') emit('add-agent')
  else if (action === 'issue') emit('issue')
  else if (action === 'sell') go('sell')
}
</script>

<template>
  <div>
    <!-- the spreadsheet has not been prepared yet -->
    <div v-if="state.needsSetup" class="card setup">
      <h3 class="row"><Icon name="gear" :size="22" /> The spreadsheet is not ready yet</h3>
      <p>
        Your sign-in worked — but the tabs the app reads from have not been made.
        Somebody needs to open the spreadsheet, go to
        <b>Extensions → Apps Script</b>, choose <b>setup</b> from the list at the top
        and press <b>Run</b>. It takes about a minute.
      </p>
      <p class="muted small">
        Set the ticket numbers in the <b>Config</b> tab first — they are fixed
        once the tickets are made.
      </p>
      <button class="btn primary" @click="refresh()"><Bi text="Check again" /></button>
    </div>

    <!-- something did not load, but the rest of the app still works -->
    <div v-else-if="state.problems.length" class="note warn">
      <b>Some things could not be loaded.</b>
      <div v-for="p in state.problems" :key="p.what">{{ p.what }} — {{ p.message }}</div>
      <button class="btn sm" style="margin-top:10px" @click="refresh()">Try again</button>
    </div>

    <!-- first run: what to do, in order -->
    <div v-if="gettingStarted" class="card">
      <h3><Bi text="Let's get started" /></h3>
      <p class="muted small"><Bi text="Four things, once." /></p>
      <div class="steps">
        <div v-for="(s, i) in gettingStarted" :key="i"
             :class="['step', { done: s.done, now: !s.done && gettingStarted.findIndex(x => !x.done) === i }]"
             @click="!s.done && s.action && doStep(s.action)">
          <span class="mark">{{ s.done ? '✓' : i + 1 }}</span>
          <span class="grow">
            <span class="t"><Bi :text="s.title" /></span>
            <span class="d"><Bi :text="s.detail" /></span>
          </span>
          <span v-if="!s.done && s.action" class="chev">›</span>
        </div>
      </div>
    </div>

    <!-- money raised -->
    <Progress v-if="overview" v-bind="{
      percent: overview.percent, collected: overview.collected, target: overview.target,
      currency: overview.currency, sold: overview.sold, total: state.cfg.totalTickets,
      outstanding: overview.outstanding }" />

    <!-- An empty grey box tells nobody anything. Say what is happening, and
         count up while it happens, because on a big raffle this takes a while. -->
    <div v-else class="card loading">
      <div class="spin"></div>
      <div class="grow">
        <b><Bi text="Getting your raffle" /></b>
        <div class="small muted">
          <template v-if="state.loadProgress">
            {{ state.loadProgress.done.toLocaleString() }} of
            {{ state.loadProgress.total.toLocaleString() }} tickets
          </template>
          <template v-else>One moment…</template>
        </div>
      </div>
    </div>

    <!-- what needs doing -->
    <template v-if="attention.length">
      <h3 class="sect"><Bi text="Needs looking at" /></h3>
      <TransitionGroup name="pop" tag="div">
        <button v-for="a in attention" :key="a.key" :class="['attn', a.tone]" @click="go(a.go)">
          <Icon :name="a.icon" :size="24" class="em" />
          <span class="grow">
            <span class="t">{{ a.title }}</span>
            <span class="d">{{ a.detail }}</span>
          </span>
          <span class="chev">›</span>
        </button>
      </TransitionGroup>
    </template>
    <div v-else-if="overview" class="note ok">
      <b>All good.</b> Nothing needs your attention right now.
    </div>

    <!-- shortcuts -->
    <h3 class="sect"><Bi text="What do you want to do?" /></h3>
    <div class="quick">
      <button v-if="canWrite" @click="go('sell')">
        <Icon name="ticket" :size="30" class="em" /><Bi class="mid" text="Write down a sale" />
      </button>
      <button @click="go('search')">
        <Icon name="search" :size="30" class="em" /><Bi class="mid" text="Find a ticket" />
      </button>
      <button v-if="canWrite" @click="emit('sell-book')">
        <Icon name="bookPlus" :size="30" class="em" /><Bi text="Sell a whole book" class="mid" />
      </button>
      <button v-if="isAdmin" @click="emit('issue')">
        <Icon name="books" :size="30" class="em" /><Bi class="mid" text="Give out books" />
      </button>
      <button v-if="isAdmin" @click="emit('add-agent')">
        <Icon name="people" :size="30" class="em" /><Bi class="mid" text="Add a seller" />
      </button>
    </div>

    <!-- the whole raffle at a glance -->
    <div class="card">
      <div class="spread" style="margin-bottom:14px">
        <h3 style="margin:0"><Bi text="All the books" /></h3>
        <button class="btn sm" @click="go('books')"><Bi text="See list" /></button>
      </div>
      <BookGrid :books="state.books" :limit="180"
                @pick="b => emit('open-book', b)" @more="go('books')" />
    </div>
  </div>
</template>

<style scoped>
.sect { margin: 22px 2px 10px; }
.setup { border-left: 4px solid var(--warn); }

.loading { display: flex; align-items: center; gap: 16px; }
.loading .spin {
  flex: 0 0 26px; width: 26px; height: 26px; border-radius: 50%;
  border: 3px solid var(--border); border-top-color: var(--brand);
  animation: turn .8s linear infinite;
}
@keyframes turn { to { transform: rotate(360deg) } }

/* getting started */
.steps { margin-top: 6px; }
.step {
  display: flex; align-items: flex-start; gap: 14px;
  padding: 14px 0; border-bottom: 1px solid var(--border);
}
.step:last-child { border-bottom: 0; }
.step[class*="now"], .step:not(.done) { cursor: pointer; }
.step .mark {
  flex: 0 0 32px; height: 32px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--surface-2); color: var(--muted);
  font-weight: 800; font-size: .95rem;
}
.step.done .mark { background: var(--ok-soft); color: var(--ok); }
.step.now .mark { background: var(--brand); color: var(--brand-ink); }
.step .t { display: block; font-weight: 700; }
.step.done .t { color: var(--muted); }
.step .d { display: block; font-size: .9rem; color: var(--muted); margin-top: 1px; }
.step .chev { color: var(--muted); font-size: 1.4rem; line-height: 1; }

/* attention rows */
.attn {
  display: flex; align-items: center; gap: 14px; width: 100%;
  padding: 16px 18px; margin-bottom: 9px; min-height: 74px;
  background: var(--surface); border: 1px solid var(--border);
  border-left: 4px solid var(--muted); border-radius: var(--r);
  cursor: pointer; text-align: left;
  transition: transform .14s var(--ease), box-shadow .14s;
}
.attn:hover { transform: translateX(3px); box-shadow: var(--shadow); }
.attn.bad  { border-left-color: var(--bad); }
.attn.warn { border-left-color: var(--warn); }
.attn .em { flex: 0 0 24px; }
.attn .t { display: block; font-weight: 700; font-size: 1.02rem; }
.attn .d { display: block; font-size: .88rem; color: var(--muted); margin-top: 2px; }
.attn .chev { color: var(--muted); font-size: 1.5rem; }

/* shortcuts */
.quick { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 18px; }
.quick button {
  display: flex; flex-direction: column; align-items: center; gap: 9px;
  padding: 22px 12px; min-height: 112px; justify-content: center;
  background: var(--surface); border: 1.5px solid var(--border);
  border-radius: var(--r); cursor: pointer;
  font-weight: 700; font-size: .98rem; text-align: center; line-height: 1.3;
  transition: transform .14s var(--ease), border-color .14s, box-shadow .14s;
}
.quick button:hover { border-color: var(--brand); transform: translateY(-3px); box-shadow: var(--shadow); }
.quick button:active { transform: translateY(0) scale(.98); }
.quick .em { color: var(--brand); }
</style>
