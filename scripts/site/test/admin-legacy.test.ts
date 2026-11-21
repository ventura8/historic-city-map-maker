import { afterEach, describe, expect, it } from 'vitest';

import { citySchema, photoSchema, type MigratedPhoto } from '@hcm/shared';

import { CITY_SEED_FILE, LEGACY_FOLDER, planLegacyBundle, type AdminFile } from '../src/admin/legacy.js';
import { SiteBuildError } from '../src/errors.js';
import { nodeFileSystem, type SiteFileSystem } from '../src/files.js';
import { readRepositoryJson } from './manifests.js';
import { ROOT, cleanup, temporaryDir } from './support.js';

afterEach(cleanup);

/** A stand-in image: the manifest record of a photo only lacks one until `photos.onUpload` made its derivatives. */
const IMAGE = { web: 'media/x/web.webp', thumb: 'media/x/thumb.webp', w: 1600, h: 1200 };

function generated(files: readonly AdminFile[], to: string): string {
    const file = files.find((candidate) => candidate.to === to);
    return file !== undefined && 'content' in file ? file.content : '';
}

function point(photo: string, lng: number, id?: string): Record<string, unknown> {
    return {
        type: 'Feature',
        ...(id === undefined ? {} : { id }),
        properties: { title: photo, photo: `https://legacy.example/photos/${photo}`, author: 'E2E', year: 1970 },
        geometry: { type: 'Point', coordinates: [lng, 44.43] },
    };
}

/** A seed folder in a temporary root: the real Bucharest manifest, `features` as the legacy GeoJSON, `photos` as files. */
function syntheticSeed(
    features: readonly unknown[],
    photos: readonly string[],
    files = nodeFileSystem(temporaryDir()),
    dir = 'seed/x',
): SiteFileSystem {
    files.write(`${dir}/manifest.static.json`, JSON.stringify(readRepositoryJson('seed/bucharest/manifest.static.json')));
    files.write(`${dir}/photos.legacy.geojson`, JSON.stringify({ type: 'FeatureCollection', features }));
    for (const name of photos) {
        files.write(`${dir}/photos/${name}`, name);
    }
    return files;
}

function bundledPhotos(files: SiteFileSystem, additions: readonly string[]): MigratedPhoto[] {
    return JSON.parse(generated(planLegacyBundle(files, 'seed/x', additions).files, `${LEGACY_FOLDER}/photos.json`)) as MigratedPhoto[];
}

describe('planLegacyBundle', () => {
    it('happyPath_theCommittedSeedGivesTheCityThe45PhotosThe12AdditionsAndTheirOriginals', () => {
        const bundle = planLegacyBundle(nodeFileSystem(ROOT));
        const city = JSON.parse(generated(bundle.files, `${LEGACY_FOLDER}/city.json`)) as Record<string, unknown>;
        const photos = JSON.parse(generated(bundle.files, `${LEGACY_FOLDER}/photos.json`)) as MigratedPhoto[];
        const first = readRepositoryJson('seed/bucharest/manifest.static.json') as { photos: { id: string }[] };
        const added = readRepositoryJson('seed/bucharest-2023/manifest.static.json') as { photos: { id: string }[] };

        expect(bundle.photos).toBe(57);
        // The 45 first, as migrated, then the 2023 additions with the ids their own manifest gave them.
        expect(photos.map((record) => record.photo.id)).toEqual([...first.photos, ...added.photos].map((photo) => photo.id));
        expect(new Set(photos.map((record) => record.photo.id)).size).toBe(57);
        // Two photos show the same original from two places: one copy each.
        expect(bundle.originals).toBe(56);
        expect(bundle.warnings).toBe(1);
        expect(city['id']).toBe('bucuresti');
        // The city file's settings, which the viewer's manifest never holds.
        const { imagery, ...manifestCity } = city;
        expect(imagery).toEqual({ targetYears: [1966, 1972, 1976, 1977, 1978, 1979, 1980, 1982, 1983, 1984] });
        expect(citySchema.safeParse({ ...manifestCity, mapbox: { publicToken: 'pk.e2e-fake-token' }, analytics: {} }).success).toBe(true);
        expect(photos.every((record) => photoSchema.safeParse({ ...record.photo, image: IMAGE }).success)).toBe(true);
        expect(bundle.files.filter((file) => 'from' in file).map((file) => file.to)).toContain(`${LEGACY_FOLDER}/originals/Ferdinand.png`);
        // The old site later moved Parc Ferdinand and gave it a cone: a new project imports it so, an existing one is corrected.
        expect(photos.find((record) => record.photo.id === 'parcul-ferdinand-1930')?.photo).toMatchObject({
            location: { lat: 44.448183, lng: 26.139431 },
            bearing: 219.1,
            fov: 50,
        });
        const corrections = JSON.parse(generated(bundle.files, `${LEGACY_FOLDER}/corrections.json`)) as Record<string, unknown>;
        expect(corrections).toEqual(readRepositoryJson('seed/bucharest-2023/corrections.json'));
        expect(Object.keys(corrections)).toEqual(['parcul-ferdinand-1930']);
    });

    it('happyPath_theViewerTokenAndTheAnalyticsIdsNeverTravel', () => {
        const city = generated(planLegacyBundle(nodeFileSystem(ROOT)).files, `${LEGACY_FOLDER}/city.json`);

        expect(city).not.toContain('publicToken');
        expect(city).not.toContain('analytics');
        expect(Object.keys(JSON.parse(city) as object)).toEqual([
            'id',
            'name',
            'center',
            'zoom',
            'minZoom',
            'maxZoom',
            'bounds',
            'about',
            'credits',
            'privacy',
            'theme',
            'basemap',
            'imagery',
        ]);
    });

    it('happyPath_aSeedOutsideThisRepositoryHasNoImagerySettings', () => {
        const files = syntheticSeed([point('A.jpg', 26.08)], ['A.jpg']);

        const city = (): unknown => JSON.parse(generated(planLegacyBundle(files, 'seed/x').files, `${LEGACY_FOLDER}/city.json`));

        expect(city()).not.toHaveProperty('imagery');
        files.write(CITY_SEED_FILE, JSON.stringify({ id: 'x' }));
        expect(city()).not.toHaveProperty('imagery');
    });

    it('badPath_invalidImagerySettingsStopTheBuild', () => {
        const files = syntheticSeed([point('A.jpg', 26.08)], ['A.jpg']);
        files.write(CITY_SEED_FILE, JSON.stringify({ imagery: { targetYears: [1966, 1966] } }));

        expect(() => planLegacyBundle(files, 'seed/x')).toThrow(/invalid imagery/);
    });

    it('happyPath_keepsTheLegacyIdWhenThereIsOne', () => {
        const files = syntheticSeed([point('A b.jpg', 26.08, 'legacy-a'), point('C.jpg', 26.09)], ['A b.jpg', 'C.jpg']);
        const photos = JSON.parse(generated(planLegacyBundle(files, 'seed/x').files, `${LEGACY_FOLDER}/photos.json`)) as MigratedPhoto[];

        expect(photos.map((record) => [record.sourceFile, record.legacyId ?? null])).toEqual([
            ['A b.jpg', 'legacy-a'],
            ['C.jpg', null],
        ]);
    });

    it('badPath_aMissingOriginalStopsTheBuild', () => {
        const files = syntheticSeed([point('A.jpg', 26.08)], []);

        expect(() => planLegacyBundle(files, 'seed/x')).toThrow(
            new SiteBuildError('seed/x/photos/A.jpg is missing: a legacy photo record names it'),
        );
    });

    it('badPath_aSeedWithoutPhotosOrWithBrokenFilesStopsTheBuild', () => {
        expect(() => planLegacyBundle(syntheticSeed([], []), 'seed/x')).toThrow(/holds no photo/);

        const broken = syntheticSeed([point('A.jpg', 26.08)], ['A.jpg']);
        broken.write('seed/x/photos.legacy.geojson', '{');
        expect(() => planLegacyBundle(broken, 'seed/x')).toThrow(/^seed\/x\/photos\.legacy\.geojson: not JSON/);

        expect(() => planLegacyBundle(broken, 'seed/missing')).toThrow(/^seed\/missing\/manifest\.static\.json is missing/);
    });

    it('happyPath_anAdditionsIdsKeepClearOfTheSeedsAndItsRecordsComeAfterThem', () => {
        const files = syntheticSeed([point('A.jpg', 26.08, 'legacy-a')], ['A.jpg']);
        syntheticSeed([point('a.png', 26.1, 'legacy-b'), point('C.jpg', 26.09)], ['a.png', 'C.jpg'], files, 'seed/y');

        const photos = bundledPhotos(files, ['seed/y']);

        // `a.png` slugs to the seed's `a`: it becomes `a-2`, and a rerun gives the same ids.
        expect(photos.map((record) => [record.photo.id, record.sourceFile, record.legacyId ?? null])).toEqual([
            ['a', 'A.jpg', 'legacy-a'],
            ['a-2', 'a.png', 'legacy-b'],
            ['c', 'C.jpg', null],
        ]);
        expect(bundledPhotos(files, ['seed/y'])).toEqual(photos);
        expect(bundledPhotos(files, [])).toHaveLength(1);
    });

    it('badPath_anAdditionThatIsMissingEmptyOrNamesAnOriginalTwiceStopsTheBuild', () => {
        const files = syntheticSeed([point('A.jpg', 26.08)], ['A.jpg']);

        expect(() => bundledPhotos(files, ['seed/y'])).toThrow(/^seed\/y\/photos\.legacy\.geojson is missing/);
        syntheticSeed([], [], files, 'seed/y');
        expect(() => bundledPhotos(files, ['seed/y'])).toThrow(new SiteBuildError('seed/y/photos.legacy.geojson holds no photo'));
        syntheticSeed([point('A.jpg', 26.1)], ['A.jpg'], files, 'seed/y');
        expect(() => bundledPhotos(files, ['seed/y'])).toThrow(
            new SiteBuildError('seed/y/photos/A.jpg: seed/x/photos/A.jpg has the same name, and the bundle has one originals folder'),
        );
    });

    it('badPath_invalidCorrectionsStopTheBuildAndNoneAreAnEmptyFile', () => {
        const files = syntheticSeed([point('A.jpg', 26.08)], ['A.jpg']);
        syntheticSeed([point('C.jpg', 26.09)], ['C.jpg'], files, 'seed/y');

        expect(generated(planLegacyBundle(files, 'seed/x', ['seed/y']).files, `${LEGACY_FOLDER}/corrections.json`)).toBe('{}\n');
        files.write('seed/y/corrections.json', JSON.stringify({ a: { bearing: 10 } }));
        expect(() => bundledPhotos(files, ['seed/y'])).toThrow(/^seed\/y\/corrections\.json: invalid corrections\n/);
    });

    it('badPath_anInvalidManifestStopsTheBuild', () => {
        const files = syntheticSeed([point('A.jpg', 26.08)], ['A.jpg']);
        files.write('seed/x/manifest.static.json', JSON.stringify({ version: 1 }));

        expect(() => planLegacyBundle(files, 'seed/x')).toThrow(/^seed\/x\/manifest\.static\.json: invalid manifest\n/);
    });
});

describe("planLegacyBundle: the city file's texts", () => {
    it('happyPath_theCommittedSeedsCreditsNameEveryAuthorFirstAndTheTextsAreTheCityFiles', () => {
        const city = JSON.parse(generated(planLegacyBundle(nodeFileSystem(ROOT)).files, `${LEGACY_FOLDER}/city.json`)) as Record<
            string,
            unknown
        >;
        // The credits name the additions' author too, first; the rest, the About and the privacy are today's, from the city file.
        const credits = city['credits'] as { label: { ro: string; en: string } }[];
        expect(credits[0]?.label.ro).toMatch(/^Fotografii: Dan Perry, .*Studiourile Buftea$/);
        const today = readRepositoryJson(CITY_SEED_FILE);
        expect(credits.slice(1)).toEqual(today['credits']);
        expect([city['about'], city['privacy']]).toEqual([today['about'], today['privacy']]);
        expect(JSON.stringify(city)).not.toMatch(/în curând|coming soon|GitHub Pages/);
    });

    it('happyPath_aCityFileWithoutTextsKeepsTheMigratedOnesAndItsTextsReplaceThem', () => {
        const files = syntheticSeed([point('A.jpg', 26.08)], ['A.jpg']);
        const migrated = (readRepositoryJson('seed/bucharest/manifest.static.json') as { city: Record<string, unknown> }).city;
        const city = (): Record<string, unknown> =>
            JSON.parse(generated(planLegacyBundle(files, 'seed/x').files, `${LEGACY_FOLDER}/city.json`)) as Record<string, unknown>;

        files.write(CITY_SEED_FILE, JSON.stringify({ id: 'x' }));
        expect([city()['about'], city()['privacy']]).toEqual([migrated['about'], migrated['privacy']]);
        const credit = { label: { ro: 'Imagini: USGS EROS', en: 'Imagery: USGS EROS' } };
        files.write(CITY_SEED_FILE, JSON.stringify({ about: { ro: 'Azi', en: 'Today' }, credits: [credit] }));
        expect(city()['about']).toEqual({ ro: 'Azi', en: 'Today' });
        expect(city()['credits']).toEqual([{ label: { ro: 'Fotografii: E2E', en: 'Photos: E2E' } }, credit]);
        expect(city()['privacy']).toEqual(migrated['privacy']);
    });

    it('badPath_invalidTextsInTheCityFileStopTheBuild', () => {
        const files = syntheticSeed([point('A.jpg', 26.08)], ['A.jpg']);
        files.write(CITY_SEED_FILE, JSON.stringify({ privacy: { ro: 'Fără [link](http://x.example)', en: 'x' } }));

        expect(() => planLegacyBundle(files, 'seed/x')).toThrow(/invalid texts/);
    });
});
