/**
 * The settings' sections in the order the section list shows them (`docs/research/M2c-interfaces.md` §8.5), and how a
 * route's params name the open one: `#/settings/<section>` and `#/settings/categories/<categoryId>`.
 */
import { isId } from '@hcm/shared';

import { CITY_SECTIONS } from './city-sections.js';
import { NEW_CATEGORY } from './categories.js';

/**
 * M5 (docs/research/M5-interfaces.md §5.6, CR-M5-10; owner: export): `export`, the city's static export; (§1.8; owner:
 * multi-city) `budget`, the city's share of the project's budgets. `icon`: the public map's browser tab icon (`./icon.ts`).
 */
const SETTINGS_SECTIONS = [...CITY_SECTIONS, 'categories', 'overlays', 'export', 'budget', 'icon'] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export interface SettingsRoute {
    readonly section: SettingsSection | null;
    /** `#/settings/categories/<id>`: a category id, `NEW_CATEGORY`, or null. */
    readonly category: string | null;
}

function isSection(value: string | undefined): value is SettingsSection {
    return (SETTINGS_SECTIONS as readonly (string | undefined)[]).includes(value);
}

function categoryParam(value: string | undefined): string | null {
    return value !== undefined && (value === NEW_CATEGORY || isId(value)) ? value : null;
}

/** The section and category a route's params name; an unknown section is the list, an invalid id no category. */
export function settingsRoute(params: readonly string[]): SettingsRoute {
    const [first, second] = params;
    const section = isSection(first) ? first : null;
    return { section, category: section === 'categories' ? categoryParam(second) : null };
}
