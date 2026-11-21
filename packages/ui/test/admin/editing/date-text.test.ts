import { describe, expect, it } from 'vitest';

import { formatDateInput, parseDateInput } from '../../../src/admin/editing/date-text.js';

describe('dates in the admin language', () => {
    it('happyPath_anIsoDateReadsDayFirstInBothLanguages', () => {
        expect(formatDateInput('ro', '2026-10-18')).toBe('18.10.2026');
        expect(formatDateInput('en', '2026-10-18')).toBe('18/10/2026');
    });

    it('badPath_whatIsNotAnIsoDateIsShownAsTyped', () => {
        expect(formatDateInput('ro', '')).toBe('');
        expect(formatDateInput('ro', '18.10.20')).toBe('18.10.20');
    });

    it('happyPath_aTypedDateBecomesAnIsoDateWhateverItsSeparator', () => {
        expect(parseDateInput('18.10.2026')).toBe('2026-10-18');
        expect(parseDateInput('1/2/2026')).toBe('2026-02-01');
        expect(parseDateInput(' 29-02-2028 ')).toBe('2028-02-29');
        expect(parseDateInput('2026-10-18')).toBe('2026-10-18');
        expect(parseDateInput('   ')).toBe('');
    });

    it('badPath_aDayThatDoesNotExistOrAnUnfinishedDateIsNoDate', () => {
        expect(parseDateInput('31.04.2026')).toBeNull();
        expect(parseDateInput('29.02.2027')).toBeNull();
        expect(parseDateInput('18.13.2026')).toBeNull();
        expect(parseDateInput('18.10.202')).toBeNull();
        expect(parseDateInput('2026-02-30')).toBeNull();
        expect(parseDateInput('mâine')).toBeNull();
    });
});
