/**
 * Step (e2), Sources (M28, `docs/research/M28-sources.md` §4): the switches of the sources the map uses, saved as the city's
 * `sources` with one click (**Save my choice**: the step's one input when the defaults suit). The step is done once the city
 * holds a choice. A choice without USGS's frames and without Landsat needs no USGS account: the USGS step leaves the list,
 * and, so that Setup reads done for the server too (`setupDone` reads `setup/status`), USGS is recorded as postponed with
 * `setup.recordCloud` as **Do it later** does; choosing either again brings the step back.
 */
import { needsUsgsAccount, sourcesOf, type SourceChoices, type SourceToggle } from '@hcm/shared/sources';

import type { SetupContext } from './context.js';
import { NO_FINDER, type CountryFinder } from './sources-state.js';
import { apiFailure, setupMessage, type StepFailure } from './messages.js';

export interface SourcesFlow {
    /** Reads the city's choice: the step is done when it holds one. */
    detect(): Promise<void>;
    /** One switch turned (one input); paid scans go off with the declassified frames. */
    choose(id: SourceToggle, on: boolean): void;
    /** Save my choice (one input). */
    save(): Promise<void>;
}

/** A Firestore failure, in plain words: the code goes to the log, the card says what to do. */
function storeFailure(key: 'adminSetup.sources.readFailed' | 'adminSetup.sources.saveFailed'): StepFailure {
    return { state: 'unavailable', message: setupMessage(key), expired: false };
}

/** `choices` with switch `id` turned; paid scans need the declassified frames. */
export function withChoice(choices: SourceChoices, id: SourceToggle, on: boolean): SourceChoices {
    const next = { ...choices, [id]: on };
    return { ...next, usgsOrders: next.usgs && next.usgsOrders };
}

class Sources implements SourcesFlow {
    constructor(private readonly ctx: SetupContext) {}

    async detect(): Promise<void> {
        try {
            const stored = await this.ctx.deps.sources.read();
            const saved = stored === undefined ? null : sourcesOf(stored);
            this.ctx.update((state) => ({ ...state, sources: { ...state.sources, choices: saved ?? state.sources.choices, saved } }));
            this.ctx.patchStep('sources', { state: saved === null ? 'missing' : 'ok', detail: null, checkedAt: this.ctx.nowIso() });
        } catch (error) {
            this.ctx.deps.log.warn('setup.sources.readFailed', { code: codeOf(error) });
            this.ctx.fail('sources', storeFailure('adminSetup.sources.readFailed'));
        }
        await this.readFinder();
    }

    /** The country's list: its own failure leaves the step as it is and says so in the finder only. */
    private async readFinder(): Promise<void> {
        let finder: CountryFinder;
        try {
            const list = await this.ctx.deps.sources.country();
            finder = list === null ? { ...NO_FINDER, state: 'none' } : { ...list, state: 'ready' };
        } catch (error) {
            this.ctx.deps.log.warn('setup.sources.finderFailed', { code: codeOf(error) });
            finder = { ...NO_FINDER, state: 'failed' };
        }
        this.ctx.update((state) => ({ ...state, sources: { ...state.sources, finder } }));
    }

    choose(id: SourceToggle, on: boolean): void {
        this.ctx.count('sources', 'inputs');
        this.ctx.update((state) => ({ ...state, sources: { ...state.sources, choices: withChoice(state.sources.choices, id, on) } }));
    }

    async save(): Promise<void> {
        this.ctx.count('sources', 'inputs');
        this.ctx.patchStep('sources', { busy: true, error: null });
        const choices = this.ctx.state().sources.choices;
        try {
            await this.ctx.deps.sources.save(choices);
        } catch (error) {
            this.ctx.deps.log.warn('setup.sources.saveFailed', { code: codeOf(error) });
            this.ctx.fail('sources', storeFailure('adminSetup.sources.saveFailed'));
            return;
        }
        this.ctx.deps.log.info('setup.sources.saved', { ...choices });
        await this.leaveUsgs(choices);
        this.ctx.update((state) => ({ ...state, sources: { ...state.sources, choices, saved: choices } }));
        this.ctx.patchStep('sources', { state: 'ok', busy: false, detail: null, checkedAt: this.ctx.nowIso() });
    }

    /** No USGS account needed: USGS is recorded as postponed (once), so `setupDone` holds without it. */
    private async leaveUsgs(choices: SourceChoices): Promise<void> {
        const usgs = this.ctx.state().steps.usgs;
        if (needsUsgsAccount(choices) || usgs.state === 'ok' || usgs.postponed) {
            return;
        }
        try {
            this.ctx.applyStatus((await this.ctx.deps.backend.recordCloud({ postponed: { usgs: true } })).status);
        } catch (error) {
            // The choice is saved; only the server's "done" waits: the header still says it, and Check again records it.
            this.ctx.deps.log.warn('setup.sources.usgsNotRecorded', { code: apiFailure(error).message.key });
        }
    }
}

function codeOf(error: unknown): string {
    const code = typeof error === 'object' && error !== null ? (error as { readonly code?: unknown }).code : undefined;
    return typeof code === 'string' ? code : 'unknown';
}

export function createSourcesFlow(ctx: SetupContext): SourcesFlow {
    return new Sources(ctx);
}
