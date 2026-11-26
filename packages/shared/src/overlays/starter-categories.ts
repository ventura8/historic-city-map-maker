/**
 * The starter POI categories (the live manual test of 2026-11-01, finding 35): a city with no category cannot hold a
 * place, so a new city starts with five common kinds (building, street, square, church, monument) and the place editor
 * offers them in one click to a city that has none (the migrated Bucharest). Each has its label in both languages, the
 * icon the admin's icon guesser gives its label (`packages/admin/src/settings/icon-guess.ts`; its test pins that the
 * two agree) and a colour of the city's palette: the default sepia of a new category, then four companion tones, every
 * one dark enough for the white glyph (contrast 3:1 or more; the test pins it). The admin edits or deletes them as any
 * other category. A city that already has categories is offered the starters it lacks (finding 41): a starter is there when
 * its Romanian or English label equals one of a category's labels, case, diacritics and spacing aside.
 */
import { freeOverlayId } from '../api/layers.js';
import type { PoiIcon } from '../schemas/poi.js';

export interface StarterCategory {
    readonly label: { readonly ro: string; readonly en: string };
    readonly icon: PoiIcon;
    readonly color: string;
}

/** The starter categories, in the order the viewer's Places group lists them. */
export const STARTER_POI_CATEGORIES: readonly StarterCategory[] = [
    { label: { ro: 'Clădire', en: 'Building' }, icon: 'domain', color: '#8b5e3c' },
    { label: { ro: 'Stradă', en: 'Street' }, icon: 'add_road', color: '#1f6f8b' },
    { label: { ro: 'Piață', en: 'Square' }, icon: 'location_on', color: '#6a4c93' },
    { label: { ro: 'Biserică', en: 'Church' }, icon: 'church', color: '#a23b2a' },
    { label: { ro: 'Monument', en: 'Monument' }, icon: 'account_balance', color: '#4d6b2f' },
];

/** A starter category as it is stored, with its id (the stamp and `createdAt` are the writer's). */
export interface StarterCategoryDoc {
    readonly id: string;
    readonly label: { readonly ro: string; readonly en: string };
    readonly icon: string;
    readonly color: string;
    readonly defaultOpacity: number;
    readonly order: number;
}

/** A label as the starters compare it: no diacritics, lower case, trimmed, one space between words. */
function starterLabelKey(text: string): string {
    return text.normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase().trim().replaceAll(/\s+/gu, ' ');
}

/** The labels of a category the starters are compared with (the English one is optional). */
interface CategoryLabels {
    readonly label: { readonly ro: string; readonly en?: string | undefined };
}

/** The starter categories none of `categories` already names, in starter order. */
export function missingStarterCategories(categories: readonly CategoryLabels[]): StarterCategory[] {
    const names = new Set(categories.flatMap(({ label }) => [label.ro, label.en ?? ''].map(starterLabelKey)));
    return STARTER_POI_CATEGORIES.filter(({ label }) => !names.has(starterLabelKey(label.ro)) && !names.has(starterLabelKey(label.en)));
}

/**
 * The starter categories with their ids and orders: each id the slug of its Romanian label, kept clear of `taken` (the
 * city's layers' and categories' ids) and of `photos`; the orders follow `firstOrder` (after the city's own categories).
 * `starters` are the ones to add (all five by default).
 */
export function starterCategoryDocs(
    taken: Iterable<string>,
    firstOrder = 0,
    starters: readonly StarterCategory[] = STARTER_POI_CATEGORIES,
): StarterCategoryDoc[] {
    const used = new Set(taken);
    return starters.map((category, index) => {
        const id = freeOverlayId(category.label.ro, used, 'category');
        used.add(id);
        return { id, label: category.label, icon: category.icon, color: category.color, defaultOpacity: 1, order: firstOrder + index };
    });
}
