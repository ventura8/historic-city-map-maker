/**
 * The overlays section's draft (behaviour A36): the admin's changes to every overlay's default, over the live layers,
 * categories and city; each change previews on the page's map, Save writes every changed document in one batch,
 * Discard takes the map back to the saved look (S-A36-BAD-DISCARD). A change another admin saved meanwhile simply
 * becomes the base: a change of the draft equal to it is no change any more.
 */
import type { OverlayKind } from '@hcm/shared';

import type { ContentServices, WriteOutcome } from '../content/services.js';
import { opacityFromPercent } from '../layers/model.js';
import type { PreviewLayer } from '../layers/preview.js';
import {
    NO_EDITS,
    overlayPreviews,
    overlayRows,
    overlayWrites,
    withOpacity,
    withShownAtStart,
    type OverlayBase,
    type OverlayEdits,
    type OverlayRow,
} from './overlays.js';

export interface OverlayDefaultsState {
    readonly rows: readonly OverlayRow[];
    /** How many documents Save would write. */
    readonly changes: number;
    readonly saving: boolean;
}

export const NO_OVERLAY_DEFAULTS: OverlayDefaultsState = { rows: [], changes: 0, saving: false };

export class OverlayDefaults {
    readonly #services: ContentServices;
    readonly #preview: PreviewLayer;
    readonly #changed: (state: OverlayDefaultsState) => void;
    #base: OverlayBase = { layers: [], categories: [], photos: 1 };
    #edits: OverlayEdits = NO_EDITS;
    #saving = false;

    constructor(services: ContentServices, preview: PreviewLayer, changed: (state: OverlayDefaultsState) => void) {
        this.#services = services;
        this.#preview = preview;
        this.#changed = changed;
    }

    get unsaved(): boolean {
        return this.#writes().length > 0;
    }

    /** The saved defaults changed (a listener answered): the rows follow, the edits stay. */
    setBase(base: OverlayBase): void {
        this.#base = base;
        this.#emit();
    }

    setOpacity(kind: OverlayKind, id: string, percent: number): void {
        this.#edit(withOpacity(this.#edits, kind, id, opacityFromPercent(percent)));
    }

    setShownAtStart(id: string, visible: boolean): void {
        this.#edit(withShownAtStart(this.#edits, id, visible));
    }

    discard(): void {
        this.#edits = NO_EDITS;
        this.#preview.clear();
        this.#emit();
    }

    async save(): Promise<WriteOutcome | null> {
        const writes = this.#writes();
        if (writes.length === 0 || this.#saving) {
            return null;
        }
        this.#saving = true;
        this.#emit();
        const outcome = await this.#services.store.batch(writes);
        this.#saving = false;
        if (outcome.ok) {
            this.#edits = NO_EDITS;
        }
        this.#emit();
        return outcome;
    }

    #writes(): ReturnType<typeof overlayWrites> {
        return overlayWrites(this.#services.cityId, this.#base, this.#edits);
    }

    #edit(edits: OverlayEdits): void {
        this.#edits = edits;
        for (const change of overlayPreviews(this.#base, edits)) {
            this.#preview.show(change);
        }
        this.#emit();
    }

    #emit(): void {
        this.#changed({ rows: overlayRows(this.#base, this.#edits), changes: this.#writes().length, saving: this.#saving });
    }
}
