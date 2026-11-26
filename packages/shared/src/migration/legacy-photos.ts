/**
 * The 2015–2022 photo data (`seed/<city>/photos.legacy.geojson`: camera Points and view-cone
 * Polygons sharing a `photo` URL) to manifest photos, as pure functions (PLAN → M1; the CLI is
 * `scripts/seed/migrate-legacy.mjs`).
 *
 * - Every Point is a photo. A Polygon is that photo's view cone: it is linked to the Point of the same
 *   original file ({@link legacyPhotoKey}: the URL's decoded file name, whatever its host, its `%20`s
 *   or its Unicode form) whose position is nearest to one of its vertices (one file can be shown
 *   from two places; each place stays its own photo), and bearing and field of view are measured
 *   from the cone (apex = the photo point). Matching the URLs as written would leave a cone whose
 *   URL is spelled differently without its point, a second photo without a direction beside it
 *   (`docs/LESSONS.md`, 2026-11-08).
 * - A Polygon without any Point is a photo too, placed at the cone's apex.
 * - Ids are the slug of the file name, with `-2`, `-3` on collisions, in feature order (stable).
 * - Titles are Romanian; `source`/`description` HTML becomes plain text plus https links;
 *   the licence is `permission-legacy` with `rightsReview: true` (security review §5).
 */
import { z } from 'zod';

import { distanceMeters } from '../geo/bearing.js';
import { coneFromPolygon, findConeApex, type MeasuredCone } from '../geo/cone.js';
import { roundTo, type LngLat } from '../geo/math.js';
import type { Photo, PhotoLink } from '../schemas/manifest.js';
import { MAX_LINKS } from '../schemas/primitives.js';
import { KNOWN_HTTPS_HOSTS, legacyHtmlToText } from './html.js';
import { createIdAllocator, fileStem, slugify } from './slug.js';
import { parseLegacyYear } from './year.js';

/** A migrated photo: the manifest record without its image, and where its original file is. */
export interface MigratedPhoto {
    /** Decoded file name of the original in `seed/<city>/photos/`. */
    readonly sourceFile: string;
    /** The legacy feature id, kept for the Firestore import (M2). */
    readonly legacyId?: string;
    readonly photo: Omit<Photo, 'image'>;
}

export interface MigrationWarning {
    /** Index of the feature in the legacy collection (-1: the collection itself). */
    readonly feature: number;
    readonly message: string;
}

export interface LegacyMigration {
    readonly photos: readonly MigratedPhoto[];
    /** How many photos got their bearing and field of view from a cone. */
    readonly cones: number;
    readonly warnings: readonly MigrationWarning[];
}

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
// No minimum: a malformed cone becomes a warning (see orphanSeed and linkCone), not a skipped photo point.
const ring = z.array(position);

const legacyFeatureSchema = z.object({
    type: z.literal('Feature'),
    id: z.string().optional(),
    geometry: z.discriminatedUnion('type', [
        z.object({ type: z.literal('Point'), coordinates: position }),
        z.object({ type: z.literal('Polygon'), coordinates: z.tuple([ring], ring) }),
    ]),
    properties: z.object({
        title: z.string().default(''),
        photo: z.string().min(1),
        author: z.string().default(''),
        year: z.union([z.number(), z.string()]).optional(),
        source: z.string().default(''),
        description: z.string().default(''),
    }),
});

type LegacyFeature = z.infer<typeof legacyFeatureSchema>;
type LegacyProperties = LegacyFeature['properties'];

const legacyCollectionSchema = z.object({ type: z.literal('FeatureCollection'), features: z.array(z.unknown()) });

/** A feature that will become a photo; `cone` is filled in when a Polygon is linked to it. */
interface Seed {
    readonly key: string;
    readonly index: number;
    readonly legacyId: string | undefined;
    readonly properties: LegacyProperties;
    readonly fileName: string;
    readonly location: LngLat;
    cone: MeasuredCone | null;
}

interface Located {
    readonly index: number;
    readonly feature: LegacyFeature;
    readonly fileName: string;
    /** {@link legacyPhotoKey} of the feature's `photo`. */
    readonly key: string;
}

/** A file name without a directory part and not hidden: what can safely be joined to `photos/`. */
const SAFE_FILE_NAME = /^(?!\.)[^/\\]{1,255}$/;

function decodeSafely(text: string): string {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}

/** The original's file name from its legacy URL (last path segment, decoded), or null if unusable. */
export function legacyFileName(photoUrl: string): string | null {
    const cut = photoUrl.search(/[?#]/);
    const path = cut < 0 ? photoUrl : photoUrl.slice(0, cut);
    const name = decodeSafely(path.slice(path.lastIndexOf('/') + 1));
    return SAFE_FILE_NAME.test(name) ? name : null;
}

/**
 * What tells two features that show the same original: the decoded file name in Unicode NFC (`parcul%20ferdinand.jpg`
 * on one host and `parcul ferdinand.jpg` on another are one file; `ţ` and `t` with a combining cedilla are one letter).
 */
export function legacyPhotoKey(fileName: string): string {
    return fileName.normalize('NFC');
}

function locate(item: unknown, index: number, warnings: MigrationWarning[]): Located[] {
    const parsed = legacyFeatureSchema.safeParse(item);
    if (!parsed.success) {
        warnings.push({ feature: index, message: 'skipped: not a Point or Polygon feature with a photo' });
        return [];
    }
    const fileName = legacyFileName(parsed.data.properties.photo);
    if (fileName === null) {
        warnings.push({ feature: index, message: `skipped: unusable photo file name in ${parsed.data.properties.photo}` });
        return [];
    }
    return [{ index, feature: parsed.data, fileName, key: legacyPhotoKey(fileName) }];
}

function seedOf(located: Located, location: LngLat, cone: MeasuredCone | null): Seed {
    return {
        key: located.key,
        index: located.index,
        legacyId: located.feature.id,
        properties: located.feature.properties,
        fileName: located.fileName,
        location,
        cone,
    };
}

/** Distance from `seed` to the nearest vertex of `vertices`. */
function gap(seed: Seed, vertices: readonly LngLat[]): number {
    return Math.min(...vertices.map((vertex) => distanceMeters(seed.location, vertex)));
}

/** A cone without a Point of its own becomes a photo at its apex. */
function orphanSeed(located: Located, vertices: readonly LngLat[], warnings: MigrationWarning[]): Seed[] {
    const apex = findConeApex(vertices);
    const cone = apex === null ? null : coneFromPolygon(vertices, apex);
    if (cone === null) {
        warnings.push({ feature: located.index, message: 'skipped: a cone without a photo point and without a usable shape' });
        return [];
    }
    warnings.push({ feature: located.index, message: `a cone without a photo point: ${located.fileName} placed at the cone's apex` });
    return [seedOf(located, cone.apex, cone)];
}

function linkCone(target: Seed, located: Located, vertices: readonly LngLat[], warnings: MigrationWarning[]): void {
    if (target.cone !== null) {
        warnings.push({ feature: located.index, message: `ignored: a second cone for the photo of feature ${String(target.index)}` });
        return;
    }
    target.cone = coneFromPolygon(vertices, target.location);
    if (target.cone === null) {
        warnings.push({ feature: located.index, message: 'ignored: a degenerate cone' });
    }
}

function nearestSeed(candidates: readonly Seed[], vertices: readonly LngLat[]): Seed | undefined {
    let best: Seed | undefined;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const seed of candidates) {
        const distance = gap(seed, vertices);
        if (distance < bestGap) {
            best = seed;
            bestGap = distance;
        }
    }
    return best;
}

/** Links a cone to the photo point of the same original nearest to it, or returns the orphan photo it becomes. */
function attachCone(seeds: readonly Seed[], located: Located, vertices: readonly LngLat[], warnings: MigrationWarning[]): Seed[] {
    const target = nearestSeed(
        seeds.filter((seed) => seed.key === located.key),
        vertices,
    );
    if (target === undefined) {
        return orphanSeed(located, vertices, warnings);
    }
    linkCone(target, located, vertices, warnings);
    return [];
}

function mergeLinks(groups: readonly (readonly PhotoLink[])[], index: number, warnings: MigrationWarning[]): PhotoLink[] {
    const links = groups.flat().filter((link, position, all) => all.findIndex((other) => other.url === link.url) === position);
    if (links.length > MAX_LINKS) {
        warnings.push({ feature: index, message: `kept the first ${String(MAX_LINKS)} of ${String(links.length)} links` });
    }
    return links.slice(0, MAX_LINKS);
}

function textFields(seed: Seed, upgradeHosts: readonly string[], warnings: MigrationWarning[]): Pick<Photo, 'description' | 'links'> {
    const description = legacyHtmlToText(seed.properties.description, upgradeHosts);
    const source = legacyHtmlToText(seed.properties.source, upgradeHosts);
    for (const url of [...description.dropped, ...source.dropped]) {
        warnings.push({ feature: seed.index, message: `dropped a link that is not https: ${url}` });
    }
    // A source that is only a link ("<a href=...>Flickr</a>") adds the link, not its label as text.
    const text = [description.text, source.linkOnly ? '' : source.text].filter((part) => part !== '').join('\n\n');
    const links = mergeLinks([source.links, description.links], seed.index, warnings);
    return text === '' ? { links } : { description: { ro: text }, links };
}

function coneFields(cone: MeasuredCone | null): Pick<Photo, 'bearing' | 'fov'> {
    return cone === null ? {} : { bearing: roundTo(cone.bearing, 1) % 360, fov: Math.round(cone.fov) };
}

function dateFields(seed: Seed): Pick<Photo, 'year' | 'dateText'> {
    const { year, dateText } = parseLegacyYear(seed.properties.year, seed.fileName);
    return { ...(year === undefined ? {} : { year }), ...(dateText === undefined ? {} : { dateText: { ro: dateText } }) };
}

function toMigrated(seed: Seed, id: string, upgradeHosts: readonly string[], warnings: MigrationWarning[]): MigratedPhoto {
    const title = seed.properties.title.trim();
    if (title === '') {
        warnings.push({ feature: seed.index, message: `no title: the file name ${seed.fileName} is used` });
    }
    const author = seed.properties.author.trim();
    const photo: Omit<Photo, 'image'> = {
        id,
        title: { ro: title === '' ? fileStem(seed.fileName) : title },
        ...textFields(seed, upgradeHosts, warnings),
        ...dateFields(seed),
        ...(author === '' ? {} : { author }),
        license: 'permission-legacy',
        rightsReview: true,
        location: { lat: roundTo(seed.location[1], 7), lng: roundTo(seed.location[0], 7) },
        ...coneFields(seed.cone),
    };
    return seed.legacyId === undefined
        ? { sourceFile: seed.fileName, photo }
        : { sourceFile: seed.fileName, legacyId: seed.legacyId, photo };
}

function readCollection(input: unknown, warnings: MigrationWarning[]): Located[] {
    const collection = legacyCollectionSchema.safeParse(input);
    if (!collection.success) {
        warnings.push({ feature: -1, message: 'not a GeoJSON FeatureCollection' });
        return [];
    }
    return collection.data.features.flatMap((item, index) => locate(item, index, warnings));
}

/**
 * Migrates a legacy FeatureCollection; never throws (problems become warnings). `reservedIds` are the ids of photos
 * already migrated (the first 45 of `seed/bucharest/` when `seed/bucharest-2023/` joins them): no new photo takes one.
 */
export function migrateLegacyPhotos(
    input: unknown,
    upgradeHosts: readonly string[] = KNOWN_HTTPS_HOSTS,
    reservedIds: Iterable<string> = [],
): LegacyMigration {
    const warnings: MigrationWarning[] = [];
    const located = readCollection(input, warnings);
    const seeds: Seed[] = [];
    for (const item of located) {
        const geometry = item.feature.geometry;
        if (geometry.type === 'Point') {
            seeds.push(seedOf(item, geometry.coordinates, null));
        }
    }
    const orphans = located.flatMap((item) =>
        item.feature.geometry.type === 'Polygon' ? attachCone(seeds, item, item.feature.geometry.coordinates[0], warnings) : [],
    );
    const ordered = [...seeds, ...orphans].toSorted((a, b) => a.index - b.index);
    const nextId = createIdAllocator(reservedIds);
    const photos = ordered.map((seed) => toMigrated(seed, nextId(slugify(fileStem(seed.fileName))), upgradeHosts, warnings));
    return { photos, cones: ordered.filter((seed) => seed.cone !== null).length, warnings };
}
