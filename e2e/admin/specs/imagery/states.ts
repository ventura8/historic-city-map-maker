/**
 * The M3 screens' states of the tour inventory (`ADMIN_STATES` of e2e/tour/states.ts spreads them inside its imagery
 * section, which keeps that file within its line limit; docs/research/M3-interfaces.md §10.9, §12.2): the Imagery area,
 * the Jobs page's raster jobs, the georeferencer, the layer editor's Crop, Replace and pending version, the Link dialog's
 * Check and the imagery settings, ids `imagery.<state>`, `georef.<state>`, `layers.<state>` and `settings.<state>`, each reached by the spec named in
 * `visit` at the admin tier's five projects (the Jobs page's in a city of its own, the others behind the tier's lock).
 */
export const IMAGERY_STATES = {
    'imagery.results': {
        title: "Historical imagery: the ranked scenes, free first, their reasons, the filters and the city's boundary on the map",
        visit: 'specs/imagery/search.spec.ts',
    },
    'imagery.results-previews': {
        title: 'Historical imagery: every listed row with its browse image, the copies the list asked for, and what tells each frame apart',
        visit: 'specs/imagery/rows.spec.ts',
    },
    'imagery.results-previews-unavailable': {
        title: 'Historical imagery: rows whose browse image USGS does not serve, each saying so, the map showing the city alone',
        visit: 'specs/imagery/rows.spec.ts',
    },
    'imagery.scene': {
        title: 'Historical imagery: a scene with its preview, its reasons and Import',
        visit: 'specs/imagery/search.spec.ts',
    },
    'imagery.browse-unavailable': {
        title: 'Historical imagery: a scene whose preview cannot be fetched, with Try again',
        visit: 'specs/imagery/search.spec.ts',
    },
    'imagery.preview-unavailable': {
        title: "Historical imagery: a scene whose larger picture could not be made, its row's thumbnail kept, with Try again",
        visit: 'specs/imagery/rows.spec.ts',
    },
    'imagery.scene-unread': {
        title: 'Historical imagery: a scene named by the address whose read failed, why, with Try again',
        visit: 'specs/imagery/search.spec.ts',
    },
    'imagery.empty-usgs': {
        title: 'Historical imagery: USGS not set up, with the link to its Setup step',
        visit: 'specs/imagery/search.spec.ts',
    },
    'imagery.zero-results': {
        title: 'Historical imagery: a search that found nothing, and what to try (every year, every collection, the area)',
        visit: 'specs/imagery/search.spec.ts',
    },
    'imagery.search-credentials': {
        title: 'Historical imagery: a search USGS refused for its token, with the way to its Setup step',
        visit: 'specs/imagery/search.spec.ts',
    },
    'imagery.downloads-pending': {
        title: 'Historical imagery: a free scene while USGS has not approved downloads, Import off and why',
        visit: 'specs/imagery/search.spec.ts',
    },
    'imagery.version-steps': {
        title: 'Historical imagery: a version being made, its steps advancing live, Cancel',
        visit: 'specs/imagery/published.spec.ts',
    },
    'imagery.version-calibrated': {
        title: 'Historical imagery: a frame found with no landmark, how, how many areas agree, its error and the city it covers',
        visit: 'specs/imagery/calibration.spec.ts',
    },
    'imagery.version-aligned': {
        title: 'Historical imagery: a frame lined up with earlier photos held still, the years, the shared points, and one left out',
        visit: 'specs/imagery/calibration.spec.ts',
    },
    'imagery.version-local-ai': {
        title: 'Historical imagery: a frame the AI on your computer proposed and the proof held, on which graphics card',
        visit: 'specs/imagery/calibration.spec.ts',
    },
    'imagery.version-not-found': {
        title: 'Historical imagery: a frame nothing found, asking for a few rough points',
        visit: 'specs/imagery/calibration.spec.ts',
    },
    'imagery.version-locate-refused': {
        title: 'Historical imagery: a frame waiting for points whose Locate again was refused, why, and the georeferencer still open',
        visit: 'specs/imagery/calibration.spec.ts',
    },
    'imagery.version-not-proved': {
        title: 'Historical imagery: a frame under the threshold the proof does not hold, why it waits, Approve',
        visit: 'specs/imagery/calibration.spec.ts',
    },
    'imagery.version-coverage': {
        title: 'Historical imagery: a frame under the threshold holding part of the city, why it waits, Approve',
        visit: 'specs/imagery/calibration.spec.ts',
    },
    'imagery.version-downloading': {
        title: 'Historical imagery: an import downloading its scene, the bytes received of the total on its step, the bar moving',
        visit: 'specs/imagery/import.spec.ts',
    },
    'imagery.version-approval': {
        title: 'Historical imagery: a version over the threshold, both errors, the compute units and Approve',
        visit: 'specs/imagery/published.spec.ts',
    },
    'imagery.version-own-tiles': {
        title: 'Historical imagery: a version awaiting approval, its own tiles on the map, what it holds of the city, its cost in words, Actual pixels',
        visit: 'specs/imagery/own-tiles.spec.ts',
    },
    // M16 (docs/research/M16-recalibrate.md §7)
    'imagery.version-recalibrate': {
        title: 'Historical imagery: a version awaiting approval offering Calibrate again: Refine automatically and Place rough points',
        visit: 'specs/imagery/recalibrate.spec.ts',
    },
    'imagery.version-recalibrated': {
        title: 'Historical imagery: a recalibration, the current fit and the new one on the same checks, Show the current one, Approve',
        visit: 'specs/imagery/recalibrate.spec.ts',
    },
    'imagery.version-refine-declined': {
        title: 'Historical imagery: a refine that found nothing better, both figures in words, the current version left as it was',
        visit: 'specs/imagery/recalibrate.spec.ts',
    },
    'imagery.version-tiles-failed': {
        title: 'Historical imagery: a version whose full detail could not be read, why, Try again, its small picture on the map',
        visit: 'specs/imagery/own-tiles.spec.ts',
    },
    'imagery.version-tiles-gone': {
        title: 'Historical imagery: a version whose tiles are gone for good, why, no Try again, its small picture on the map',
        visit: 'specs/imagery/own-tiles.spec.ts',
    },
    'imagery.version-tiles-never': {
        title: 'Historical imagery: a rejected version, its small picture on the map and why no full detail will come',
        visit: 'specs/imagery/own-tiles.spec.ts',
    },
    'imagery.version-tiles-small': {
        title: 'Historical imagery: a version with no tiles yet, its small picture on the map and why',
        visit: 'specs/imagery/own-tiles.spec.ts',
    },
    // M25 (docs/research/M25-landsat.md §8): Landsat beside the declassified sources.
    'imagery.results-landsat': {
        title: 'Historical imagery: the Landsat chip chosen, its scenes ranked by cloud and season, each free',
        visit: 'specs/imagery/landsat.spec.ts',
    },
    'imagery.version-landsat-held': {
        title: 'Historical imagery: a Landsat version off Sentinel-2 by more than a pixel, its shift and cloud, waiting for Approve',
        visit: 'specs/imagery/landsat.spec.ts',
    },
    'imagery.work-thumbs': {
        title: "Historical imagery: Work's waiting row with the version's small picture",
        visit: 'specs/imagery/own-tiles.spec.ts',
    },
    'imagery.version-published': {
        title: 'Historical imagery: a version the policy approved and published',
        visit: 'specs/imagery/published.spec.ts',
    },
    'imagery.version-cancelled': {
        title: 'Historical imagery: a cancelled import',
        visit: 'specs/imagery/import.spec.ts',
    },
    'imagery.version-failed': {
        title: 'Historical imagery: a failed import, its error, the failed step and Retry',
        visit: 'specs/imagery/import.spec.ts',
    },
    'imagery.version-delete': {
        title: 'Historical imagery: a failure no retry cures, no Try again, and Delete this version asked first',
        visit: 'specs/imagery/import.spec.ts',
    },
    // t130/t131: Work's folded Cancelled versions, open, with a row's Remove warning shown.
    'imagery.work-cancelled': {
        title: 'Historical imagery: Work with its Cancelled versions open and a Remove warning',
        visit: 'specs/imagery/cancelled.spec.ts',
    },
    'imagery.version-usgs-wait': {
        title: 'Historical imagery: an import waiting for USGS maintenance to end',
        visit: 'specs/imagery/import.spec.ts',
    },
    // Findings 60 and 61 of 2026-11-02.
    'imagery.version-lost-run': {
        title: "Historical imagery: a run lost in a step, that step failed and the failure's sentence alone",
        visit: 'specs/imagery/import.spec.ts',
    },
    'imagery.version-over-budget': {
        title: "Historical imagery: an approved version past the month's compute units, the three ways out",
        visit: 'specs/imagery/publish.spec.ts',
    },
    'imagery.version-studio': {
        title: 'Historical imagery: the free Mapbox Studio upload in three steps',
        visit: 'specs/imagery/publish.spec.ts',
    },
    'imagery.upload-approval': {
        title: 'Historical imagery: an uploaded GeoTIFF with its own georeference, its error unmeasured, Approve',
        visit: 'specs/imagery/upload.spec.ts',
    },
    'imagery.upload-needs-points': {
        title: 'Historical imagery: an uploaded scan without georeference, waiting for points, the georeferencer',
        visit: 'specs/imagery/upload.spec.ts',
    },
    'imagery.upload-not-tiff': {
        title: 'Historical imagery: Upload refusing a file that is not a TIFF',
        visit: 'specs/imagery/upload.spec.ts',
    },
    'imagery.guard-paused': {
        title: 'Historical imagery: processing paused by the budget guard, the spend and Resume processing',
        visit: 'specs/imagery/guard.spec.ts',
    },
    'imagery.guard-resume': {
        title: 'Jobs: Resume processing? asked first, what it lets spend',
        visit: 'specs/imagery/guard.spec.ts',
    },
    'imagery.job-guard-paused': {
        title: 'Jobs: processing paused by the budget guard, the spend and Resume processing',
        visit: 'specs/imagery/guard.spec.ts',
    },
    'imagery.job-failed': {
        title: 'Jobs: a failed import, every step by its name, Run it again',
        visit: 'specs/imagery/jobs.spec.ts',
    },
    'imagery.job-points': {
        title: 'Jobs: an import waiting for points, with the georeferencer',
        visit: 'specs/imagery/jobs.spec.ts',
    },
    'georef.pairs': {
        title: 'Georeferencer: the scan, the reference map, the pairs and their residuals',
        visit: 'specs/imagery/georeferencer.spec.ts',
    },
    'georef.too-few': {
        title: 'Georeferencer: too few pairs, Save off',
        visit: 'specs/imagery/georeferencer.spec.ts',
    },
    'georef.full-screen': {
        title: 'Georeferencer: full screen, the actions above the scan and the map',
        visit: 'specs/imagery/georeferencer.spec.ts',
    },
    'georef.full-screen-refused': {
        title: 'Georeferencer: the browser refused full screen, the page fills the window and says how to allow it',
        visit: 'specs/imagery/georeferencer.spec.ts',
    },
    'georef.rmse-over': {
        title: 'Georeferencer: an error over the threshold, the warning',
        visit: 'specs/imagery/georeferencer.spec.ts',
    },
    'georef.degenerate': {
        title: 'Georeferencer: pairs in a line refused, Save off',
        visit: 'specs/imagery/georeferencer.spec.ts',
    },
    'georef.context-menu': {
        title: 'Georeferencer: the context menu on the scan, Add a point here focused',
        visit: 'specs/imagery/georef-menu.spec.ts',
    },
    'georef.linked': {
        title: 'Georeferencer: the views linked, the map zoomed with the scan',
        visit: 'specs/imagery/georef-linked.spec.ts',
    },
    'georef.ghost': {
        title: 'Georeferencer: a pair begun on the scan, the dashed ring where the pairs expect it on the still map, and the hint',
        visit: 'specs/imagery/georef-ghost.spec.ts',
    },
    'georef.pair-removed': {
        title: "Georeferencer: a chosen pair removed with the button beside the panes and put back by the notice's Undo",
        visit: 'specs/imagery/georef-ghost.spec.ts',
    },
    'georef.edit-published': {
        title: 'Georeferencer: Edit points on the version the map shows, the note on what saving does',
        visit: 'specs/imagery/layer-geometry.spec.ts',
    },
    'georef.map-shows': {
        title: 'Georeferencer: the map pane showing a published layer under the pairs, chosen from The map shows',
        visit: 'specs/imagery/layer-geometry.spec.ts',
    },
    'georef.rotated': {
        title: 'Georeferencer: the scan turned 15 degrees, the map turned with it, the turn buttons under each pane',
        visit: 'specs/imagery/georef-linked.spec.ts',
    },
    'georef.refitted': {
        title: "Georeferencer: a fitted version's pairs edited, the figures said to be a refit",
        visit: 'specs/imagery/georeferencer.spec.ts',
    },
    'layers.link-probed': {
        title: 'Layers, Link a layer: Check asked one tile, which answered',
        visit: 'specs/imagery/link-probe.spec.ts',
    },
    'layers.link-no-tiles': {
        title: 'Layers, Link a layer: Check found no tiles, Link off',
        visit: 'specs/imagery/link-probe.spec.ts',
    },
    'layers.pending-version': {
        title: "Layer editor: a new version of the layer's image on its way, the layer keeping its tiles",
        visit: 'specs/imagery/layer-geometry.spec.ts',
    },
    'layers.crop-refused': {
        title: 'Layer editor: a crop off the layer refused, why',
        visit: 'specs/imagery/layer-geometry.spec.ts',
    },
    'layers.crop-drawn': {
        title: 'Layer editor: the area to keep drawn on the map, Save the crop',
        visit: 'specs/imagery/layer-geometry.spec.ts',
    },
    'settings.imagery': {
        title: 'Settings: historical imagery, auto-publish off',
        visit: 'specs/imagery/publish.spec.ts',
    },
} as const;
