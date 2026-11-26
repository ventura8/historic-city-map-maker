import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineHcmChip, type HcmChip } from '../../src/components/chip.js';
import { cleanup, fixture, recordEvents, shadowPart } from '../helpers.js';

defineHcmChip();

describe('<hcm-chip>', () => {
    afterEach(cleanup);

    it('happyPath_aClickSelectsAndShowsTheCheckMark', async () => {
        const chip = await fixture<HcmChip>(html`<hcm-chip label="1945" icon="history"></hcm-chip>`);
        const changes = recordEvents(chip, 'hcm-change');

        expect(shadowPart(chip, 'hcm-icon').getAttribute('name')).toBe('history');
        await userEvent.click(page.getByRole('button', { name: '1945' }));
        await chip.updateComplete;

        expect(changes).toEqual([{ selected: true }]);
        expect(shadowPart(chip, 'hcm-icon').getAttribute('name')).toBe('check');
        await expect.element(page.getByRole('button', { name: '1945' })).toHaveAttribute('aria-pressed', 'true');
        expect(await axeViolations(chip)).toEqual([]);
    });

    it('happyPath_aChipWithoutIconHasNoneUntilSelected', async () => {
        const chip = await fixture<HcmChip>(html`<hcm-chip label="Today"></hcm-chip>`);

        expect(chip.shadowRoot?.querySelector('hcm-icon')).toBeNull();
    });

    it('badPath_aDisabledChipStaysUnselected', async () => {
        const chip = await fixture<HcmChip>(html`<hcm-chip label="1945" disabled></hcm-chip>`);

        (shadowPart(chip, 'button') as HTMLButtonElement).click();

        expect(chip.selected).toBe(false);
    });
});
