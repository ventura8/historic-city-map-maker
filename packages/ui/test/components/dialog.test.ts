import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineHcmDialog, type HcmDialog } from '../../src/components/dialog.js';
import { watchModals } from '../../src/components/modal-registry.js';
import { cleanup, deepFocus, fixture, part, recordEvents, shadowPart } from '../helpers.js';

defineHcmDialog();

async function dialogWithOpener(): Promise<{ dialog: HcmDialog; opener: HTMLButtonElement }> {
    const box = await fixture<HTMLElement>(
        html`<div>
            <button id="opener">Despre</button>
            <hcm-dialog headline="Despre hartă" close-label="Închide">
                <p>Hartă istorică a Bucureștiului. <a href="#credits">Credite</a></p>
                <button slot="actions">Gata</button></hcm-dialog
            >
        </div>`,
    );
    const dialog = part(box, 'hcm-dialog') as HcmDialog;
    await dialog.updateComplete;
    return { dialog, opener: part(box, '#opener') as HTMLButtonElement };
}

async function open(dialog: HcmDialog, opener: HTMLButtonElement): Promise<void> {
    opener.focus();
    dialog.open = true;
    await dialog.updateComplete;
}

describe('<hcm-dialog>', () => {
    afterEach(cleanup);

    it('happyPath_opensModalNamedByItsHeadlineWithTheFocusInside', async () => {
        const { dialog, opener } = await dialogWithOpener();

        await open(dialog, opener);

        await expect.element(page.getByRole('dialog', { name: 'Despre hartă' })).toBeVisible();
        expect((shadowPart(dialog, 'dialog') as HTMLDialogElement).open).toBe(true);
        expect(deepFocus()).toBe(shadowPart(shadowPart(dialog, 'hcm-icon-button'), 'button'));
        expect(await axeViolations(dialog)).toEqual([]);
    });

    it('happyPath_whileOpenItCountsAmongTheDocumentsOpenModals', async () => {
        const { dialog, opener } = await dialogWithOpener();
        const heard: boolean[] = [];
        const stop = watchModals(document, (open) => heard.push(open));

        await open(dialog, opener);
        dialog.close();
        await dialog.updateComplete;
        await open(dialog, opener);
        dialog.remove();
        stop();

        expect(heard).toEqual([false, true, false, true, false]);
    });

    it('badPath_itsHeadlineRowIsNoBanner', async () => {
        // axe, on the admin's account menu: the dialog's header was a banner inside the top bar's banner.
        const { dialog, opener } = await dialogWithOpener();

        await open(dialog, opener);

        await expect.element(page.getByRole('heading', { name: 'Despre hartă' })).toBeVisible();
        expect(page.getByRole('banner').query()).toBeNull();
    });

    it('happyPath_tabWrapsInsideTheDialog', async () => {
        const { dialog, opener } = await dialogWithOpener();
        await open(dialog, opener);

        await userEvent.tab();
        expect(deepFocus()?.textContent).toBe('Credite');
        await userEvent.tab();
        expect(deepFocus()?.textContent).toBe('Gata');
        await userEvent.tab();
        expect(deepFocus()).toBe(shadowPart(shadowPart(dialog, 'hcm-icon-button'), 'button'));
        await userEvent.tab({ shift: true });
        expect(deepFocus()?.textContent).toBe('Gata');
    });

    it('happyPath_escapeClosesWithCancelAndReturnsTheFocus', async () => {
        const { dialog, opener } = await dialogWithOpener();
        const closes = recordEvents(dialog, 'hcm-close');
        await open(dialog, opener);

        await userEvent.keyboard('{Escape}');
        await dialog.updateComplete;

        expect(closes).toEqual([{ returnValue: 'cancel' }]);
        expect(dialog.open).toBe(false);
        expect((shadowPart(dialog, 'dialog') as HTMLDialogElement).open).toBe(false);
        expect(document.activeElement).toBe(opener);
    });

    it('happyPath_theCloseButtonAndAnActionClose', async () => {
        const { dialog, opener } = await dialogWithOpener();
        const closes = recordEvents(dialog, 'hcm-close');
        await open(dialog, opener);

        await userEvent.click(page.getByRole('button', { name: 'Închide' }));
        await dialog.updateComplete;
        await open(dialog, opener);
        dialog.close('done');
        dialog.close('again');

        expect(closes).toEqual([{ returnValue: 'close' }, { returnValue: 'done' }]);
    });

    it('happyPath_aClickOnTheScrimCloses', async () => {
        const { dialog, opener } = await dialogWithOpener();
        const closes = recordEvents(dialog, 'hcm-close');
        await open(dialog, opener);
        const native = shadowPart(dialog, 'dialog') as HTMLDialogElement;

        native.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 1, clientY: 1 }));
        await dialog.updateComplete;

        expect(closes).toEqual([{ returnValue: 'scrim' }]);
    });

    it('badPath_clicksInsideTheDialogDoNotClose', async () => {
        const { dialog, opener } = await dialogWithOpener();
        const closes = recordEvents(dialog, 'hcm-close');
        await open(dialog, opener);
        const native = shadowPart(dialog, 'dialog') as HTMLDialogElement;
        const box = native.getBoundingClientRect();

        native.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: box.left + 5, clientY: box.top + 5 }));
        await userEvent.click(page.getByText('Hartă istorică', { exact: false }));

        expect(closes).toEqual([]);
        expect(dialog.open).toBe(true);
    });

    it('badPath_openingTwiceOrRemovingWhileOpenIsSafe', async () => {
        const { dialog, opener } = await dialogWithOpener();
        await open(dialog, opener);

        dialog.requestUpdate('open', false);
        await dialog.updateComplete;
        dialog.remove();

        expect((shadowPart(dialog, 'dialog') as HTMLDialogElement).open).toBe(false);
    });

    it('badPath_anActionsTouchTargetLeavesTheContentsLastControlUncovered', async () => {
        // CR-M2c-29: a 48 px target reaches 4 px past a 40 px action; the actions start 4 px below the content.
        const { dialog, opener } = await dialogWithOpener();
        await open(dialog, opener);

        const content = shadowPart(dialog, '.content').getBoundingClientRect();
        const action = part(dialog, 'button[slot="actions"]').getBoundingClientRect();
        expect(getComputedStyle(shadowPart(dialog, '.actions')).paddingTop).toBe('4px');
        expect(action.top - content.bottom).toBeGreaterThanOrEqual(4);
    });

    it('happyPath_fullscreenFillsTheWindow', async () => {
        const dialog = await fixture<HcmDialog>(html`<hcm-dialog fullscreen open headline="Foto" close-label="Închide"></hcm-dialog>`);

        expect(shadowPart(dialog, 'dialog').getBoundingClientRect().width).toBe(window.innerWidth);
        dialog.open = false;
        await dialog.updateComplete;
    });
});
