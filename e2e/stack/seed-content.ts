import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
    cityDocSchema,
    layerDocSchema,
    photoDocSchema,
    poiCategoryDocSchema,
    poiDocSchema,
    STORAGE_PATHS,
    timestampFromDate,
} from '@hcm/shared';
import type { APIRequestContext } from '@playwright/test';

import type { CityWorld } from '../admin/support/content.js';
import { E2E_PROJECT_ID, emulatorOrigin } from '../admin/world.js';
import { E2E_TOKEN, E2E_XYZ_LAYER } from '../fixtures/world.js';

/**
 * The local stack's Bucharest content (docs/SETUP.md → *Local stack for manual testing*): the city as Setup and an earlier
 * season of editing left it, written past the rules as the server would, every document validated with the shared schema
 * first. Twelve of the legacy photos (`seed/bucharest/`, read only) with their real derivatives in the public bucket, four
 * place categories and seven places (points, a street, two areas; one a draft), and two linked layers (a Mapbox tileset
 * of the e2e account and an XYZ plan on the e2e tile host). The history triggers record every write, so History has
 * entries from the start. Generated test values only: no address, token or account is real.
 */

/** When the city was set up and edited (fixed: never the wall clock). */
const SEEDED_AT = new Date('2026-10-01T09:00:00.000Z');
const EDITED_AT = new Date('2026-10-15T16:30:00.000Z');

const LEGACY = 'seed/bucharest';
const PUBLIC_BUCKET = `${E2E_PROJECT_ID}-public`;

/** A schema as the seed uses it (zod's `parse`). */
interface Schema {
    parse(value: unknown): unknown;
}

/** `value` as Firestore hands it to a schema: every `Date` a timestamp. */
export function firestoreShape(value: unknown): unknown {
    if (value instanceof Date) {
        return timestampFromDate(value);
    }
    if (Array.isArray(value)) {
        return value.map(firestoreShape);
    }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, firestoreShape(item)]));
    }
    return value;
}

/** Validates `data` with `schema`, then writes it past the rules. */
async function write(world: CityWorld, path: string, schema: Schema, data: Readonly<Record<string, unknown>>): Promise<void> {
    schema.parse(firestoreShape(data));
    await world.emulators.setDocument(path, data);
}

type Json = Record<string, unknown>;

async function legacyManifest(): Promise<Json> {
    return JSON.parse(await readFile(`${LEGACY}/manifest.static.json`, 'utf8')) as Json;
}

/** The city as Setup leaves it once Mapbox is connected, with the legacy site's texts, credits and theme. */
export async function seedCity(world: CityWorld): Promise<void> {
    const legacy = (await legacyManifest())['city'] as Json;
    await write(world, `cities/${world.city}`, cityDocSchema, {
        name: { ro: 'București', en: 'Bucharest' },
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        center: { lat: 44.428, lng: 26.095 },
        zoom: 14,
        minZoom: 10,
        maxZoom: 19,
        about: legacy['about'],
        privacy: legacy['privacy'],
        credits: legacy['credits'],
        theme: legacy['theme'],
        mapbox: { user: 'e2e-user', publicToken: E2E_TOKEN },
        photosOverlay: { defaultOpacity: 1 },
        imagery: { autoPublish: true, rmseThresholdM: 15, targetYears: [1966, 1976, 1977, 1978, 1980] },
        published: true,
        createdAt: SEEDED_AT,
        updatedBy: 'system:setup',
        updatedAt: SEEDED_AT,
    });
}

const CATEGORIES = [
    { id: 'monumente', label: { ro: 'Monumente', en: 'Monuments' }, icon: 'account_balance', color: '#8E3B46' },
    { id: 'biserici', label: { ro: 'Biserici', en: 'Churches' }, icon: 'church', color: '#5B4B8A' },
    { id: 'cartiere', label: { ro: 'Cartiere demolate', en: 'Demolished quarters' }, icon: 'domain_disabled', color: '#8B5E3C' },
    { id: 'piete', label: { ro: 'Piețe și hale', en: 'Markets and halls' }, icon: 'store', color: '#2F6B4F' },
] as const;

export async function seedCategories(world: CityWorld): Promise<void> {
    for (const [order, { id, ...fields }] of CATEGORIES.entries()) {
        await write(world, `cities/${world.city}/poiCategories/${id}`, poiCategoryDocSchema, {
            ...fields,
            defaultOpacity: 1,
            order,
            createdAt: SEEDED_AT,
            updatedBy: 'system:setup',
            updatedAt: SEEDED_AT,
        });
    }
}

/** A closed ring of `[lat, lng]` corners (the first repeated at the end). */
function ring(corners: readonly (readonly [number, number])[]): { points: { lat: number; lng: number }[] } {
    const points = corners.map(([lat, lng]) => ({ lat, lng }));
    return { points: [...points, points[0] ?? { lat: 0, lng: 0 }] };
}

const WIKI = 'https://ro.wikipedia.org/wiki/';

/** The places: what Bucharest lost, and one that stands (a draft). */
const PLACES: readonly Json[] = [
    {
        id: 'biserica-enei',
        category: 'biserici',
        geometry: { type: 'Point', point: { lat: 44.4357, lng: 26.1003 } },
        title: { ro: 'Biserica Enei', en: 'Enei Church' },
        description: {
            ro: 'Biserică din secolul al XVIII-lea, **demolată în 1977** după cutremur, pentru lărgirea bulevardului.',
            en: 'An 18th-century church, **demolished in 1977** after the earthquake, to widen the boulevard.',
        },
        yearEnd: 1977,
        links: [{ url: `${WIKI}Biserica_Enei`, label: 'Wikipedia' }],
    },
    {
        id: 'manastirea-vacaresti',
        category: 'biserici',
        geometry: {
            type: 'Polygon',
            rings: [
                ring([
                    [44.4045, 26.124],
                    [44.4045, 26.1275],
                    [44.402, 26.1275],
                    [44.402, 26.124],
                ]),
            ],
        },
        title: { ro: 'Mănăstirea Văcărești', en: 'Văcărești Monastery' },
        description: { ro: 'Ctitorie din 1716, cel mai mare ansamblu mănăstiresc din sud-estul Europei, demolat în 1986.' },
        yearEnd: 1986,
        links: [{ url: `${WIKI}M%C4%83n%C4%83stirea_V%C4%83c%C4%83re%C8%99ti`, label: 'Wikipedia' }],
    },
    {
        id: 'cartierul-uranus',
        category: 'cartiere',
        geometry: {
            type: 'Polygon',
            rings: [
                ring([
                    [44.4275, 26.0835],
                    [44.4275, 26.0905],
                    [44.4215, 26.0905],
                    [44.4215, 26.0835],
                ]),
            ],
        },
        title: { ro: 'Cartierul Uranus', en: 'The Uranus quarter' },
        description: {
            ro: 'Străzi întregi rase în 1984 pentru Casa Poporului.',
            en: 'Whole streets razed in 1984 for the House of the People.',
        },
        yearEnd: 1984,
        photoIds: ['arionoaia-1980', 'ecoului-1978', 'iontaranu-1980', 'uranus-spre-izvor-colt-13-septembrie'],
    },
    {
        id: 'strada-mihai-voda',
        category: 'cartiere',
        geometry: {
            type: 'LineString',
            points: [
                { lat: 44.43106, lng: 26.0865 },
                { lat: 44.43115, lng: 26.088 },
                { lat: 44.4314, lng: 26.09 },
                { lat: 44.4318, lng: 26.0921 },
            ],
        },
        title: { ro: 'Strada Mihai Vodă', en: 'Mihai Vodă Street' },
        yearEnd: 1985,
        photoIds: ['mihai-voda-1978'],
    },
    {
        id: 'hala-unirii',
        category: 'piete',
        geometry: { type: 'Point', point: { lat: 44.4268, lng: 26.1022 } },
        title: { ro: 'Hala Unirii', en: 'Unirii Market Hall' },
        yearStart: 1872,
        yearEnd: 1984,
    },
    {
        id: 'teatrul-national-vechi',
        category: 'monumente',
        geometry: { type: 'Point', point: { lat: 44.437, lng: 26.097 } },
        title: { ro: 'Teatrul Național (clădirea veche)', en: 'The National Theatre (old building)' },
        description: { ro: 'Pe Calea Victoriei, distrus de bombardamentul din 24 august 1944.' },
        yearStart: 1852,
        yearEnd: 1944,
    },
    {
        id: 'ateneul-roman',
        category: 'monumente',
        geometry: { type: 'Point', point: { lat: 44.4413, lng: 26.0973 } },
        title: { ro: 'Ateneul Român', en: 'The Romanian Athenaeum' },
        yearStart: 1888,
        published: false,
    },
];

export async function seedPlaces(world: CityWorld): Promise<void> {
    for (const { id, ...place } of PLACES) {
        await write(world, `cities/${world.city}/pois/${String(id)}`, poiDocSchema, {
            published: true,
            ...place,
            createdAt: SEEDED_AT,
            createdBy: world.uid,
            updatedBy: world.uid,
            updatedAt: SEEDED_AT,
        });
    }
}

/** A later edit, so History has an update to compare and revert. */
export async function editPlace(world: CityWorld): Promise<void> {
    const [enei] = PLACES;
    const { id, ...place } = enei ?? {};
    await write(world, `cities/${world.city}/pois/${String(id)}`, poiDocSchema, {
        published: true,
        ...place,
        title: { ro: 'Biserica Enei (Sf. Nicolae)', en: 'Enei Church (St Nicholas)' },
        createdAt: SEEDED_AT,
        createdBy: world.uid,
        updatedBy: world.uid,
        updatedAt: EDITED_AT,
    });
}

/** The legacy photos the city starts with (`seed/bucharest/manifest.static.json` ids): varied years, authors, places. */
const PHOTO_IDS = [
    'arionoaia-1980',
    'ecoului-1978',
    'mihai-voda-spre-dambovita',
    'iontaranu-1980',
    'biserica-izvorul-tamaduirii',
    'mihai-voda-1978',
    'calea-rahovei-colt-sabinelor-1978',
    'intrarea-antim-1982',
    'uranus-spre-izvor-colt-13-septembrie',
    'sfintii-apostoli-1978',
    'strandul-opereta-1976',
    'gara-obor',
] as const;

/** Drafts: not on the public map yet. */
const UNPUBLISHED: ReadonlySet<string> = new Set(['biserica-izvorul-tamaduirii', 'strandul-opereta-1976']);

/** The photo fields a client or the processing trigger writes, from a legacy manifest entry. */
const PHOTO_FIELDS = ['title', 'year', 'dateText', 'author', 'license', 'rightsReview', 'links', 'location', 'bearing', 'fov'];

async function uploadPublic(api: APIRequestContext, path: string, bytes: Buffer): Promise<string> {
    const query = new URLSearchParams({ uploadType: 'media', name: path });
    const response = await api.post(`${emulatorOrigin('storage')}/upload/storage/v1/b/${PUBLIC_BUCKET}/o?${query.toString()}`, {
        headers: { authorization: 'Bearer owner', 'content-type': 'image/webp' },
        data: bytes,
    });
    if (!response.ok()) {
        throw new Error(`upload of ${path}: ${String(response.status())} ${await response.text()}`);
    }
    return `https://storage.googleapis.com/${PUBLIC_BUCKET}/${path}`;
}

/** One legacy photo: its derivatives in the public bucket, its document processed. */
async function seedPhoto(world: CityWorld, api: APIRequestContext, entry: Json): Promise<void> {
    const id = String(entry['id']);
    const image = entry['image'] as { web: string; thumb: string; w: number; h: number };
    const web = await readFile(`${LEGACY}/${image.web}`);
    const thumb = await readFile(`${LEGACY}/${image.thumb}`);
    const sha256 = createHash('sha256').update(web).digest('hex');
    const fields = Object.fromEntries(PHOTO_FIELDS.filter((field) => field in entry).map((field) => [field, entry[field]]));
    await write(world, `cities/${world.city}/photos/${id}`, photoDocSchema, {
        ...fields,
        legacyId: id,
        published: !UNPUBLISHED.has(id),
        processing: 'done',
        image: {
            web: await uploadPublic(api, STORAGE_PATHS.photoDerivative(world.city, id, sha256, 'web'), web),
            thumb: await uploadPublic(api, STORAGE_PATHS.photoDerivative(world.city, id, sha256, 'thumb'), thumb),
            sha256,
            w: image.w,
            h: image.h,
        },
        createdAt: SEEDED_AT,
        createdBy: world.uid,
        updatedBy: world.uid,
        updatedAt: SEEDED_AT,
    });
}

/** The twelve legacy photos, and one upload whose processing failed (no image, its reason). */
export async function seedPhotos(world: CityWorld, api: APIRequestContext): Promise<void> {
    const photos = (await legacyManifest())['photos'] as Json[];
    for (const id of PHOTO_IDS) {
        const entry = photos.find((photo) => photo['id'] === id);
        if (entry !== undefined) {
            await seedPhoto(world, api, entry);
        }
    }
    await write(world, `cities/${world.city}/photos/scanare-ilizibila`, photoDocSchema, {
        title: { ro: 'Scanare ilizibilă' },
        license: 'unknown',
        location: { lat: 44.4295, lng: 26.0915 },
        published: false,
        processing: 'failed',
        processingError: 'apiError.photo.unreadable',
        createdAt: EDITED_AT,
        createdBy: world.uid,
        updatedBy: 'system:photos',
        updatedAt: EDITED_AT,
    });
}

/** Two linked layers: a Corona frame on the e2e Mapbox account (blue tiles) and the 1911 plan on the e2e tile host. */
export async function seedLayers(world: CityWorld): Promise<void> {
    const stamp = { createdAt: SEEDED_AT, updatedBy: world.uid, updatedAt: SEEDED_AT };
    await write(world, `cities/${world.city}/layers/plan-1911`, layerDocSchema, {
        year: 1911,
        label: { ro: 'Planul Bucureștiului, 1911', en: 'Plan of Bucharest, 1911' },
        kind: 'map',
        attribution: 'Plan istoric (tile-urile de test ale serverului e2e)',
        source: { type: 'xyz', tiles: [E2E_XYZ_LAYER.tiles], tileSize: 256 },
        minzoom: 10,
        maxzoom: 18,
        order: 0,
        opacity: 0.7,
        defaultVisible: true,
        adjustments: { saturation: -0.3 },
        status: 'ready',
        published: true,
        ...stamp,
    });
    await write(world, `cities/${world.city}/layers/corona-1968`, layerDocSchema, {
        year: 1968,
        label: { ro: 'Corona 1968', en: 'Corona 1968' },
        kind: 'satellite',
        sensor: 'KH-4B',
        attribution: 'USGS EROS',
        source: { type: 'mapbox', tilesetId: 'e2e-user.corona-1968' },
        minzoom: 10,
        maxzoom: 17,
        order: 1,
        opacity: 0.85,
        defaultVisible: false,
        status: 'ready',
        published: true,
        mapbox: { tilesetId: 'e2e-user.corona-1968', origin: 'linked' },
        ...stamp,
    });
}
