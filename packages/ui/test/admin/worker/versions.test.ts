// `<hcm-worker-versions>` (`docs/research/M7-local-worker.md`, *The starter updates itself*): in "This computer", the worker's
// image and its helper file's version beside the installed release's; an out-of-date helper says why and gives the one command.
import { WORKER_STARTER_VERSION, type WorkerMachine } from '@hcm/shared';
import { translateAdminWorkerLocal, type AdminWorkerLocalKey } from '@hcm/shared/admin-worker-local';
import { axeViolations } from '@hcm/test-support/axe';
import { html, type LitElement } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defineHcmButton } from '../../../src/components/button.js';
import { defineHcmSegmentedButton } from '../../../src/components/segmented-button.js';
import { defineWorkerLocal } from '../../../src/admin/worker/hcm-worker-local.js';
import { starterUpdateCommand } from '../../../src/admin/worker/hcm-worker-versions.js';
import type { VersionsViewPort } from '../../../src/admin/worker/worker-port.js';
import { cleanup, fixture } from '../../helpers.js';
import { deep, deepText, updated } from '../shell/fake-app.js';
import { FakeLocal, linksOf } from './fake-local.js';

defineHcmButton();
defineHcmSegmentedButton();
defineWorkerLocal();

const DIGEST = `sha256:${'ab'.repeat(32)}`;
const MACHINE: WorkerMachine = {
    cpu: { cores: 16 },
    memory: { totalMb: 30_720, availableMb: 23_040 },
    power: { source: 'ac' },
    gpus: [],
    npus: [],
    backend: { matcher: 'cuda' },
    profile: { chosen: 'auto', active: 'full', why: 'idle' },
    budget: { threads: 14, memoryMb: 13_824, gpuFraction: 0.7 },
    usage: { cpuPct: 3, othersCpuPct: 10, memoryMb: 600 },
};
const CURRENT: VersionsViewPort = {
    said: true,
    image: DIGEST,
    imageCurrent: true,
    starter: WORKER_STARTER_VERSION,
    starterCurrent: true,
    update: 'current',
};

function t(locale: 'en' | 'ro', key: AdminWorkerLocalKey, params?: Readonly<Record<string, string>>): string {
    return translateAdminWorkerLocal(locale, key, params);
}

async function versionsShown(
    versions: VersionsViewPort,
    locale: 'en' | 'ro' = 'en',
    os: 'linux' | 'windows' = 'linux',
): Promise<LitElement> {
    const local = new FakeLocal();
    local.set({ os, files: linksOf(os), phase: 'connected', machine: { kind: 'known', machine: MACHINE, failed: false }, versions });
    const element = await fixture<LitElement>(
        html`<hcm-worker-local .local=${local} locale=${locale} project="demo-hcm" city="bucharest" image="sha256:x"></hcm-worker-local>`,
    );
    await updated(element);
    const card = deep(element, 'hcm-worker-machine') as LitElement;
    await updated(card);
    const shown = deep(card, 'hcm-worker-versions') as LitElement;
    await updated(shown);
    return shown;
}

describe('<hcm-worker-versions>', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        cleanup();
    });

    it.each(['en', 'ro'] as const)('happyPath_bothVersionsMatchTheInstalledRelease_%s @S-A142-HAPPY-VERSIONS', async (locale) => {
        const shown = await versionsShown(CURRENT, locale);

        const text = deepText(shown);
        expect(text).toContain(t(locale, 'adminWorkerLocal.versions.worker', { version: DIGEST.slice(0, 19) }));
        expect(text).toContain(t(locale, 'adminWorkerLocal.versions.starter', { version: WORKER_STARTER_VERSION }));
        expect(deep(shown, '[data-versions-worker]').getAttribute('data-versions-worker')).toBe('current');
        expect(deep(shown, '[data-versions-starter]').getAttribute('data-versions-starter')).toBe('current');
        expect(text).not.toContain(t(locale, 'adminWorkerLocal.versions.old'));
        expect(await axeViolations(shown)).toEqual([]);
    });

    it('badPath_anOldHelperSaysWhatWhyAndTheCommandWithCopy @S-A142-BAD-OLD-STARTER', async () => {
        const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
        const shown = await versionsShown({ ...CURRENT, starter: '2', starterCurrent: false, update: null });

        const alert = deep(shown, '[data-starter-old]');
        expect(alert.getAttribute('role')).toBe('alert');
        expect(alert.getAttribute('data-starter-old')).toBe('none');
        expect(deepText(alert)).toContain(t('en', 'adminWorkerLocal.versions.old'));
        expect(deepText(alert)).toContain(t('en', 'adminWorkerLocal.versions.why.first'));
        const command = starterUpdateCommand(linksOf('linux').install.url, 'linux');
        expect(deep(shown, 'pre').textContent).toBe(command);
        deep(shown, '[data-copy-update]').click();
        await vi.waitFor(() => {
            expect(write).toHaveBeenCalledWith(command);
        });
        await updated(shown);
        expect(deep(shown, '[data-copied="update"]').textContent).toBe(t('en', 'adminWorkerLocal.copied'));
        expect(await axeViolations(shown)).toEqual([]);
    });

    it.each([
        ['no-list', 'adminWorkerLocal.versions.why.no-list'],
        ['bad-sum', 'adminWorkerLocal.versions.why.bad-sum'],
        ['read-only', 'adminWorkerLocal.versions.why.read-only'],
        ['current', 'adminWorkerLocal.versions.why.later'],
        ['unchecked', 'adminWorkerLocal.versions.why.first'],
    ] as const)('badPath_theHelpersLastLookSaysWhy_%s @S-A142-BAD-OLD-STARTER', async (update, key) => {
        const shown = await versionsShown({ ...CURRENT, starter: 'aaaaaaaaaaaa', starterCurrent: false, update }, 'ro');

        expect(deepText(deep(shown, '[data-starter-old]'))).toContain(t('ro', key));
    });

    it('badPath_aRefusedCopySaysToSelectTheCommand @S-A142-BAD-OLD-STARTER', async () => {
        vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
        const shown = await versionsShown({ ...CURRENT, starter: '2', starterCurrent: false, update: 'no-file' }, 'en', 'windows');

        expect(deep(shown, 'pre').textContent).toContain('Invoke-WebRequest');
        expect(deepText(shown)).toContain(t('en', 'adminWorkerLocal.versions.where.windows'));
        deep(shown, '[data-copy-update]').click();
        await vi.waitFor(() => {
            expect(deep(shown, '[data-copied="update"]').textContent).toBe(t('en', 'adminWorkerLocal.copyFailed'));
        });
    });

    it('badPath_anOlderWorkerOrOneStartedByACommandSaysSoWithNoCommand @S-A142-BAD-OLD-STARTER', async () => {
        const byCommand = await versionsShown({ ...CURRENT, image: null, imageCurrent: false, starter: null, starterCurrent: false });
        expect(deepText(byCommand)).toContain(t('en', 'adminWorkerLocal.versions.byCommand'));
        expect(deepText(byCommand)).toContain(t('en', 'adminWorkerLocal.versions.workerOld'));
        expect(deepText(byCommand)).toContain(
            t('en', 'adminWorkerLocal.versions.worker', { version: t('en', 'adminWorkerLocal.versions.unknown') }),
        );
        expect(byCommand.shadowRoot?.querySelector('pre')).toBeNull();
        cleanup();

        const older = await versionsShown({ ...CURRENT, said: false });
        expect(deep(older, '[data-versions]').textContent).toBe(t('en', 'adminWorkerLocal.versions.notSaid'));
    });

    it('happyPath_theCommandOfEachSystem', () => {
        const url = 'https://x.test/worker-starter?city=b&os=linux&action=install';
        expect(starterUpdateCommand(url, 'linux')).toBe(`curl -fsSL '${url}' -o ~/hcm-worker.sh && sh ~/hcm-worker.sh`);
        expect(starterUpdateCommand(url, 'mac')).toBe(`curl -fsSL '${url}' -o ~/hcm-worker.command && sh ~/hcm-worker.command`);
        expect(starterUpdateCommand(url, 'windows')).toBe(
            `Invoke-WebRequest -UseBasicParsing '${url}' -OutFile "$env:TEMP\\hcm-worker.bat"; & "$env:TEMP\\hcm-worker.bat"`,
        );
    });

    it('happyPath_nothingBeforeTheWorkerAnswered', async () => {
        const local = new FakeLocal();
        local.set({ phase: 'connected', machine: { kind: 'unknown' } });
        const element = await fixture<LitElement>(
            html`<hcm-worker-local .local=${local} locale="en" project="demo-hcm" city="bucharest" image="sha256:x"></hcm-worker-local>`,
        );
        await updated(element);
        const card = deep(element, 'hcm-worker-machine') as LitElement;
        await updated(card);
        const shown = deep(card, 'hcm-worker-versions') as LitElement;
        await updated(shown);
        expect(shown.shadowRoot?.textContent.trim()).toBe('');
        local.set({ versions: CURRENT });
        await updated(shown);
        expect(deepText(shown)).toContain(t('en', 'adminWorkerLocal.versions.current'));
    });
});
