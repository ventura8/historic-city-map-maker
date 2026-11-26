import { describe, expect, it } from 'vitest';

import { BUDGET_AMOUNTS, DEFAULT_BUDGET_AMOUNT, budgetAmountFor } from '../../src/setup/budget.js';

describe('budgetAmountFor', () => {
    it('happyPath_thePlansFiveDollarsInTheAccountsCurrency', () => {
        expect(budgetAmountFor('USD')).toBe(5);
        expect(budgetAmountFor('EUR')).toBe(5);
        expect(budgetAmountFor('GBP')).toBe(4);
        expect(budgetAmountFor('RON')).toBe(25);
        expect([...BUDGET_AMOUNTS.keys()]).toEqual(['USD', 'EUR', 'GBP', 'RON']);
    });

    it('badPath_anyOtherCurrencyGetsFiveUnits', () => {
        expect(budgetAmountFor('JPY')).toBe(DEFAULT_BUDGET_AMOUNT);
        expect(budgetAmountFor('constructor')).toBe(5);
    });
});
