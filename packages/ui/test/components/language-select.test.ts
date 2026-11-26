import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineHcmLanguageSelect, type HcmLanguageSelect } from '../../src/components/language-select.js';
import type { SegmentOption } from '../../src/components/segmented-button.js';
import { cleanup, fixture, recordEvents, shadowPart } from '../helpers.js';

defineHcmLanguageSelect();

const LANGUAGES: readonly SegmentOption[] = [
    { value: 'de', label: 'Deutsch', lang: 'de' },
    { value: 'en', label: 'English', lang: 'en' },
    { value: 'ro', label: 'Română', lang: 'ro' },
    { value: 'xx', label: 'Unmarked' },
];

function picker(value: string): Promise<HcmLanguageSelect> {
    return fixture<HcmLanguageSelect>(html`<hcm-language-select .options=${LANGUAGES} value=${value} label="Limbă"></hcm-language-select>`);
}

function select(element: HcmLanguageSelect): HTMLSelectElement {
    return shadowPart(element, 'select') as HTMLSelectElement;
}

describe('<hcm-language-select>', () => {
    afterEach(cleanup);

    it('happyPath_oneNamedDropdownOfLanguagesByTheirOwnNamesAtLeast48PxTall', async () => {
        const element = await picker('ro');

        await expect.element(page.getByRole('combobox', { name: 'Limbă' })).toHaveValue('ro');
        const options = [...select(element).options];
        expect(options.map((option) => [option.value, option.textContent.trim(), option.getAttribute('lang')])).toEqual([
            ['de', 'Deutsch', 'de'],
            ['en', 'English', 'en'],
            ['ro', 'Română', 'ro'],
            ['xx', 'Unmarked', null],
        ]);
        expect(select(element).getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aChoiceFiresHcmChangeAtOnce_withTheMouseAndTheKeyboard', async () => {
        const element = await picker('ro');
        const events = recordEvents(element, 'hcm-change');

        await page.getByRole('combobox', { name: 'Limbă' }).selectOptions('en');
        expect(element.value).toBe('en');

        select(element).focus();
        await userEvent.keyboard('{ArrowUp}');
        expect(events).toEqual([{ value: 'en' }, { value: 'de' }]);
    });

    it('badPath_theHostPutsTheValueBackWhenTheLanguageCannotLoad', async () => {
        const element = await picker('ro');
        element.addEventListener('hcm-change', () => {
            element.value = 'ro';
        });

        await page.getByRole('combobox', { name: 'Limbă' }).selectOptions('de');
        await element.updateComplete;

        expect(select(element).value).toBe('ro');
    });

    it('badPath_withoutOptionsOrALabelItIsAnEmptyUnnamedList', async () => {
        const element = await fixture<HcmLanguageSelect>(html`<hcm-language-select></hcm-language-select>`);

        expect(select(element).options).toHaveLength(0);
        expect(select(element).hasAttribute('aria-label')).toBe(false);
        expect(element.value).toBe('');
    });
});
