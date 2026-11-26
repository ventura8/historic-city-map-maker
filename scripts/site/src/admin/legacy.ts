import { z } from 'zod';
import {
    applyLegacyCorrections,
    cityImagerySchema,
    citySchema,
    creditsNamingAuthors,
    KNOWN_HTTPS_HOSTS,
    legacyCorrectionsSchema,
    migrateLegacyPhotos,
    photoAuthorsCredit,
    validate,
    validateManifest,
    type City,
    type CityImagery,
    type LegacyCorrections,
    type MigratedPhoto,
} from '@hcm/shared';

import { SiteBuildError, issuesText } from '../errors.js';
import type { SiteFileSystem } from '../files.js';

/**
 * The legacy Bucharest bundle the admin build ships for the Setup Assistant's import step (docs/research/M2b-interfaces.md
 * §3.3 h, `DECISIONS-for-review.md` §23d), below the admin's `dist/`:
 *
 * ```text
 * legacy/bucharest/city.json              the seed manifest's city, without its Mapbox token and analytics ids
 *                                         (the fields `setup.createCity` takes, CR-M2b-1), plus the imagery settings of
 *                                         scripts/seed/bucharest.city.json: the manifest is the viewer's, it holds none (M8);
 *                                         that file's About, credits and privacy replace the migrated ones, which
 *                                         `seed/bucharest/` keeps as they were (they said "coming soon" and GitHub Pages)
 * legacy/bucharest/photos.json            migrateLegacyPhotos(photos.legacy.geojson): [{sourceFile, legacyId?, photo}], the
 *                                         seed's records first, then each addition's (SEED_ADDITIONS), each corrected by
 *                                         the additions' corrections.json (the old site's later place and direction)
 * legacy/bucharest/corrections.json       those corrections, keyed by photo id: the import applies them to the photos a
 *                                         project already has, where the owner never changed the place or direction
 * legacy/bucharest/originals/<sourceFile> each original a record names, once (the import uploads them; photos.onUpload
 *                                         makes the public derivatives, so nothing is upscaled)
 * ```
 *
 * The additions (`docs/research/M5-interfaces.md` → *The 2023 additions*) are the photos the old site gained after the
 * legacy seed was taken, kept in their own folder because `seed/bucharest/` stays as migrated: their ids keep clear of
 * the seed's (`migrateLegacyPhotos`' reserved ids, as `migrate-legacy.mjs --joins` gives them), so the import of a
 * project that already has the 45 adds only the new ones. The city's credits name every photo's author, the additions'
 * too (`creditsNamingAuthors`).
 *
 * Hosting serves the files; the admin fetches them only during an import.
 */

/** Where the bundle lives below the admin's output folder. */
export const LEGACY_FOLDER = 'legacy/bucharest';

/** The seed it is made from. */
export const DEFAULT_SEED_DIR = 'seed/bucharest';

/** The seed folders whose photos join the default seed's, in order: the old site's 2023 additions. */
const SEED_ADDITIONS: readonly string[] = ['seed/bucharest-2023'];

/** The city file the seed manifest was made from: the only place that holds the city's target years. */
export const CITY_SEED_FILE = 'scripts/seed/bucharest.city.json';

/** One output file, relative to the admin's output folder: generated text, or a copy of a repository file. */
export type AdminFile = { readonly to: string; readonly content: string } | { readonly to: string; readonly from: string };

export interface LegacyBundle {
    readonly files: readonly AdminFile[];
    readonly photos: number;
    readonly originals: number;
    /** What the migration could not map one to one (a cone without its photo point, say); informational. */
    readonly warnings: number;
}

/**
 * The manifest city as `setup.createCity` takes it (the fields a client may not create, CR-M2b-1): an allowlist, so the
 * viewer's public token and the analytics ids, which are not the seed's to give, never travel.
 */
type LegacyCity = Pick<
    City,
    'id' | 'name' | 'center' | 'zoom' | 'minZoom' | 'maxZoom' | 'bounds' | 'about' | 'credits' | 'privacy' | 'theme' | 'basemap'
>;

type BundledCity = LegacyCity & { readonly imagery?: CityImagery };

function cityFields(city: City): LegacyCity {
    const { id, name, center, zoom, minZoom, maxZoom, bounds, about, credits, privacy, theme, basemap } = city;
    return { id, name, center, zoom, minZoom, maxZoom, bounds, about, credits, privacy, theme, basemap };
}

function readJson(files: SiteFileSystem, path: string): unknown {
    if (!files.isFile(path)) {
        throw new SiteBuildError(`${path} is missing: the legacy import bundles the committed Bucharest seed`);
    }
    try {
        return JSON.parse(files.readText(path));
    } catch (error: unknown) {
        throw new SiteBuildError(`${path}: not JSON: ${String(error)}`);
    }
}

/** The city file, or an empty one without it (a seed outside this repository). */
function cityFile(files: SiteFileSystem): Readonly<Record<string, unknown>> {
    return (files.isFile(CITY_SEED_FILE) ? readJson(files, CITY_SEED_FILE) : {}) as Readonly<Record<string, unknown>>;
}

/** The texts a visitor reads that the city file holds today; the seed manifest keeps the ones it was migrated with. */
const TEXT_FIELDS = ['about', 'credits', 'privacy'] as const;

type CityTexts = Pick<City, (typeof TEXT_FIELDS)[number]>;

/** Those texts as the city schema has them (the city schema's refinements forbid `pick`). */
const cityTextsSchema: z.ZodType<CityTexts> = z.object({
    about: citySchema.shape.about,
    credits: citySchema.shape.credits,
    privacy: citySchema.shape.privacy,
});

/** The migrated city's About, credits and privacy, each replaced by the city file's when it holds one, validated. */
function seedTexts(migrated: City, file: Readonly<Record<string, unknown>>): CityTexts {
    const held = Object.fromEntries(TEXT_FIELDS.filter((name) => file[name] !== undefined).map((name) => [name, file[name]]));
    const result = validate(cityTextsSchema, { about: migrated.about, credits: migrated.credits, privacy: migrated.privacy, ...held });
    if (!result.ok) {
        throw new SiteBuildError(`${CITY_SEED_FILE}: invalid texts\n${issuesText(result.issues)}`);
    }
    return result.value;
}

/** The city file's imagery settings; none when it holds none. */
function seedImagery(file: Readonly<Record<string, unknown>>): { readonly imagery?: CityImagery } {
    const { imagery } = file;
    if (imagery === undefined) {
        return {};
    }
    const result = validate(cityImagerySchema, imagery);
    if (!result.ok) {
        throw new SiteBuildError(`${CITY_SEED_FILE}: invalid imagery\n${issuesText(result.issues)}`);
    }
    return { imagery: result.value };
}

/** The bundled city and whether its credits are the city file's (they hold no authors' line: the bundle puts it first). */
function legacyCity(files: SiteFileSystem, seedDir: string): { readonly city: BundledCity; readonly fileCredits: boolean } {
    const path = `${seedDir}/manifest.static.json`;
    const result = validateManifest(readJson(files, path));
    if (!result.ok) {
        throw new SiteBuildError(`${path}: invalid manifest\n${issuesText(result.issues)}`);
    }
    const file = cityFile(files);
    const texts = seedTexts(result.value.city, file);
    return { city: { ...cityFields(result.value.city), ...texts, ...seedImagery(file) }, fileCredits: file['credits'] !== undefined };
}

/** The credits naming every author: the migrated list completes its authors' line; the city file's gets one, first. */
function bundledCredits(credits: City['credits'], photos: readonly MigratedPhoto[], fileCredits: boolean): City['credits'] {
    const shown = photos.map((record) => record.photo);
    const authors = fileCredits ? photoAuthorsCredit(shown) : null;
    return authors === null ? creditsNamingAuthors(credits, shown) : [authors, ...credits];
}

/** One seed folder's migrated records. */
interface SeedPhotos {
    readonly dir: string;
    readonly photos: readonly MigratedPhoto[];
    readonly warnings: number;
}

/** Every folder's `corrections.json`, merged (a folder without one has none). */
function correctionsOf(files: SiteFileSystem, dirs: readonly string[]): LegacyCorrections {
    const merged: Record<string, LegacyCorrections[string]> = {};
    for (const path of dirs.map((dir) => `${dir}/corrections.json`).filter((candidate) => files.isFile(candidate))) {
        const result = validate(legacyCorrectionsSchema, readJson(files, path));
        if (!result.ok) {
            throw new SiteBuildError(`${path}: invalid corrections\n${issuesText(result.issues)}`);
        }
        Object.assign(merged, result.value);
    }
    return merged;
}

/** Migrates each folder in order; a folder's ids keep clear of the folders before it. */
function migrateSeeds(files: SiteFileSystem, dirs: readonly string[]): SeedPhotos[] {
    const seeds: SeedPhotos[] = [];
    for (const dir of dirs) {
        const reserved = seeds.flatMap((seed) => seed.photos.map((record) => record.photo.id));
        const migration = migrateLegacyPhotos(readJson(files, `${dir}/photos.legacy.geojson`), KNOWN_HTTPS_HOSTS, reserved);
        if (migration.photos.length === 0) {
            throw new SiteBuildError(`${dir}/photos.legacy.geojson holds no photo`);
        }
        seeds.push({ dir, photos: migration.photos, warnings: migration.warnings.length });
    }
    return seeds;
}

/** Each original the records name, once; two folders may not bring two files of one name (one `originals/` folder). */
function originals(files: SiteFileSystem, seeds: readonly SeedPhotos[]): AdminFile[] {
    const copied = new Map<string, string>();
    return seeds.flatMap(({ dir, photos }) =>
        [...new Set(photos.map((record) => record.sourceFile))].map((name) => {
            const from = `${dir}/photos/${name}`;
            if (!files.isFile(from)) {
                throw new SiteBuildError(`${from} is missing: a legacy photo record names it`);
            }
            const earlier = copied.get(name);
            if (earlier !== undefined) {
                throw new SiteBuildError(`${from}: ${earlier} has the same name, and the bundle has one originals folder`);
            }
            copied.set(name, from);
            return { from, to: `${LEGACY_FOLDER}/originals/${name}` };
        }),
    );
}

/**
 * The bundle's files, read and validated from `seedDir` and its `additions` (SEED_ADDITIONS for the default seed, none
 * for another); throws SiteBuildError when an input is missing or invalid.
 */
export function planLegacyBundle(
    files: SiteFileSystem,
    seedDir = DEFAULT_SEED_DIR,
    additions: readonly string[] = seedDir === DEFAULT_SEED_DIR ? SEED_ADDITIONS : [],
): LegacyBundle {
    const { city: seedCity, fileCredits } = legacyCity(files, seedDir);
    const seeds = migrateSeeds(files, [seedDir, ...additions]);
    const corrections = correctionsOf(files, additions);
    const photos = applyLegacyCorrections(
        seeds.flatMap((seed) => seed.photos),
        corrections,
    );
    const city = { ...seedCity, credits: bundledCredits(seedCity.credits, photos, fileCredits) };
    const copies = originals(files, seeds);
    return {
        files: [
            { to: `${LEGACY_FOLDER}/city.json`, content: `${JSON.stringify(city)}\n` },
            { to: `${LEGACY_FOLDER}/photos.json`, content: `${JSON.stringify(photos)}\n` },
            { to: `${LEGACY_FOLDER}/corrections.json`, content: `${JSON.stringify(corrections)}\n` },
            ...copies,
        ],
        photos: photos.length,
        originals: copies.length,
        warnings: seeds.reduce((sum, seed) => sum + seed.warnings, 0),
    };
}
