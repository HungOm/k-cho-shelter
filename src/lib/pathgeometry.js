/*
 * THE PEN'S ARITHMETIC, READ FROM BOTH SIDES OF THE WALL.
 *
 * Defined once in supabase/functions/_shared/pathgeometry.js, because the
 * renderer that draws a path and the server that refuses one must measure it
 * the same way. The same arrangement as src/lib/designelements.js, and `.js`
 * for the same reason: a plain-Node test reaches it through the renderer.
 */
export {
  cleanNode,
  segments,
  pathData,
  boundsOfPath,
  fromUnit,
  refitPath,
  moveNode,
  setHandle,
  toggleSmooth,
  removeNode,
  insertOnSegment,
  nearestOnPath,
  constrain45,
} from '../../supabase/functions/_shared/pathgeometry.js'
