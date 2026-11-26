/**
 * Romanian texts of the admin's M5 static export (`docs/research/M5-interfaces.md` §5.6): the export card in Settings,
 * its states and the photos licensed for this map only. The source of truth for `AdminExportKey`; `en.ts` is typed
 * against it. Merged into `translateAdminContent` by `../admin-content/index.ts`. One entry per line
 * (scripts/ci/check_i18n.py); every key carries its section's prefix (`packages/shared/test/i18n-admin.test.ts`).
 * Owner: export (the contracts agent wrote the texts the contract names).
 */
export const ro = {
    // [section export] owner: export; keys adminContent.export.*
    'adminContent.export.title': 'Exportă orașul',
    'adminContent.export.intro': 'Un .zip cu tot ce trebuie ca orașul să meargă pe orice găzduire statică, fără Firebase.',
    'adminContent.export.rasters': 'Include scanările USGS ({size})',
    'adminContent.export.rastersHelp': 'Doar scanările USGS (domeniu public); celelalte straturi rămân doar ca referințe.',
    'adminContent.export.start': 'Exportă',
    'adminContent.export.queued': 'Exportul așteaptă să pornească…',
    'adminContent.export.building': 'Se pregătește arhiva…',
    'adminContent.export.ready': 'Arhiva e gata: {size}; fotografii: {photos}, straturi: {layers}.',
    'adminContent.export.download': 'Descarcă',
    'adminContent.export.expires': 'Se poate descărca până la {date}.',
    'adminContent.export.checksum': 'SHA-256: {sha256}',
    'adminContent.export.restricted.one': '{count} fotografie are permisiune doar pentru această hartă: RIGHTS.md o numește.',
    'adminContent.export.restricted.few': '{count} fotografii au permisiune doar pentru această hartă: RIGHTS.md le numește.',
    'adminContent.export.restricted.other': '{count} de fotografii au permisiune doar pentru această hartă: RIGHTS.md le numește.',
    'adminContent.export.failed': 'Exportul nu a reușit: {reason}',
    'adminContent.export.expired': 'Exportul a expirat și a fost șters.',
    'adminContent.export.again': 'Exportă din nou',
    'adminContent.export.ownerOnly': 'Doar proprietarii orașului îl pot exporta.',
    'adminContent.export.unpublished': 'Publică orașul înainte să-l exporți.',
    // [end export]
} as const;

export type AdminExportKey = keyof typeof ro;
