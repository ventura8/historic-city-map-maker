/**
 * Home's Visitors card's reports (the owner, 2026-11-16; `DECISIONS-for-review.md` §238), read with the Statistics view's
 * numbers: the period's days, the period before, new against returning, languages, and the years, layers and photos looked
 * at most. A lazy chunk of its own (`analytics-summary`), fetched by `readStatistics`.
 */
import {
    batch,
    counts,
    DATA_API,
    dim,
    eventIs,
    num,
    rowsOf,
    VIEWER_ROLE,
    type Ask,
    type ReportSpec,
    type VisitorSummary,
} from './analytics-data.js';
import { at, list } from './json.js';
import type { GoogleTransport } from './transport.js';

const TOP = 10;

/** Home's Visitors card: its days, the period before, new against returning, languages, and the most looked-at years, layers, photos. */
const SUMMARY_REPORTS: readonly ReportSpec[] = [
    { dimensions: ['date'], metrics: ['totalUsers', 'sessions'] },
    { dimensions: ['newVsReturning'], metrics: ['totalUsers'] },
    { dimensions: ['language'], metrics: ['totalUsers'], orderBy: 'totalUsers', limit: TOP },
];

/** The viewer's own parameters, a batch of its own: one not registered yet leaves only its list empty. */
const LOOKED_AT_REPORTS: readonly ReportSpec[] = [
    { dimensions: ['customEvent:year'], metrics: ['eventCount'], filter: eventIs('year_change'), orderBy: 'eventCount', limit: TOP },
    { dimensions: ['customEvent:layer_id'], metrics: ['eventCount'], filter: eventIs('layer_toggle'), orderBy: 'eventCount', limit: TOP },
    { dimensions: ['customEvent:photo_id'], metrics: ['eventCount'], filter: eventIs('photo_open'), orderBy: 'eventCount', limit: TOP },
];

/** Home's Visitors card from its two batches. */
export async function summaryOf(transport: GoogleTransport, property: string, ask: Ask): Promise<VisitorSummary> {
    const [daily, kinds, languages] = await batch(transport, property, SUMMARY_REPORTS, ask);
    const [years, layers, photos] = await batch(transport, property, LOOKED_AT_REPORTS, ask);
    const before = rowsOf(await previousOf(transport, property, ask))[0];
    return {
        daily: rowsOf(daily)
            .map((row) => ({ date: dim(row, 0), visitors: num(row, 0), sessions: num(row, 1) }))
            .sort((left, right) => left.date.localeCompare(right.date)),
        previous: { visitors: before === undefined ? 0 : num(before, 0), sessions: before === undefined ? 0 : num(before, 1) },
        ...{ newVsReturning: counts(kinds), languages: counts(languages) },
        ...{ years: counts(years), layers: counts(layers), photos: counts(photos) },
    };
}

/** The visitors and visits of as many days just before the period (the trend's baseline). */
async function previousOf(transport: GoogleTransport, property: string, ask: Ask): Promise<unknown> {
    const answer = await transport.call({
        operation: 'analytics-data.batchRunReports',
        method: 'POST',
        url: `${DATA_API}/${property}:batchRunReports`,
        body: {
            requests: [
                {
                    dateRanges: [{ startDate: `${String(ask.days * 2)}daysAgo`, endDate: `${String(ask.days + 1)}daysAgo` }],
                    metrics: [{ name: 'totalUsers' }, { name: 'sessions' }],
                },
            ],
        },
        role: VIEWER_ROLE,
    });
    return list(at(answer, 'reports'))[0];
}
