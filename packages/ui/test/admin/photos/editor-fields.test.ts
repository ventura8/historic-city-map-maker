// `selectField` over real Lit in Chromium: the field always shows the model's value, also for an option the admin picked.
import { render } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import { selectField } from '../../../src/admin/photos/editor-fields.js';

const OPTIONS = [
    { value: '', label: 'None' },
    { value: '3', label: 'March' },
    { value: '5', label: 'May' },
];

let host: HTMLElement | null = null;

function show(value: string, changed: (value: string) => void = () => undefined): HTMLSelectElement {
    host ??= document.body.appendChild(document.createElement('div'));
    render(selectField({ id: 'month', label: 'Month', value, error: null, options: OPTIONS }, changed), host);
    const select = host.querySelector('select');
    if (select === null) {
        throw new Error('selectField rendered no select');
    }
    return select;
}

/** What a click on an option does: the option turns dirty, and the model follows through `change`. */
function pick(select: HTMLSelectElement, value: string): void {
    select.value = value;
    select.dispatchEvent(new Event('change'));
}

describe('selectField', () => {
    afterEach(() => {
        host?.remove();
        host = null;
    });

    it('happyPath_showsTheModelFromTheFirstRender', () => {
        expect(show('5').value).toBe('5');
    });

    it('happyPath_reportsThePickedValue', () => {
        const picked: string[] = [];
        const select = show('3', (value) => picked.push(value));

        pick(select, '5');

        expect(picked).toEqual(['5']);
    });

    it('badPath_aChangeOfTheModelWinsOverAChoiceTheAdminPicked', () => {
        const select = show('');
        pick(select, '3');
        show('3');
        pick(select, '5');
        show('5');

        show('3');

        expect(select.value).toBe('3');
    });

    it('badPath_aRenderAtTheSameValueTakesBackAPickTheModelRefused', () => {
        const select = show('3');
        pick(select, '5');

        show('3');

        expect(select.value).toBe('3');
    });

    it('badPath_noValueGoesBackToTheEmptyChoice', () => {
        const select = show('');
        pick(select, '5');
        show('5');

        show('');

        expect(select.value).toBe('');
    });
});
