/**
 * cities/{city}: admins edit the settings (`CLIENT_WRITES.city.update`, M3's imagery settings included), validated like
 * `cityDocSchema`; id, mapbox, analytics, engine and createdAt are server-owned (client-writes.test.ts), cities are created
 * and deleted by callables.
 */
import { FIRESTORE_PATHS } from '@hcm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cityDoc, harvestStateDoc, historyEntryDoc, manifestStateDoc, photoDoc, theme } from './support/documents.js';
import {
    createWorld,
    deleted,
    past,
    serverTime,
    stampedBy,
    systemStamp,
    verdict,
    type Data,
    type Persona,
    type Verdict,
    type World,
} from './support/world.js';

const CITY_ID = 'rules-cities';

let world: World;
let sequence = 0;

/** A fresh copy of the complete city for each edit, so edits never depend on each other. */
async function seededCity(): Promise<string> {
    sequence += 1;
    const path = FIRESTORE_PATHS.city(`${CITY_ID}-${String(sequence)}`);
    await world.seed(path, cityDoc(CITY_ID));
    return path;
}

async function edit(changes: Data): Promise<Verdict> {
    const path = await seededCity();
    return verdict(
        world
            .db('admin')
            .doc(path)
            .update({ ...stampedBy(world.uid('admin')), ...changes }),
    );
}

beforeAll(async () => {
    world = await createWorld('cities');
});

afterAll(async () => {
    await world.close();
});

describe('update', () => {
    it.each([
        ['the smallest valid settings', { center: deleted(), zoom: deleted(), about: deleted(), theme: deleted(), basemap: deleted() }],
        ['an English name', { name: { ro: 'București', en: 'Bucharest' } }],
        ['zooms at their limits', { zoom: 0, minZoom: 0, maxZoom: 24 }],
        ['a Mapbox style', { basemap: { style: 'mapbox://styles/hcm-test/historic-1' } }],
        ['an https style on a port', { basemap: { style: 'https://styles.example.org:8443/v1/style.json?key=a#b' } }],
        ['a basemap with 30 config properties', { basemap: { style: 'mapbox://styles/mapbox/standard', config: configOf(30) } }],
        ['200 tokens per scheme', { theme: { ...theme('#000000'), tokens: tokenSchemes(200) } }],
        ['50 credits', { credits: Array.from({ length: 50 }, () => ({ label: { ro: 'A', en: 'A' } })) }],
        ['a fully transparent photos overlay', { photosOverlay: { defaultOpacity: 0 } }],
        ['bounds around the globe', { bounds: { west: -180, south: -90, east: 180, north: 90 } }],
        ['imagery settings with every default', { imagery: {} }],
        ['imagery settings at their limits', { imagery: { autoPublish: false, rmseThresholdM: 200, targetYears: yearsOf(20) } }],
        ['a threshold of one metre and a fraction', { imagery: { rmseThresholdM: 1.5 } }],
        ['the choice of Mapbox for the tiles (M12)', { imagery: { publishThroughMapbox: true } }],
        ['a drawn map’s threshold cap and its own auto-publish (M20)', { imagery: { mapThresholdMaxM: 100, mapAutoPublish: false } }],
        ['Landsat’s own imports and their years (M25)', { imagery: { landsatAuto: false, landsatFrom: 1986, landsatTo: 1999 } }],
        ['no imagery settings', { imagery: deleted() }],
    ])('happyPath_adminSaves_%s', async (_label, changes) => {
        expect(await edit(changes)).toBe('allow');
    });

    it.each([
        ['a name without Romanian', { name: { en: 'Bucharest' } }],
        ['a name in another language', { name: { ro: 'București', fr: 'Bucarest' } }],
        ['a name that is not a map', { name: 'București' }],
        ['a name over 100 characters', { name: { ro: 'x'.repeat(101) } }],
        ['a blank name', { name: { ro: '   ' } }],
        ['an English name that is not text', { name: { ro: 'București', en: 42 } }],
        ['bounds that are not a map', { bounds: '25.9,44.3,26.3,44.6' }],
        ['bounds missing a side', { bounds: { west: 25.9, south: 44.3, east: 26.3 } }],
        ['bounds with an extra key', { bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6, up: 1 } }],
        ['bounds west of nothing', { bounds: { west: -181, south: 44.3, east: 26.3, north: 44.6 } }],
        ['bounds east of everything', { bounds: { west: 25.9, south: 44.3, east: 181, north: 44.6 } }],
        ['bounds below the pole', { bounds: { west: 25.9, south: -91, east: 26.3, north: 44.6 } }],
        ['bounds above the pole', { bounds: { west: 25.9, south: 44.3, east: 26.3, north: 91 } }],
        ['bounds with east before west', { bounds: { west: 26.3, south: 44.3, east: 25.9, north: 44.6 } }],
        ['bounds with north before south', { bounds: { west: 25.9, south: 44.6, east: 26.3, north: 44.3 } }],
        ['empty bounds', { bounds: { west: 26, south: 44, east: 26, north: 44.6 } }],
        ['a centre with altitude', { center: { lat: 44.43, lng: 26.1, alt: 80 } }],
        ['a centre off the globe', { center: { lat: 44.43, lng: 190 } }],
        ['a zoom of 25', { zoom: 25 }],
        ['a negative minimum zoom', { minZoom: -1 }],
        ['a maximum zoom that is text', { maxZoom: '18' }],
        ['an About text over 10000 characters', { about: { ro: 'x'.repeat(10_001) } }],
        ['a privacy text that is not a map', { privacy: 'Confidențialitate' }],
        ['credits that are not a list', { credits: { label: 'A' } }],
        ['51 credits', { credits: Array.from({ length: 51 }, () => ({ label: { ro: 'A', en: 'A' } })) }],
        ['a theme without tokens', { theme: { seedColor: '#875329' } }],
        ['a theme with an extra key', { theme: { ...theme('#875329'), css: 'body{}' } }],
        ['a seed colour that is not hex', { theme: theme('red') }],
        ['a theme missing a scheme', { theme: { seedColor: '#875329', tokens: { light: tokensOf(1), dark: tokensOf(1) } } }],
        ['a scheme without tokens', { theme: { ...theme('#875329'), tokens: { ...tokenSchemes(1), dark: {} } } }],
        ['a scheme of 201 tokens', { theme: { ...theme('#875329'), tokens: { ...tokenSchemes(1), highContrastDark: tokensOf(201) } } }],
        ['a light scheme that is a list', { theme: { ...theme('#875329'), tokens: { ...tokenSchemes(1), light: ['#000'] } } }],
        [
            'a high-contrast light scheme of 201 tokens',
            { theme: { ...theme('#875329'), tokens: { ...tokenSchemes(1), highContrastLight: tokensOf(201) } } },
        ],
        ['a basemap without a style', { basemap: { config: {} } }],
        ['a basemap with an extra key', { basemap: { style: 'mapbox://styles/mapbox/standard', sprite: 'x' } }],
        ['an http basemap style', { basemap: { style: 'http://example.org/style.json' } }],
        // docs/LESSONS.md 241: a host with `;` or a quote would end the directive of the export's policy and add others.
        [
            'a basemap style whose host ends a policy directive @S-A53-BAD-STYLE-HOST',
            { basemap: { style: 'https://a.example.org;connect-src/x' } },
        ],
        ['a basemap style whose host holds a quote', { basemap: { style: "https://a.example.org'unsafe-inline'/x" } }],
        ['a basemap style that is not text', { basemap: { style: 42 } }],
        ['a basemap with 31 config properties', { basemap: { style: 'mapbox://styles/mapbox/standard', config: configOf(31) } }],
        ['a basemap config that is a list', { basemap: { style: 'mapbox://styles/mapbox/standard', config: ['a'] } }],
        ['a photos overlay opacity over 1', { photosOverlay: { defaultOpacity: 1.01 } }],
        ['a photos overlay with an extra key', { photosOverlay: { defaultOpacity: 0.5, visible: true } }],
        ['a published flag that is not a boolean', { published: 'yes' }],
        ['a missing published flag', { published: deleted() }],
        ['an unknown field', { html: '<script>alert(1)</script>' }],
        ['imagery settings that are not a map', { imagery: 'auto' }],
        ['an imagery setting the schema does not know', { imagery: { autoPublish: true, publishAll: true } }],
        ['an auto-publish flag that is not a boolean', { imagery: { autoPublish: 'yes' } }],
        ['a choice of Mapbox that is not a boolean', { imagery: { publishThroughMapbox: 'yes' } }],
        ['a map threshold cap under 15 m (M20)', { imagery: { mapThresholdMaxM: 14 } }],
        ['a map threshold cap over 200 m (M20)', { imagery: { mapThresholdMaxM: 201 } }],
        ['a map auto-publish that is not a boolean (M20)', { imagery: { mapAutoPublish: 'yes' } }],
        ['a Landsat switch that is not a boolean (M25)', { imagery: { landsatAuto: 'yes' } }],
        ['a Landsat year that is no year (M25)', { imagery: { landsatFrom: 1700 } }],
        ['a Landsat year that is text (M25)', { imagery: { landsatTo: '2000' } }],
        ['a threshold under one metre', { imagery: { rmseThresholdM: 0.5 } }],
        ['a threshold over 200 metres', { imagery: { rmseThresholdM: 201 } }],
        ['a threshold that is text', { imagery: { rmseThresholdM: '15' } }],
        ['target years that are not a list', { imagery: { targetYears: 1966 } }],
        ['21 target years', { imagery: { targetYears: yearsOf(21) } }],
        ['a target year twice', { imagery: { targetYears: [1966, 1966] } }],
        ['a target year before 1800', { imagery: { targetYears: [1966, 1799] } }],
        ['a target year that is text', { imagery: { targetYears: ['1966'] } }],
        ['a fraction of a year last of twenty', { imagery: { targetYears: [...yearsOf(19), 1966.5] } }],
        ['imagery settings saved with other settings', { imagery: { autoPublish: false }, published: false }],
        ['imagery settings saved with a client clock', { imagery: { autoPublish: false }, updatedAt: past() }],
    ])('badPath_adminCannotSave_%s', async (_label, changes) => {
        expect(await edit(changes)).toBe('deny');
    });

    it.each([
        ['another editor', { updatedBy: 'someone-else', updatedAt: serverTime() }],
        ['a client clock', { updatedBy: 'cities-admin', updatedAt: past() }],
        ['no stamp at all', {}],
    ])('badPath_editsMustBeStampedByTheEditorWithTheServerClock_%s', async (_label, stamp) => {
        const path = await seededCity();

        expect(
            await verdict(
                world
                    .db('admin')
                    .doc(path)
                    .update({ published: false, ...stamp }),
            ),
        ).toBe('deny');
    });
});

// M28 (docs/research/M28-sources.md §3): the map's sources, saved on their own as the imagery settings are.
describe('the sources (M28)', () => {
    it.each([
        ['the default sources @S-A180-HAPPY-RULES-SAVE', { sources: {} }],
        [
            'every source chosen',
            {
                sources: {
                    usgs: true,
                    usgsOrders: true,
                    landsat: true,
                    archives: true,
                    contributors: true,
                    openData: true,
                    localAi: true,
                    cloudAi: true,
                },
            },
        ],
        ['USGS and Landsat off', { sources: { usgs: false, landsat: false } }],
    ])('happyPath_adminSavesTheSources_%s', async (_label, changes) => {
        expect(await edit(changes)).toBe('allow');
    });

    it.each([
        ['sources that are not a map (M28) @S-A180-BAD-RULES-SHAPE', { sources: 'all' }],
        ['a source the schema does not know (M28)', { sources: { usgs: true, scraped: true } }],
        ['a source choice that is not a boolean (M28)', { sources: { cloudAi: 'yes' } }],
        ['the sources with a city setting (M28)', { sources: { usgs: false }, zoom: 13 }],
    ])('badPath_theSourcesAreRefused_%s', async (_label, changes) => {
        expect(await edit(changes)).toBe('deny');
    });
});

describe('many cities (M5, docs/research/M5-interfaces.md §1.4)', () => {
    const OTHER_STAMP = (persona: Persona) => stampedBy(world.uid(persona));

    it('badPath_anEditorOfAnotherCityReadsAndWritesNothingOfThisOne @S-A51-BAD-OTHER-CITY-RULES', async () => {
        const path = await seededCity();
        const city = path.slice('cities/'.length);
        await world.seed(FIRESTORE_PATHS.photo(city, 'p1'), photoDoc(city, 'p1', world.uid('admin')));
        await world.seed(FIRESTORE_PATHS.manifestState(city), manifestStateDoc(city));
        await world.seed(FIRESTORE_PATHS.harvestState(city), harvestStateDoc());
        const db = world.db('outsider');

        const requests = {
            city: await verdict(db.doc(path).get()),
            update: await verdict(db.doc(path).update({ published: false, ...OTHER_STAMP('outsider') })),
            photos: await verdict(db.collection(FIRESTORE_PATHS.photos(city)).get()),
            photo: await verdict(db.doc(FIRESTORE_PATHS.photo(city, 'p1')).get()),
            manifest: await verdict(db.doc(FIRESTORE_PATHS.manifestState(city)).get()),
            harvest: await verdict(db.doc(FIRESTORE_PATHS.harvestState(city)).get()),
        };

        expect(requests).toEqual({ city: 'deny', update: 'deny', photos: 'deny', photo: 'deny', manifest: 'deny', harvest: 'deny' });
    });

    it('happyPath_theSameRequestsOnTheirOwnCityAreAllowed @S-A51-BAD-OTHER-CITY-RULES', async () => {
        const own = FIRESTORE_PATHS.city(world.elsewhere);
        await world.seed(FIRESTORE_PATHS.harvestState(world.elsewhere), harvestStateDoc());
        const db = world.db('outsider');

        const requests = {
            city: await verdict(db.doc(own).get()),
            update: await verdict(db.doc(own).update({ published: true, ...OTHER_STAMP('outsider') })),
            photos: await verdict(db.collection(FIRESTORE_PATHS.photos(world.elsewhere)).get()),
            harvest: await verdict(db.doc(FIRESTORE_PATHS.harvestState(world.elsewhere)).get()),
            notMine: await verdict(world.db('admin').doc(own).get()),
        };

        expect(requests).toEqual({ city: 'allow', update: 'allow', photos: 'allow', harvest: 'allow', notMine: 'deny' });
    });

    it('badPath_historysQueryIsKeptToTheAdminsCities @S-A51-BAD-HISTORY-QUERY', async () => {
        const path = await seededCity();
        const city = path.slice('cities/'.length);
        const entry = (cityId: string) => `${FIRESTORE_PATHS.history({ entity: 'photo', cityId, entityId: 'p1' })}/1767225600000-event1`;
        await world.seed(entry(city), historyEntryDoc(world.uid('admin'), city));
        await world.seed(entry(world.elsewhere), historyEntryDoc(world.uid('outsider'), world.elsewhere));
        const recent = (persona: Persona, cityId: string) =>
            verdict(
                world.db(persona).collectionGroup('history').where('cityId', '==', cityId).orderBy('updatedAt', 'desc').limit(50).get(),
            );

        const verdicts = {
            othersByOutsider: await recent('outsider', city),
            ownByOutsider: await recent('outsider', world.elsewhere),
            ownByAdmin: await recent('admin', city),
            entryByOutsider: await verdict(world.db('outsider').doc(entry(city)).get()),
            ownEntryByOutsider: await verdict(world.db('outsider').doc(entry(world.elsewhere)).get()),
            unfiltered: await verdict(world.db('outsider').collectionGroup('history').limit(5).get()),
        };

        expect(verdicts).toEqual({
            othersByOutsider: 'deny',
            ownByOutsider: 'allow',
            ownByAdmin: 'allow',
            entryByOutsider: 'deny',
            ownEntryByOutsider: 'allow',
            unfiltered: 'deny',
        });
    });

    it('badPath_noClientWritesACitysLimitsOrUsage @S-A52-BAD-CLIENT-LIMITS', async () => {
        const path = await seededCity();
        const city = path.slice('cities/'.length);
        const limits = {
            computeUnitsPerMonth: 1000,
            rasterJobsPerDay: 10,
            aiRequestsPerMonth: 500,
            geocodeCellsPerDay: 300,
            exportsPerDay: 10,
        };
        const usage = `${path}/usage/2026-10`;
        await world.seed(usage, { month: '2026-10', computeUnits: 1, aiRequests: 0, updatedBy: 'system:cities', updatedAt: past() });

        const results = {
            limits: await verdict(
                world
                    .db('admin')
                    .doc(path)
                    .update({ limits, ...OTHER_STAMP('admin') }),
            ),
            usage: await verdict(
                world
                    .db('admin')
                    .doc(usage)
                    .update({ computeUnits: 0, ...OTHER_STAMP('admin') }),
            ),
            newUsage: await verdict(
                world.db('admin').doc(`${path}/usage/2026-11`).set({ month: '2026-11', computeUnits: 0, aiRequests: 0 }),
            ),
            readUsage: await verdict(world.db('admin').doc(usage).get()),
            outsiderReadsUsage: await verdict(world.db('outsider').doc(FIRESTORE_PATHS.cityUsage(city, '2026-10')).get()),
        };

        expect(results).toEqual({ limits: 'deny', usage: 'deny', newUsage: 'deny', readUsage: 'allow', outsiderReadsUsage: 'deny' });
    });

    it('badPath_noClientWritesTheCitysTabIcon @S-A101-BAD-CLIENT-WRITE', async () => {
        const path = await seededCity();
        const icon = {
            source: 'custom',
            url: 'https://storage.googleapis.com/demo-hcm-public/cities/x/icon-180.png',
            sha256: 'a'.repeat(64),
            updatedBy: world.uid('admin'),
            updatedAt: past(),
        };

        const result = await verdict(
            world
                .db('admin')
                .doc(path)
                .update({ icon, ...OTHER_STAMP('admin') }),
        );

        expect(result).toBe('deny');
    });
});

describe('static exports (M5, docs/research/M5-interfaces.md §5.3, CR-M5-11)', () => {
    it('badPath_exportsAreTheServersAndOnlyTheCitysMembersReadThem @S-A53-BAD-CLIENT-EXPORTS', async () => {
        const path = await seededCity();
        const city = path.slice('cities/'.length);
        const record = FIRESTORE_PATHS.cityExport(city, 'x-20261017-1');
        await world.seed(record, exportRecord(world.uid('admin'), 'ready'));
        const member = world.db('admin');

        const results = {
            memberReads: await verdict(member.doc(record).get()),
            memberListsTheLatest: await verdict(
                member.collection(FIRESTORE_PATHS.cityExports(city)).orderBy('createdAt', 'desc').limit(1).get(),
            ),
            memberCreates: await verdict(
                member.doc(FIRESTORE_PATHS.cityExport(city, 'x-20261017-2')).set(exportRecord(world.uid('admin'), 'queued')),
            ),
            memberMarksReady: await verdict(member.doc(record).update({ state: 'ready', ...stampedBy(world.uid('admin')) })),
            memberDeletes: await verdict(member.doc(record).delete()),
            outsiderReads: await verdict(world.db('outsider').doc(record).get()),
            outsiderLists: await verdict(world.db('outsider').collection(FIRESTORE_PATHS.cityExports(city)).get()),
        };

        expect(results).toEqual({
            memberReads: 'allow',
            memberListsTheLatest: 'allow',
            memberCreates: 'deny',
            memberMarksReady: 'deny',
            memberDeletes: 'deny',
            outsiderReads: 'deny',
            outsiderLists: 'deny',
        });
    });
});

/** An export's record as `export.start` and `export.build` leave it (`cityExportDocSchema`). */
function exportRecord(requestedBy: string, state: 'queued' | 'ready'): Data {
    return { state, requestedBy, rasters: false, engineVersion: '1.0.0', createdAt: past(), ...systemStamp('export') };
}

function tokensOf(count: number): Data {
    return Object.fromEntries(Array.from({ length: count }, (_, index) => [`--md-sys-color-token-${String(index)}`, '#000000']));
}

function tokenSchemes(count: number): Data {
    return { light: tokensOf(count), dark: tokensOf(count), highContrastLight: tokensOf(count), highContrastDark: tokensOf(count) };
}

function configOf(count: number): Data {
    return Object.fromEntries(Array.from({ length: count }, (_, index) => [`option${String(index)}`, index]));
}

/** `count` distinct years from 1900. */
function yearsOf(count: number): number[] {
    return Array.from({ length: count }, (_, index) => 1900 + index);
}
