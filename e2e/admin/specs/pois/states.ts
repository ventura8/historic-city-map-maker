/**
 * The places area's states of the tour inventory (`ADMIN_STATES` of e2e/tour/states.ts spreads them inside its pois
 * section, which keeps that file within its line limit): ids `pois.<state>` (docs/research/M2c-interfaces.md §12.2),
 * each reached by the tour file named in `visit` and checked there with `expectStateSound` at every tour project.
 */
const VISIT = 'tour/admin-places.tour.ts';
const DRAWING = 'tour/admin-drawing.tour.ts';

export const POIS_STATES = {
    'pois.empty': { title: 'Places: none yet, with Add place, Import and Export', visit: VISIT },
    'pois.add-shape': { title: 'Places: Add place open, its three shapes', visit: VISIT },
    'pois.new-place': {
        title: 'Places: a new line without the Mapbox token (the map box with its link to Setup, the tools, no position yet)',
        visit: VISIT,
    },
    'pois.no-categories': {
        title: 'Places: a new point in a city without categories (the starter categories offered, Save naming what it waits for)',
        visit: VISIT,
    },
    'pois.editor': { title: 'Places: a saved line, its positions listed and its description previewed', visit: VISIT },
    'pois.delete-confirm': { title: 'Places: the delete confirmation (a dialog)', visit: VISIT },
    'pois.more-actions': { title: "Places: the editor's other actions, History and Redraw as… (a dialog)", visit: VISIT },
    'pois.list': { title: 'Places: the list of two places in two categories, with the filters', visit: VISIT },
    'pois.import-refused': { title: 'Places: an import file that is not GeoJSON, refused (a dialog)', visit: VISIT },
    'pois.import-preview': {
        title: 'Places: the import preview, one new place and five refused with their reasons (a dialog)',
        visit: VISIT,
    },
    'pois.photo-picker': {
        title: "Places: the photo picker, the city's newest photos with Show more (a dialog)",
        visit: 'specs/pois/import-delete.spec.ts',
    },
    'pois.drawing': { title: 'Places: an area being drawn on the map, click by click, its positions listed', visit: DRAWING },
    'pois.draw-refused': { title: 'Places: a position outside the city refused, said at the drawing tools', visit: DRAWING },
    'pois.vertex-list': {
        title: 'Places: a line of two positions, the map, its tools and the list of positions in one Tab round',
        visit: DRAWING,
    },
} as const;
