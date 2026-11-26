import { describe, expect, it } from 'vitest';

import { systemWriter, timestampFromDate, timestampSchema, timestampToDate, uidSchema } from '../../src/schemas/firestore-common.js';

describe('timestamps', () => {
    it('happyPath_aDateRoundTripsWithMillisecondPrecision', () => {
        const date = new Date('2026-10-12T08:30:15.123Z');

        const timestamp = timestampFromDate(date);

        expect(timestamp).toEqual({ seconds: 1_791_793_815, nanoseconds: 123_000_000 });
        expect(timestampSchema.safeParse(timestamp).success).toBe(true);
        expect(timestampToDate(timestamp).toISOString()).toBe('2026-10-12T08:30:15.123Z');
    });

    it('badPath_aDateBeforeTheEpochKeepsPositiveNanoseconds', () => {
        const timestamp = timestampFromDate(new Date(-1500));

        expect(timestamp).toEqual({ seconds: -2, nanoseconds: 500_000_000 });
        expect(timestampToDate(timestamp).getTime()).toBe(-1500);
    });

    it('badPath_subMillisecondNanosecondsAreDropped', () => {
        expect(timestampToDate({ seconds: 1, nanoseconds: 999_999 }).getTime()).toBe(1000);
    });
});

describe('writers', () => {
    it('happyPath_aServerWriterIsNamespaced', () => {
        expect(systemWriter('setup')).toBe('system:setup');
        expect(uidSchema.safeParse(systemWriter('pipeline')).success).toBe(true);
    });

    it('badPath_anEmptyWriterIsRefused', () => {
        expect(uidSchema.safeParse('').success).toBe(false);
    });
});
