/**
 * `snapGeoref` success and refusal through the persist host (branch coverage of `outcome.saved`).
 */
import { describe, expect, it, vi } from 'vitest';

import * as extras from '../../src/georef/extras.js';
import { snapGeoref, type PersistHost } from '../../src/georef/persist.js';
import type { GeorefState } from '../../src/georef/state.js';
import { pair } from './fixtures.js';

function host(): { readonly persist: PersistHost; readonly refit: ReturnType<typeof vi.fn> } {
    const state = {
        pairs: [pair('g1', 0, 0)],
        transform: 'affine' as const,
        version: { id: 'v1' },
        saving: false,
        refusal: null as GeorefState['refusal'],
        saved: null as string | null,
    };
    const refit = vi.fn();
    const persist = {
        services: {
            cityId: 'bucharest',
            callables: { call: () => Promise.resolve({} as never) },
            notify: () => undefined,
        },
        cell: {
            get state() {
                return state as unknown as GeorefState;
            },
            update: (patch: object) => {
                Object.assign(state, patch);
            },
        },
        history: { clear: () => undefined },
        extras: () => Promise.resolve({} as never),
        base: () => ({ pairs: state.pairs, transform: state.transform }),
        setBase: () => undefined,
        own: () => null,
        setOwn: () => undefined,
        refit,
    } as unknown as PersistHost;
    return { persist, refit };
}

describe('snapGeoref', () => {
    it('happyPath_aSavedSnapRefitsTheBasePairs', async () => {
        const { persist, refit } = host();
        vi.spyOn(extras, 'snapOf').mockResolvedValueOnce({ saved: 'new-v', refusal: null });
        expect(await snapGeoref(persist)).toBe(true);
        expect(refit).toHaveBeenCalledWith(persist.base().pairs, 'affine');
        expect(persist.cell.state.saved).toBe('new-v');
    });

    it('badPath_aRefusedSnapDoesNotRefit', async () => {
        const { persist, refit } = host();
        vi.spyOn(extras, 'snapOf').mockResolvedValueOnce({
            saved: null,
            refusal: { key: 'adminContent.georef.snapUnavailable' },
        });
        expect(await snapGeoref(persist)).toBe(false);
        expect(refit).toHaveBeenCalledTimes(0);
        expect(persist.cell.state.refusal).toEqual({ key: 'adminContent.georef.snapUnavailable' });
    });
});
