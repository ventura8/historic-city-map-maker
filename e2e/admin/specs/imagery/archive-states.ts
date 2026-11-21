/**
 * M20's states of the tour inventory (docs/research/M20-import-local.md §8; `ADMIN_SECTION_STATES` of e2e/tour/admin-sections.ts
 * spreads them): Import local files in the Upload view, an archive's report before and after Import, and Settings' drawn maps, ids
 * `archive.<state>`, each reached by specs/imagery/archive.spec.ts.
 */
export const ARCHIVE_STATES = {
    'archive.panel-worker': {
        title: 'Historical imagery, Upload: Import local files with the computer connected, Choose a folder, Choose a zip, the scanned archives',
        visit: 'specs/imagery/archive.spec.ts',
    },
    'archive.panel-local-refused': {
        title: "Historical imagery, Upload: Import local files that the computer's worker refused, and why (batch 4)",
        visit: 'specs/imagery/archive.spec.ts',
    },
    'archive.panel-no-worker': {
        title: 'Historical imagery, Upload: Import local files with no computer connected: start the worker first, Open Jobs',
        visit: 'specs/imagery/archive.spec.ts',
    },
    'archive.report': {
        title: "An archive's scan report: its series, what happens to each, rights to confirm, the estimate, the total and Import",
        visit: 'specs/imagery/archive.spec.ts',
    },
    'archive.report-year-invalid': {
        title: "An archive's scan report: a series' year a layer cannot show, said at its field, Import off",
        visit: 'specs/imagery/archive.spec.ts',
    },
    'archive.progress': {
        title: 'An imported archive: a series at work on the computer, one waiting for points and why',
        visit: 'specs/imagery/archive.spec.ts',
    },
    'archive.settings-maps': {
        title: "Settings, Historical imagery: drawn maps publish themselves within their scaled threshold, the cap's field",
        visit: 'specs/imagery/archive.spec.ts',
    },
} as const;
