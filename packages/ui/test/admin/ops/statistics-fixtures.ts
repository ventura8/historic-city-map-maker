import type { StatisticsNumbersPort, StatisticsViewState } from '../../../src/admin/crashes/crashes-port.js';

/** §203: the Statistics view's numbers as the admin hands them (one wizard's three steps, three apps, two days). */
export const NUMBERS: StatisticsNumbersPort = {
    visitors: 1234,
    sessions: 2000,
    pages: [{ name: '/', count: 300 }],
    screens: [{ name: 'home', count: 12 }],
    events: [{ name: 'year_change', count: 50 }],
    devices: [
        { name: 'mobile', count: 4 },
        { name: 'smart tv', count: 1 },
    ],
    countries: [{ name: 'Romania', count: 90 }],
    surfaces: [
        {
            surface: 'viewer',
            visitors: 100,
            sessions: 150,
            daily: [
                { date: '20261111', visitors: 30, sessions: 40 },
                { date: '20261112', visitors: 50, sessions: 70 },
            ],
        },
        { surface: 'admin_owner', visitors: 1, sessions: 9, daily: [{ date: '20261112', visitors: 1, sessions: 9 }] },
        { surface: '(not set)', visitors: 19, sessions: 21, daily: [] },
    ],
    steps: [
        {
            wizard: 'new_city',
            step: 'area',
            visitors: 7,
            averageMs: 150_000,
            errors: [
                { name: 'apiError.invalidRequest', count: 2 },
                { name: 'e2e_unknown_code', count: 1 },
            ],
        },
        { wizard: 'new_city', step: 'names', visitors: 10, averageMs: 30_000, errors: [] },
        { wizard: 'new_city', step: 'e2e_extra', visitors: 0, averageMs: null, errors: [] },
        { wizard: 'e2e_wizard', step: 'one', visitors: 1, averageMs: null, errors: [] },
    ],
    pending: null,
};

export function statistics(overrides: Partial<StatisticsViewState> = {}): StatisticsViewState {
    return { days: 28, status: 'idle', problem: null, notice: null, numbers: null, ...overrides };
}
