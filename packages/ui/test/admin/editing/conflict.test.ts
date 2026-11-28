// `savedByText` and `conflictFields` (packages/ui/src/admin/editing/conflict.ts): formats who saved the conflicting
// version, with or without a valid timestamp, and names the conflicting fields in the admin's language.
import { describe, expect, it } from 'vitest';

import { conflictFields, NOBODY, savedByText } from '../../../src/admin/editing/conflict.js';

describe('conflict', () => {
    it('happyPath_formatsWhoSavedWithATimestampAndNamesTheConflictingFields', () => {
        const named = savedByText('en', { by: 'u1', at: '2026-10-17T14:02:00Z' }, { self: 'u0', people: { u1: 'Ana' } });
        const bySelf = savedByText('en', { by: 'u0', at: '2026-10-17T14:02:00Z' }, { self: 'u0', people: {} });

        expect(named).toContain('Ana');
        expect(named).toContain('2026');
        expect(bySelf).toContain('2026');
        expect(conflictFields('en', { fields: ['title', 'year'] })).toBe('Title, Year');
    });

    it('badPath_fallsBackWhenTheTimestampIsInvalidOrTheAuthorIsUnknown', () => {
        const noDate = savedByText('en', { by: 'u9', at: 'not-a-date' }, NOBODY);

        expect(noDate).not.toContain('not-a-date');
        expect(noDate.length).toBeGreaterThan(0);
        expect(conflictFields('en', { fields: ['customField'] })).toBe('customField');
    });
});
