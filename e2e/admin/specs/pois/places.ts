import { translateAdminContent, type AdminContentKey } from '@hcm/shared';
import type { Page } from '@playwright/test';

import type { CityWorld } from '../../support/content.js';

/**
 * The places area's world for the admin tier (docs/research/M2c-interfaces.md §7, §12.3): a city, its categories and
 * places, written into the Firestore emulator past the rules (as the city settings or an earlier session would have left
 * them), and the places page's texts.
 */

/** An editor text (`adminContent.*`) in the project's language. */
export function poisText(lang: 'ro' | 'en', key: AdminContentKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminContent(lang, key, params);
}

/** The city document: bounds around Bucharest, its view's centre, published. */
export async function seedPoisCity(world: CityWorld, at: Date): Promise<void> {
    await world.emulators.setDocument(`cities/${world.city}`, {
        name: { ro: 'București', en: 'Bucharest' },
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        center: { lat: 44.43, lng: 26.1 },
        zoom: 13,
        published: true,
        updatedBy: 'system:setup',
        updatedAt: at,
    });
}

/** Two categories, in this order: monuments, then markets. */
export async function seedCategories(world: CityWorld, at: Date): Promise<void> {
    const categories = [
        { id: 'monuments', label: { ro: 'Monumente', en: 'Monuments' }, icon: 'account_balance', color: '#8E3B46', order: 1 },
        { id: 'markets', label: { ro: 'Piețe', en: 'Markets' }, icon: 'storefront', color: '#2F6B4F', order: 2 },
    ];
    for (const { id, ...fields } of categories) {
        await world.emulators.setDocument(`cities/${world.city}/poiCategories/${id}`, {
            ...fields,
            defaultOpacity: 1,
            updatedBy: 'system:setup',
            updatedAt: at,
        });
    }
}

export interface SeededPlace {
    readonly id: string;
    readonly title: string;
    /** `[longitude, latitude]` of a point. */
    readonly at: readonly [number, number];
    readonly extra?: Readonly<Record<string, unknown>>;
}

/** A published point of the monuments from 1890 (every place names a year; its `extra` overrides any field). */
export async function seedPlace(world: CityWorld, place: SeededPlace, at: Date): Promise<void> {
    await world.emulators.setDocument(`cities/${world.city}/pois/${place.id}`, {
        category: 'monuments',
        geometry: { type: 'Point', point: { lat: place.at[1], lng: place.at[0] } },
        title: { ro: place.title },
        yearStart: 1890,
        published: true,
        createdAt: at,
        createdBy: world.uid,
        updatedBy: world.uid,
        updatedAt: at,
        ...place.extra,
    });
}

/** Chooses `file` with the list's Import GeoJSON (a hidden file input inside its label). */
export async function chooseImport(
    page: Page,
    file: { readonly name: string; readonly mimeType: string; readonly text: string },
): Promise<void> {
    await page
        .locator('hcm-poi-list input[type="file"]')
        .setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: Buffer.from(file.text) });
}

/** A GeoJSON Feature of `geometry` with these properties. */
export function feature(
    geometry: Readonly<Record<string, unknown>>,
    properties: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
    // Every place names a year: a feature that names none starts in 1890.
    const dated = 'yearStart' in properties || 'yearEnd' in properties ? properties : { yearStart: 1890, ...properties };
    return { type: 'Feature', geometry, properties: dated };
}
