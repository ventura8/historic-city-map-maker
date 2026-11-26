import { describe, expect, it } from 'vitest';

import noMessages from '../../src/vendor/zod-locale-none.js';

describe('the stand-in for zod English messages', () => {
    it('happyPath_itConfiguresNoMessages', () => {
        expect(noMessages()).toEqual({});
    });
});
