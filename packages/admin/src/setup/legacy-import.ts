/**
 * Step (h), the legacy Bucharest import (`docs/research/M2b-interfaces.md` §3.3 h): one click imports the 45 photos
 * through the normal photo pipeline (google-clients' importer, idempotent by document id and `legacyId`). The card
 * shows the progress, the photos that failed processing with their reason, and is done once every photo is imported.
 * M6 (finding 19 of 2026-10-25): the end of a run is said in the snackbar, which stays while Setup moves on: every photo
 * on the map, or how many are, with Open (the card and its list of the photos that failed). §73k: once the import is
 * complete a site build leaves the originals out, so Publish the map's cost line says the smaller transfer.
 */
import { SITE_PUBLISH_TRANSFER_MB, SITE_PUBLISH_TRANSFER_TRIMMED_MB } from '@hcm/shared';

import type { SetupContext } from './context.js';
import { apiFailure, setupMessage } from './messages.js';
import type { LegacyImportProgress, SetupNotice } from './ports.js';
import type { StepPatch } from './state.js';

export interface LegacyImportFlow {
    /** What is already imported (normal mode, no write). */
    detect(): Promise<void>;
    /** "Import the 45 photos": one click; it also adds the old site's directions and the additions' authors (`legacy-fixes.ts`). */
    run(): Promise<void>;
}

/** The old site's directions or the additions' authors still to add to a map that has the photos (`legacy-fixes.ts`). */
function hasFixes(progress: LegacyImportProgress): boolean {
    return (progress.directions ?? 0) > 0 || progress.credits === true;
}

/** Every photo on the map, with its direction and its author's credit. */
function allDone(progress: LegacyImportProgress): boolean {
    return progress.total > 0 && progress.done >= progress.total && !hasFixes(progress);
}

function importHealth(progress: LegacyImportProgress, checkedAt: string): StepPatch {
    if (progress.failed.length > 0) {
        return { state: 'invalid', detail: setupMessage('adminSetup.import.failed', { count: String(progress.failed.length) }), checkedAt };
    }
    if (allDone(progress)) {
        return { state: 'ok', detail: null, checkedAt };
    }
    return { state: progress.done > 0 ? 'pending' : 'missing', detail: null, checkedAt };
}

class LegacyImport implements LegacyImportFlow {
    constructor(private readonly ctx: SetupContext) {}

    async detect(): Promise<void> {
        try {
            this.progress(await this.ctx.deps.importer.detect(), false);
        } catch (error) {
            this.ctx.fail('legacyImport', apiFailure(error));
        }
    }

    async run(): Promise<void> {
        this.ctx.count('legacyImport', 'inputs');
        this.ctx.patchStep('legacyImport', { busy: true, error: null });
        this.ctx.update((state) => ({ ...state, legacyImport: { ...state.legacyImport, running: true } }));
        try {
            const final = await this.ctx.deps.importer.run((progress) => {
                this.progress(progress, true);
            });
            this.progress(final, false);
            this.ctx.deps.notify(this.ended(final));
        } catch (error) {
            this.ctx.update((state) => ({ ...state, legacyImport: { ...state.legacyImport, running: false } }));
            this.ctx.fail('legacyImport', apiFailure(error));
        }
    }

    /** The snackbar at the end of a run: all on the map, or how many, with Open (the card and its failures). */
    private ended({ done, total, failed }: LegacyImportProgress): SetupNotice {
        if (failed.length === 0 && done >= total) {
            return { key: 'adminSetup.import.allOnMap', params: { count: String(total) } };
        }
        const open = (): void => {
            this.ctx.update((state) => ({ ...state, openStep: 'legacyImport' }));
        };
        return {
            key: 'adminSetup.import.someOnMap',
            params: { done: String(done), total: String(total) },
            action: { key: 'adminSetup.import.open', run: open },
        };
    }

    private progress(progress: LegacyImportProgress, running: boolean): void {
        const { done, total, failed } = progress;
        const complete = total > 0 && done >= total && failed.length === 0;
        const siteTransferMegabytes = complete ? SITE_PUBLISH_TRANSFER_TRIMMED_MB : SITE_PUBLISH_TRANSFER_MB;
        const fixes = { directions: progress.directions ?? 0, credits: progress.credits === true };
        this.ctx.update((state) => ({
            ...state,
            legacyImport: { done, total, failed, running, ...fixes },
            install: { ...state.install, siteTransferMegabytes },
        }));
        this.ctx.patchStep('legacyImport', { ...importHealth(progress, this.ctx.nowIso()), busy: running });
    }
}

export function createLegacyImportFlow(ctx: SetupContext): LegacyImportFlow {
    return new LegacyImport(ctx);
}
