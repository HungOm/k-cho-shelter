/**
 * One rule: do not use a name that does not exist.
 *
 * Not a style config, and deliberately not a broad one. It exists because of a
 * class of bug nothing else here can see: SettleBook.vue called map(resolve)
 * where the import is resolveTicketNumber, and shipped. Vite does not resolve
 * identifiers, so the build passed; the suite does not drive that component, so
 * it stayed green; and reaching the line in a browser needs a book, a seller
 * and a settle dialog, so no smoke test touched it. The first thing that ran it
 * was a volunteer pressing "Finish this book" — the one action in this system
 * that decides money.
 *
 * Every other rule is off on purpose. A hundred style warnings is a linter
 * nobody runs, and a linter nobody runs is worse than none: it makes the
 * failure look covered.
 */
import vue from 'eslint-plugin-vue'
import globals from 'globals'

export default [
  ...vue.configs['flat/base'],
  {
    files: ['src/**/*.{js,vue}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser, ...globals.es2021,
        // Replaced at build time by vite.config.js. Declared readonly so
        // `no-undef` does not fire on them and nothing tries to assign one.
        __APP_VERSION__: 'readonly',
        __APP_SHA__: 'readonly',
      },
    },
    rules: { 'no-undef': 'error' },
  },
]
