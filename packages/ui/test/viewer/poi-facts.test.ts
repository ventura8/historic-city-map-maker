import type { Poi } from '@hcm/shared';
import { render } from 'lit';
import { describe, expect, it } from 'vitest';

import { placeFacts, yearSpan } from '../../src/viewer/poi-facts.js';
import { testManifest } from './fixtures.js';

const POIS = testManifest().pois ?? [];

function place(facts: Poi['facts']): Poi {
    const [first] = POIS;
    if (first === undefined) {
        throw new Error('fixture');
    }
    return { ...first, facts };
}

function shown(poi: Poi, open: (id: string) => void = () => undefined): HTMLElement {
    const host = document.createElement('div');
    render(placeFacts(poi, POIS, 'en', open), host);
    return host;
}

describe('placeFacts', () => {
    it('happyPath_everyFactIsAnsweredAndARelatedPlaceOpens @S-V81-HAPPY-FACTS', () => {
        const opened: string[] = [];
        const related = POIS[1]?.id ?? '';
        const host = shown(
            place({
                architects: ['Horia Maicu'],
                yearBuilt: 1934,
                yearDemolished: 1985,
                yearAbandoned: 1977,
                style: { ro: 'Modernism' },
                floors: 9,
                heightM: 32,
                lmiCode: 'B-II-m-B-19750',
                uses: [{ use: { ro: 'Hotel', en: 'Hotel' }, yearStart: 1934, yearEnd: 1977 }],
                addresses: [{ text: 'Bd. Elisabeta 1', current: true }],
                relatedPlaceIds: [related, 'gone'],
            }),
            (id) => opened.push(id),
        );
        const text = host.textContent.replace(/\s+/g, ' ');
        for (const part of ['About the place', 'Horia Maicu', 'Built', '1934', 'Demolished', 'Abandoned', 'Modernism', '32 m', 'B-II-m-B-19750', '1934–1977: Hotel', 'Bd. Elisabeta 1 (today)']) {
            expect(text).toContain(part);
        }
        const buttons = host.querySelectorAll('button.related');
        expect(buttons).toHaveLength(1);
        (buttons[0] as HTMLButtonElement).click();
        expect(opened).toEqual([related]);
    });

    it('badPath_aPlaceWithoutFactsShowsNothingAndMarkupStaysText @S-V81-BAD-FACTS', () => {
        expect(shown(place(undefined)).querySelector('.facts')).toBeNull();
        const host = shown(place({ architects: ['<b>X</b>'] }));
        expect(host.querySelector('b')).toBeNull();
        expect(host.textContent).toContain('<b>X</b>');
        expect(yearSpan(undefined, undefined)).toBeNull();
        expect(yearSpan(1900, undefined)).toBe('1900–');
        expect(yearSpan(undefined, 1900)).toBe('–1900');
    });
});
