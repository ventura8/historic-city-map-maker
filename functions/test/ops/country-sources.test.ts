/**
 * `ops.tick`'s `sources` step (M28 §10): a city placed in its country with one reverse lookup, the curated list of a country
 * that has one (every website checked), Wikidata's institutions for a country without one, a fresh list a second city only
 * joins, a month-old list refreshed, and the failures (no country, Wikidata down, a website that does not answer).
 */
import { COUNTRY_SEEDS } from '@hcm/shared/country-seeds';
import { countrySourcesDocSchema, type CountrySourcesDoc } from '@hcm/shared/sources';
import { FIRESTORE_PATHS, cityDocSchema, timestampFromDate } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { refreshCountrySources, researchCountry } from '../../src/ops/country-sources.js';
import { CITY_ID, cityDoc } from '../publish/city.js';
import { opsDeps, type OpsTestDeps } from './fakes.js';

const NOW = '2026-11-14T10:00:00.000Z';
const BYTES = new TextEncoder().encode('<html></html>');
const RO = COUNTRY_SEEDS['RO'];

async function list(deps: OpsTestDeps, country: string): Promise<CountrySourcesDoc | undefined> {
    return deps.documents.get(FIRESTORE_PATHS.countrySource(country), countrySourcesDocSchema);
}

async function withCity(deps: OpsTestDeps, id = CITY_ID, overrides: Parameters<typeof cityDoc>[0] = {}): Promise<void> {
    await deps.documents.set(FIRESTORE_PATHS.city(id), cityDocSchema, cityDoc(overrides));
}

function wikidata(rows: readonly object[]): Uint8Array {
    return new TextEncoder().encode(JSON.stringify({ results: { bindings: rows } }));
}

const row = (item: string, label: string | undefined, site: string, kind: string) => ({
    item: { value: `https://www.wikidata.org/entity/${item}` },
    ...(label === undefined ? {} : { label: { value: label } }),
    site: { value: site },
    kind: { value: kind },
});

function serveWikidata(deps: OpsTestDeps, bytes: Uint8Array): void {
    deps.sites.files.clear();
    const original = deps.remote.get.bind(deps.remote);
    Object.assign(deps.remote, {
        get: (url: string, limits: Parameters<typeof original>[1]) =>
            url.startsWith('https://query.wikidata.org/')
                ? Promise.resolve({ status: 200, contentType: 'application/json', bytes })
                : original(url, limits),
    });
}

describe('refreshCountrySources', () => {
    it('happyPath_aRomanianCityGetsTheCuratedListWithEachWebsiteChecked @S-A183-HAPPY-REFRESH', async () => {
        const deps = opsDeps(NOW);
        await withCity(deps);
        const first = RO?.places[0]?.url ?? '';
        deps.sites.serve(first, BYTES, 'text/html');

        await expect(refreshCountrySources(deps, new Date(NOW))).resolves.toBe('RO');

        const stored = await list(deps, 'RO');
        expect(stored).toMatchObject({
            country: 'RO',
            language: 'ro',
            cities: [CITY_ID],
            origin: 'curated',
            factsCheckedOn: RO?.factsCheckedOn,
        });
        expect(stored?.places.map((place) => place.reachable)).toEqual(RO?.places.map((place) => place.url === first));
        expect(stored?.updatedBy).toBe('system:ops');
    });

    it('happyPath_aSecondCityJoinsAFreshListWithoutARefresh', async () => {
        const deps = opsDeps(NOW);
        await withCity(deps);
        await refreshCountrySources(deps, new Date(NOW));
        await withCity(deps, 'bacau', { center: { lat: 46.57, lng: 26.91 } });
        const fetched = deps.sites.fetched.length;

        await expect(refreshCountrySources(deps, new Date(NOW))).resolves.toBeUndefined();

        expect((await list(deps, 'RO'))?.cities).toEqual([CITY_ID, 'bacau']);
        expect(deps.sites.fetched).toHaveLength(fetched);
    });

    it('happyPath_aListAMonthOldIsRefreshedAndAFreshOneIsLeftAlone', async () => {
        const deps = opsDeps('2026-10-01T10:00:00.000Z');
        await withCity(deps);
        await refreshCountrySources(deps, new Date('2026-10-01T10:00:00.000Z'));

        await expect(refreshCountrySources(deps, new Date('2026-10-20T10:00:00.000Z'))).resolves.toBeUndefined();
        await expect(refreshCountrySources(deps, new Date(NOW))).resolves.toBe('RO');

        expect((await list(deps, 'RO'))?.refreshedAt).toEqual(timestampFromDate(new Date(NOW)));
    });

    it('happyPath_aCountryWithoutACuratedListGetsWikidatasInstitutionsUnverified', async () => {
        const deps = opsDeps(NOW);
        deps.country = 'MD';
        await withCity(deps);
        serveWikidata(
            deps,
            wikidata([
                row('Q1', 'National Archives of Moldova', 'https://arhiva.gov.md/', 'archive'),
                row('Q1', 'National Archives of Moldova', 'https://arhiva.gov.md/', 'archive'),
                row('Q2', 'National Library', 'bnrm.md/', 'library'),
                row('Q3', undefined, 'https://example.md/', 'library'),
            ]),
        );

        await expect(refreshCountrySources(deps, new Date(NOW))).resolves.toBe('MD');

        const stored = await list(deps, 'MD');
        expect(stored).toMatchObject({ language: 'en', origin: 'researched', cities: [CITY_ID] });
        expect(stored?.factsCheckedOn).toBeUndefined();
        expect(stored?.places).toEqual([
            {
                id: 'Q1',
                name: { ro: 'National Archives of Moldova', en: 'National Archives of Moldova' },
                kind: 'archive',
                access: 'both',
                cost: 'unknown',
                materials: [],
                url: 'https://arhiva.gov.md/',
                verified: false,
                reachable: false,
            },
        ]);
    });

    it('badPath_aPlaceWithNoCountryWritesNothing @S-A183-BAD-REFRESH', async () => {
        const deps = opsDeps(NOW);
        deps.country = undefined;
        await withCity(deps);

        await expect(refreshCountrySources(deps, new Date(NOW))).resolves.toBeUndefined();

        expect(await list(deps, 'RO')).toBeUndefined();
    });

    it('badPath_noCityMeansNoLookupAndNoList', async () => {
        const deps = opsDeps(NOW);

        await expect(refreshCountrySources(deps, new Date(NOW))).resolves.toBeUndefined();

        expect(deps.sites.fetched).toEqual([]);
    });
});

describe('researchCountry', () => {
    it('badPath_wikidataDownOrUnreadableGivesNoPlaces', async () => {
        const deps = opsDeps(NOW);
        await expect(researchCountry(deps, 'MD')).resolves.toEqual([]);
        serveWikidata(deps, new TextEncoder().encode('not json'));
        await expect(researchCountry(deps, 'MD')).resolves.toEqual([]);
        serveWikidata(deps, new TextEncoder().encode('{}'));
        await expect(researchCountry(deps, 'MD')).resolves.toEqual([]);
    });
});
