import type { AdminExportKey } from './ro.js';

/**
 * English texts of the admin's M5 static export: the export card in Settings, its states and the photos licensed for
 * this map only. Typed against the Romanian source of truth (`ro.ts`): a missing or extra key is a type error.
 */
export const en: Readonly<Record<AdminExportKey, string>> = {
    // [section export] owner: export; keys adminContent.export.*
    'adminContent.export.title': 'Export the city',
    'adminContent.export.intro': 'A .zip with everything the city needs to run on any static host, without Firebase.',
    'adminContent.export.rasters': 'Include the USGS scans ({size})',
    'adminContent.export.rastersHelp': 'Only the USGS scans (public domain); the other layers stay references only.',
    'adminContent.export.start': 'Export',
    'adminContent.export.queued': 'The export is waiting to start…',
    'adminContent.export.building': 'Preparing the archive…',
    'adminContent.export.ready': 'The archive is ready: {size}; photos: {photos}, layers: {layers}.',
    'adminContent.export.download': 'Download',
    'adminContent.export.expires': 'It can be downloaded until {date}.',
    'adminContent.export.checksum': 'SHA-256: {sha256}',
    'adminContent.export.restricted.one': '{count} photo is licensed for this map only: RIGHTS.md names it.',
    'adminContent.export.restricted.few': '{count} photos are licensed for this map only: RIGHTS.md names them.',
    'adminContent.export.restricted.other': '{count} photos are licensed for this map only: RIGHTS.md names them.',
    'adminContent.export.failed': 'The export failed: {reason}',
    'adminContent.export.expired': 'The export has expired and was deleted.',
    'adminContent.export.again': 'Export again',
    'adminContent.export.ownerOnly': 'Only the city’s owners can export it.',
    'adminContent.export.unpublished': 'Publish the city before you export it.',
    // [end export]
};
