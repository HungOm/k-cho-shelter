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
    chunkSizeWarningLimit: 700
  }
})
