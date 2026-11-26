// What the photos remember per admin in localStorage: the sticky fields, the last pin, the photos whose place to check.
import { MAX_PHOTOS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { CHECK_PLACE_KEY, LAST_PIN_KEY, PhotoMemory, STICKY_KEY, definedSticky } from '../../src/photos/session.js';
import { MemoryStore } from '../app/fakes.js';

describe('PhotoMemory: sticky fields', () => {
    it('happyPath_theLastChosenAuthorSourceAndLicenceAreRemembered', () => {
        const local = new MemoryStore();
        const memory = new PhotoMemory(local);

        memory.rememberSticky({ author: 'Ion', license: 'CC-BY-4.0', title: { ro: 'ignored' } } as never);
        memory.rememberSticky({ sourceLabel: 'Arhiva', sourceUrl: 'https://arhiva.example', author: undefined });

        expect(memory.sticky()).toEqual({
            author: 'Ion',
            license: 'CC-BY-4.0',
            sourceLabel: 'Arhiva',
            sourceUrl: 'https://arhiva.example',
        });
        expect(JSON.parse(local.get(STICKY_KEY) ?? '{}')).not.toHaveProperty('title');
    });

    it('badPath_aStoredValueThatDoesNotValidateIsIgnored', () => {
        const local = new MemoryStore();
        const memory = new PhotoMemory(local);
        local.set(STICKY_KEY, '{not json');
        expect(memory.sticky()).toEqual({});

        local.set(STICKY_KEY, JSON.stringify({ sourceUrl: 'http://insecure.example' }));
        expect(memory.sticky()).toEqual({});

        memory.rememberSticky({ sourceUrl: 'javascript:alert(1)' });
        expect(local.get(STICKY_KEY)).toBe(JSON.stringify({ sourceUrl: 'http://insecure.example' }));
    });

    it('happyPath_definedStickyLeavesOutTheAbsentFields', () => {
        expect(definedSticky({ author: 'Ion', license: undefined })).toEqual({ author: 'Ion' });
    });
});

describe('PhotoMemory: the last pin and the places to check', () => {
    it('happyPath_theLastPinIsRemembered', () => {
        const memory = new PhotoMemory(new MemoryStore());
        expect(memory.lastPin()).toBeNull();

        memory.rememberPin([26.1, 44.43]);

        expect(memory.lastPin()).toEqual([26.1, 44.43]);
    });

    it('badPath_aPinOutOfTheWorldIsIgnored', () => {
        const local = new MemoryStore();
        local.set(LAST_PIN_KEY, JSON.stringify([500, 44]));

        expect(new PhotoMemory(local).lastPin()).toBeNull();
    });

    it('happyPath_aPhotoIsMarkedAndUnmarked', () => {
        const memory = new PhotoMemory(new MemoryStore());

        memory.markCheckPlace('p1', true);
        memory.markCheckPlace('p2', true);
        memory.markCheckPlace('p1', false);

        expect([...memory.checkPlace()]).toEqual(['p2']);
    });

    it('badPath_noMarkIsForgottenHoweverMany @S-A08-BAD-CHECK-PLACE-KEPT', () => {
        const local = new MemoryStore();
        const memory = new PhotoMemory(local);
        const many = Array.from({ length: MAX_PHOTOS }, (_value, index) => `p${String(index)}`);
        local.set(CHECK_PLACE_KEY, JSON.stringify(many));

        memory.markCheckPlace('newest', true);

        const kept = memory.checkPlace();
        expect(kept.size).toBe(MAX_PHOTOS + 1);
        // The oldest mark still blocks its photo's publish.
        expect(kept.has('p0')).toBe(true);
        expect(kept.has('newest')).toBe(true);
    });
});
