/** The photo editor's level and places (`editor-sections.ts`, M17 §12 and §14) over real Lit. */
import { render } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import { textsSection, type SectionInput } from '../../../src/admin/photos/editor-sections.js';
import { VALUE } from './fixtures.js';

let host: HTMLElement | null = null;

function section(overrides: Partial<SectionInput>, patches: unknown[]): HTMLElement {
    host ??= document.body.appendChild(document.createElement('div'));
    const input: SectionInput = {
        locale: 'en',
        value: VALUE,
        issues: [],
        edit: (patch) => patches.push(patch),
        left: { has: () => false, leave: () => undefined },
        readOnly: false,
        ...overrides,
    };
    render(textsSection(input), host);
    return host;
}

function typeInto(element: HTMLElement, selector: string, value: string, event: string): void {
    const field = element.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    if (field === null) {
        throw new Error(`no ${selector}`);
    }
    field.value = value;
    field.dispatchEvent(new Event(event));
}

describe('the photo editor: level and places', () => {
    afterEach(() => {
        host?.remove();
        host = null;
    });

    it('happyPath_anInteriorPhotoHasALevel_andAPickedPlaceIsAnEdit @S-A198-HAPPY-PHOTO-PLACES', () => {
        const patches: unknown[] = [];
        const element = section(
            { value: { ...VALUE, kind: 'interior', level: 1 }, places: [{ id: 'p1', title: { ro: 'Ateneul Român' } }] },
            patches,
        );
        expect(element.querySelector<HTMLInputElement>('#photo-level')?.value).toBe('1');

        typeInto(element, '#photo-level', '0.5', 'input');
        typeInto(element, '#photo-places', 'p1', 'change');

        expect(patches).toEqual([{ level: 0.5 }, { placeIds: ['p1'] }]);
        expect(section({ value: { ...VALUE, kind: 'interior' } }, []).querySelector<HTMLInputElement>('#photo-level')?.value).toBe('');
    });

    it('badPath_aStreetPhotoHasNoLevel_andWithoutPlacesNoPicker @S-A198-BAD-PLACE-IDS', () => {
        const element = section({}, []);

        expect(element.querySelector('#photo-level')).toBeNull();
        expect(element.querySelector('#photo-places')).toBeNull();
    });
});
