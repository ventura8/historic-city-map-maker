import { describe, expect, it } from 'vitest';

import { workerCount } from '../worker-count.mjs';

describe('workerCount', () => {
    it('accepts positive integer counts', () => {
        expect(workerCount('3')).toBe(3);
    });

    it.each([undefined, '', '0', '-1', '1.5', ' 2 ', 'many', '9007199254740992'])('ignores invalid count %s', (value) => {
        expect(workerCount(value)).toBeUndefined();
    });
});
