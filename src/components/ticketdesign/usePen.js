/*
 * THE PEN, AND EDITING A PATH BY ITS NODES — the interaction, apart from any
 * one screen.
 *
 * A composable rather than more code in the studio shell, because two screens
 * draw: the printed ticket's Place tab now, and the digital card next
 * (STUDIO-ESSENTIALS Phase 9). The geometry is src/lib/pathgeometry.js; this
 * file is only "what a press, a drag and a release mean".
 *
 * DRAWING. Click to put down a corner; press and drag to put down a smooth
 * node, pulling its handles; click the first node to close; Enter or Escape
 * to finish an open path. Shift keeps a segment to the eight compass
 * directions. What has been drawn so far is on screen as it will print.
 *
 * EDITING. A selected path's nodes are drawn over it: drag a node, drag a
 * handle (⌥ breaks the pair so the node becomes a cusp), double-click a node
 * to turn a corner smooth or a smooth node into a corner, ⌥-click the path to
 * add a node, Delete to remove the chosen one. Every gesture is one undo step,
 * and after every one the path is refitted so its box still surrounds it.
 *
 * WHY AN ISOTROPIC SPACE. Positions are shares of the artboard, and the
 * artboard is three times wider than it is tall — so a "45°" measured in
 * shares is a much shallower angle on screen, and a handle "a third of the
 * way" is longer across than down. Anything that measures an angle or a length
 * works in shares with x scaled by the artboard's aspect, and converts back.
 */
import { ref, computed } from 'vue'
import {
  fromUnit, refitPath, moveNode, setHandle, toggleSmooth, removeNode,
  insertOnSegment, nearestOnPath, constrain45,
} from '../../lib/pathgeometry.js'

/**
 * @param {object} o
 * @param {() => number} o.aspect   artboard width ÷ height, in pixels
 * @param {() => void} o.mark        record one undo step, before a change
 * @param {(deco: object) => void} o.place   add a finished path to the design
 * @param {() => object|null} o.target       the selected path decoration, if any
 * @param {() => number} o.reach     how close, in shares of the width, counts as "on" a node
 */
export function usePen({ aspect, mark, place, target, reach = () => 0.008 }) {
  const iso = (p) => [p[0] * aspect(), p[1]]
  const flat = (p) => [p[0] / aspect(), p[1]]
  const isoNode = (n) => {
    const o = { x: n.x * aspect(), y: n.y }
    if (n.hx1 !== undefined) { o.hx1 = n.hx1 * aspect(); o.hy1 = n.hy1 }
    if (n.hx2 !== undefined) { o.hx2 = n.hx2 * aspect(); o.hy2 = n.hy2 }
    return o
  }
  const flatNode = (n) => {
    const o = { x: n.x / aspect(), y: n.y }
    if (n.hx1 !== undefined) { o.hx1 = n.hx1 / aspect(); o.hy1 = n.hy1 }
    if (n.hx2 !== undefined) { o.hx2 = n.hx2 / aspect(); o.hy2 = n.hy2 }
    return o
  }
  /* A distance in the isotropic space — units of the artboard's HEIGHT — so it
     compares with `reach() * aspect()`, the reach converted the same way. */
  const dist = (a, b) => Math.hypot(...[a[0] - b[0], a[1] - b[1]].map((v, i) => (i ? v : v * aspect())))
  const near = () => reach() * aspect()

  /* ---------- drawing ---------- */

  /* { nodes: [share nodes], pulling: bool, cursor: [x, y] } while drawing. */
  const drawing = ref(null)

  function down(pt, ev = {}) {
    const d = drawing.value
    if (!d) { drawing.value = { nodes: [{ x: pt[0], y: pt[1] }], pulling: true, cursor: pt }; return }
    const first = d.nodes[0]
    if (d.nodes.length >= 2 && dist(pt, [first.x, first.y]) <= near()) { finish(true); return }
    const last = d.nodes[d.nodes.length - 1]
    const at = ev.shiftKey ? flat(constrain45(iso([last.x, last.y]), iso(pt))) : pt
    d.nodes = [...d.nodes, { x: at[0], y: at[1] }]
    d.pulling = true
    d.cursor = at
  }

  function move(pt, ev = {}) {
    const d = drawing.value
    if (!d) return
    d.cursor = pt
    if (!d.pulling) return
    /* Pressed and dragged: the node just put down becomes smooth, its leaving
       handle under the pointer and its arriving one mirrored through it. */
    const i = d.nodes.length - 1
    const n = d.nodes[i]
    if (dist(pt, [n.x, n.y]) < near() / 2) return
    const nodes = [...d.nodes]
    nodes[i] = flatNode(setHandle(isoNode(n), 'h2', iso(pt), !ev.altKey))
    d.nodes = nodes
  }

  function up() { if (drawing.value) drawing.value.pulling = false }

  /** Finish the path being drawn. Fewer than two nodes is nothing, not a path. */
  function finish(closed = false) {
    const d = drawing.value
    drawing.value = null
    if (!d || d.nodes.length < 2) return false
    const { box, nodes } = refitPath(d.nodes, closed)
    place({ kind: 'path', box, path: { nodes, closed } })
    return true
  }

  function cancel() { drawing.value = null }

  /* The path so far and the rubber band to the pointer, as share nodes — the
     screen draws them in its own pixels (pathData rounds to hundredths, which
     is a pixel in pixels and a whole percent in shares). */
  const draftNodes = computed(() => {
    const d = drawing.value
    if (!d) return []
    return d.pulling ? d.nodes : [...d.nodes, { x: d.cursor[0], y: d.cursor[1] }]
  })

  /* ---------- editing a placed path ---------- */

  const editing = ref('')
  const chosenNode = ref(-1)
  let grip = null

  /** The selected path's nodes, in shares of the artboard, for drawing them. */
  const handles = computed(() => {
    const d = target()
    if (!editing.value || !d || d.id !== editing.value || d.kind !== 'path') return []
    return fromUnit(d.path.nodes, d.box)
  })

  function enter(id) { editing.value = id; chosenNode.value = -1 }
  function leave() { editing.value = ''; chosenNode.value = -1; grip = null }

  /* Write a new list of share nodes back to the decoration, refitted. */
  function commit(d, shareNodes) {
    const { box, nodes } = refitPath(shareNodes, d.path.closed)
    d.box.left = box.left; d.box.top = box.top; d.box.width = box.width; d.box.height = box.height
    d.path.nodes = nodes
  }

  function gripDown(i, which, pt) {
    const d = target()
    if (!d || d.locked) return
    mark()
    chosenNode.value = i
    grip = { i, which, from: pt, nodes: fromUnit(d.path.nodes, d.box) }
  }

  function gripMove(pt, ev = {}) {
    const d = target()
    if (!grip || !d) return false
    const nodes = grip.nodes.map((n) => ({ ...n }))
    const n = nodes[grip.i]
    if (grip.which === 'node') {
      nodes[grip.i] = moveNode(n, pt[0] - grip.from[0], pt[1] - grip.from[1])
    } else {
      nodes[grip.i] = flatNode(setHandle(isoNode(n), grip.which, iso(pt), !ev.altKey))
    }
    commit(d, nodes)
    return true
  }

  function gripUp() { grip = null }
  const gripping = () => !!grip

  function toggleNode(i) {
    const d = target()
    if (!d) return
    mark()
    const isoNodes = fromUnit(d.path.nodes, d.box).map(isoNode)
    commit(d, toggleSmooth(isoNodes, i, d.path.closed).map(flatNode))
  }

  /** ⌥-click on the path: a node there, the shape unchanged. */
  function addNodeAt(pt) {
    const d = target()
    if (!d) return false
    const isoNodes = fromUnit(d.path.nodes, d.box).map(isoNode)
    const hit = nearestOnPath(isoNodes, d.path.closed, iso(pt))
    if (hit.seg < 0 || hit.dist > near() * 1.5) return false
    mark()
    commit(d, insertOnSegment(isoNodes, hit.seg, hit.t, d.path.closed).map(flatNode))
    chosenNode.value = hit.seg + 1
    return true
  }

  /** The arrow keys, with nodes up: the chosen node moves, handles and all. */
  function nudgeNode(dx, dy) {
    const d = target()
    if (!d || d.locked || chosenNode.value < 0) return false
    mark()
    const nodes = fromUnit(d.path.nodes, d.box)
    nodes[chosenNode.value] = moveNode(nodes[chosenNode.value], dx, dy)
    commit(d, nodes)
    return true
  }

  function removeChosen() {
    const d = target()
    if (!d || chosenNode.value < 0) return false
    if (d.path.nodes.length <= 2) return false
    mark()
    commit(d, removeNode(fromUnit(d.path.nodes, d.box), chosenNode.value))
    chosenNode.value = -1
    return true
  }

  return {
    drawing, draftNodes, down, move, up, finish, cancel,
    editing, chosenNode, handles, enter, leave, gripDown, gripMove, gripUp, gripping,
    toggleNode, addNodeAt, removeChosen, nudgeNode,
  }
}
