import { existsSync, readFileSync } from 'node:fs';

import { migrateLegacyPhotos } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { bundleUrl, isLegacyRecord, legacyRecord, uploadType } from '../../src/import/bundle.js';

/** The legacy bundle's records as photo documents a client may create (M2b §3.3 h). */

const SEED = new URL('../../../../seed/bucharest/', import.meta.url);

describe('legacyRecord', () => {
    it('happyPath_everyMigratedBucharestPhotoIsAValidPhotoDocumentWithItsOriginal', () => {
        const migration = migrateLegacyPhotos(JSON.parse(readFileSync(new URL('photos.legacy.geojson', SEED), 'utf8')));
        const records = migration.photos.map(legacyRecord);
        const valid = records.filter(isLegacyRecord);
        const missing = valid.map((record) => record.sourceFile).filter((file) => !existsSync(new URL(`photos/${file}`, SEED)));

        expect(valid).toHaveLength(records.length);
        expect(records).toHaveLength(45);
        expect(valid.every((record) => record.fields.license === 'permission-legacy' && record.fields.rightsReview)).toBe(true);
        expect(valid.every((record) => !record.fields.published && record.fields.processing === 'pending')).toBe(true);
        expect(missing).toEqual([]);
        expect(valid.every((record) => uploadType(record.sourceFile) !== undefined)).toBe(true);
    });

    it('badPath_aMalformedRecordOrOneTheSchemaRefusesIsNamed', () => {
        expect(legacyRecord({ sourceFile: '../etc/passwd', photo: { id: 'a' } }, 3)).toEqual({ id: '#3' });
        expect(legacyRecord({ sourceFile: 'a.jpg', photo: { id: 'a', title: { ro: '' } } }, 0)).toEqual({ id: 'a' });
    });

    it('happyPath_onlyTheClientsFieldsAreKeptAndEmptyLinksDropped', () => {
        const record = legacyRecord(
            {
                sourceFile: 'Arionoaia 1980.jpg',
                legacyId: 'ci9e9tn7b0356kzkuzlkncngf',
                photo: {
                    id: 'arionoaia-1980',
                    title: { ro: 'Arionoaiei' },
                    location: { lat: 44.42, lng: 26.1 },
                    links: [],
                    image: { web: 'x' },
                },
            },
            0,
        );

        expect(record).toEqual({
            id: 'arionoaia-1980',
            sourceFile: 'Arionoaia 1980.jpg',
            legacyId: 'ci9e9tn7b0356kzkuzlkncngf',
            fields: {
                title: { ro: 'Arionoaiei' },
                location: { lat: 44.42, lng: 26.1 },
                legacyId: 'ci9e9tn7b0356kzkuzlkncngf',
                license: 'permission-legacy',
                rightsReview: true,
                published: false,
                processing: 'pending',
            },
        });
    });
});

describe('uploadType and bundleUrl', () => {
    it('happyPath_theExtensionDecidesTheContentType', () => {
        expect(uploadType('Ferdinand.PNG')).toEqual({ extension: 'png', contentType: 'image/png' });
        expect(uploadType('a.jpeg')).toEqual({ extension: 'jpeg', contentType: 'image/jpeg' });
        expect(bundleUrl('https://demo-hcm.web.app/', 'bucharest', 'originals/A%20b.jpg')).toBe(
            'https://demo-hcm.web.app/legacy/bucharest/originals/A%20b.jpg',
        );
    });

    it('badPath_aTypeThePipelineRefusesHasNone', () => {
        expect(uploadType('scan.gif')).toBeUndefined();
        expect(uploadType('no-extension')).toBeUndefined();
    });
});
