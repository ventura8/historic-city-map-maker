/** The open photo's version (the owner 2026-11-09): the store keeps the visitor's pick, the URL hash carries it as `pv=`. */
import { decodeHash } from '@hcm/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initialState, withManifest } from '../../src/core/state.js';
import { applyDecodedHash, hashLimits, hashStateOf, HASH_WRITE_DELAY_MS } from '../../src/core/url-sync.js';
import { manifest } from './fixtures.js';
import { loaded } from './harness.js';

describe('viewer store: the photo version', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_aPickIsKeptAndWrittenIntoTheHash', async () => {
        const { store, location } = await loaded();

        store.openPhoto('mihai-voda-1978');
        store.setPhotoVersion('colorized');
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().photoVersion).toBe('colorized');
        expect(location.written.at(-1)).toContain('&photo=mihai-voda-1978&pv=colorized');
    });

    it('badPath_withoutAnOpenPhotoTheHashHasNoPv', async () => {
        const { store, location } = await loaded();

        store.setPhotoVersion('improved');
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(location.written.join(' ')).not.toContain('pv=');
    });
});

describe('url sync: pv=', () => {
    const city = manifest();
    const ready = withManifest(initialState('ro', 'system', 'unknown'), city);

    it('happyPath_aLinkOpensThePhotoAtItsVersion', () => {
        const { state } = applyDecodedHash(ready, decodeHash('#photo=mihai-voda-1978&pv=improved', hashLimits(city)));

        expect(state).toMatchObject({ selectedPhotoId: 'mihai-voda-1978', photoVersion: 'improved' });
        expect(hashStateOf(state, 'ro')).toMatchObject({ photo: 'mihai-voda-1978', photoVersion: 'improved' });
    });

    it('badPath_anUnknownWordOpensTheOriginal', () => {
        const { state } = applyDecodedHash(ready, decodeHash('#photo=mihai-voda-1978&pv=sepia', hashLimits(city)));

        expect(state.photoVersion).toBe('original');
    });

    it('badPath_aLinkWithoutPvLeavesThePhotosDefault', () => {
        const picked = { ...ready, photoVersion: 'colorized' as const };
        const { state } = applyDecodedHash(picked, decodeHash('#photo=mihai-voda-1978', hashLimits(city)));

        expect(state.photoVersion).toBeNull();
        expect(hashStateOf(state, 'ro')).not.toHaveProperty('photoVersion');
    });
});
