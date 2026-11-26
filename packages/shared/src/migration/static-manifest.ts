/**
 * Assembles a static City Manifest v1 from a city seed (hand-written JSON: names, About, credits,
 * privacy, basemap, ...), the generated theme, and the migrated photos with their derived images.
 * The result is validated with the strict manifest schema; the CLI writes it only when it passes.
 */
import { translate } from '../i18n/index.js';
import { MANIFEST_VERSION, type Credit, type Manifest, type PhotoImage, type Theme } from '../schemas/manifest.js';
import { validateManifest, type ValidationResult } from '../schemas/validation.js';
import type { MigratedPhoto } from './legacy-photos.js';

export interface StaticManifestInput {
    /** Everything of `city` except `theme`; its `credits` get the photo authors' credit first. */
    readonly city: Readonly<Record<string, unknown>>;
    readonly theme: Theme;
    readonly photos: readonly MigratedPhoto[];
    /** The derived images per photo id; a photo without one is left out. */
    readonly images: ReadonlyMap<string, PhotoImage>;
}

/** One credit line naming `authors` (at least one), alphabetically in Romanian order, each once. */
function authorsLine(authors: readonly string[]): Credit {
    const names = [...new Set(authors)].toSorted((a, b) => a.localeCompare(b, 'ro')).join(', ');
    return { label: { ro: `${translate('ro', 'photos.title')}: ${names}`, en: `${translate('en', 'photos.title')}: ${names}` } };
}

/** The photos' authors, without the photos that have none. */
function authorsIn(photos: readonly { readonly author?: string | undefined }[]): string[] {
    return photos.flatMap((photo) => (photo.author === undefined ? [] : [photo.author]));
}

/** One credit naming every photo author, alphabetically in Romanian order; null when there is none. */
export function photoAuthorsCredit(photos: readonly { readonly author?: string | undefined }[]): Credit | null {
    const authors = authorsIn(photos);
    return authors.length === 0 ? null : authorsLine(authors);
}

/** The names a line `authorsLine` wrote lists, while it is untouched; null for any other credit. */
function authorsOf(credit: Credit): readonly string[] | null {
    const prefix = `${translate('ro', 'photos.title')}: `;
    if (!credit.label.ro.startsWith(prefix)) {
        return null;
    }
    const listed = credit.label.ro.slice(prefix.length).split(', ');
    return JSON.stringify(authorsLine(listed)) === JSON.stringify(credit) ? listed : null;
}

function named(credits: readonly Credit[], author: string): boolean {
    return credits.some((credit) => credit.label.ro.includes(author) || credit.label.en.includes(author));
}

/**
 * `credits` naming every author of `photos` (the old site's 2023 additions brought a new one, `docs/research/M5-interfaces.md`
 * → *The 2023 additions*): unchanged when each is named already; else the authors line the migration wrote, while it is
 * untouched, lists them all; else (that line edited or removed) a line for the authors no credit names is added last.
 */
export function creditsNamingAuthors(credits: readonly Credit[], photos: readonly { readonly author?: string | undefined }[]): Credit[] {
    const missing = authorsIn(photos).filter((author) => !named(credits, author));
    if (missing.length === 0) {
        return [...credits];
    }
    const line = credits.findIndex((credit) => authorsOf(credit) !== null);
    if (line < 0) {
        return [...credits, authorsLine(missing)];
    }
    return credits.map((credit, index) => (index === line ? authorsLine([...(authorsOf(credit) ?? []), ...missing]) : credit));
}

/** The manifest for `input`, validated (a failure lists the localized issues). */
export function buildStaticManifest(input: StaticManifestInput): ValidationResult<Manifest> {
    const photos = input.photos.flatMap((migrated) => {
        const image = input.images.get(migrated.photo.id);
        return image === undefined ? [] : [{ ...migrated.photo, image }];
    });
    const credit = photoAuthorsCredit(photos);
    const credits = Array.isArray(input.city['credits']) ? (input.city['credits'] as unknown[]) : [];
    return validateManifest({
        version: MANIFEST_VERSION,
        city: { ...input.city, theme: input.theme, credits: credit === null ? credits : [credit, ...credits] },
        layers: [],
        photos,
    });
}
