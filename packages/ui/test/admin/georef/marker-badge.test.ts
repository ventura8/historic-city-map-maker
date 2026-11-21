import { describe, expect, it } from 'vitest';

import { badgeToneOf, BADGE_RADIUS, BADGE_SELECTED_RADIUS } from '../../../src/admin/georef/marker-badge.js';

describe('georeferencer badge tones', () => {
    it('happyPath_residualsBandAgainstTheThreshold', () => {
        expect(badgeToneOf(undefined, 10)).toBe('plain');
        expect(badgeToneOf(2, 10)).toBe('ok');
        expect(badgeToneOf(5, 10)).toBe('ok');
        expect(badgeToneOf(6, 10)).toBe('warn');
        expect(badgeToneOf(10, 10)).toBe('warn');
        expect(badgeToneOf(11, 10)).toBe('bad');
    });

    it('badPath_aZeroOrNegativeThresholdLeavesTheBadgePlain', () => {
        expect(badgeToneOf(3, 0)).toBe('plain');
        expect(badgeToneOf(3, -1)).toBe('plain');
    });

    it('happyPath_selectedBadgeIsLargerThanAPlainOne', () => {
        expect(BADGE_SELECTED_RADIUS).toBeGreaterThan(BADGE_RADIUS);
    });
});
