/**
 * `ops.tick`'s `sources` step (M28, `docs/research/M28-sources.md` §10): where each city's country keeps its old maps and
 * images, as `countrySources/{country}`. A city whose country is not known yet is placed with one Nominatim reverse lookup
 * of its centre a tick (Nominatim's one request a second, by far). Then one list a tick that is missing or older than
 * `COUNTRY_SOURCES_REFRESH_DAYS` is built again: from the curated list when the country has one (`COUNTRY_SEEDS`), else from
 * Wikidata's national archives, library and mapping agency of the country (open data, CC0; `verified: false`); and every
 * place's website is checked to answer, through `remote` (https only, no credential, no redirect followed, small reads).
 */
import { COUNTRY_SEEDS } from '@hcm/shared/country-seeds';
import { countrySourcesDocSchema, countrySourcesDue, type CountryPlace, type CountrySourcesDoc } from '@hcm/shared/sources';
import { FIRESTORE_PATHS, cityDocSchema, systemWriter, timestampFromDate, timestampToDate, type CityDoc } from '@hcm/shared';

import type { Ports } from '../ports/index.js';

export type CountrySourcesDeps = Pick<Ports, 'log' | 'documents' | 'remote' | 'geocoder'>;

const CHECK_LIMITS = { maxBytes: 65_536, timeoutMs: 8_000 } as const;
const WIKIDATA = 'https://query.wikidata.org/sparql';
/** At most this many places found in Wikidata (the country's national archives, library and mapping agency, with a website). */
const RESEARCHED_MAX = 20;

/** Wikidata classes: national archives, national library, national mapping agency. */
const CLASSES = [
    ['Q2122214', 'archive'],
    ['Q22806', 'library'],
    ['Q6979629', 'mappingAgency'],
] as const;

type Kind = (typeof CLASSES)[number][1];

function researchQuery(country: string): string {
    const values = CLASSES.map(([id, kind]) => `(wd:${id} "${kind}")`).join(' ');
    return [
        'SELECT ?item ?label ?site ?kind WHERE {',
        `?country wdt:P297 "${country}" . VALUES (?class ?kind) { ${values} }`,
        '?item wdt:P31 ?class ; wdt:P17 ?country ; wdt:P856 ?site .',
        'OPTIONAL { ?item rdfs:label ?label . FILTER(LANG(?label) = "en") } }',
        `LIMIT ${String(RESEARCHED_MAX)}`,
    ].join(' ');
}

interface Binding {
    readonly item?: { readonly value?: unknown };
    readonly label?: { readonly value?: unknown };
    readonly site?: { readonly value?: unknown };
    readonly kind?: { readonly value?: unknown };
}

function text(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function valueAt(row: Binding, key: keyof Binding): string | undefined {
    return text(row[key]?.value);
}

/** A website address kept only when it is https (the remote reader refuses anything else). */
function httpsOnly(url: string | undefined): string | undefined {
    return url?.startsWith('https://') === true ? url : undefined;
}

/** One Wikidata answer row as a place, or undefined when it misses a field or its website is not https. */
function placeOf(row: Binding): CountryPlace | undefined {
    const fields = [valueAt(row, 'item')?.split('/').pop(), valueAt(row, 'label'), httpsOnly(valueAt(row, 'site')), valueAt(row, 'kind')];
    if (fields.includes(undefined)) {
        return undefined;
    }
    const [item, label, site, kind] = fields as [string, string, string, Kind];
    const name = label.slice(0, 160);
    return { id: item, name: { ro: name, en: name }, kind, access: 'both', cost: 'unknown', materials: [], url: site, verified: false };
}

/** The country's institutions Wikidata knows, each with an https website (none when Wikidata does not answer). */
export async function researchCountry(deps: CountrySourcesDeps, country: string): Promise<readonly CountryPlace[]> {
    const url = `${WIKIDATA}?format=json&query=${encodeURIComponent(researchQuery(country))}`;
    try {
        const answer = await deps.remote.get(url, { maxBytes: 262_144, timeoutMs: 20_000, allowedHosts: ['query.wikidata.org'] });
        const rows = (JSON.parse(new TextDecoder().decode(answer.bytes)) as { results?: { bindings?: Binding[] } }).results?.bindings;
        const places = (rows ?? []).map(placeOf).filter((place): place is CountryPlace => place !== undefined);
        return [...new Map(places.map((place) => [place.id, place])).values()];
    } catch (error) {
        deps.log.warn('country research failed', { country, error: String(error) });
        return [];
    }
}

/** Whether `url` answers (any status under 400; a redirect counts: the site is there). */
async function answers(deps: CountrySourcesDeps, url: string): Promise<boolean> {
    try {
        return (await deps.remote.get(url, CHECK_LIMITS)).status < 400;
    } catch {
        return false;
    }
}

/** The places of `country`, each with whether its website answered now. */
async function checkedPlaces(deps: CountrySourcesDeps, country: string): Promise<Pick<CountrySourcesDoc, 'places' | 'origin'>> {
    const seed = COUNTRY_SEEDS[country];
    const places = seed === undefined ? await researchCountry(deps, country) : seed.places;
    const checked = await Promise.all(places.map(async (place) => ({ ...place, reachable: await answers(deps, place.url) })));
    return { places: checked, origin: seed === undefined ? 'researched' : 'curated' };
}

/** The language of a country's institutions: the curated list's, else English (Wikidata's names are read in English). */
function languageOf(country: string): string {
    return COUNTRY_SEEDS[country]?.language ?? 'en';
}

interface CityPlace {
    readonly id: string;
    readonly lat: number;
    readonly lng: number;
}

function centreOf(id: string, city: CityDoc): CityPlace {
    const { bounds } = city;
    return city.center === undefined
        ? { id, lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 }
        : { id, lat: city.center.lat, lng: city.center.lng };
}

interface PlacedCity {
    readonly cityId: string;
    readonly country: string;
}

/** Nominatim's country code, when it is one (`RO`). */
function countryOf(found: { readonly countryCode?: string } | undefined): string | undefined {
    const code = found?.countryCode;
    return code !== undefined && /^[A-Z]{2}$/.test(code) ? code : undefined;
}

/** The country of the first city no list names yet (one lookup a tick), or undefined. */
async function placeOneCity(
    deps: CountrySourcesDeps,
    cities: readonly CityPlace[],
    known: ReadonlySet<string>,
): Promise<PlacedCity | undefined> {
    const city = cities.find((candidate) => !known.has(candidate.id));
    if (city === undefined) {
        return undefined;
    }
    const country = countryOf(await deps.geocoder.reverse({ lat: city.lat, lng: city.lng, lang: 'en' }));
    deps.log.info('city country looked up', { cityId: city.id, country: country ?? 'none' });
    return country === undefined ? undefined : { cityId: city.id, country };
}

/** A list with cities whose month is over (a list just started for a newly placed city always is). */
function isDue(list: CountrySourcesDoc, now: Date): boolean {
    return list.cities.length > 0 && countrySourcesDue(timestampToDate(list.refreshedAt), now);
}

async function write(deps: CountrySourcesDeps, list: Omit<CountrySourcesDoc, 'updatedBy' | 'updatedAt'>, now: Date): Promise<void> {
    const at = timestampFromDate(now);
    await deps.documents.set(FIRESTORE_PATHS.countrySource(list.country), countrySourcesDocSchema, {
        ...list,
        updatedBy: systemWriter('ops'),
        updatedAt: at,
    });
}

async function readLists(deps: CountrySourcesDeps): Promise<Map<string, CountrySourcesDoc>> {
    const stored = await deps.documents.query(FIRESTORE_PATHS.countrySources, countrySourcesDocSchema);
    return new Map(stored.documents.map((entry) => [entry.data.country, entry.data]));
}

async function cityPlaces(deps: CountrySourcesDeps): Promise<readonly CityPlace[]> {
    const stored = await deps.documents.query(FIRESTORE_PATHS.cities, cityDocSchema);
    return stored.documents.map((entry) => centreOf(entry.id, entry.data));
}

/** A country's list before its first refresh: no place yet, due at once. */
function startedList(country: string): CountrySourcesDoc {
    const never = timestampFromDate(new Date(0));
    const origin = COUNTRY_SEEDS[country] === undefined ? 'researched' : 'curated';
    return {
        country,
        language: languageOf(country),
        cities: [],
        places: [],
        origin,
        refreshedAt: never,
        updatedBy: systemWriter('ops'),
        updatedAt: never,
    };
}

/** The placed city added to its country's list (one started when the country has none yet); the list returned. */
function join(lists: Map<string, CountrySourcesDoc>, placed: PlacedCity): CountrySourcesDoc {
    const current = lists.get(placed.country) ?? startedList(placed.country);
    const next = { ...current, cities: [...current.cities, placed.cityId] };
    lists.set(placed.country, next);
    return next;
}

async function refreshOne(deps: CountrySourcesDeps, list: CountrySourcesDoc, now: Date): Promise<void> {
    const { country, cities } = list;
    const factsCheckedOn = COUNTRY_SEEDS[country]?.factsCheckedOn;
    const fresh = {
        country,
        language: languageOf(country),
        cities: [...cities],
        ...(await checkedPlaces(deps, country)),
        ...(factsCheckedOn === undefined ? {} : { factsCheckedOn }),
        refreshedAt: timestampFromDate(now),
    };
    await write(deps, fresh, now);
    deps.log.info('country sources refreshed', { country, cities: cities.length, places: fresh.places.length });
}

/**
 * The step: places one city, then refreshes at most one country's list. Returns the country refreshed, if any. A city placed
 * in a country whose list is fresh only joins its `cities`.
 */
export async function refreshCountrySources(deps: CountrySourcesDeps, now: Date): Promise<string | undefined> {
    const lists = await readLists(deps);
    const known = new Set([...lists.values()].flatMap((list) => list.cities));
    const placed = await placeOneCity(deps, await cityPlaces(deps), known);
    const joined = placed === undefined ? undefined : join(lists, placed);
    const due = [...lists.values()].find((list) => isDue(list, now));
    if (due !== undefined) {
        await refreshOne(deps, due, now);
        return due.country;
    }
    await (joined === undefined ? Promise.resolve() : write(deps, joined, now));
    return undefined;
}
