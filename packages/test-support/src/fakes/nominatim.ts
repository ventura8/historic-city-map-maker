import { fixtureResponse, type FixtureName } from '../api-fixtures/index.js';
import { route, type Route } from './routes.js';
import type { FailureMode, ServiceFake } from './service.js';

/**
 * Nominatim reverse geocoding (`nominatim.openstreetmap.org/reverse`) and, for M5's New city (`cities.locate`), its search
 * (`/search`: Cluj-Napoca is found, any other name answers an empty list), which only the server calls (the
 * `assist-geocode` queue's worker, `docs/research/M4-interfaces.md` §4.2, §8): a few Bucharest places answer as Nominatim does at zoom 18
 * (a named building with its English name, a quarter with no named object or road), every other point inside Romania
 * answers the fixture's road in its sector with the point's own coordinates, and anywhere else answers
 * `{"error": "Unable to geocode"}` with HTTP 200, as Nominatim does over the open sea. `fail('nominatim', 'rateLimited')`
 * answers 429 and `'unavailable'` 503; the recording `fetch` counts the calls (`callsTo('nominatim.reverse')`).
 */

/** Romania's bounding box, generously: inside it the fake knows an address. */
const KNOWN_AREA = { south: 43.5, north: 48.3, west: 20.2, east: 29.8 } as const;

/** The places with an answer of their own, and how near (in degrees) a point must be to get it. */
const KNOWN_PLACES: readonly { readonly lat: number; readonly lon: number; readonly fixture: FixtureName }[] = [
    /** Ateneul Român (Romanian Athenaeum): a named building. */
    { lat: 44.4413, lon: 26.0973, fixture: 'nominatim/reverse.building' },
    /** Cotroceni: a quarter, nothing named nearer. */
    { lat: 44.4325, lon: 26.07, fixture: 'nominatim/reverse.quarter' },
];
const NEAR_DEG = 0.0015;

const FAILURES: Readonly<Partial<Record<FailureMode, FixtureName>>> = {
    unavailable: 'nominatim/error.unavailable',
    rateLimited: 'nominatim/error.rate-limited',
};

function inKnownArea(lat: number, lon: number): boolean {
    return lat >= KNOWN_AREA.south && lat <= KNOWN_AREA.north && lon >= KNOWN_AREA.west && lon <= KNOWN_AREA.east;
}

/** The `lat` and `lon` of a query, or undefined when either is missing or not a number. */
function pointOf(query: URLSearchParams): { readonly lat: number; readonly lon: number } | undefined {
    const [lat, lon] = [query.get('lat'), query.get('lon')].map((value) =>
        value === null || value.trim() === '' ? Number.NaN : Number(value),
    );
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat: Number(lat), lon: Number(lon) } : undefined;
}

/** The answer of a known place near the point, or the road every other point in Romania gets. */
function answerAt(point: { readonly lat: number; readonly lon: number }): Response {
    const known = KNOWN_PLACES.find((place) => Math.abs(place.lat - point.lat) <= NEAR_DEG && Math.abs(place.lon - point.lon) <= NEAR_DEG);
    if (known !== undefined) {
        return fixtureResponse(known.fixture);
    }
    return inKnownArea(point.lat, point.lon)
        ? fixtureResponse('nominatim/reverse.ok', { merge: { lat: String(point.lat), lon: String(point.lon) } })
        : fixtureResponse('nominatim/reverse.unable');
}

/** The names a search finds (M5 New city, `cities.locate`), lower case without diacritics; any other finds nothing. */
const KNOWN_NAMES: ReadonlySet<string> = new Set(['cluj', 'cluj-napoca']);

function plainName(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
}

/** The fake Nominatim (stateless). */
export function createNominatimFake(): ServiceFake {
    const reverse: Route['answer'] = (request) => {
        const point = pointOf(request.url.searchParams);
        return point === undefined ? fixtureResponse('nominatim/reverse.unable', { status: 400 }) : answerAt(point);
    };
    const search: Route['answer'] = (request) =>
        fixtureResponse(
            KNOWN_NAMES.has(plainName(request.url.searchParams.get('q') ?? '')) ? 'nominatim/search.city' : 'nominatim/search.none',
        );
    return {
        name: 'nominatim',
        routes: [
            route('GET', 'https://nominatim.openstreetmap.org/reverse', 'nominatim.reverse', reverse),
            route('GET', 'https://nominatim.openstreetmap.org/search', 'nominatim.search', search),
        ],
        failure: (mode) => {
            const name = FAILURES[mode];
            return name === undefined ? undefined : fixtureResponse(name);
        },
        scenarios: {},
        snapshot: () => ({}),
    };
}
