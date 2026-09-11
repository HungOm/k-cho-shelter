import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // Relative asset paths, so the build works at a domain root *and* under a
  // /repo-name/ path on github.io without rebuilding.
  base: './',
  build: {
    outDir: 'dist',
    // One small bundle beats several round trips on a phone on mobile data.
    chunkSizeWarningLimit: 700
  }
})
