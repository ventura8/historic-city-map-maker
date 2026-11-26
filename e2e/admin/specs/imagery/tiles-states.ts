/**
 * The tile-import wizard's states of the tour inventory (docs/research/M20-import-local.md §19.11; `ADMIN_SECTION_STATES` of
 * e2e/tour/admin-sections.ts spreads them), ids `tiles.<state>`, each reached by specs/imagery/tiles.spec.ts at every admin project
 * (a phone, a tablet, a laptop).
 */
export const TILES_STATES = {
    'tiles.order': {
        title: "The tile-import wizard, step 1: the sheets' thumbnails in their grid with their sources, Turn, Mirror, the sheets left out",
        visit: 'specs/imagery/tiles.spec.ts',
    },
    'tiles.seams': {
        title: 'The tile-import wizard, step 2: a weak seam, its two strips with the guess, Accept the guess and Next seam',
        visit: 'specs/imagery/tiles.spec.ts',
    },
    'tiles.preview': {
        title: "The tile-import wizard, step 3: the layout from the thumbnails, the pipeline's joined picture and the quality meter",
        visit: 'specs/imagery/tiles.spec.ts',
    },
    'tiles.preview-poor': {
        title: 'The tile-import wizard, step 3: a poor layout, said in the meter and in an alert',
        visit: 'specs/imagery/tiles.spec.ts',
    },
    'tiles.previewing': {
        title: 'The tile-import wizard, step 3: the real preview asked for, waiting for the pipeline, said in a status line',
        visit: 'specs/imagery/tiles.spec.ts',
    },
    'tiles.stale': {
        title: "The tile-import wizard after a stale refusal: the alert says the owner's changes were not saved, the newer layout shown",
        visit: 'specs/imagery/tiles.spec.ts',
    },
    'tiles.seam-missing': {
        title: 'The tile-import wizard, step 2: a seam the app did not find, no guess, a point picked with the keyboard on each strip',
        visit: 'specs/imagery/tiles.spec.ts',
    },
    'tiles.handed-off': {
        title: 'The tile-import wizard, step 4: the layout sent on, and the link to the georeferencer',
        visit: 'specs/imagery/tiles.spec.ts',
    },
    'tiles.all-out': {
        title: 'The tile-import wizard, step 4: every sheet out of the map, said, Place it on the map off',
        visit: 'specs/imagery/tiles.spec.ts',
    },
    'tiles.empty': {
        title: 'The tile-import wizard at an address with no series',
        visit: 'specs/imagery/tiles.spec.ts',
    },
    'tiles.error': {
        title: "The tile-import wizard when the series' layout cannot be read, with Try again",
        visit: 'specs/imagery/tiles.spec.ts',
    },
} as const;
