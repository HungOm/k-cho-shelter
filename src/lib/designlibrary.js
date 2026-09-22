/*
 * ONE LIBRARY MODEL, READ FROM BOTH SIDES OF THE WALL.
 *
 * Defined once in supabase/functions/_shared/designlibrary.js — the studio
 * saves and places, the server refuses what it will not store, and a shape the
 * panel produced must be one the save accepts. The same arrangement as
 * src/lib/ranks.js and src/lib/designelements.js, and for the same reason.
 *
 * `.js` rather than `.ts`, which the rest of _shared is not: this is reachable
 * from a renderer that a plain-Node test imports, and Node cannot load a .ts —
 * the failure being the suite STOPPING rather than an assertion going red. The
 * note in src/lib/designelements.js has the whole of it.
 */
export {
  MAX_SHAPES,
  MAX_COLOURS,
  MAX_STYLES,
  MAX_PARTS,
  BUILT_IN,
  EMPTY_LIBRARY,
  nextLibId,
  normalLibrary,
  shapeFrom,
  placeShape,
  libraryFaults,
} from '../../supabase/functions/_shared/designlibrary.js'
