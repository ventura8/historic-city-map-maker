// The deployment, Mapbox and USGS bodies: copy buttons, the paste boxes and the 60 s countdown.
import { axeViolations } from '@hcm/test-support/axe';
import { MAPBOX_TOKENS } from '@hcm/test-support/fakes';
import { html } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import type { HcmSetupDeploy } from '../../../src/admin/setup/hcm-setup-deploy.js';
import { defineHcmSetupDeploy } from '../../../src/admin/setup/hcm-setup-deploy.js';
import type { HcmSetupMapbox } from '../../../src/admin/setup/hcm-setup-mapbox.js';
import { defineHcmSetupMapbox } from '../../../src/admin/setup/hcm-setup-mapbox.js';
import { cleanup, fixture, shadowPart } from '../../helpers.js';
import { FakeSetupPort, setupView, type ViewChanges } from './fixtures.js';

defineHcmSetupDeploy();
defineHcmSetupMapbox();

/** When the deployment's watch last looked: the count shows only after a look (finding 9 of the M6 review). */
const LOOKED = '2026-10-12T13:05:00.000Z';

describe('<hcm-setup-deploy>', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        cleanup();
    });

    async function deploy(changes: ViewChanges = {}) {
        const port = new FakeSetupPort(setupView(changes));
        return fixture<HcmSetupDeploy>(
            html`<hcm-setup-deploy .view=${port.getState()} .intents=${port.intents} locale="en"></hcm-setup-deploy>`,
        );
    }

    it('happyPath_explainsTheInstallationAndCountsTheFunctions', async () => {
        const element = await deploy({
            deploy: { ...setupView().deploy, ready: 8, watching: true },
            steps: { deploy: { state: 'pending', checkedAt: LOOKED } },
        });

        await expect.element(page.getByRole('progressbar', { name: '8 of 32 functions installed' })).toHaveAttribute('aria-valuenow', '25');
        expect(shadowPart(element, '.watching').textContent).toBe('Checking every 30 seconds…');
        expect(shadowPart(element, '.copy-list').textContent).toContain('GCP_PROJECT_ID');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aCopyButtonCopiesTheVariableAndSaysSo', async () => {
        const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
        const element = await deploy();

        // M6: the GitHub variables are the optional path, collapsed under their summary.
        await page.getByText('For developers: install from GitHub Actions').click();
        await page.getByRole('button', { name: 'Copy GCP_PROJECT_ID' }).click();

        expect(writeText).toHaveBeenCalledWith('demo-hcm');
        await expect.poll(() => element.renderRoot.querySelector('.copied')?.textContent).toBe('Copied.');
    });

    it('badPath_theCopyButtonsLineUpWhateverTheValuesLength', async () => {
        // The M2 final screenshots: space-between put each button midway between its value and the empty status.
        const variables = [
            { name: 'GCP_DEPLOY_SA', value: 'gh-deployer@demo-hcm.iam.gserviceaccount.com' },
            { name: 'GCP_PROJECT_ID', value: 'demo-hcm' },
        ];
        const element = await deploy({ deploy: { ...setupView().deploy, variables } });
        // Wide enough that no value wraps: then the rows' free space differs, and so did the buttons' places.
        element.style.display = 'block';
        element.style.inlineSize = '1000px';
        element.renderRoot.querySelector('details')?.setAttribute('open', '');
        const rows = [...element.renderRoot.querySelectorAll<HTMLElement>('.copy-row')];
        const ends = rows.map((row) => Math.round(row.querySelector('hcm-icon-button')?.getBoundingClientRect().right ?? 0));

        expect(rows.length).toBeGreaterThan(1);
        expect(new Set(ends).size).toBe(1);
    });

    it('badPath_aRefusedClipboardSaysNothing', async () => {
        vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
        const element = await deploy();

        await page.getByText('For developers: install from GitHub Actions').click();
        await page.getByRole('button', { name: 'Copy DEPLOY_ENABLED' }).click();

        await expect.poll(() => element.copied).toBeNull();
        expect([...element.renderRoot.querySelectorAll('.copied')].map((note) => note.textContent)).toEqual(['', '']);
    });

    it('badPath_noFunctionCountShowsAnEmptyBar', async () => {
        await deploy({ deploy: { ...setupView().deploy, total: 0 }, steps: { deploy: { state: 'pending', checkedAt: LOOKED } } });

        await expect.element(page.getByRole('progressbar', { name: '0 of 0 functions installed' })).toHaveAttribute('aria-valuenow', '0');
    });
});

/** A Mapbox card over a fake port holding `changes`. */
async function mapbox(changes: ViewChanges = {}, locale = 'ro') {
    const port = new FakeSetupPort(setupView(changes));
    const element = await fixture<HcmSetupMapbox>(
        html`<hcm-setup-mapbox .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-mapbox>`,
    );
    return { port, element };
}

describe('<hcm-setup-mapbox>', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        cleanup();
    });

    it('happyPath_theScopesToTickCanBeCopied', async () => {
        const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
        const { element } = await mapbox();

        expect(shadowPart(element, '.scopes').textContent).toBe('styles:read tokens:write');
        await page.getByRole('button', { name: 'Copiază permisiunile' }).click();

        expect(writeText).toHaveBeenCalledWith('styles:read tokens:write');
    });

    /** What a paste from the clipboard does to the box: its value, then an `insertFromPaste` input. */
    function paste(box: HTMLInputElement, value: string): void {
        box.value = value;
        box.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }));
    }

    it('happyPath_aPastedSecretIsSavedAtOnceAndTheBoxCleared', async () => {
        const { port, element } = await mapbox();
        const box = page.getByLabelText('Tokenul secret (sk.…)');

        await expect.element(box).toHaveAttribute('type', 'password');
        await expect.element(box).toHaveAttribute('autocomplete', 'off');
        paste(box.element() as HTMLInputElement, MAPBOX_TOKENS.bootstrap);

        expect(port.calls).toEqual([['saveMapbox', MAPBOX_TOKENS.bootstrap]]);
        expect((box.element() as HTMLInputElement).value).toBe('');
        expect(element.verdict).toBe('empty');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aTypedSecretIsSavedWithEnterOrSave', async () => {
        const { port, element } = await mapbox();
        const box = page.getByLabelText('Tokenul secret (sk.…)');

        await userEvent.fill(box, MAPBOX_TOKENS.bootstrap);
        expect(shadowPart(element, '#verdict').textContent).toBe('Pare un token secret.');
        expect(port.calls).toEqual([]);
        await userEvent.keyboard('{Enter}');
        await userEvent.fill(box, MAPBOX_TOKENS.bootstrap);
        await page.getByRole('button', { name: 'Salvează' }).click();
        await userEvent.click(box);
        await userEvent.keyboard('{Enter}');

        expect(port.calls).toEqual([
            ['saveMapbox', MAPBOX_TOKENS.bootstrap],
            ['saveMapbox', MAPBOX_TOKENS.bootstrap],
        ]);
    });

    it('badPath_aPastedPublicTokenIsCountedAndExplainedButNotSent', async () => {
        const { port, element } = await mapbox({}, 'en');

        paste(shadowPart(element, '#token') as HTMLInputElement, MAPBOX_TOKENS.defaultPublic);
        await element.updateComplete;

        expect(port.calls).toEqual([['noteInput', 'mapbox']]);
        expect(shadowPart(element, '#verdict').textContent).toBe('This is a public token (pk.). Paste the secret token (sk.) you created.');
    });

    it('badPath_aPublicTokenIsExplainedBeforeAnyCall', async () => {
        const { element } = await mapbox({}, 'en');
        const box = page.getByLabelText('Secret token (sk.…)');

        await userEvent.fill(box, MAPBOX_TOKENS.defaultPublic);
        expect(shadowPart(element, '#verdict').textContent).toBe('This is a public token (pk.). Paste the secret token (sk.) you created.');
        await userEvent.fill(box, 'hello');
        expect(shadowPart(element, '#verdict').textContent).toBe('This does not look like a Mapbox secret token (one starts with sk.).');
        await userEvent.fill(box, '   ');
        expect(shadowPart(element, '#verdict').textContent).toBe('');
    });

    it('badPath_saveBeforeAnyPasteSendsNothing', async () => {
        const { port, element } = await mapbox();

        shadowPart(element, 'hcm-button').click();

        expect(port.calls).toEqual([]);
    });

    it('happyPath_aSavedTokenNamesItsAccount', async () => {
        const { element } = await mapbox({
            mapbox: {
                user: 'ventura86',
                requiredScopes: [],
                rotation: { audience: null, busy: false, retiresOldAt: null, done: false, error: null },
            },
        });

        expect(shadowPart(element, '.success').textContent).toBe('Salvat pentru contul Mapbox ventura86.');
    });
});

describe('<hcm-setup-mapbox>: replacing a token', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        cleanup();
    });

    const NO_ROTATION = { audience: null, busy: false, retiresOldAt: null, done: false, error: null } as const;

    it('happyPath_aPublicTokenIsReplacedAfterTheConfirmation', async () => {
        const { port, element } = await mapbox({ mapbox: { user: 'ventura86', requiredScopes: [], rotation: NO_ROTATION } }, 'en');

        shadowPart(element, 'hcm-button.rotate-viewer').click();
        await element.updateComplete;
        const dialog = shadowPart(element, 'hcm-confirm-dialog') as HTMLElement & { open: boolean; headline: string };
        expect([dialog.open, dialog.headline]).toEqual([true, "Replace the visitors' token?"]);
        expect(await axeViolations(element)).toEqual([]);
        dialog.dispatchEvent(new CustomEvent('hcm-confirm'));
        await element.updateComplete;

        expect(port.calls).toEqual([['rotatePublicToken', 'viewer']]);
        expect(dialog.open).toBe(false);
    });

    it('badPath_cancellingTheReplacementReplacesNothing', async () => {
        const { port, element } = await mapbox({ mapbox: { user: 'ventura86', requiredScopes: [], rotation: NO_ROTATION } }, 'en');

        shadowPart(element, 'hcm-button.rotate-admin').click();
        await element.updateComplete;
        const dialog = shadowPart(element, 'hcm-confirm-dialog') as HTMLElement & { open: boolean; headline: string };
        expect(dialog.headline).toBe("Replace the admin's token?");
        dialog.dispatchEvent(new CustomEvent('hcm-cancel'));
        await element.updateComplete;
        dialog.dispatchEvent(new CustomEvent('hcm-confirm'));

        expect(port.calls).toEqual([]);
        expect(dialog.open).toBe(false);
    });

    it.each([
        [{ ...NO_ROTATION, audience: 'viewer', busy: true }, 'Replacing the token…'],
        [
            { ...NO_ROTATION, audience: 'viewer', done: true, retiresOldAt: '2026-10-12T09:10:00.000Z' },
            'The new token is in use. The old one is deleted at',
        ],
        [{ ...NO_ROTATION, audience: 'admin', done: true }, 'The new token is in use.'],
    ] as const)('happyPath_theReplacementSaysWhereItIs %#', async (rotation, text) => {
        const { element } = await mapbox({ mapbox: { user: 'ventura86', requiredScopes: [], rotation } }, 'en');

        expect(shadowPart(element, '.rotation [role="status"]').textContent).toContain(text);
    });

    it('badPath_aRefusedReplacementSaysWhyAndNoTokenOffersNone', async () => {
        const error = { key: 'apiError.mapbox.notConfigured' } as const;
        const { element } = await mapbox({ mapbox: { user: 'ventura86', requiredScopes: [], rotation: { ...NO_ROTATION, error } } }, 'en');

        expect(shadowPart(element, '.rotation [role="alert"]').textContent).not.toBe('');
        cleanup();
        const none = await mapbox();
        expect(none.element.shadowRoot?.querySelector('.rotation')).toBeNull();
    });
});
