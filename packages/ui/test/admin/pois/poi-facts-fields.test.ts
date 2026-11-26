import type { PlaceFacts } from '@hcm/shared';
import { render } from 'lit';
import { describe, expect, it } from 'vitest';

import { factsFields, withFact } from '../../../src/admin/pois/poi-facts-fields.js';
import type { FieldContext } from '../../../src/admin/pois/poi-fields.js';

const PLACES = [
    { id: 'p1', title: { ro: 'Biserica Enei' } },
    { id: 'p2', title: { ro: 'Hanul Gabroveni' } },
];

function fields(facts: PlaceFacts | undefined, patches: unknown[], issues: readonly { path: string }[] = []): HTMLElement {
    const context = {
        locale: 'en',
        value: { facts },
        issues,
        edit: (patch: unknown) => patches.push(patch),
        left: new Set(),
        readOnly: false,
    } as unknown as FieldContext;
    const host = document.createElement('div');
    render(factsFields(context, PLACES), host);
    return host;
}

function type(host: HTMLElement, id: string, value: string): void {
    const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
    if (element === null) {
        throw new Error(`no ${id}`);
    }
    element.value = value;
    element.dispatchEvent(new Event('change'));
}

const FULL: PlaceFacts = {
    architects: ['Ion Mincu'],
    yearBuilt: 1850,
    style: { ro: 'neoromânesc', en: 'Neo-Romanian' },
    floors: 3,
    lmiCode: 'B-II-m-A-18001',
    uses: [{ use: { ro: 'biserică' }, yearStart: 1850, yearEnd: 1977 }],
    addresses: [{ text: 'Strada Academiei 1' }],
    relatedPlaceIds: ['p1'],
};

describe('the Facts fields', () => {
    it('happyPath_everyFactShowsItsTextAndWritesWhenLeft @S-A200-HAPPY-FACTS-IMPORT', () => {
        const patches: unknown[] = [];
        const host = fields(FULL, patches);
        expect(host.querySelector<HTMLInputElement>('#facts-architects')?.value).toBe('Ion Mincu');
        expect(host.querySelector<HTMLInputElement>('#facts-built')?.value).toBe('1850');
        expect(host.querySelector<HTMLInputElement>('#facts-style-en')?.value).toBe('Neo-Romanian');
        expect(host.querySelector<HTMLTextAreaElement>('#facts-uses')?.value).not.toBe('');
        expect(host.querySelector('[role="alert"]')).toBeNull();

        type(host, 'facts-architects', 'Ion Mincu, Petre Antonescu');
        type(host, 'facts-height', '12,5');
        type(host, 'facts-style-en', 'Romanian Revival');
        type(host, 'facts-lmi', ' B-II-m-A-18002 ');
        type(host, 'facts-uses', '1900-1940: teatru');
        type(host, 'facts-addresses', 'Calea Victoriei 2');
        const related = host.querySelector<HTMLSelectElement>('#facts-related');
        if (related !== null) {
            related.value = 'p2';
            related.dispatchEvent(new Event('change'));
        }

        const facts = patches.map((patch) => (patch as { facts: PlaceFacts }).facts);
        expect(facts[0]?.architects).toEqual(['Ion Mincu', 'Petre Antonescu']);
        expect(facts[1]?.heightM).toBe(12.5);
        expect(facts[2]?.style).toEqual({ ro: 'neoromânesc', en: 'Romanian Revival' });
        expect(facts[3]?.lmiCode).toBe('B-II-m-A-18002');
        expect(facts[4]?.uses?.[0]?.use).toEqual({ ro: 'teatru' });
        expect(facts[5]?.addresses?.[0]?.text).toBe('Calea Victoriei 2');
        expect(facts[6]?.relatedPlaceIds).toEqual(['p1', 'p2']);
    });

    it('badPath_emptiedFieldsRemoveTheirFacts_andAProblemIsSaid @S-A200-BAD-FACTS-IMPORT', () => {
        const patches: unknown[] = [];
        const host = fields({ yearBuilt: 1850 }, patches, [{ path: 'facts.yearBuilt' }]);
        expect(host.querySelector('[role="alert"]')).not.toBeNull();

        type(host, 'facts-built', 'x');
        type(host, 'facts-built', ' ');
        type(host, 'facts-architects', ' ');
        type(host, 'facts-style-ro', ' ');
        type(host, 'facts-style-en', 'Gothic');
        type(host, 'facts-lmi', '');
        type(host, 'facts-uses', '');
        type(host, 'facts-addresses', '');

        expect(patches).toEqual([
            { facts: undefined },
            { facts: undefined },
            { facts: { yearBuilt: 1850 } },
            { facts: { yearBuilt: 1850 } },
            { facts: { yearBuilt: 1850 } },
            { facts: { yearBuilt: 1850 } },
            { facts: { yearBuilt: 1850 } },
            { facts: { yearBuilt: 1850 } },
        ]);
        const empty = fields(undefined, patches);
        expect(empty.querySelector<HTMLInputElement>('#facts-architects')?.value).toBe('');
        expect(withFact(undefined, 'floors', undefined)).toBeUndefined();
    });
});
