/**
 * Cutting a named region out of a source file, safely.
 *
 * Tests here routinely slice one function out of a file to run it. The slice is
 * done with indexOf, and indexOf returns -1 when the marker is gone — so
 * slice(start, -1) quietly runs to the end of the file and the test then
 * examines something other than what it named. It does not fail; it reports on
 * the wrong region, confidently.
 *
 * ANCHOR ON CODE, NEVER ON A COMMENT. Two tests here ended a slice at a comment
 * — '/**\n * The old route' and '<!-- something went wrong -->' — so rewording
 * prose, which everybody does freely, would have silently changed what the test
 * measured. A comment is the least stable text in a file and the one nothing
 * else depends on, which is exactly why it looks like a safe landmark.
 */

/** The region between two markers, or a named failure. Never a silent -1. */
export function cut(text, from, to, what) {
  const a = String(text).indexOf(from)
  if (a < 0) throw new Error(`cut: could not find the start of ${what}`)
  const b = String(text).indexOf(to, a + from.length)
  if (b < 0) throw new Error(`cut: could not find the end of ${what}`)
  return text.slice(a, b)
}

/**
 * Source with its comments removed.
 *
 * For assertions about what the code DOES. A file that explains a rule at
 * length contains every phrase the rule does, so a match against the raw text
 * passes on a file that merely talks about it — which has happened three times
 * here: a logo filename, a security_invoker declaration, and an org name.
 */
export function codeOf(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
}
