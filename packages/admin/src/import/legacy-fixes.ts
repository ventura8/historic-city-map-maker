import { creditsNamingAuthors, legacyCorrectionsSchema, type Credit, type LegacyCorrection, type Logger } from '@hcm/shared';

import { bundleJson } from './bundle.js';
import type { LegacyImport, LegacyImportProgress } from './legacy-import.js';

/**
 * What step (h) adds to the photos a project already has (`docs/research/M5-interfaces.md` → *Directions from the old
 * site*): the old site's direction for a photo the first migration left without one (`legacy/<city>/corrections.json`:
 * Parc Ferdinand, which the old site later moved and gave a cone), and the credits naming the additions' author.
 *
 * A correction is applied only to a photo whose direction is still the migration's (none, or exactly the migrated one)
 * and that no person ever aimed (its history has no person's change of `bearing` or `fov`); its point moves to the old
 * site's only while it is still the migrated one and no person ever moved it. The owner's direction and place are never
 * overwritten. Applied once, a photo holds the old site's values, so a rerun finds nothing to do (idempotent). The credits
 * gain the authors no credit names yet (`creditsNamingAuthors`): the migrated authors line, untouched, lists them all.
 */

interface LatLng {
    readonly lat: number;
    readonly lng: number;
}

/** What the fixes read of a photo document. */
export interface PhotoPlace {
    readonly location?: LatLng;
    readonly bearing?: number;
    readonly fov?: number;
}

/** What a photo's history says a person did (entries stamped with a person's uid, a create left out). */
export interface PlaceHistory {
    /** A person changed `location`. */
    readonly placed: boolean;
    /** A person changed `bearing` or `fov`. */
    readonly aimed: boolean;
}

/** The fields one correction writes: always the direction, and the point while it is still the migrated one. */
export interface AimFields {
    readonly bearing: number;
    readonly fov: number;
    readonly location?: LatLng;
}

/** The Firestore operations of the fixes (admin-shell's adapter, `../app/legacy-photos.ts` → `legacyFixStore`). */
export interface LegacyFixStore {
    /** The photo's place and direction, or null when it has no document. */
    place(cityId: string, photoId: string): Promise<PhotoPlace | null>;
    history(cityId: string, photoId: string): Promise<PlaceHistory>;
    /** Merges `fields` into the photo with the caller's stamp. */
    aim(cityId: string, photoId: string, fields: AimFields): Promise<void>;
    /** The city's credits (none: an empty list), or null when the city has no document. */
    credits(cityId: string): Promise<readonly Credit[] | null>;
    saveCredits(cityId: string, credits: readonly Credit[]): Promise<void>;
}

interface LegacyFixesDeps {
    readonly fetch: typeof fetch;
    readonly store: LegacyFixStore;
    readonly cityId: string;
    readonly baseUrl: string;
    readonly log: Logger;
}

interface Aim {
    readonly id: string;
    readonly fields: AimFields;
}

/** What a run would change: the photos to aim, and the credits to save (null: they name every author already). */
interface Plan {
    readonly aims: readonly Aim[];
    readonly credits: readonly Credit[] | null;
}

const NOTHING: Plan = { aims: [], credits: null };

function sameLocation(a: LatLng | undefined, b: LatLng): boolean {
    return a?.lat === b.lat && a.lng === b.lng;
}

/** The photo's direction is still the migration's: none, or exactly the migrated one. */
function aimedAsMigrated(place: PhotoPlace, migrated: LegacyCorrection['migrated']): boolean {
    return place.bearing === undefined || (place.bearing === migrated.bearing && place.fov === migrated.fov);
}

/** The photo's point may move to the old site's: no person ever moved it, and it is still the migrated one. */
function movable(place: PhotoPlace, history: PlaceHistory, correction: LegacyCorrection): boolean {
    return !history.placed && sameLocation(place.location, correction.migrated.location);
}

/** The fields to write, or null when a person aimed the photo, or it has no point and its point may not move. */
function aimFields(place: PhotoPlace, history: PlaceHistory, correction: LegacyCorrection): AimFields | null {
    const move = movable(place, history, correction);
    if (history.aimed || !(move || place.location !== undefined)) {
        return null;
    }
    const { bearing, fov, location } = correction;
    return move ? { bearing, fov, location } : { bearing, fov };
}

function progressWith(progress: LegacyImportProgress, plan: Plan): LegacyImportProgress {
    return { ...progress, directions: plan.aims.length, credits: plan.credits !== null };
}

class LegacyFixes implements LegacyImport {
    readonly #importer: LegacyImport;
    readonly #deps: LegacyFixesDeps;

    constructor(importer: LegacyImport, deps: LegacyFixesDeps) {
        this.#importer = importer;
        this.#deps = deps;
    }

    async detect(): Promise<LegacyImportProgress> {
        const progress = await this.#importer.detect();
        return progressWith(progress, await this.#plan());
    }

    async run(onProgress: (progress: LegacyImportProgress) => void): Promise<LegacyImportProgress> {
        const plan = await this.#plan();
        const imported = await this.#importer.run((progress) => {
            onProgress(progressWith(progress, plan));
        });
        const left = await this.#apply(plan);
        const final = progressWith({ ...imported, failed: [...imported.failed, ...left.failed] }, left.plan);
        onProgress(final);
        return final;
    }

    /** What a run would change; a read that fails changes nothing (the photos' import goes on) and is logged. */
    async #plan(): Promise<Plan> {
        try {
            const [corrections, authors] = await Promise.all([this.#corrections(), this.#authors()]);
            const aims = await Promise.all(Object.entries(corrections).map(([id, correction]) => this.#aim(id, correction)));
            return { aims: aims.filter((aim) => aim !== null), credits: await this.#credits(authors) };
        } catch (error) {
            this.#deps.log.warn('legacy import: the directions and credits could not be read', { error: errorName(error) });
            return NOTHING;
        }
    }

    async #aim(id: string, correction: LegacyCorrection): Promise<Aim | null> {
        const { store, cityId } = this.#deps;
        const place = await store.place(cityId, id);
        if (place === null || !aimedAsMigrated(place, correction.migrated)) {
            return null;
        }
        const fields = aimFields(place, await store.history(cityId, id), correction);
        return fields === null ? null : { id, fields };
    }

    async #credits(authors: readonly { readonly author?: string }[]): Promise<readonly Credit[] | null> {
        const credits = await this.#deps.store.credits(this.#deps.cityId);
        if (credits === null) {
            return null;
        }
        const named = creditsNamingAuthors(credits, authors);
        return named.length === credits.length && named.every((credit, index) => credit === credits[index]) ? null : named;
    }

    /** Writes the plan; what failed stays to do (and its photo is listed as unavailable: a rerun tries it again). */
    async #apply(plan: Plan): Promise<{ readonly plan: Plan; readonly failed: LegacyImportProgress['failed'] }> {
        const { store, cityId } = this.#deps;
        const left: Aim[] = [];
        for (const aim of plan.aims) {
            if (!(await this.#safely(() => store.aim(cityId, aim.id, aim.fields)))) {
                left.push(aim);
            }
        }
        const credits = plan.credits;
        const saved = credits === null || (await this.#safely(() => store.saveCredits(cityId, credits)));
        const failed = left.map((aim) => ({ id: aim.id, detail: 'apiError.unavailable' as const }));
        return { plan: { aims: left, credits: saved ? null : credits }, failed };
    }

    async #safely(write: () => Promise<void>): Promise<boolean> {
        try {
            await write();
            return true;
        } catch (error) {
            this.#deps.log.warn('legacy import: a direction or the credits were not saved', { error: errorName(error) });
            return false;
        }
    }

    /** The bundle's corrections; none when it has no file (a bundle from before them) or an invalid one. */
    async #corrections(): Promise<Readonly<Record<string, LegacyCorrection>>> {
        const body = await this.#bundled('corrections.json');
        const parsed = legacyCorrectionsSchema.safeParse(body);
        return parsed.success ? parsed.data : {};
    }

    /** The bundled photos' authors. */
    async #authors(): Promise<readonly { readonly author?: string }[]> {
        const body = await this.#bundled('photos.json');
        return (Array.isArray(body) ? (body as unknown[]) : []).flatMap((record) => {
            const author = (record as { readonly photo?: { readonly author?: unknown } } | null)?.photo?.author;
            return typeof author === 'string' ? [{ author }] : [];
        });
    }

    #bundled(file: string): Promise<unknown> {
        return bundleJson(this.#deps.fetch, this.#deps.baseUrl, this.#deps.cityId, file);
    }
}

function errorName(error: unknown): string {
    return error instanceof Error ? error.name : 'unknown';
}

/** `importer` that also adds the old site's directions and the additions' authors, counted by `detect` (step h). */
export function withLegacyFixes(importer: LegacyImport, deps: LegacyFixesDeps): LegacyImport {
    return new LegacyFixes(importer, deps);
}
