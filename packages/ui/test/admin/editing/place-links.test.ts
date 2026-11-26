import { MAX_MEDIA_PLACES } from '@hcm/shared';
import { render } from 'lit';
import { describe, expect, it } from 'vitest';

import { placeLinksField, type PlaceLinksInput } from '../../../src/admin/editing/place-links.js';

const PLACES = [
    { id: 'p1', title: { ro: 'Biserica Enei', en: 'Enei Church' } },
    { id: 'p2', title: { ro: 'Hanul Șerban Vodă', en: '' } },
    { id: 'p3', title: { ro: 'Teatrul Național' } },
];

function field(input: Partial<PlaceLinksInput> & { readonly changes?: unknown[] }): HTMLElement {
    const host = document.createElement('div');
    const changes = input.changes ?? [];
    render(
        placeLinksField({
            id: 'photo-places',
            locale: 'en',
            ids: [],
            places: PLACES,
            readOnly: false,
            change: (ids) => changes.push(ids),
            ...input,
        }),
        host,
    );
    return host;
}

function select(host: HTMLElement): HTMLSelectElement {
    const element = host.querySelector('select');
    if (element === null) {
        throw new Error('no select');
    }
    return element;
}

describe('placeLinksField', () => {
    it('happyPath_chipsNameThePlacesInTheLocale_andTheSelectAddsAnother @S-A198-HAPPY-PHOTO-PLACES', () => {
        const changes: unknown[] = [];
        const host = field({ ids: ['p1', 'p2', 'gone'], changes });

        expect([...host.querySelectorAll('hcm-button')].map((chip) => chip.textContent.trim())).toEqual([
            'Enei Church',
            'Hanul Șerban Vodă',
            'gone',
        ]);
        expect([...select(host).options].map((option) => option.value)).toEqual(['', 'p3']);
        expect(host.querySelector('h3')?.id).toBe('photo-places-label');

        select(host).value = 'p3';
        select(host).dispatchEvent(new Event('change'));
        expect(changes).toEqual([['p1', 'p2', 'gone', 'p3']]);
        expect(select(host).value).toBe('');
    });

    it('happyPath_aChipRemovesItsPlace_andTheLastOneClearsTheField @S-A198-HAPPY-PHOTO-PLACES', () => {
        const changes: unknown[] = [];
        const host = field({ ids: ['p1', 'p3'], changes, locale: 'ro' });
        expect(host.querySelector('hcm-button')?.textContent.trim()).toBe('Biserica Enei');

        host.querySelector('hcm-button')?.dispatchEvent(new Event('click'));
        const single = field({ ids: ['p3'], changes });
        single.querySelector('hcm-button')?.dispatchEvent(new Event('click'));

        expect(changes).toEqual([['p3'], undefined]);
    });

    it('badPath_theEmptyChoiceAddsNothing @S-A198-BAD-PLACE-IDS', () => {
        const changes: unknown[] = [];
        const host = field({ changes });

        select(host).dispatchEvent(new Event('change'));

        expect(changes).toEqual([]);
    });

    it('badPath_aFullListLoadingPlacesOrAReadOnlyEditorTurnTheSelectOff @S-A198-BAD-PLACE-IDS', () => {
        const ids = Array.from({ length: MAX_MEDIA_PLACES }, (_, index) => `x${String(index)}`);
        const full = field({ ids });
        expect(select(full).disabled).toBe(true);
        expect(full.querySelectorAll('p.note')).toHaveLength(2);

        expect(select(field({ places: null })).disabled).toBe(true);
        expect(select(field({ readOnly: true })).disabled).toBe(true);
        expect(select(field({})).disabled).toBe(false);
    });
});
