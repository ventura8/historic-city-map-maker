/**
 * The Nominatim adapter (`functions/src/adapters/nominatim.ts`, `docs/research/M4-interfaces.md` §4.2) against the shared
 * fake Nominatim: the request Nominatim's usage policy asks for (the application's User-Agent, the cell's centre, zoom
 * 18, names and address details), the places it knows (a named building with its English name, a road in its sector, a
 * quarter only, the open sea), a mirror's address, and its refusals and failures. No network.
 */
import { NOMINATIM_ATTRIBUTION, NOMINATIM_USER_AGENT } from '@hcm/shared';
import { createFakeFetch, createUpstreamFakes, jsonResponse, route, routeTable } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { createNominatim } from '../../src/adapters/nominatim.js';
import { UpstreamError } from '../../src/ports/errors.js';

const OSM_LICENCE = 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright';

function nominatim() {
    const fakes = createUpstreamFakes();
    return { fakes, geocoder: createNominatim({ fetch: fakes.fetch }) };
}

describe('reverse', () => {
    it('happyPath_aNamedBuildingAnswersItsNamesRoadAndArea', async () => {
        const { fakes, geocoder } = nominatim();

        await expect(geocoder.reverse({ lat: 44.4413, lng: 26.0973, lang: 'ro' })).resolves.toEqual({
            name: 'Ateneul Român',
            nameEn: 'Romanian Athenaeum',
            road: 'Strada Benjamin Franklin',
            area: 'Sector 1',
            countryCode: 'RO',
            licence: OSM_LICENCE,
        });
        const [call] = fakes.callsTo('nominatim.reverse');
        const query = new URL(String(call?.url)).searchParams;
        expect(Object.fromEntries(query)).toEqual({
            format: 'jsonv2',
            lat: '44.4413',
            lon: '26.0973',
            zoom: '18',
            addressdetails: '1',
            namedetails: '1',
            'accept-language': 'ro',
        });
        expect(call?.headers['user-agent']).toBe(NOMINATIM_USER_AGENT);
    });

    it('happyPath_aRoadInItsSectorHasNoEnglishName', async () => {
        const { geocoder } = nominatim();

        await expect(geocoder.reverse({ lat: 44.4355, lng: 26.0974, lang: 'en' })).resolves.toEqual({
            name: 'Calea Victoriei',
            road: 'Calea Victoriei',
            area: 'Sector 1',
            countryCode: 'RO',
            licence: OSM_LICENCE,
        });
    });

    it('happyPath_aQuarterWithoutAnyNamedObject', async () => {
        const { geocoder } = nominatim();

        await expect(geocoder.reverse({ lat: 44.4325, lng: 26.07, lang: 'ro' })).resolves.toEqual({
            area: 'Cotroceni',
            countryCode: 'RO',
            licence: OSM_LICENCE,
        });
    });

    it('badPath_theOpenSeaIsNoPlace', async () => {
        const { geocoder } = nominatim();

        await expect(geocoder.reverse({ lat: 43.0, lng: 31.0, lang: 'ro' })).resolves.toBeUndefined();
    });

    it('happyPath_aMirrorIsAskedAtItsOwnAddressAndAnAnswerWithoutLicenceGetsOsmsLine', async () => {
        const upstream = createFakeFetch(
            routeTable([
                route('GET', 'https://mirror.e2e.test/nominatim/reverse', 'mirror.reverse', () => jsonResponse({ name: 'Piața' })),
            ]),
        );
        const geocoder = createNominatim({ fetch: upstream.fetch, url: 'https://mirror.e2e.test/nominatim/reverse' });

        await expect(geocoder.reverse({ lat: 44.43, lng: 26.1, lang: 'ro' })).resolves.toEqual({
            name: 'Piața',
            licence: NOMINATIM_ATTRIBUTION,
        });
    });

    it.each([
        ['rateLimited', 429],
        ['unavailable', 503],
    ] as const)('badPath_aFakeIn_%s_isThatFailure', async (mode, status) => {
        const { fakes, geocoder } = nominatim();
        fakes.fail('nominatim', mode);

        await expect(geocoder.reverse({ lat: 44.4, lng: 26.1, lang: 'ro' })).rejects.toEqual(
            new UpstreamError('nominatim', mode, { status }),
        );
    });

    it.each([
        ['a refusal by policy is a rate limit', 403, 'rateLimited'],
        ['a bad request is invalid', 400, 'invalid'],
    ] as const)('badPath_%s', async (_name, status, failure) => {
        const upstream = createFakeFetch(
            routeTable([route('GET', 'https://nominatim.openstreetmap.org/reverse', 'nominatim.reverse', () => jsonResponse({}, status))]),
        );

        const error = await createNominatim({ fetch: upstream.fetch })
            .reverse({ lat: 44.4, lng: 26.1, lang: 'ro' })
            .catch((caught: unknown) => caught);

        expect(error).toMatchObject({ service: 'nominatim', failure, status });
    });

    it.each([
        ['an HTML page', () => new Response('<html></html>', { status: 200 })],
        ['a list', () => jsonResponse([])],
    ])('badPath_%s_isInvalid', async (_name, answer) => {
        const upstream = createFakeFetch(
            routeTable([route('GET', 'https://nominatim.openstreetmap.org/reverse', 'nominatim.reverse', answer)]),
        );

        await expect(createNominatim({ fetch: upstream.fetch }).reverse({ lat: 44.4, lng: 26.1, lang: 'ro' })).rejects.toMatchObject({
            service: 'nominatim',
            failure: 'invalid',
        });
    });
});

/** M5 (`cities.locate`): New city finds the named city's box. */
describe('search', () => {
    it('happyPath_aCityIsFoundWithItsBoxAndName', async () => {
        const { fakes, geocoder } = nominatim();

        await expect(geocoder.search({ q: 'Cluj-Napoca', lang: 'ro' })).resolves.toEqual({
            bounds: { west: 23.4846, south: 46.7181, east: 23.6919, north: 46.8167 },
            name: 'Cluj-Napoca, Cluj, România',
        });
        const [call] = fakes.callsTo('nominatim.search');
        expect(Object.fromEntries(new URL(String(call?.url)).searchParams)).toEqual({
            q: 'Cluj-Napoca',
            format: 'jsonv2',
            limit: '1',
            'accept-language': 'ro',
        });
        expect(call?.headers['user-agent']).toBe(NOMINATIM_USER_AGENT);
    });

    it('badPath_aNameNothingHasIsNone', async () => {
        const { geocoder } = nominatim();

        await expect(geocoder.search({ q: 'Turda E2E', lang: 'ro' })).resolves.toBeUndefined();
        await expect(geocoder.search({ q: '', lang: 'ro' })).resolves.toBeUndefined();
    });

    it('happyPath_aMirrorsSearchSitsBesideItsReverseAndAPlaceWithoutANameHasNone', async () => {
        const place = { boundingbox: ['44.3', '44.6', '25.9', '26.3'] };
        const upstream = createFakeFetch(
            routeTable([route('GET', 'https://mirror.e2e.test/nominatim/search', 'mirror.search', () => jsonResponse([place]))]),
        );
        const geocoder = createNominatim({ fetch: upstream.fetch, url: 'https://mirror.e2e.test/nominatim/reverse' });

        await expect(geocoder.search({ q: 'București', lang: 'en' })).resolves.toEqual({
            bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
            name: '',
        });
    });

    it.each([
        ['an object', () => jsonResponse({ error: 'x' })],
        ['a place without a box', () => jsonResponse([{ display_name: 'x' }])],
        ['a box of three', () => jsonResponse([{ boundingbox: ['1', '2', '3'] }])],
        ['a box that is not numbers', () => jsonResponse([{ boundingbox: ['a', '2', '3', '4'] }])],
    ])('badPath_%s_isInvalid', async (_name, answer) => {
        const upstream = createFakeFetch(
            routeTable([route('GET', 'https://nominatim.openstreetmap.org/search', 'nominatim.search', answer)]),
        );

        await expect(createNominatim({ fetch: upstream.fetch }).search({ q: 'x', lang: 'ro' })).rejects.toMatchObject({
            service: 'nominatim',
            failure: 'invalid',
        });
    });

    it('badPath_aRefusalIsARateLimit', async () => {
        const { fakes, geocoder } = nominatim();
        fakes.fail('nominatim', 'rateLimited');

        await expect(geocoder.search({ q: 'Cluj', lang: 'ro' })).rejects.toEqual(
            new UpstreamError('nominatim', 'rateLimited', { status: 429 }),
        );
    });
});
