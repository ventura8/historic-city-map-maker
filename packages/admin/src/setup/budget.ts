/**
 * The monthly budget step (b) creates in the billing account's currency (`docs/research/M2b-interfaces.md` §3.3 b):
 * the PLAN's $5, and its rounded equivalent in the currencies a Romanian owner is likely to have.
 */
export const BUDGET_AMOUNTS: ReadonlyMap<string, number> = new Map([
    ['USD', 5],
    ['EUR', 5],
    ['GBP', 4],
    ['RON', 25],
]);

/** Any other currency: 5 units. */
export const DEFAULT_BUDGET_AMOUNT = 5;

/** The currency shown on the card before the billing account is known. */
export const DEFAULT_BUDGET_CURRENCY = 'USD';

export function budgetAmountFor(currency: string): number {
    return BUDGET_AMOUNTS.get(currency) ?? DEFAULT_BUDGET_AMOUNT;
}
