import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/*
 * WHAT VERSION IS THIS, from the point of view of somebody on the phone.
 *
 * Baked in at build time because the running app has no other way to know. An
 * organiser reporting something is otherwise describing a build nobody can
 * identify — "the latest one" means whatever was deployed, which is the
 * question rather than the answer.
 *
 * The sha is the short commit. It falls back to 'dev' rather than failing the
 * build: `git` is absent in some CI images and in a plain source download, and
 * a build that will not run without a version string is worse than one that
 * says it does not know which it is.
 */
const version = JSON.parse(readFileSync('./package.json', 'utf8')).version
const sha = (() => {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() }
  catch { return 'dev' }
})()

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_SHA__: JSON.stringify(sha),
  },
  // Relative asset paths, so the build works at a domain root *and* under a
  // /repo-name/ path on github.io without rebuilding.
  base: './',
  build: {
    outDir: 'dist',
    // One small bundle beats several round trips on a phone on mobile data.
    chunkSizeWarningLimit: 700,
    /*
     * TWO PAGES, NOT ONE.
     *
     * `v/index.html` is the ticket check: somebody scans the QR on a raffle
     * ticket and lands there with no account and no session. It shares nothing
     * with the app — no store, no Supabase client, no sign-in script — because
     * none of that is any use without a session and all of it is weight on a
     * phone in a hall on one bar of signal.
     *
     * A DIRECTORY WITH AN index.html, not `v.html`, and that is not a
     * preference. GitHub Pages serves both, but `vite preview` and most static
     * hosts will not reliably answer `/v` for a file called `v.html` — so the
     * form below is the one that works everywhere, including on the machine of
     * whoever is checking it before it goes out. It costs one character in the
     * QR, which is nothing.
     *
     * `base: './'` above means each page emits its own relative asset paths, so
     * dist/v/index.html correctly reaches ../assets/ without any more config.
     */
    rollupOptions: {
      input: {
        main: 'index.html',
        verify: 'v/index.html',
      },
    },
  }
})
