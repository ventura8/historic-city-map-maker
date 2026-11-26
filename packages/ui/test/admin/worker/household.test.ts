// W5, household computers (docs/research/M7-local-worker.md *Household computers*): `<hcm-worker-household>` over a fake of the
// city's computers: the list and its actions, Add another computer (an address for a computer with a screen, one line for one
// without), and Remove this computer (clean up first, disconnect second; Disconnect now anyway and only then the manual line).
import { axeViolations } from '@hcm/test-support/axe';
import { translateAdminWorkerHousehold, type AdminWorkerHouseholdKey } from '@hcm/shared/admin-worker-household';
import { html, type LitElement } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import { defineHcmButton } from '../../../src/components/button.js';
import { defineHcmSegmentedButton } from '../../../src/components/segmented-button.js';
import { defineWorkerHousehold } from '../../../src/admin/worker/hcm-worker-household.js';
import { cleanup, fixture } from '../../helpers.js';
import { deep, deepAll, deepText, updated } from '../shell/fake-app.js';
import { computer, FakeHousehold } from './fake-household.js';

defineWorkerHousehold();
defineWorkerHousehold();
defineHcmButton();
defineHcmSegmentedButton();

function t(key: AdminWorkerHouseholdKey, params?: Readonly<Record<string, string>>, locale: 'ro' | 'en' = 'en'): string {
    return translateAdminWorkerHousehold(locale, key, params);
}

async function list(household: FakeHousehold | null, locale: 'ro' | 'en' = 'en'): Promise<LitElement> {
    const element = await fixture<LitElement>(
        html`<hcm-worker-household .household=${household} locale=${locale} city="bucharest" .level=${3}></hcm-worker-household>`,
    );
    await updated(element);
    return element;
}

function button(element: Element, label: string): HTMLElement {
    const found = deepAll(element, 'hcm-button').find((candidate) => candidate.textContent.trim() === label);
    if (found === undefined) {
        throw new Error(`no button ${label}`);
    }
    return deep(found, 'button');
}

describe('<hcm-worker-household>: the city computers', () => {
    afterEach(cleanup);

    it('happyPath_eachComputerSaysItsNameStateShareAndVersions @S-A143-HAPPY-LIST', async () => {
        const household = new FakeHousehold();
        household.set({
            computers: [
                computer(),
                computer({
                    id: 'w-fedcba9876543210',
                    name: null,
                    online: false,
                    paused: true,
                    share: { profile: 'quiet', why: 'user-active', cores: 4, threads: 1, memoryMb: 2048 },
                    starter: null,
                    starterCurrent: false,
                }),
            ],
        });
        const element = await list(household);
        const text = deepText(element);

        expect(text).toContain('nuc');
        expect(text).toContain(`${t('adminWorkerHousehold.online')}. ${t('adminWorkerHousehold.waiting')}`);
        expect(text).toContain(t('adminWorkerHousehold.share', { threads: '7', cores: '8', memory: '8.0' }));
        expect(text).toContain(t('adminWorkerHousehold.unnamed', { id: 'w-fedcba' }));
        expect(text).toContain(t('adminWorkerHousehold.paused'));
        expect(text).toContain(t('adminWorkerHousehold.why.user-active'));
        expect(text).toContain(t('adminWorkerHousehold.versions', { starter: t('adminWorkerHousehold.noStarter'), version: '1.0.0' }));
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_renamePauseAndResumeAskTheList @S-A143-HAPPY-MANAGE', async () => {
        const household = new FakeHousehold();
        const element = await list(household);

        button(element, t('adminWorkerHousehold.pause')).click();
        button(element, t('adminWorkerHousehold.rename')).click();
        await updated(element);
        (deep(element, 'input') as HTMLInputElement).value = 'Living room';
        button(element, t('adminWorkerHousehold.save')).click();
        await updated(element);
        await updated(element);
        expect(household.calls).toEqual(['pause w-0123456789abcdef', 'rename w-0123456789abcdef Living room']);
        expect(deepAll(element, 'input')).toHaveLength(0);

        household.set({ computers: [computer({ paused: true, state: 'busy', jobId: 'j7' })] });
        await updated(element);
        expect(deepText(element)).toContain(t('adminWorkerHousehold.paused'));
        button(element, t('adminWorkerHousehold.resume')).click();
        expect(household.calls.at(-1)).toBe('resume w-0123456789abcdef');
    });

    it('badPath_aRefusedRenameKeepsTheFieldAndCancelClosesIt', async () => {
        const household = new FakeHousehold();
        household.answer = false;
        const element = await list(household);

        button(element, t('adminWorkerHousehold.rename')).click();
        await updated(element);
        button(element, t('adminWorkerHousehold.save')).click();
        await updated(element);
        expect(deepAll(element, 'input')).toHaveLength(1);
        button(element, t('adminWorkerHousehold.cancel')).click();
        await updated(element);
        expect(deepAll(element, 'input')).toHaveLength(0);
    });

    it('badPath_noComputerAFailedListAndARefusal', async () => {
        const household = new FakeHousehold();
        household.set({ computers: [], refusal: { key: 'apiError.imagery.versionState' } });
        const element = await list(household);
        expect(deep(element, '[data-computers="0"]').textContent).toBe(t('adminWorkerHousehold.none'));
        expect(deep(element, '[role="alert"]').textContent).not.toBe('');

        household.set({ status: 'error', failure: { kind: 'failed', code: 'internal' } });
        await updated(element);
        deep(deepAll(element, 'hcm-button').at(0) ?? element, 'button').click();
        expect(household.calls).toContain('retry');
        expect(deepText(await list(null))).toBe('');
    });

    it('happyPath_withAnotherLocaleTheTextsAreRomanian', async () => {
        const element = await list(new FakeHousehold(), 'ro');

        expect(deepText(element)).toContain(t('adminWorkerHousehold.title', undefined, 'ro'));
    });
});

describe('<hcm-worker-household>: Add another computer', () => {
    afterEach(cleanup);

    it('happyPath_aComputerWithoutAScreenGetsOneLineWithItsCode @S-A143-HAPPY-HEADLESS-PAIR', async () => {
        const household = new FakeHousehold();
        const element = await list(household);
        button(element, t('adminWorkerHousehold.add')).click();
        await updated(element);
        expect(deepText(element)).toContain(t('adminWorkerHousehold.lineMaking'));

        const line =
            "curl -fsSL 'https://x/worker-starter?city=bucharest&os=linux&action=install' -o ~/hcm-worker.sh && echo abc | sh ~/hcm-worker.sh";
        household.set({ line, code: 'abc', expiresAt: '2026-11-13T10:45:00.000Z' });
        await updated(element);
        expect(deep(element, '[data-line="headless"]').textContent).toBe(line);
        button(element, t('adminWorkerHousehold.newLine')).click();
        expect(household.calls).toEqual(['add headless', 'mint']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aComputerWithAScreenGetsThisAdminsAddress', async () => {
        const household = new FakeHousehold();
        const element = await list(household);
        deep(deep(element, '[data-add]'), 'button').click();
        await updated(element);
        deep(deep(element, '[data-kind="windows"]'), 'button').click();
        await updated(element);

        expect(deep(element, '[data-line="address"]').textContent).toBe('https://demo-hcm.web.app/admin/#/jobs');
        expect(deepText(element)).toContain(t('adminWorkerHousehold.screenWindows'));
        button(element, t('adminWorkerHousehold.close')).click();
        expect(household.calls.at(-1)).toBe('add null');
    });

    it('badPath_aLineThatCouldNotBeMadeSaysSoAndTriesAgain @S-A143-BAD-HEADLESS-EXPIRED', async () => {
        const household = new FakeHousehold();
        household.set({ adding: 'headless', codeFailed: true });
        const element = await list(household);

        expect(deep(element, '[data-line-failed]').textContent).toBe(t('adminWorkerHousehold.lineFailed'));
        button(element, t('adminWorkerHousehold.retry')).click();
        expect(household.calls).toEqual(['mint']);
    });

    it('happyPath_copyingALineIsSaid', async () => {
        const household = new FakeHousehold();
        household.set({ adding: 'mac' });
        const element = await list(household);
        button(element, t('adminWorkerHousehold.copyAddress')).click();
        await updated(element);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await updated(element);

        expect(deep(element, '[data-copied="address"]').textContent).not.toBe('');
    });
});

describe('<hcm-worker-household>: Remove this computer', () => {
    afterEach(cleanup);

    it('happyPath_removeAsksTheComputerWithItsChoices @S-A143-HAPPY-REMOVE', async () => {
        const household = new FakeHousehold();
        const element = await list(household);
        button(element, t('adminWorkerHousehold.remove')).click();
        await updated(element);
        expect(deepText(element)).toContain(t('adminWorkerHousehold.removeIntro'));
        deep(deep(element, '[data-choice="keep"] hcm-switch'), 'button').click();
        await updated(element);
        button(element, t('adminWorkerHousehold.removeNow')).click();
        await updated(element);
        await updated(element);
        expect(household.calls).toEqual(['remove w-0123456789abcdef docker=false keep=true']);

        for (const [step, key] of [
            ['asked', 'adminWorkerHousehold.removal.asked'],
            ['accepted', 'adminWorkerHousehold.removal.accepted'],
        ] as const) {
            household.set({ computers: [computer({ removal: { step, docker: false, keep: true } })] });
            await updated(element);
            expect(deep(element, '[data-removal]').textContent).toBe(t(key));
            expect(deepAll(element, '[data-disconnect]')).toHaveLength(0);
        }
        household.set({
            computers: [computer({ online: false, revoked: true, removal: { step: 'done', docker: true, keep: false, dockerLeft: true } })],
        });
        await updated(element);
        expect(deep(element, '[data-removal]').textContent).toContain(t('adminWorkerHousehold.removal.dockerLeft'));
        expect(deepAll(element, '[data-line^="cleanup-"]')).toHaveLength(0);
    });

    it('badPath_anOfflineComputerWaitsAndDisconnectNowAnywayThenShowsTheManualLine @S-A143-BAD-REMOVE-FORCED', async () => {
        const household = new FakeHousehold();
        household.set({ computers: [computer({ online: false, removal: { step: 'asked', docker: false, keep: false } })] });
        const element = await list(household);
        expect(deep(element, '[data-removal]').textContent).toBe(t('adminWorkerHousehold.removal.askedOffline'));

        deep(deep(element, '[data-disconnect]'), 'button').click();
        expect(household.calls).toEqual(['disconnect w-0123456789abcdef']);
        household.set({ computers: [computer({ online: false, revoked: true, os: 'windows', removal: null })] });
        await updated(element);
        expect(deep(element, '[data-removal]').textContent).toBe(t('adminWorkerHousehold.disconnected'));
        expect(deep(element, '[data-line^="cleanup-"]').textContent).toContain('os=windows&action=uninstall');
        expect(deep(element, 'a[download]').getAttribute('download')).toBe('hcm-worker-remove.bat');
    });

    it('badPath_aComputerWithoutAHelperSaysWhyAndOffersTheLastResort @S-A143-BAD-REMOVE-NO-STARTER', async () => {
        const household = new FakeHousehold();
        household.set({ computers: [computer({ removal: { step: 'failed', why: 'no-starter', docker: false, keep: false } })] });
        const element = await list(household);

        expect(deep(element, '[data-removal]').textContent).toBe(t('adminWorkerHousehold.removal.failed.no-starter'));
        expect(deepAll(element, '[data-disconnect]')).toHaveLength(1);
        household.set({ computers: [computer({ removal: { step: 'failed', docker: false, keep: false } })] });
        await updated(element);
        expect(deep(element, '[data-removal]').textContent).toBe(t('adminWorkerHousehold.removal.failed.cleanup'));
    });

    it('badPath_cancelLeavesTheComputerAlone', async () => {
        const household = new FakeHousehold();
        household.answer = false;
        const element = await list(household);
        button(element, t('adminWorkerHousehold.remove')).click();
        await updated(element);
        button(element, t('adminWorkerHousehold.removeNow')).click();
        await updated(element);
        await updated(element);
        expect(deepAll(element, 'hcm-switch')).toHaveLength(2);
        button(element, t('adminWorkerHousehold.cancel')).click();
        await updated(element);
        expect(deepAll(element, 'hcm-switch')).toHaveLength(0);
    });
});
