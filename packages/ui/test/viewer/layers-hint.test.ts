import { afterEach, describe, expect, it, vi } from 'vitest';

import { LayersHint } from '../../src/viewer/layers-hint.js';
import { readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';

describe("the first visit's Layers hint", () => {
    afterEach(() => {
        localStorage.removeItem('hcm.layersHint.seen');
        vi.restoreAllMocks();
    });

    const answers = () => ({ open: vi.fn(), changed: vi.fn() });

    it('happyPath_offeredOnceWhereNotDocked_openOpensAndRemembers', () => {
        localStorage.removeItem('hcm.layersHint.seen');
        const hint = new LayersHint();
        const answer = answers();
        const offer = hint.offer(readyState(testManifest()), false, answer);
        expect(offer).not.toBeNull();
        offer?.onOpen();
        expect(answer.open).toHaveBeenCalledOnce();
        expect(localStorage.getItem('hcm.layersHint.seen')).toBe('1');
        expect(hint.offer(readyState(testManifest()), false, answer)).toBeNull();
        expect(new LayersHint().offer(readyState(testManifest()), false, answer)).toBeNull();
    });

    it('badPath_noHintWhereDockedWithoutLayersOrWithBlockedStorage', () => {
        localStorage.removeItem('hcm.layersHint.seen');
        const answer = answers();
        expect(new LayersHint().offer(readyState(testManifest()), true, answer)).toBeNull();
        const noLayers = testManifest((raw) => {
            raw['layers'] = [];
        });
        expect(new LayersHint().offer(readyState(noLayers), false, answer)).toBeNull();
        expect(new LayersHint().offer(null, false, answer)).toBeNull();

        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const blocked = new LayersHint();
        blocked.offer(readyState(testManifest()), false, answer)?.onDismiss();
        expect(answer.changed).toHaveBeenCalled();
        expect(blocked.offer(readyState(testManifest()), false, answer)).toBeNull();
    });
});
