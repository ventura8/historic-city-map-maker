/**
 * The extras' loader (packages/engine/src/extras/loader.ts; DECISIONS-for-review.md §186): the IIFE's extras are scripts
 * beside it, added with their integrity once each, and one that fails is logged, removed and fetched afresh next time.
 */
import { describe, expect, it } from 'vitest';

import { createExtraLoader, ExtraLoadError, type ExtraFile } from '../../src/extras/loader.js';
import { recordingLog } from '../core/support.js';
import { FakeDocument, settle } from './fake-page.js';

const COMPARE: ExtraFile = { host: 'v1_2_3', global: 'compare', file: 'extra-compare-AbCd12_-.js', integrity: 'sha384-test-compare' };
const BASE = 'https://cdn.example.org/gh/owner/repo@v1.2.3/cdn/engine/';

function world(registry: Record<string, unknown> = {}, ready: Record<string, unknown> = {}) {
    const document = new FakeDocument();
    const recording = recordingLog();
    const load = createExtraLoader({ document, base: () => BASE, registry: () => registry, ready: () => ready, log: recording.log });
    /** What the extra's script does as it runs to its end: registers its exports, then marks itself ready. */
    const run = (global: string, module: unknown): void => {
        registry[global] = module;
        ready[global] = true;
    };
    return { document, registry, ready, run, load, recording };
}

describe('createExtraLoader', () => {
    it('happyPath_theFirstWishAddsOneScriptWithItsIntegrityAndResolvesWithWhatItRegistered', async () => {
        const { document, run, load } = world();
        const module = { compareModule: 'the chunk' };

        const first = load(COMPARE);
        const second = load(COMPARE);
        run('compare', module);
        document.scripts[0]?.fire('load');

        await expect(first).resolves.toBe(module);
        await expect(second).resolves.toBe(module);
        expect(document.scripts).toHaveLength(1);
        expect(document.scripts[0]).toMatchObject({
            src: `${BASE}extra-compare-AbCd12_-.js`,
            integrity: 'sha384-test-compare',
            crossOrigin: 'anonymous',
            async: true,
            removed: false,
        });
        await expect(load(COMPARE)).resolves.toBe(module);
        expect(document.scripts).toHaveLength(1);
    });

    it('happyPath_anExtraAlreadyRunOnThePageNeedsNoScript', async () => {
        const module = { gamepad: true };
        const { document, load } = world({ gamepad: module }, { gamepad: true });

        await expect(load({ host: 'v1_2_3', global: 'gamepad', file: 'extra-gamepad-x.js', integrity: 'sha384-g' })).resolves.toBe(module);
        expect(document.scripts).toHaveLength(0);
    });

    it('badPath_aHalfRegisteredExtraOnThePageIsNotReusedButFetched', async () => {
        const { document, run, load } = world({ compare: {} });

        const loading = load(COMPARE);
        expect(document.scripts).toHaveLength(1);
        run('compare', { compareModule: 'whole' });
        document.scripts[0]?.fire('load');

        await expect(loading).resolves.toEqual({ compareModule: 'whole' });
    });

    it('badPath_aChunkThatFailsIsLoggedRemovedAndFetchedAfreshNextTime', async () => {
        const { document, run, load, recording } = world();

        const failed = load(COMPARE);
        document.scripts[0]?.fire('error');

        await expect(failed).rejects.toBeInstanceOf(ExtraLoadError);
        await expect(failed).rejects.toThrow('the extra extra-compare-AbCd12_-.js could not be loaded');
        expect(document.scripts[0]?.removed).toBe(true);
        expect(recording.messages()).toEqual(['extra not loaded']);
        expect(recording.records[0]?.data).toMatchObject({ file: 'extra-compare-AbCd12_-.js' });

        const retried = load(COMPARE);
        run('compare', { compareModule: 'now' });
        document.scripts[1]?.fire('load');

        await expect(retried).resolves.toEqual({ compareModule: 'now' });
        expect(document.scripts).toHaveLength(2);
    });

    it('badPath_aScriptThatThrowsWhileItRunsFailsAndIsRetriedWhole', async () => {
        const { document, registry, run, load } = world();

        const loaded = load(COMPARE);
        // The script's first statement made its registry entry; its body threw before the exports and the ready mark.
        registry['compare'] = {};
        document.scripts[0]?.fire('load');
        await settle();

        await expect(loaded).rejects.toThrow('the extra extra-compare-AbCd12_-.js did not run to its end');
        expect(document.scripts[0]?.removed).toBe(true);
        expect(registry).toEqual({});
        const error = await loaded.catch((caught: unknown) => caught);
        expect(error).toMatchObject({ name: 'ExtraLoadError', file: 'extra-compare-AbCd12_-.js' });

        const retried = load(COMPARE);
        expect(document.scripts).toHaveLength(2);
        run('compare', { compareModule: 'whole' });
        document.scripts[1]?.fire('load');
        await expect(retried).resolves.toEqual({ compareModule: 'whole' });
    });
});
