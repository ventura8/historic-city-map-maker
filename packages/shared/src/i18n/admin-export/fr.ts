import type { AdminExportKey } from './ro.js';

/**
 * The `packages/shared/src/i18n/admin-export` family's texts in `fr`, imported by scripts/i18n/import_translations.py (docs/I18N.md).
 * Partial while the translation goes on: a key not here shows in English.
 */
export const fr: Readonly<Partial<Record<AdminExportKey, string>>> = {
    'adminContent.export.title': 'Exporter la ville',
    'adminContent.export.intro':
        'Une archive .zip contenant tout ce dont la ville a besoin pour fonctionner sur n’importe quel hébergement statique, sans Firebase.',
    'adminContent.export.rasters': 'Inclure les images numérisées de l’USGS ({size}).',
    'adminContent.export.rastersHelp':
        'Seules les scans de l’USGS (domaine public) sont importés ; les autres calques restent des références.',
    'adminContent.export.start': 'Exporter',
    'adminContent.export.queued': "L'exportation est en attente de lancement…",
    'adminContent.export.building': 'Préparation de l’archive…',
    'adminContent.export.ready': 'L’archive est prête : {size} ; photos : {photos}, couches : {layers}.',
    'adminContent.export.download': 'Télécharger',
    'adminContent.export.expires': 'Il peut être téléchargé jusqu’au {date}.',
    'adminContent.export.checksum': 'SHA-256 : {sha256}',
    'adminContent.export.restricted.one':
        '{count} photo est réservée à cette carte : son autorisation est précisée dans le fichier RIGHTS.md.',
    'adminContent.export.restricted.few':
        '{count} photos sont réservées à cette carte : leur licence est précisée dans le fichier RIGHTS.md.',
    'adminContent.export.restricted.other':
        '{count} photos sont réservées à cette carte : leur licence est précisée dans le fichier RIGHTS.md.',
    'adminContent.export.failed': 'L’exportation a échoué : {reason}',
    'adminContent.export.expired': "L'export a expiré et a été supprimé.",
    'adminContent.export.again': 'Réexporter',
    'adminContent.export.ownerOnly': 'Seul le propriétaire de la ville peut l’exporter.',
    'adminContent.export.unpublished': 'Publiez la ville avant de l’exporter.',
};
