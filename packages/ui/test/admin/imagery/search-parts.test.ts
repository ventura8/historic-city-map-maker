/** Lesson 676: each dataset's part of the USGS search, in words, in both languages. */
import { render } from 'lit';
import { describe, expect, it } from 'vitest';

import { searchParts } from '../../../src/admin/imagery/search-parts.js';

function shown(parts: Parameters<typeof searchParts>[1], locale: 'ro' | 'en' = 'en'): HTMLElement {
    const host = document.createElement('div');
    render(searchParts(locale, parts), host);
    return host;
}

describe('the search’s parts', () => {
    it('happyPath_eachDatasetSaysWhatItFoundOrThatItIsSearching @S-A130-HAPPY-OLI', () => {
        const host = shown([
            { dataset: 'landsat_ot_c2_l1', state: 'done', found: 2 },
            { dataset: 'corona2', state: 'searching', found: 0 },
        ]);

        expect([...host.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
            'Landsat 8–9 OLI: 2',
            'Corona (Declass 1): Searching…',
        ]);
        expect(host.querySelector('[data-dataset="corona2"]')?.getAttribute('data-part')).toBe('searching');
    });

    it('badPath_aDatasetUsgsWasTooSlowForKeepsWhatItFoundAndSaysTheRestComesByItself @S-A11-BAD-REQUEST-TIMED-OUT', () => {
        const en = shown([
            { dataset: 'corona2', state: 'partial', found: 100, reason: 'requestTimedOut' },
            { dataset: 'declassii', state: 'failed', found: 0, reason: 'usgsFailed' },
            { dataset: 'declassiii', state: 'failed', found: 0, reason: 'outOfTime' },
        ]);
        const ro = shown([{ dataset: 'corona2', state: 'partial', found: 100, reason: 'outOfTime' }], 'ro');

        const [slow, refused, late] = [...en.querySelectorAll('li')].map((item) => item.textContent);
        expect(slow).toContain('100 kept; USGS was too slow');
        expect(refused).toContain('0 kept; USGS turned it away');
        expect(late).toContain('The rest comes in 15 minutes');
        expect(ro.textContent).toContain('100 păstrate');
    });

    it('badPath_noPartsRenderNothing', () => {
        expect(shown(undefined).querySelector('ul')).toBeNull();
        expect(shown([]).querySelector('ul')).toBeNull();
    });
});
