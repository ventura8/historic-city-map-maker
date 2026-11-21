/** M13 §1: an uploader's lists ask for their own items only (`ownerOnlyOf`, `src/content/services.ts`). */
import { describe, expect, it } from 'vitest';

import { ownerOnlyOf } from '../../src/content/services.js';

describe('ownerOnlyOf', () => {
    it('happyPath_anUploaderAsksForTheirOwnItems', () => {
        expect(ownerOnlyOf({ cityRole: () => 'uploader', user: () => ({ uid: 'u-1', name: null }) })).toBe('u-1');
    });

    it('badPath_anyOtherRoleOrNoAccountAsksForNoOwner', () => {
        expect(ownerOnlyOf({ cityRole: () => 'moderator', user: () => ({ uid: 'u-1', name: null }) })).toBeNull();
        expect(ownerOnlyOf({ cityRole: () => 'uploader', user: () => null })).toBeNull();
    });
});
