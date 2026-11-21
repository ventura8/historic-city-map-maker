/** The extras' host on the page (packages/engine/src/extras/host.ts; DECISIONS-for-review.md §186). */
import { describe, expect, it } from 'vitest';

import { EXTRAS_HOST_GLOBAL, installExtrasHost } from '../../src/extras/host.js';

describe('installExtrasHost', () => {
    it('happyPath_installsLitAndSharedBindingsUnderTheReleaseOnAPropertyThatIsNotPartOfTheApi', () => {
        const scope: Record<string, unknown> = {};

        const host = installExtrasHost(scope, 'v1_0_0');

        expect(scope[EXTRAS_HOST_GLOBAL]).toEqual({ v1_0_0: host });
        expect(Object.keys(scope)).toEqual([]);
        expect(typeof host.lit.html).toBe('function');
        expect(typeof host.lit.LitElement).toBe('function');
        expect(typeof host.shared.translate).toBe('function');
        expect(typeof host.shared.createViewerGuard).toBe('function');
        expect(host.extras).toEqual({});
        expect(host.ready).toEqual({});
    });

    it('badPath_anotherReleaseGetsItsOwnHostAndAStrangeValueIsReplaced', () => {
        const scope: Record<string, unknown> = {};
        const first = installExtrasHost(scope, 'v1_0_0');
        first.extras['compare'] = { compareModule: 1 };

        expect(installExtrasHost(scope, 'v1_0_0')).toBe(first);
        const other = installExtrasHost(scope, 'v1_1_0');
        expect(other).not.toBe(first);
        expect(other.extras).toEqual({});
        expect(Object.keys(scope[EXTRAS_HOST_GLOBAL] as object)).toEqual(['v1_0_0', 'v1_1_0']);

        const strange: Record<string, unknown> = { [EXTRAS_HOST_GLOBAL]: { v1_0_0: { extras: {} } } };
        const replaced = installExtrasHost(strange, 'v1_0_0');
        expect(replaced).toBe((strange[EXTRAS_HOST_GLOBAL] as Record<string, unknown>)['v1_0_0']);
        expect(typeof replaced.shared.translate).toBe('function');
        expect(installExtrasHost({ [EXTRAS_HOST_GLOBAL]: null }, 'v1_0_0')).toMatchObject({ extras: {}, ready: {} });
    });
});
