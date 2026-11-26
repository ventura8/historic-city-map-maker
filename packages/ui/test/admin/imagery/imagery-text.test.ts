import { describe, expect, it } from 'vitest';

import { labelText, pluralOf, reasonText, versionDetail, waitText } from '../../../src/admin/imagery/imagery-text.js';
import { versionItem } from './fixtures.js';

describe('the Imagery words', () => {
    it('happyPath_aWaitWithoutADateALabelWithoutEnglishAndAJobWithoutProgress', () => {
        const job = { id: 'job-1966', status: 'running', progress: null, step: null, waitReason: null, retryAt: null, attempt: 1 } as const;

        expect(waitText('en', 'deferred', null)).not.toContain('{date}');
        expect(labelText({ ro: 'Planul 1911' }, 'en')).toBe('Planul 1911');
        expect(labelText({ ro: 'Planul 1911', en: 'The 1911 plan' }, 'ro')).toBe('Planul 1911');
        expect(versionDetail('en', versionItem({ state: 'processing' }), job)).toBe('Processing');
    });

    it('happyPath_theYearsToTheNearestLayerTakeTheirPluralForm', () => {
        const years = (count: string, locale: 'ro' | 'en') => reasonText(locale, { code: 'newYear', params: { years: count } });

        expect([years('1', 'en'), years('4', 'en')]).toEqual([
            'The nearest layer is 1 year from this frame',
            'The nearest layer is 4 years from this frame',
        ]);
        expect([years('1', 'ro'), years('4', 'ro'), years('24', 'ro')]).toEqual([
            'Cel mai apropiat strat este la 1 an de acest cadru',
            'Cel mai apropiat strat este la 4 ani de acest cadru',
            'Cel mai apropiat strat este la 24 de ani de acest cadru',
        ]);
        expect(reasonText('en', { code: 'noLayers' })).toBe('The city has no layer yet: any year is new');
    });

    it('badPath_aCountWithoutItsOwnFormTakesTheOtherOne', () => {
        expect([pluralOf('en', 0), pluralOf('en', 1), pluralOf('ro', 2), pluralOf('ro', 100), pluralOf('en', 1.5)]).toEqual([
            'other',
            'one',
            'few',
            'other',
            'other',
        ]);
    });
});
