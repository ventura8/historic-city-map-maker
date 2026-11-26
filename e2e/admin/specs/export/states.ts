/**
 * The static export's states of the tour inventory (M5, docs/research/M5-interfaces.md §5.6, §7.3; `ADMIN_STATES` of
 * e2e/tour/states.ts spreads them inside its export section), ids `export.<state>`: Settings → Export the city with
 * nothing exported yet, an export being prepared, ready to download, failed, expired, and an editor's read-only view.
 * Each is reached by `specs/export/export.spec.ts` at the admin tier's projects, in a content world of its own.
 */
export const EXPORT_STATES = {
    'export.card': {
        title: 'Settings → Export the city: the intro and Export, nothing exported yet',
        visit: 'specs/export/export.spec.ts',
    },
    'export.building': {
        title: 'Export the city: the archive is being prepared, Export waits',
        visit: 'specs/export/export.spec.ts',
    },
    'export.ready': {
        title: 'Export the city: ready, with its size, counts, SHA-256, expiry, the restricted photos and Download',
        visit: 'specs/export/export.spec.ts',
    },
    'export.failed': {
        title: 'Export the city: the export failed as too large, with Export again',
        visit: 'specs/export/export.spec.ts',
    },
    'export.expired': {
        title: 'Export the city: the export expired and was deleted, with Export again',
        visit: 'specs/export/export.spec.ts',
    },
    'export.readonly': {
        title: 'Export the city: an editor sees the export read-only, only the owners export',
        visit: 'specs/export/export.spec.ts',
    },
} as const;
