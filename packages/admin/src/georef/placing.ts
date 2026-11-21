/**
 * The georeferencer's mark on a frame parked for points (review of M18 item 3): while an editor places points on it, its job
 * carries `placingPoints` (stamped), so `imagery.tick`'s relocate part does not send the frame searching again under their
 * hands, which would refuse their Save (`apiError.imagery.versionState`) and stitch the scan they placed them on again. Marked
 * at the first edit and again every quarter of `PLACING_POINTS_HOLD_MS`; a refused mark changes nothing on the page.
 */
import { FIRESTORE_PATHS, PLACING_POINTS_HOLD_MS, type LayerVersionDoc } from '@hcm/shared';

import type { ContentServices } from '../content/services.js';

/** How often the mark is written again while points are placed. */
const PLACING_MARK_EVERY_MS = PLACING_POINTS_HOLD_MS / 4;

export class PlacingMark {
    readonly #services: Pick<ContentServices, 'store' | 'clock' | 'cityId'>;
    #markedAt = Number.NEGATIVE_INFINITY;

    constructor(services: Pick<ContentServices, 'store' | 'clock' | 'cityId'>) {
        this.#services = services;
    }

    /** An edit of the points of `version`: its job is marked when it waits for them and the last mark is old. */
    edited(version: LayerVersionDoc | null): void {
        const now = this.#services.clock.now();
        if (version?.state !== 'needs_gcps' || now - this.#markedAt < PLACING_MARK_EVERY_MS) {
            return;
        }
        this.#markedAt = now;
        void this.#services.store.update(FIRESTORE_PATHS.job(this.#services.cityId, version.jobId), { placingPoints: true }, null);
    }

    /** Another version opens: its first edit marks it at once. */
    reset(): void {
        this.#markedAt = Number.NEGATIVE_INFINITY;
    }
}
