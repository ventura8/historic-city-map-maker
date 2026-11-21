/**
 * The import dialog's session (docs/research/M2c-interfaces.md §7.4; behaviour A34): a file is checked for size before
 * it is read, parsed and planned in the page against every place of the city, read once (a file that names a place past
 * the list's loaded page updates it, never a duplicate; a dry run: nothing is written while the preview shows), planned again when
 * the admin chooses the category for features without a known one, and written on Import in batches of at most
 * `MAX_BATCH_WRITES`, new places with new ids, every write stamped by the store. The total after the import may not pass
 * `MAX_POIS`, checked before the first write.
 */
import { FIRESTORE_PATHS, latestPlaceYear, MAX_POIS } from '@hcm/shared';

import { MAX_BATCH_WRITES, type BatchWrite, type ContentServices, type ContentStore } from '../content/services.js';
import { MAX_IMPORT_BYTES, planImport, readFeatures, type ImportContext, type ImportFileRefusal, type ImportPlan } from './geojson.js';
import { docFieldsOf, type PoiValue } from './model.js';

/** A chosen file, as the page hands it over (a `File` is one). */
export interface ImportFile {
    readonly name: string;
    readonly size: number;
    text(): Promise<string>;
}

type ImportRefusalOfFile = ImportFileRefusal | 'too-many' | 'unreadable' | 'places-unread';

export interface ImportState {
    readonly status: 'reading' | 'refused' | 'preview' | 'writing' | 'done' | 'failed';
    readonly fileName: string;
    readonly refusal: ImportRefusalOfFile | null;
    readonly plan: ImportPlan | null;
    readonly fallbackCategory: string | null;
    /** Places written so far (created and updated). */
    readonly written: number;
    /** With `too-many`: the places the city has and the ones the file would add. */
    readonly limit?: { readonly existing: number; readonly adding: number } | null;
}

export interface ImporterDeps {
    readonly store: Pick<ContentStore, 'batch' | 'newId' | 'count'>;
    readonly cityId: string;
    /** Today, for the latest year a feature may name (`latestPlaceYear`: next year), as the editor's Save. */
    readonly clock: Pick<ContentServices['clock'], 'now'>;
    readonly context: () => Omit<ImportContext, 'fallbackCategory' | 'existing'>;
    /** Every place of the city, read once per chosen file (and the ids it could not make sense of); null when it could not be read. */
    readonly places: () => Promise<{
        readonly places: readonly { readonly id: string; readonly value: PoiValue }[];
        readonly unreadable: readonly string[];
    } | null>;
    readonly changed: (state: ImportState | null) => void;
}

function batches<T>(items: readonly T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(items.length / size) }, (_unused, index) => items.slice(index * size, (index + 1) * size));
}

export class Importer {
    readonly #deps: ImporterDeps;
    #features: readonly unknown[] = [];
    #existing: ReadonlyMap<string, PoiValue> = new Map();
    #unreadable: ReadonlySet<string> = new Set();
    #state: ImportState | null = null;
    /** The chosen file's turn: a new choice or a close ends the turn of a read still under way. */
    #turn = 0;

    constructor(deps: ImporterDeps) {
        this.#deps = deps;
    }

    get state(): ImportState | null {
        return this.#state;
    }

    #set(state: ImportState | null): void {
        this.#state = state;
        this.#deps.changed(state);
    }

    #update(patch: Partial<ImportState>): void {
        if (this.#state !== null) {
            this.#set({ ...this.#state, ...patch });
        }
    }

    async choose(file: ImportFile, fallbackCategory: string | null): Promise<void> {
        this.#turn += 1;
        const turn = this.#turn;
        const base = { fileName: file.name, plan: null, fallbackCategory, written: 0 };
        if (file.size > MAX_IMPORT_BYTES) {
            this.#set({ ...base, status: 'refused', refusal: 'too-big' });
            return;
        }
        this.#set({ ...base, status: 'reading', refusal: null });
        const read = await file.text().then(readFeatures, () => ({ ok: false, reason: 'unreadable' }) as const);
        if (turn !== this.#turn) {
            return;
        }
        if (!read.ok) {
            this.#update({ status: 'refused', refusal: read.reason });
            return;
        }
        await this.#planned(read.features, fallbackCategory, turn);
    }

    /** The file's features planned against every place of the city, unless another file or a close took over meanwhile. */
    async #planned(features: readonly unknown[], fallbackCategory: string | null, turn: number): Promise<void> {
        const read = await this.#deps.places();
        if (turn !== this.#turn) {
            return;
        }
        if (read === null) {
            this.#update({ status: 'refused', refusal: 'places-unread' });
            return;
        }
        this.#existing = new Map(read.places.map((place) => [place.id, place.value]));
        this.#unreadable = new Set(read.unreadable);
        this.#features = features;
        this.#plan(fallbackCategory);
    }

    /** The plan (again, when the category for uncategorised features changes). */
    #plan(fallbackCategory: string | null): void {
        const latestYear = latestPlaceYear(this.#deps.clock.now());
        const context = { ...this.#deps.context(), latestYear, existing: this.#existing, unreadable: this.#unreadable, fallbackCategory };
        const plan = planImport(this.#features, context);
        this.#update({ status: 'preview', plan, fallbackCategory });
    }

    setCategory(category: string): void {
        if (this.#state?.status === 'preview') {
            this.#plan(category);
        }
    }

    /**
     * The city's categories or frame changed (or first arrived: a file chosen right after the page opened was planned
     * without them): a preview is planned again, so a known category counts as such.
     */
    contextChanged(): void {
        if (this.#state?.status === 'preview') {
            this.#plan(this.#state.fallbackCategory);
        }
    }

    /** Writes the plan; the outcome is the state (`done`, `failed`, or `refused` with `too-many`). */
    async commit(): Promise<void> {
        const plan = this.#state?.status === 'preview' ? this.#state.plan : null;
        if (plan === null) {
            return;
        }
        this.#update({ status: 'writing' });
        if (await this.#withinLimit(plan)) {
            await this.#write(this.#writesOf(plan));
        }
    }

    /**
     * Whether the city may take the plan's new places; otherwise the state says why: `refused` with the numbers, or
     * `failed` when the places could not be counted (nothing is written: the import stopped before any write).
     */
    async #withinLimit(plan: ImportPlan): Promise<boolean> {
        const existing = await this.#deps.store.count(FIRESTORE_PATHS.pois(this.#deps.cityId), {});
        const adding = plan.created.length;
        if (existing === null) {
            this.#update({ status: 'failed' });
        } else if (existing + adding > MAX_POIS) {
            this.#update({ status: 'refused', refusal: 'too-many', limit: { existing, adding } });
        }
        return existing !== null && existing + adding <= MAX_POIS;
    }

    #writesOf(plan: ImportPlan): BatchWrite[] {
        const { cityId, store } = this.#deps;
        const created = plan.created.map((place): BatchWrite => ({
            kind: 'create',
            path: FIRESTORE_PATHS.poi(cityId, store.newId()),
            data: docFieldsOf(place.value),
            withCreator: true,
        }));
        const updated = plan.updated.map((place): BatchWrite => ({
            kind: 'update',
            path: FIRESTORE_PATHS.poi(cityId, place.id),
            fields: docFieldsOf(place.value),
        }));
        return [...created, ...updated];
    }

    async #write(writes: readonly BatchWrite[]): Promise<void> {
        let written = 0;
        for (const batch of batches(writes, MAX_BATCH_WRITES)) {
            const outcome = await this.#deps.store.batch(batch);
            if (!outcome.ok) {
                this.#update({ status: 'failed', written });
                return;
            }
            written += batch.length;
            this.#update({ written });
        }
        this.#update({ status: 'done', written });
    }

    close(): void {
        this.#turn += 1;
        this.#features = [];
        this.#set(null);
    }
}
