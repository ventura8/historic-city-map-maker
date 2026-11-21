import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loaded } from './harness.js';

describe("viewer store: the theme's colours (Device accent, Map colours)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_theAccentChoiceIsRemembered', async () => {
        const { store, storage } = await loaded();
        expect(store.getState().accent).toBe('device');

        store.setAccent('map');
        store.setAccent('map');

        expect(store.getState().accent).toBe('map');
        expect(storage.get('hcm:bucuresti:accent')).toBe('map');
    });

    it('badPath_theSameAccentChangesNothing', async () => {
        const { store, storage } = await loaded();
        const before = store.getState();

        store.setAccent('device');

        expect(store.getState()).toBe(before);
        expect(storage.get('hcm:bucuresti:accent')).toBeUndefined();
    });
});
