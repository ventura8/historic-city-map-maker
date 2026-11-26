import { readFileSync } from 'node:fs';

import { timestampFromDate } from '@hcm/shared';
import { createFakeFetch, E2E_PROJECT_CONFIG, jsonResponse } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import {
    installBundleLoader,
    legacyImportedCheck,
    publishedMapCheck,
    setupModuleFor,
    setupOptionsFor,
    setupSourcesPort,
    wiringHelpers,
    type SetupWiringDeps,
} from '../../src/app/setup-wiring.js';
import { readCountryList } from '../../src/app/country-wiring.js';
import { InstallBundleError } from '../../src/install/bundle.js';
import type { ProjectConfig } from '../../src/provision/project-config.js';
import { E2E_WEB_CONFIG, FakeAuth, FakeCallables, FakeClock, FakeDocuments, NO_STORAGE, OWNER, testLog } from './fakes.js';

/** The seed manifest's city: what the admin build bundles as `legacy/bucharest/city.json`. */
const SEED_CITY = (
    JSON.parse(readFileSync(new URL('../../../../seed/bucharest/manifest.static.json', import.meta.url), 'utf8')) as { city: unknown }
).city;

const PROJECT: ProjectConfig = {
    ...E2E_PROJECT_CONFIG,
    cities: [...E2E_PROJECT_CONFIG.cities],
    viewerOrigins: [...E2E_PROJECT_CONFIG.viewerOrigins],
};

function wiring(city: unknown = SEED_CITY, project: ProjectConfig = PROJECT) {
    const auth = new FakeAuth();
    auth.user = OWNER;
    const fetcher = createFakeFetch((request) => {
        if (!request.url.pathname.endsWith('/city.json')) {
            return undefined;
        }
        return { operation: 'city', response: city === null ? new Response('missing', { status: 404 }) : jsonResponse(city) };
    });
    const callables = new FakeCallables();
    callables.answer('setup.createCity', () => ({ created: true }));
    const deps: SetupWiringDeps = {
        config: E2E_WEB_CONFIG,
        project,
        firebase: { auth, callables, documents: new FakeDocuments(), storage: NO_STORAGE },
        fetch: fetcher.fetch,
        clock: new FakeClock(),
        log: testLog().log,
        baseUrl: 'https://demo-hcm.web.app/',
        nonce: () => 'nonce-1',
        release: '1.0.0+abc1234',
        releaseTime: 1_761_955_200,
        installOrigins: ['https://demo-hcm.web.app'],
        adminSite: null,
        newerAdmin: () => Promise.resolve(null),
    };
    return { deps, fetcher, callables };
}

describe('setupOptionsFor', () => {
    it('happyPath_theProjectsCityIsCreatedFromTheBundledSeed', async () => {
        const w = wiring();
        const options = setupOptionsFor(w.deps);

        await expect(options.createCity()).resolves.toEqual({ created: true });

        expect(options.cityId).toBe('bucharest');
        expect(options.cityBBox).toBeNull();
        expect(w.fetcher.calls[0]?.url).toBe('https://demo-hcm.web.app/legacy/bucharest/city.json');
        expect(w.callables.calls).toEqual([
            {
                name: 'setup.createCity',
                request: { cityId: 'bucharest', city: expect.objectContaining({ center: { lng: 26.085298, lat: 44.427037 } }) as unknown },
            },
        ]);
        expect(typeof options.cloud.provision).toBe('function');
        expect(typeof options.importer.run).toBe('function');
    });

    it('badPath_aMissingOrInvalidBundledCityFailsTheStep', async () => {
        await expect(setupOptionsFor(wiring(null).deps).createCity()).rejects.toThrow('missing or invalid');
        await expect(setupOptionsFor(wiring({ center: 'nowhere' }).deps).createCity()).rejects.toThrow('missing or invalid');
    });

    it('badPath_aProjectWithoutCitiesUsesThisRepositorysCity', () => {
        expect(setupOptionsFor(wiring(SEED_CITY, { ...PROJECT, cities: [] }).deps).cityId).toBe('bucharest');
    });

    it('happyPath_aProjectOfTheOwnersOwnHasNoBundledCityNorOldPhotos', async () => {
        const rest = Object.fromEntries(Object.entries(PROJECT).filter(([key]) => key !== 'github')) as Omit<ProjectConfig, 'github'>;
        const bounds = { west: 26.8, south: 46.5, east: 27, north: 46.6 };
        const own: ProjectConfig = { ...rest, firstCity: { id: 'bacau', name: { ro: 'Bacău' }, bounds } };
        const w = wiring(SEED_CITY, own);
        const options = setupOptionsFor(w.deps);

        await expect(options.createCity()).resolves.toEqual({ created: false });
        await expect(options.importer.detect()).resolves.toEqual({ done: 0, total: 0, failed: [] });
        await expect(options.importer.run(() => undefined)).resolves.toEqual({ done: 0, total: 0, failed: [] });
        expect(options.github).toBe(false);
        expect(options.cityBBox).toEqual([26.8, 46.5, 27, 46.6]);
        expect(w.callables.calls).toEqual([]);
        expect(w.fetcher.calls).toEqual([]);
    });

    it('happyPath_theModuleStartsWithNoStateUntilTheShellCreatesIt', () => {
        expect(setupModuleFor(wiring().deps).initial).toBeNull();
    });
});

describe('wiringHelpers', () => {
    it('happyPath_theSignedInAdminAndTheClock', async () => {
        const auth = new FakeAuth();
        const clock = new FakeClock();
        const helpers = wiringHelpers({ auth }, clock);
        expect([helpers.uid(), helpers.ownerEmail()]).toEqual([null, null]);
        auth.user = OWNER;

        const slept = helpers.sleep(500);
        clock.advance(500);

        await expect(slept).resolves.toBeUndefined();
        expect([helpers.uid(), helpers.ownerEmail()]).toEqual([OWNER.uid, OWNER.email]);
    });
});

// M28 (docs/research/M28-sources.md §4): the city's sources over the Firestore SDK.
describe('the sources wiring', () => {
    it('happyPath_theChoiceIsWrittenOnItsOwnWithTheAdminsStamp_andReadBack', async () => {
        const documents = new FakeDocuments();
        const port = setupSourcesPort({ documents }, 'bucharest', () => OWNER.uid);

        await expect(port.read()).resolves.toBeUndefined();
        await port.save({ usgs: false, landsat: true });

        expect(await documents.get('cities/bucharest')).toMatchObject({ sources: { usgs: false, landsat: true }, updatedBy: OWNER.uid });
        await expect(port.read()).resolves.toEqual({ usgs: false, landsat: true });
    });

    it('badPath_aStoredValueTheSchemaRefusesReadsAsNoChoice', async () => {
        const documents = new FakeDocuments();
        await documents.set('cities/bucharest', { sources: { usgs: 'yes' } });

        await expect(setupSourcesPort({ documents }, 'bucharest', () => null).read()).resolves.toBeUndefined();
    });
});

// M28 §10: the city's country list.
describe('the country list wiring', () => {
    const list = (cities: readonly string[], language = 'ro') => ({
        country: 'RO',
        language,
        cities,
        places: [],
        origin: 'curated',
        refreshedAt: timestampFromDate(new Date('2026-11-14T10:00:00.000Z')),
        updatedBy: 'system:ops',
        updatedAt: timestampFromDate(new Date('2026-11-14T10:00:00.000Z')),
    });

    it('happyPath_theListNamingTheCityIsReadWithTheCitysNameInItsLanguage', async () => {
        const documents = new FakeDocuments();
        await documents.set('countrySources/MD', { ...list(['chisinau']), country: 'MD' });
        await documents.set('countrySources/RO', list(['bucharest']));
        await documents.set('cities/bucharest', { name: { ro: 'București', en: 'Bucharest' } });

        await expect(readCountryList(documents, 'bucharest')).resolves.toEqual({
            country: 'RO',
            language: 'ro',
            origin: 'curated',
            factsCheckedOn: null,
            refreshedAt: '2026-11-14T10:00:00.000Z',
            places: [],
            cityName: 'București',
        });
        await documents.set('countrySources/RO', list(['bucharest'], 'en'));
        await expect(readCountryList(documents, 'bucharest')).resolves.toMatchObject({ cityName: 'Bucharest' });
        await documents.set('cities/bucharest', { name: { ro: 'București' } });
        await expect(readCountryList(documents, 'bucharest')).resolves.toMatchObject({ cityName: 'București' });
    });

    it('badPath_noListNamesTheCityOrItsListIsRefused_andANamelessCityHasNoName', async () => {
        const documents = new FakeDocuments();
        await expect(readCountryList(documents, 'bucharest')).resolves.toBeNull();
        await documents.set('countrySources/RO', { ...list(['bucharest']), origin: 'guessed' });
        await expect(readCountryList(documents, 'bucharest')).resolves.toBeNull();
        await documents.set('countrySources/RO', list(['bucharest']));
        await expect(readCountryList(documents, 'bucharest')).resolves.toMatchObject({ cityName: null });
    });
});

// [section install] owner: installer (M6, docs/research/M6-interfaces.md §1.3, §1.8)
describe('the installer wiring', () => {
    it('happyPath_aPublishedManifestIsSomethingToShow_badPath_noneOrAnUnreadableOneIsNot', async () => {
        const documents = new FakeDocuments();
        const check = publishedMapCheck({ documents }, 'bucharest');

        await expect(check()).resolves.toBe(false);
        await documents.set('manifests/bucharest', {
            url: 'https://storage.googleapis.com/demo-hcm-public/cities/bucharest/manifest.json',
        });
        await expect(check()).resolves.toBe(true);
        const refusing = { get: () => Promise.reject(new Error('permission-denied')) } as unknown as FakeDocuments;
        await expect(publishedMapCheck({ documents: refusing }, 'bucharest')()).resolves.toBe(false);
    });

    it.each([
        [{ done: 45, total: 45, failed: [] }, true],
        [{ done: 44, total: 45, failed: [] }, false],
        [{ done: 45, total: 45, failed: [{ id: 'p-1', detail: 'apiError.unavailable' as const }] }, false],
        [{ done: 0, total: 0, failed: [] }, false],
    ])('happyPath_theLegacyImportIsCompleteOnlyWhenEveryPhotoIsIn (%o)', async (progress, complete) => {
        // §73k: a site build leaves the originals out only then.
        await expect(legacyImportedCheck({ detect: () => Promise.resolve(progress) })()).resolves.toBe(complete);
    });

    it('badPath_anUnreadableImportStateKeepsTheOriginals', async () => {
        await expect(legacyImportedCheck({ detect: () => Promise.reject(new Error('offline')) })()).resolves.toBe(false);
    });

    it('badPath_theAdminsBundleIsReadFromItsOwnBase_aMissingOneCannotInstall', async () => {
        const w = wiring();

        const error = await installBundleLoader(w.deps)().catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(InstallBundleError);
        expect((error as InstallBundleError).code).toBe('apiError.unavailable');
        expect(w.fetcher.unhandled[0]?.url).toBe('https://demo-hcm.web.app/install/1-0-0-abc1234/manifest.json');
        expect(setupOptionsFor(w.deps)).toMatchObject({ release: '1.0.0+abc1234', siteAddress: 'https://demo-hcm.web.app/' });
    });

    it('badPath_aNewerAdminServedRefusesTheBuildBeforeItsBundleIsRead', async () => {
        const w = wiring();
        const { installer } = setupOptionsFor({ ...w.deps, newerAdmin: () => Promise.resolve('1.0.1+def5678') });

        const error = await installer.submit('server', { token: 'test-token' }).catch((caught: unknown) => caught);

        expect((error as InstallBundleError).code).toBe('apiError.install.adminOutdated');
        expect(w.fetcher.unhandled).toEqual([]);
    });
});
// [end install]
