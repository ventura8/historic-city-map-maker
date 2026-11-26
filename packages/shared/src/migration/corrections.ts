/**
 * The old site's later changes to photos we had already migrated (`docs/research/M5-interfaces.md` → *The 2023
 * additions*, *Directions from the old site*): the legacy seed (`seed/bucharest/`, kept as migrated) was copied before
 * the owner's account gave some of its photos a view cone, or moved their point. A correction, keyed by photo id in
 * `seed/bucharest-2023/corrections.json`, carries the old site's place and direction, measured from its cone exactly
 * as the first migration measured the others (`migrateLegacyPhotos`), and the values the migration gave, so an import
 * changes only a photo that still holds them.
 */
import { z } from 'zod';

import { distanceMeters } from '../geo/bearing.js';
import { bearingSchema, fovSchema, idSchema, latLngSchema } from '../schemas/primitives.js';
import { legacyFileName, legacyPhotoKey, migrateLegacyPhotos, type MigratedPhoto } from './legacy-photos.js';

/** What the first migration gave the photo: an import changes a photo only while it still holds these. */
const migratedPlaceSchema = z.strictObject({
    location: latLngSchema,
    bearing: bearingSchema.optional(),
    fov: fovSchema.optional(),
});

const legacyCorrectionSchema = z.strictObject({
    /** The old site's point. */
    location: latLngSchema,
    /** Measured from the old site's cone, as `migrateLegacyPhotos` measures one. */
    bearing: bearingSchema,
    fov: fovSchema,
    migrated: migratedPlaceSchema,
    /** The old site's `photo` URL the correction was read from (provenance; never fetched). */
    source: z.string().min(1).max(500),
});

/** `seed/<city>-<year>/corrections.json`: one correction per photo id. */
export const legacyCorrectionsSchema = z.record(idSchema, legacyCorrectionSchema);

export type LegacyCorrection = z.infer<typeof legacyCorrectionSchema>;
export type LegacyCorrections = z.infer<typeof legacyCorrectionsSchema>;

/**
 * What the old site says of one of our photos: it gave a direction or a place we lack (`corrected`), it agrees with ours
 * (`had`), its entry has no cone (`noCone`), or it no longer has the photo (`gone`).
 */
type LegacyCorrectionStatus = 'corrected' | 'had' | 'noCone' | 'gone';

interface LegacyCorrectionRow {
    readonly id: string;
    readonly status: LegacyCorrectionStatus;
}

interface LegacyCorrectionResult {
    readonly corrections: LegacyCorrections;
    /** Every photo of `ours`, in order. */
    readonly report: readonly LegacyCorrectionRow[];
}

type Place = Pick<MigratedPhoto['photo'], 'location' | 'bearing' | 'fov'>;

/** The old site's photo of the same original nearest to ours (one file may be shown from two places). */
function counterpart(ours: MigratedPhoto, theirs: readonly MigratedPhoto[]): MigratedPhoto | undefined {
    const key = legacyPhotoKey(ours.sourceFile);
    const here = ours.photo.location;
    let best: MigratedPhoto | undefined;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const candidate of theirs.filter((photo) => legacyPhotoKey(photo.sourceFile) === key)) {
        const there = candidate.photo.location;
        const gap = distanceMeters([here.lng, here.lat], [there.lng, there.lat]);
        if (gap < bestGap) {
            best = candidate;
            bestGap = gap;
        }
    }
    return best;
}

function samePlace(a: Place, b: Place): boolean {
    return a.location.lat === b.location.lat && a.location.lng === b.location.lng && a.bearing === b.bearing && a.fov === b.fov;
}

/** The old site's place and direction of its photo `match`, when there is one and it has a cone. */
function aimed(match: MigratedPhoto | undefined): LegacyCorrection | null {
    const photo = match?.photo;
    if (photo?.bearing === undefined || photo.fov === undefined) {
        return null;
    }
    const { location, bearing, fov } = photo;
    return { location, bearing, fov, migrated: { location }, source: '' };
}

/** Why the old site has no direction for a photo: it no longer has the photo, or no cone for it. */
function absence(match: MigratedPhoto | undefined): LegacyCorrectionStatus {
    return match === undefined ? 'gone' : 'noCone';
}

function migratedOf(photo: Place): LegacyCorrection['migrated'] {
    return {
        location: photo.location,
        ...(photo.bearing === undefined ? {} : { bearing: photo.bearing }),
        ...(photo.fov === undefined ? {} : { fov: photo.fov }),
    };
}

interface Compared {
    readonly row: LegacyCorrectionRow;
    readonly correction?: LegacyCorrection;
}

/** How the old site's entry of `ours` compares: none, no cone, the same place and direction, or a correction. */
function compare(ours: MigratedPhoto, theirs: readonly MigratedPhoto[], sources: ReadonlyMap<string, string>): Compared {
    const id = ours.photo.id;
    const match = counterpart(ours, theirs);
    const found = aimed(match);
    if (match === undefined || found === null) {
        return { row: { id, status: absence(match) } };
    }
    if (samePlace(ours.photo, found)) {
        return { row: { id, status: 'had' } };
    }
    const source = sources.get(legacyPhotoKey(match.sourceFile)) ?? match.sourceFile;
    return { row: { id, status: 'corrected' }, correction: { ...found, migrated: migratedOf(ours.photo), source } };
}

/** A feature's `photo` URL, or null. */
function photoUrlOf(feature: unknown): string | null {
    const url = (feature as { readonly properties?: { readonly photo?: unknown } } | null)?.properties?.photo;
    return typeof url === 'string' ? url : null;
}

/** The `photo` URLs of a collection's features, in order. */
function urlsOf(later: unknown): string[] {
    const features = (later as { readonly features?: unknown } | null)?.features;
    return (Array.isArray(features) ? (features as unknown[]) : []).map(photoUrlOf).filter((url) => url !== null);
}

/** The old site's `photo` URL of each original as its first feature spells it, by {@link legacyPhotoKey} of its file name. */
function photoUrls(later: unknown): Map<string, string> {
    const urls = new Map<string, string>();
    for (const url of urlsOf(later)) {
        const name = legacyFileName(url);
        if (name !== null && !urls.has(legacyPhotoKey(name))) {
            urls.set(legacyPhotoKey(name), url);
        }
    }
    return urls;
}

/**
 * Compares every photo we migrated (`ours`: the seed's and its additions', with their final ids) with the old site's
 * current data (`later`, a legacy FeatureCollection), migrated the same way, so bearing and field of view come from its
 * cones as the first migration measured them. Pure; `later`'s problems are the migration's warnings, not thrown.
 */
export function deriveLegacyCorrections(ours: readonly MigratedPhoto[], later: unknown): LegacyCorrectionResult {
    const theirs = migrateLegacyPhotos(later).photos;
    const sources = photoUrls(later);
    const compared = ours.map((photo) => compare(photo, theirs, sources));
    const corrections: Record<string, LegacyCorrection> = {};
    for (const { row, correction } of compared) {
        if (correction !== undefined) {
            corrections[row.id] = correction;
        }
    }
    return { corrections, report: compared.map(({ row }) => row) };
}

/**
 * `photo` with its correction applied: the old site's place and direction while it still holds the ones the migration
 * gave it (`correction.migrated`); any other photo is returned as it is. For a migrated record's photo or a manifest's.
 */
export function correctedPhoto<T extends Place & { readonly id: string }>(photo: T, corrections: LegacyCorrections): T {
    const correction = corrections[photo.id];
    if (correction === undefined || !samePlace(photo, correction.migrated)) {
        return photo;
    }
    const { location, bearing, fov } = correction;
    return { ...photo, location, bearing, fov };
}

/** The records with {@link correctedPhoto} applied: the admin's bundle starts from the migration, as the static site does. */
export function applyLegacyCorrections(photos: readonly MigratedPhoto[], corrections: LegacyCorrections): MigratedPhoto[] {
    return photos.map((record) => {
        const photo = correctedPhoto(record.photo, corrections);
        return photo === record.photo ? record : { ...record, photo };
    });
}
