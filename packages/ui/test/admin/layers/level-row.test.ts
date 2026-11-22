import { describe, expect, it } from 'vitest';

import { levelOf } from '../../../src/admin/layers/level-row.js';

describe('levelOf', () => {
    it('happyPath_anOrderAndANameMakeALevel @S-A201-HAPPY-LEVEL', () => {
        expect(levelOf(' 0,5 ', 'Mezanin', undefined)).toEqual({ order: 0.5, label: { ro: 'Mezanin' } });
        expect(levelOf('-1', 'Subsol', 'Basement')).toEqual({ order: -1, label: { ro: 'Subsol', en: 'Basement' } });
    });

    it.each([
        ['', 'Parter'],
        ['x', 'Parter'],
        ['0', '  '],
    ])('badPath_%j_and_%j_makeNoLevel @S-A201-BAD-LEVEL', (order, name) => {
        expect(levelOf(order, name, undefined)).toBeUndefined();
    });
});
