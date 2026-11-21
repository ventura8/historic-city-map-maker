/**
 * firebase/storage.rules (the PRIVATE bucket): own-uid uploads only (STORAGE_PATHS.photoUpload, into the folder of an
 * existing photo document; RASTER_PATHS.upload with exactly `rasterUploadMetadataSchema`'s metadata), type, size and
 * name limits, no SVG, no overwrite, admin-only reads, nothing public, and every other object written by service
 * accounts only. The Storage emulator has no rule-coverage report, so every
 * condition has an explicit allow and deny case here.
 */
import { FIRESTORE_PATHS, PHOTO_CONTENT_TYPES, STORAGE_PATHS } from '@hcm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { photoDoc } from './support/documents.js';
import {
    ANY_ADMIN,
    EVERYONE,
    NOBODY,
    bytes,
    createWorld,
    expected,
    verdict,
    verdicts,
    type Persona,
    type Verdict,
    type World,
} from './support/world.js';

const MIB = 1024 * 1024;
const CITY_ID = 'storage-city';
const PHOTO_ID = 'p1';

let world: World;
let sequence = 0;

function nonce(): string {
    sequence += 1;
    return `nonce${String(sequence).padStart(6, '0')}`;
}

function photoUpload(persona: Persona, file = `${nonce()}.jpg`): string {
    return STORAGE_PATHS.photoUpload(CITY_ID, world.uid(persona), PHOTO_ID, file);
}

function rasterUpload(persona: Persona, city = CITY_ID, upload = nonce(), file = `${nonce()}.tif`): string {
    return `uploads/rasters/${city}/${world.uid(persona)}/${upload}/${file}`;
}

interface Upload {
    readonly contentType?: string;
    readonly size?: number;
    readonly originalName?: string;
    /** Custom metadata beyond the original name (a raster upload's `year` and `layerId`). */
    readonly metadata?: Readonly<Record<string, string>>;
}

/** The upload request itself (for `verdicts`). */
function send(persona: Persona, path: string, upload: Upload = {}): Promise<unknown> {
    const { contentType = 'image/jpeg', size = 1024, originalName, metadata = {} } = upload;
    const custom = originalName === undefined ? metadata : { ...metadata, originalName };
    const customMetadata = Object.keys(custom).length === 0 ? {} : { customMetadata: custom };
    return world
        .storage(persona)
        .ref(path)
        .put(bytes(size), { contentType, ...customMetadata })
        .then(() => undefined);
}

function put(persona: Persona, path: string, upload: Upload = {}): Promise<Verdict> {
    return verdict(send(persona, path, upload));
}

beforeAll(async () => {
    world = await createWorld('storage');
    await world.seed(FIRESTORE_PATHS.photo(CITY_ID, PHOTO_ID), photoDoc(CITY_ID, PHOTO_ID, world.uid('admin')));
});

afterAll(async () => {
    await world.close();
});

describe('photo uploads', () => {
    it.each(PHOTO_CONTENT_TYPES)('happyPath_adminUploads_%s', async (contentType) => {
        expect(await put('admin', photoUpload('admin'), { contentType })).toBe('allow');
    });

    it.each([
        ['a .jpeg name', 'abcdefgh.jpeg'],
        ['a TIFF name', 'abcdefgh.tiff'],
        ['a HEIF name', 'abcdefgh_-12.heif'],
    ])('happyPath_adminUploadsAFileWith_%s', async (_label, file) => {
        expect(await put('admin', photoUpload('admin', file))).toBe('allow');
    });

    it('happyPath_theOriginalFileNameTravelsAsMetadata', async () => {
        expect(await put('admin', photoUpload('admin'), { originalName: 'Piata Romana, 1936.jpg' })).toBe('allow');
        expect(await put('admin', photoUpload('admin'), { originalName: 'x'.repeat(255) })).toBe('allow');
    });

    it('badPath_onlyAdminsUploadIntoTheirOwnFolder', async () => {
        const result = await verdicts(EVERYONE, (persona) => send(persona, photoUpload(persona)));

        expect(result).toEqual(expected(EVERYONE, ['admin']));
    });

    it('badPath_adminCannotUploadIntoAnotherAdminsFolder', async () => {
        expect(await put('admin', photoUpload('pending'))).toBe('deny');
    });

    it.each(['image/svg+xml', 'image/gif', 'text/html', 'application/pdf', 'application/octet-stream', 'image/jpeg2000'])(
        'badPath_adminCannotUpload_%s',
        async (contentType) => {
            expect(await put('admin', photoUpload('admin'), { contentType })).toBe('deny');
        },
    );

    it.each([
        ['60 MiB or more', 60 * MIB],
        ['an empty file', 0],
    ])('badPath_photosOfTheWrongSizeAreRejected_%s', async (_label, size) => {
        expect(await put('admin', photoUpload('admin'), { size })).toBe('deny');
    });

    it('happyPath_anImprovedOrColorizedVersionTravelsAsMetadata', async () => {
        expect(await put('admin', photoUpload('admin'), { metadata: { version: 'improved' } })).toBe('allow');
        expect(await put('admin', photoUpload('admin'), { metadata: { version: 'colorized' } })).toBe('allow');
    });

    it('badPath_anUnknownVersionIsRejected', async () => {
        expect(await put('admin', photoUpload('admin'), { metadata: { version: 'sepia' } })).toBe('deny');
    });

    it('badPath_anOriginalNameOver255CharactersIsRejected', async () => {
        expect(await put('admin', photoUpload('admin'), { originalName: 'x'.repeat(256) })).toBe('deny');
    });

    it.each([
        ['no extension', 'abcdefgh'],
        ['an SVG name', 'abcdefgh.svg'],
        ['an upper-case extension', 'abcdefgh.JPG'],
        ['a short nonce', 'abc.jpg'],
        ['a dotted nonce', 'abc.defgh.jpg'],
    ])('badPath_fileNamesFollowTheUploadPattern_%s', async (_label, file) => {
        expect(await put('admin', `uploads/photos/${CITY_ID}/${world.uid('admin')}/${PHOTO_ID}/${file}`)).toBe('deny');
    });

    it.each([
        ['an upper-case city', `uploads/photos/Storage-city/{uid}/${PHOTO_ID}/abcdefgh.jpg`],
        ['a one-letter city', `uploads/photos/s/{uid}/${PHOTO_ID}/abcdefgh.jpg`],
        ['a city id over 32 characters', `uploads/photos/${'s'.repeat(33)}/{uid}/${PHOTO_ID}/abcdefgh.jpg`],
        ['a photo id with a dot', `uploads/photos/${CITY_ID}/{uid}/p.1/abcdefgh.jpg`],
        ['a photo without its document', `uploads/photos/${CITY_ID}/{uid}/p404/abcdefgh.jpg`],
        ['a photo of another city', `uploads/photos/storage-other/{uid}/${PHOTO_ID}/abcdefgh.jpg`],
        ['a folder too deep', `uploads/photos/${CITY_ID}/{uid}/${PHOTO_ID}/extra/abcdefgh.jpg`],
    ])('badPath_uploadsGoIntoAnExistingPhotosFolder_%s', async (_label, template) => {
        expect(await put('admin', template.replace('{uid}', world.uid('admin')))).toBe('deny');
    });

    it('badPath_uploadsAreNeverOverwritten', async () => {
        const path = photoUpload('admin');
        await world.seedObject(path, 'image/jpeg');

        expect(await put('admin', path, { contentType: 'image/png' })).toBe('deny');
        expect(await verdict(world.storage('admin').ref(path).updateMetadata({ contentType: 'image/svg+xml' }))).toBe('deny');
    });

    it('happyPath_onlyAdminsReadAndDeleteUploads', async () => {
        const path = photoUpload('admin');
        await world.seedObject(path, 'image/jpeg');

        const reads = await verdicts(EVERYONE, (persona) => world.storage(persona).ref(path).getMetadata());
        const deletes = await verdicts(EVERYONE, (persona) => world.storage(persona).ref(path).delete());

        expect({ reads, deletes }).toEqual({ reads: expected(EVERYONE, ['admin']), deletes: expected(EVERYONE, ['admin']) });
    });
});

describe('raster uploads', () => {
    it.each(['image/tiff', 'application/octet-stream'])('happyPath_adminUploadsGeoTiffAs_%s', async (contentType) => {
        expect(await put('admin', rasterUpload('admin'), { contentType })).toBe('allow');
    });

    it('happyPath_aReplacementCarriesItsNameYearAndLayer', async () => {
        const metadata = { year: '1911', layerId: 'planul-bucurestilor-1911' };
        const path = rasterUpload('admin', CITY_ID, nonce(), `${nonce()}.tiff`);

        expect(await put('admin', path, { contentType: 'image/tiff', originalName: 'Planul Bucureștilor 1911.tif', metadata })).toBe(
            'allow',
        );
    });

    it.each([
        ['a name that is no nonce', () => rasterUpload('admin', CITY_ID, nonce(), 'scan.tif'), {}],
        ['a name that is not a TIFF', () => rasterUpload('admin', CITY_ID, nonce(), `${nonce()}.png`), {}],
        ['an original name over 255 characters', () => rasterUpload('admin'), { originalName: `${'x'.repeat(252)}.tif` }],
        ['a year of two digits', () => rasterUpload('admin'), { metadata: { year: '19' } }],
        ['a year after 2099', () => rasterUpload('admin'), { metadata: { year: '2100' } }],
        ['a layer id that leaves its folder', () => rasterUpload('admin'), { metadata: { layerId: '../plan' } }],
        ['metadata the schema does not know', () => rasterUpload('admin'), { metadata: { note: 'x' } }],
    ] as const)('badPath_rasterUploadMetadataAndNamesFollowTheContract_%s', async (_label, path, upload) => {
        expect(await put('admin', path(), { contentType: 'image/tiff', ...upload })).toBe('deny');
    });

    it('badPath_onlyAdminsUploadRasters', async () => {
        const result = await verdicts(EVERYONE, (persona) => send(persona, rasterUpload(persona), { contentType: 'image/tiff' }));

        expect(result).toEqual(expected(EVERYONE, ['admin']));
    });

    it.each([
        ['a JPEG', rasterUpload, { contentType: 'image/jpeg' }],
        ['an empty file', rasterUpload, { contentType: 'image/tiff', size: 0 }],
        ['another admins folder', () => rasterUpload('pending'), { contentType: 'image/tiff' }],
        ['an upper-case city', () => rasterUpload('admin', 'Bucuresti'), { contentType: 'image/tiff' }],
        ['an upload id with a dot', () => rasterUpload('admin', CITY_ID, 'u.1'), { contentType: 'image/tiff' }],
    ] as const)('badPath_rasterUploadDeniedFor_%s', async (_label, path, upload) => {
        expect(await put('admin', path('admin'), upload)).toBe('deny');
    });

    it('happyPath_onlyAdminsReadAndDeleteRasterUploads', async () => {
        const path = rasterUpload('admin');
        await world.seedObject(path, 'image/tiff');

        const reads = await verdicts(EVERYONE, (persona) => world.storage(persona).ref(path).getMetadata());
        const deletes = await verdicts(EVERYONE, (persona) => world.storage(persona).ref(path).delete());

        expect({ reads, deletes }).toEqual({ reads: expected(EVERYONE, ['admin']), deletes: expected(EVERYONE, ['admin']) });
    });
});

describe('server-written objects', () => {
    // M5 (docs/research/M5-interfaces.md §1.4): what lies under a city is read by that city's admins only; a USGS browse
    // copy by every admin; anything else (USGS deliveries, exports, scratch, paths with no city) by nobody.
    const objects: readonly (readonly [string, readonly Persona[]])[] = [
        [STORAGE_PATHS.photoOriginal(CITY_ID, PHOTO_ID, 'ab'.repeat(32), 'image/jpeg'), ['admin']],
        [`rasters/${CITY_ID}/corona-1966/v1/cog.tif`, ['admin']],
        [`work/${CITY_ID}/job-1/frame.tif`, ['admin']],
        [`reference/${CITY_ID}/osm/k1.geojson`, ['admin']],
        ['usgs-browse/corona2/DS1034-1057DA024.jpg', ANY_ADMIN],
        ['usgs-raw/storage/frame.tgz', NOBODY],
        ['previews/storage/browse.jpg', NOBODY],
        ['tmp/selftest', NOBODY],
        [STORAGE_PATHS.cityExport(CITY_ID, 'export-1'), NOBODY],
        // Paths of the PUBLIC bucket's layout: in this bucket they are server-only.
        [STORAGE_PATHS.photoDerivative(CITY_ID, PHOTO_ID, 'ab'.repeat(32), 'web'), NOBODY],
        [STORAGE_PATHS.manifest(CITY_ID), NOBODY],
        // The city's tab icon (cities.setIcon writes it with its service account).
        [STORAGE_PATHS.cityIcon(CITY_ID, 32), NOBODY],
    ];

    it.each(objects)('happyPath_theRightAdminsRead_%s', async (path, readers) => {
        await world.seedObject(path, 'application/octet-stream');

        const result = await verdicts(EVERYONE, (persona) => world.storage(persona).ref(path).getMetadata());

        expect(result).toEqual(expected(EVERYONE, readers));
    });

    it.each(objects)('badPath_nobodyWritesOrDeletes_%s', async (path) => {
        await world.seedObject(path, 'application/octet-stream');

        const writes = await verdicts(EVERYONE, (persona) => send(persona, `${path}.new`, { contentType: 'image/tiff' }));
        const deletes = await verdicts(EVERYONE, (persona) => world.storage(persona).ref(path).delete());

        expect({ writes, deletes }).toEqual({ writes: expected(EVERYONE, []), deletes: expected(EVERYONE, []) });
    });

    it('badPath_noClientWritesACitysTabIconNotEvenAsAPng @S-A101-BAD-CLIENT-WRITE', async () => {
        const writes = await verdicts(EVERYONE, (persona) =>
            send(persona, STORAGE_PATHS.cityIcon(CITY_ID, 180), { contentType: 'image/png', size: 2048 }),
        );
        const svg = await verdicts(EVERYONE, (persona) => send(persona, `cities/${CITY_ID}/icon.svg`, { contentType: 'image/svg+xml' }));

        expect({ writes, svg }).toEqual({ writes: expected(EVERYONE, []), svg: expected(EVERYONE, []) });
    });

    it('badPath_onlyTheCitysAdminsListItsFolders', async () => {
        await world.seedObject(`rasters/${CITY_ID}/corona-1966/v1/preview.png`, 'image/png');

        const city = await verdicts(EVERYONE, (persona) => world.storage(persona).ref(`rasters/${CITY_ID}`).listAll());
        const scratch = await verdicts(EVERYONE, (persona) => world.storage(persona).ref('tmp').listAll());

        expect({ city, scratch }).toEqual({ city: expected(EVERYONE, ['admin']), scratch: expected(EVERYONE, []) });
    });
});

describe('another city (M5)', () => {
    it('badPath_anAdminOfAnotherCityReadsAndUploadsNothingOfThisOne @S-A51-BAD-OTHER-CITY-RULES', async () => {
        const original = STORAGE_PATHS.photoOriginal(CITY_ID, PHOTO_ID, 'cd'.repeat(32), 'image/jpeg');
        await world.seedObject(original, 'image/jpeg');

        const reads = await verdict(world.storage('outsider').ref(original).getMetadata());
        const upload = await put('outsider', photoUpload('outsider'));
        const raster = await put('outsider', rasterUpload('outsider'), { contentType: 'image/tiff' });

        expect({ reads, upload, raster }).toEqual({ reads: 'deny', upload: 'deny', raster: 'deny' });
    });

    it('happyPath_theSameRequestsInTheirOwnCityAreAllowed', async () => {
        await world.seed(FIRESTORE_PATHS.photo(world.elsewhere, PHOTO_ID), photoDoc(world.elsewhere, PHOTO_ID, world.uid('outsider')));
        const original = STORAGE_PATHS.photoOriginal(world.elsewhere, PHOTO_ID, 'cd'.repeat(32), 'image/jpeg');
        await world.seedObject(original, 'image/jpeg');
        const own = STORAGE_PATHS.photoUpload(world.elsewhere, world.uid('outsider'), PHOTO_ID, `${nonce()}.jpg`);

        const reads = await verdicts(EVERYONE, (persona) => world.storage(persona).ref(original).getMetadata());
        const upload = await put('outsider', own);
        const raster = await put('outsider', rasterUpload('outsider', world.elsewhere), { contentType: 'image/tiff' });

        expect({ reads, upload, raster }).toEqual({ reads: expected(EVERYONE, ['outsider']), upload: 'allow', raster: 'allow' });
    });
});
