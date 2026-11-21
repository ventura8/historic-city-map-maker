// The editors' number fields (DECISIONS-for-review.md §35d): `numberValue` keeps what the admin typed while it is the
// same number, and `LeftFields` remembers the fields left since the item opened.
import { html, render } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LeftFields, numberValue, typedNumber } from '../../../src/admin/editing/number-fields.js';

const hosts: HTMLElement[] = [];

afterEach(() => {
    for (const host of hosts.splice(0)) {
        host.remove();
    }
});

/** Renders one number input bound to `text` into `host` (a new host the first time). */
function field(
    text: string,
    host: HTMLElement = document.body.appendChild(document.createElement('div')),
): { host: HTMLElement; input: HTMLInputElement } {
    if (!hosts.includes(host)) {
        hosts.push(host);
    }
    render(html`<input type="number" step="any" .value=${numberValue(text)} />`, host);
    const input = host.querySelector('input');
    if (input === null) {
        throw new Error('the field was not rendered');
    }
    return { host, input };
}

describe('numberValue', () => {
    it('happyPath_theDraftsNumberIsShownOnce', () => {
        expect(field('1937').input.value).toBe('1937');
        expect(field('').input.value).toBe('');
    });

    it('happyPath_theAdminsSpellingOfTheSameNumberStays', () => {
        const { host, input } = field('44.4');
        input.value = '44.40';

        field('44.4', host);

        expect(input.value).toBe('44.40');
    });

    it('happyPath_anUnfinishedNumberStaysWhileTheDraftHoldsNone', () => {
        const { host, input } = field('');
        input.value = '-';

        field('NaN', host);
        field('', host);

        // A number input whose text is not a number yet reports an empty value; nothing rewrites it under the cursor.
        expect(input.value).toBe('');
    });

    it('badPath_anotherNumberFromTheDraftReplacesTheField', () => {
        const { host, input } = field('1937');
        input.value = '1940';
        field('1940', host);
        expect(input.value).toBe('1940');

        // Discard brings back the number the field showed first: it is written although Lit wrote it once already.
        field('1937', host);
        expect(input.value).toBe('1937');
        field('', host);
        expect(input.value).toBe('');
    });

    it('badPath_itBindsOnlyAnInputsValue', () => {
        const [first, second] = [0, 1].map(() => document.body.appendChild(document.createElement('div')));
        hosts.push(...[first, second].filter((host): host is HTMLDivElement => host !== undefined));

        expect(() => {
            render(html`<input .max=${numberValue('1')} />`, first as HTMLElement);
        }).toThrow('numberValue() binds the .value of an input');
        expect(() => {
            render(html`<input value=${numberValue('1')} />`, second as HTMLElement);
        }).toThrow('numberValue() binds the .value of an input');
    });

    it('happyPath_typedNumber', () => {
        expect([typedNumber('44.40'), typedNumber('1e3'), typedNumber(''), typedNumber('-'), typedNumber('NaN')]).toEqual([
            44.4,
            1000,
            undefined,
            undefined,
            undefined,
        ]);
    });
});

describe('LeftFields', () => {
    it('happyPath_aFieldLeftOnceStaysLeftAndReRendersOnce', () => {
        const changed = vi.fn();
        const left = new LeftFields(changed).forItem('p1');

        left.leave('photo-year');
        left.leave('photo-year');

        expect(left.has('photo-year')).toBe(true);
        expect(left.has('photo-lat')).toBe(false);
        expect(changed).toHaveBeenCalledOnce();
        expect(left.forItem('p1').has('photo-year')).toBe(true);
    });

    it('badPath_anotherItemStartsWithNoFieldLeft', () => {
        const left = new LeftFields(() => undefined).forItem('p1');
        left.leave('photo-year');

        expect(left.forItem('p2').has('photo-year')).toBe(false);
        expect(left.forItem('p1').has('photo-year')).toBe(false);
    });
});
