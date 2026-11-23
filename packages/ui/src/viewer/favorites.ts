/**
 * The visitor's favourites (V91; the owner, 2026-11-23): places, photos, layers and stories starred in this browser only,
 * no account. They live in localStorage under `hcm:<cityId>:favorites` (the preferences' naming, so two cities on one
 * origin keep their own), as a JSON list of `{kind, id}`; every access is guarded, so a private window or blocked storage
 * keeps the stars for the page only and says so (`persisted` false). One store per page (`favorites`): the stars and the
 * Favourites sheet listen to its `change` event.
 */
import { localized, type Manifest, type ViewerLocale } from '@hcm/shared';

import { localizedText } from './text.js';

const FAVORITE_KINDS = ['poi', 'photo', 'layer', 'story'] as const;

export type FavoriteKind = (typeof FAVORITE_KINDS)[number];

export interface Favorite {
    readonly kind: FavoriteKind;
    readonly id: string;
}

/** At most this many are kept (the oldest go first): the storage stays small whatever a visitor does. */
export const MAX_FAVORITES = 500;

const ID = /^[A-Za-z0-9_-]{1,80}$/;

export function favoritesKey(cityId: string): string {
    return `hcm:${cityId}:favorites`;
}

function isFavorite(value: unknown): value is Favorite {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const { kind, id } = value as Record<string, unknown>;
    return (FAVORITE_KINDS as readonly unknown[]).includes(kind) && typeof id === 'string' && ID.test(id);
}

/** The stored list, keeping only well-formed entries; anything unreadable is an empty list. */
export function parseFavorites(raw: string | null): readonly Favorite[] {
    if (raw === null) {
        return [];
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(isFavorite).map(({ kind, id }) => ({ kind, id })) : [];
    } catch {
        return [];
    }
}

function same(a: Favorite, b: Favorite): boolean {
    return a.kind === b.kind && a.id === b.id;
}

/** `list` with `item` added at the front, or without it when it was there. */
export function toggled(list: readonly Favorite[], item: Favorite): readonly Favorite[] {
    return list.some((entry) => same(entry, item)) ? list.filter((entry) => !same(entry, item)) : [item, ...list].slice(0, MAX_FAVORITES);
}

/** One row of the Favourites sheet: what it opens, its title and icon. */
export interface FavoriteEntry extends Favorite {
    readonly title: string;
    readonly icon: string;
}

const KIND_ICONS: Readonly<Record<FavoriteKind, string>> = { poi: 'place', photo: 'image', layer: 'layers', story: 'museum' };

function titleOf(item: Favorite, manifest: Manifest, locale: ViewerLocale): string | null {
    const find = <T extends { readonly id: string }>(list: readonly T[] | undefined): T | undefined =>
        list?.find((entry) => entry.id === item.id);
    const titles: Readonly<Record<FavoriteKind, () => string | null>> = {
        poi: () => {
            const poi = find(manifest.pois);
            return poi === undefined ? null : localizedText(poi.title, locale);
        },
        photo: () => {
            const photo = find(manifest.photos) ?? find(manifest.unplaced);
            return photo === undefined ? null : localizedText(photo.title, locale);
        },
        layer: () => {
            const layer = find(manifest.layers);
            return layer === undefined ? null : `${localized(layer.label, locale)} (${String(layer.year)})`;
        },
        story: () => {
            const story = find(manifest.stories);
            return story === undefined ? null : localizedText(story.title, locale);
        },
    };
    return titles[item.kind]();
}

/** The favourites the manifest still has, in their saved order; one the city removed since is left out. */
export function favoriteEntries(list: readonly Favorite[], manifest: Manifest, locale: ViewerLocale): readonly FavoriteEntry[] {
    return list.flatMap((item) => {
        const title = titleOf(item, manifest, locale);
        return title === null ? [] : [{ ...item, title, icon: KIND_ICONS[item.kind] }];
    });
}

function storage(): Storage | null {
    try {
        return globalThis.localStorage;
    } catch {
        return null;
    }
}

/** The page's favourites, loaded for one city; `change` fires after every load and toggle. */
export class FavoritesStore extends EventTarget {
    #key: string | null = null;
    #list: readonly Favorite[] = [];
    #persisted = true;

    /** Reads the city's list (once per city: a second call for the same city keeps what is in memory). */
    load(cityId: string): void {
        const key = favoritesKey(cityId);
        if (key === this.#key) {
            return;
        }
        this.#key = key;
        try {
            this.#list = parseFavorites(storage()?.getItem(key) ?? null);
            this.#persisted = storage() !== null;
        } catch {
            this.#list = [];
            this.#persisted = false;
        }
        this.dispatchEvent(new Event('change'));
    }

    get list(): readonly Favorite[] {
        return this.#list;
    }

    /** False when the browser refused the storage: the stars hold for this page only. */
    get persisted(): boolean {
        return this.#persisted;
    }

    has(kind: FavoriteKind, id: string): boolean {
        return this.#list.some((entry) => entry.kind === kind && entry.id === id);
    }

    toggle(kind: FavoriteKind, id: string): void {
        this.#list = toggled(this.#list, { kind, id });
        this.#save();
        this.dispatchEvent(new Event('change'));
    }

    #save(): void {
        if (this.#key === null) {
            return;
        }
        try {
            const target = storage();
            target?.setItem(this.#key, JSON.stringify(this.#list));
            this.#persisted = target !== null;
        } catch {
            this.#persisted = false;
        }
    }
}

/** The page's one store. */
export const favorites = new FavoritesStore();

/** V91: the city's favourites, read once per city from this browser when its manifest arrives (null: not yet). */
export function loadCityFavorites(state: { readonly manifest: Pick<Manifest, 'city'> | null } | null): void {
    const manifest = state?.manifest ?? null;
    if (manifest !== null) {
        favorites.load(manifest.city.id);
    }
}
