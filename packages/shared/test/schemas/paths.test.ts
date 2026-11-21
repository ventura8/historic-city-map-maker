import { describe, expect, it } from 'vitest';

import {
    auditedDocumentPath,
    cityIdSchema,
    FIRESTORE_PATHS,
    parseAuditedDocumentPath,
    parsePhotoUploadPath,
    publicObjectUrl,
    STORAGE_PATHS,
} from '../../src/schemas/paths.js';

const SHA = 'ab12cd34'.repeat(8);

describe('Firestore paths', () => {
    it('happyPath_everyBuilderSpellsItsPath', () => {
        const city = 'bucuresti';

        expect([
            FIRESTORE_PATHS.city(city),
            FIRESTORE_PATHS.photos(city),
            FIRESTORE_PATHS.photo(city, 'p1'),
            FIRESTORE_PATHS.layers(city),
            FIRESTORE_PATHS.layer(city, 'l1'),
            FIRESTORE_PATHS.pois(city),
            FIRESTORE_PATHS.poi(city, 'x'),
            FIRESTORE_PATHS.poiCategories(city),
            FIRESTORE_PATHS.poiCategory(city, 'c'),
            FIRESTORE_PATHS.jobs(city),
            FIRESTORE_PATHS.job(city, 'j'),
            FIRESTORE_PATHS.jobLogs(city, 'j'),
            FIRESTORE_PATHS.usgsScenes(city),
            FIRESTORE_PATHS.usgsScene(city, 'DS1035-1057DA023'),
            FIRESTORE_PATHS.history({ entity: 'poi', cityId: city, entityId: 'x' }),
            FIRESTORE_PATHS.historyEntry({ entity: 'city', cityId: city, entityId: city }, '1760000000000-evt_1'),
            FIRESTORE_PATHS.admin('uid-1'),
            FIRESTORE_PATHS.invite(SHA),
            FIRESTORE_PATHS.usage('2026-10'),
            FIRESTORE_PATHS.manifestState(city),
            FIRESTORE_PATHS.imageryPlan(city),
        ]).toEqual([
            'cities/bucuresti',
            'cities/bucuresti/photos',
            'cities/bucuresti/photos/p1',
            'cities/bucuresti/layers',
            'cities/bucuresti/layers/l1',
            'cities/bucuresti/pois',
            'cities/bucuresti/pois/x',
            'cities/bucuresti/poiCategories',
            'cities/bucuresti/poiCategories/c',
            'cities/bucuresti/jobs',
            'cities/bucuresti/jobs/j',
            'cities/bucuresti/jobs/j/logs',
            'cities/bucuresti/usgsScenes',
            'cities/bucuresti/usgsScenes/DS1035-1057DA023',
            'cities/bucuresti/pois/x/history',
            'cities/bucuresti/history/1760000000000-evt_1',
            'admins/uid-1',
            `invites/${SHA}`,
            'usage/mapbox-2026-10',
            'manifests/bucuresti',
            'cities/bucuresti/imageryPlans/dates',
        ]);
        expect([
            FIRESTORE_PATHS.admins,
            FIRESTORE_PATHS.invites,
            FIRESTORE_PATHS.setupStatus,
            FIRESTORE_PATHS.setupOwner,
            FIRESTORE_PATHS.opsGuard,
        ]).toEqual(['admins', 'invites', 'setup/status', 'setup/owner', 'ops/guard']);
        expect(FIRESTORE_PATHS.manifestStates).toBe('manifests');
        expect(FIRESTORE_PATHS.cities).toBe(FIRESTORE_PATHS.city('bucuresti').split('/')[0]);
    });

    it.each([
        ['a city id with capitals', () => FIRESTORE_PATHS.city('Bucuresti')],
        ['a photo id with a slash', () => FIRESTORE_PATHS.photo('bucuresti', 'a/b')],
        ['a uid that climbs up', () => FIRESTORE_PATHS.admin('..')],
        ['an invitation id that is an e-mail address', () => FIRESTORE_PATHS.invite('a@example.test')],
        ['a month 13', () => FIRESTORE_PATHS.usage('2026-13')],
        [
            'a history entry id without its time',
            () => FIRESTORE_PATHS.historyEntry({ entity: 'poi', cityId: 'bucuresti', entityId: 'x' }, 'evt'),
        ],
        ['a city entity of another city', () => auditedDocumentPath({ entity: 'city', cityId: 'bucuresti', entityId: 'cluj' })],
        ['a manifest of an empty city', () => FIRESTORE_PATHS.manifestState('')],
    ])('badPath_%s_throws', (_name, build) => {
        expect(build).toThrow(RangeError);
    });
});

/** M4 (docs/research/M4-interfaces.md §4, §5): the inbox, push devices, notification events, the assists' documents. */
describe('the M4 paths', () => {
    const DEVICE = 'a1b2c3d4'.repeat(4);

    it('happyPath_everyBuilderSpellsItsPath', () => {
        expect([
            FIRESTORE_PATHS.inbox('uid-1'),
            FIRESTORE_PATHS.inboxItem('uid-1', 'order.reminder~bucharest~DS1105-1071DF076~7'),
            FIRESTORE_PATHS.notifySettings('uid-1'),
            FIRESTORE_PATHS.pushDevices('uid-1'),
            FIRESTORE_PATHS.pushDevice('uid-1', DEVICE),
            FIRESTORE_PATHS.notificationEvent('budget.paused~2026-10-01'),
            FIRESTORE_PATHS.geocodeCell('n444268_e261025'),
            FIRESTORE_PATHS.aiUsage('2026-10'),
        ]).toEqual([
            'admins/uid-1/inbox',
            'admins/uid-1/inbox/order.reminder~bucharest~DS1105-1071DF076~7',
            'admins/uid-1/notify/settings',
            'admins/uid-1/pushDevices',
            `admins/uid-1/pushDevices/${DEVICE}`,
            'notificationEvents/budget.paused~2026-10-01',
            'assistGeocodes/n444268_e261025',
            'usage/ai-2026-10',
        ]);
        expect([FIRESTORE_PATHS.notificationEvents, FIRESTORE_PATHS.geocodeCells, FIRESTORE_PATHS.assistState]).toEqual([
            'notificationEvents',
            'assistGeocodes',
            'ops/assist',
        ]);
    });

    it.each([
        ['an event id without its parts', () => FIRESTORE_PATHS.notificationEvent('budget.paused')],
        ['an event id with a slash', () => FIRESTORE_PATHS.inboxItem('uid-1', 'job.failed~a/b')],
        ['a device id that is a token', () => FIRESTORE_PATHS.pushDevice('uid-1', 'fcm-token:abc')],
        ['a cell with too many decimals', () => FIRESTORE_PATHS.geocodeCell('n44426812_e261025')],
        ['an AI month 00', () => FIRESTORE_PATHS.aiUsage('2026-00')],
    ])('badPath_%s_throws', (_name, build) => {
        expect(build).toThrow(RangeError);
    });
});

describe('audited documents', () => {
    it.each([
        ['cities/bucuresti', { entity: 'city', cityId: 'bucuresti', entityId: 'bucuresti' }],
        ['cities/bucuresti/photos/p1', { entity: 'photo', cityId: 'bucuresti', entityId: 'p1' }],
        ['cities/bucuresti/layers/l1', { entity: 'layer', cityId: 'bucuresti', entityId: 'l1' }],
        ['cities/bucuresti/pois/x', { entity: 'poi', cityId: 'bucuresti', entityId: 'x' }],
        ['cities/bucuresti/poiCategories/c', { entity: 'poiCategory', cityId: 'bucuresti', entityId: 'c' }],
    ] as const)('happyPath_%s_roundTrips', (path, document) => {
        expect(parseAuditedDocumentPath(path)).toEqual(document);
        expect(auditedDocumentPath(document)).toBe(path);
    });

    it.each([
        'cities',
        'towns/bucuresti',
        'cities/Bucuresti',
        'cities/bucuresti/jobs/j1',
        'cities/bucuresti/photos/a.b',
        'towns/bucuresti/photos/p1',
        'cities/x/photos/p1',
        'cities/bucuresti/photos/p1/history/1',
    ])('badPath_%s_isNotAudited', (path) => {
        expect(parseAuditedDocumentPath(path)).toBeUndefined();
    });
});

describe('Storage paths', () => {
    it('happyPath_everyBuilderSpellsItsPath', () => {
        expect([
            STORAGE_PATHS.photoUpload('bucuresti', 'uid-1', 'p1', 'Xy7_aB9-q2.jpg'),
            STORAGE_PATHS.photoOriginal('bucuresti', 'p1', SHA, 'image/heic'),
            STORAGE_PATHS.photoDerivative('bucuresti', 'p1', SHA, 'thumb'),
            STORAGE_PATHS.manifest('bucuresti'),
        ]).toEqual([
            'uploads/photos/bucuresti/uid-1/p1/Xy7_aB9-q2.jpg',
            `originals/photos/bucuresti/p1/${SHA}.heic`,
            'photos/bucuresti/p1/ab12cd34/thumb.webp',
            'cities/bucuresti/manifest.json',
        ]);
    });

    it('happyPath_anUploadPathParsesBack', () => {
        expect(parsePhotoUploadPath('uploads/photos/bucuresti/uid-1/p1/Xy7_aB9-q2.jpeg')).toEqual({
            cityId: 'bucuresti',
            uid: 'uid-1',
            photoId: 'p1',
            fileName: 'Xy7_aB9-q2.jpeg',
        });
    });

    it.each([
        'uploads/photos/bucuresti/uid-1/p1',
        'uploads/rasters/bucuresti/uid-1/p1/Xy7_aB9-q2.jpg',
        'downloads/photos/bucuresti/uid-1/p1/Xy7_aB9-q2.jpg',
        'uploads/photos/Bucuresti/uid-1/p1/Xy7_aB9-q2.jpg',
        'uploads/photos/bucuresti/uid.1/p1/Xy7_aB9-q2.jpg',
        'uploads/photos/bucuresti/uid-1/p.1/Xy7_aB9-q2.jpg',
        'uploads/photos/bucuresti/uid-1/p1/short.jpg',
        'uploads/photos/bucuresti/uid-1/p1/Xy7_aB9-q2.svg',
    ])('badPath_%s_isNoPhotoUpload', (path) => {
        expect(parsePhotoUploadPath(path)).toBeUndefined();
    });

    it.each([
        ['an upload file without a nonce', () => STORAGE_PATHS.photoUpload('bucuresti', 'uid-1', 'p1', 'a.jpg')],
        ['an original of a short hash', () => STORAGE_PATHS.photoOriginal('bucuresti', 'p1', 'abc', 'image/jpeg')],
        ['a derivative of another city id', () => STORAGE_PATHS.photoDerivative('a', 'p1', SHA, 'web')],
        ['a manifest of a city id with a slash', () => STORAGE_PATHS.manifest('a/b')],
    ])('badPath_%s_throws', (_name, build) => {
        expect(build).toThrow(RangeError);
    });

    it('happyPath_aPublicObjectUrl', () => {
        expect(publicObjectUrl('bucurestiul-disparut-public', 'cities/bucuresti/manifest.json')).toBe(
            'https://storage.googleapis.com/bucurestiul-disparut-public/cities/bucuresti/manifest.json',
        );
    });

    it('badPath_aBucketNameWithASlashThrows', () => {
        expect(() => publicObjectUrl('evil.example/x', 'm.json')).toThrow(RangeError);
    });

    it('badPath_cityIdsAreLowercaseStorageFolders', () => {
        expect(cityIdSchema.safeParse('bucuresti').success).toBe(true);
        expect(cityIdSchema.safeParse('Bucuresti').success).toBe(false);
    });
});

describe('M5 paths (docs/research/M5-interfaces.md §1.8, §5)', () => {
    it('happyPath_aCitysUsageAndExportsLiveUnderTheCity', () => {
        expect([
            FIRESTORE_PATHS.cityUsage('cluj', '2026-11'),
            FIRESTORE_PATHS.cityExports('cluj'),
            FIRESTORE_PATHS.cityExport('cluj', 'e1761400000000-ab12cd'),
            STORAGE_PATHS.cityExport('cluj', 'e1761400000000-ab12cd'),
        ]).toEqual([
            'cities/cluj/usage/2026-11',
            'cities/cluj/exports',
            'cities/cluj/exports/e1761400000000-ab12cd',
            'exports/cluj/e1761400000000-ab12cd.zip',
        ]);
    });

    it.each([
        ['a usage month 13', () => FIRESTORE_PATHS.cityUsage('cluj', '2026-13')],
        ['an export id with a slash', () => FIRESTORE_PATHS.cityExport('cluj', 'a/b')],
        ['an export object of a city id with capitals', () => STORAGE_PATHS.cityExport('Cluj', 'e1')],
        ['an export object whose id climbs up', () => STORAGE_PATHS.cityExport('cluj', '..')],
    ])('badPath_%s_throws', (_name, build) => {
        expect(build).toThrow(RangeError);
    });
});
