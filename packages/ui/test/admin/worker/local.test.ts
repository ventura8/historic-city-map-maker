// `<hcm-worker-local>` (finding 72 of 2026-11-02; finding 73 of 2026-11-03: the starter files are links the server answers
// as downloads): Use this computer, then where the file is and how to run it, the auto-pair's progress in a polite region,
// Stop using this computer, and the command behind Advanced.
import { axeViolations } from '@hcm/test-support/axe';
import { translateAdminWorkerLocal, type AdminWorkerLocalKey } from '@hcm/shared/admin-worker-local';
import { html, type LitElement } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defineHcmButton } from '../../../src/components/button.js';
import { defineHcmSegmentedButton } from '../../../src/components/segmented-button.js';
import {
    defineWorkerLocal,
    GET_DOCKER_URL,
    LINUX_RUN_LINE,
    WORKER_PAGE,
    workerCommand,
} from '../../../src/admin/worker/hcm-worker-local.js';
import { cleanup, fixture } from '../../helpers.js';
import { deep, deepAll, deepText, updated } from '../shell/fake-app.js';
import { FakeLocal, linksOf } from './fake-local.js';

defineHcmButton();
defineHcmSegmentedButton();
defineWorkerLocal();
defineWorkerLocal();

const DIGEST = `sha256:${'b'.repeat(64)}`;
const CODE = 'abcdefghijklmnopqrstuvwxyz';

function t(key: AdminWorkerLocalKey): string {
    return translateAdminWorkerLocal('en', key);
}

async function shown(local: FakeLocal | null): Promise<LitElement> {
    const element = await fixture<LitElement>(
        html`<hcm-worker-local .local=${local} locale="en" project="demo-hcm" city="bucharest" image=${DIGEST}></hcm-worker-local>`,
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

function status(element: Element): string {
    return deep(element, 'p[data-local]').textContent;
}

describe('<hcm-worker-local>', () => {
    afterEach(cleanup);

    it('happyPath_useThisComputerIsADownloadLinkThenWhereTheFileIsAndHowToRunItThenTheAutoPair @S-A62-HAPPY-STARTER', async () => {
        const local = new FakeLocal();
        const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
        const element = await shown(local);
        const link = deep(element, 'a[data-starter="hcm-worker.sh"]') as HTMLAnchorElement;
        // Finding 73: an ordinary link the owner clicks; the server answers the file as a download.
        link.addEventListener('click', (event) => {
            event.preventDefault();
        });

        expect(link.href).toBe(linksOf('linux').install.url);
        expect(link.download).toBe('hcm-worker.sh');
        expect(link.textContent.trim()).toBe(t('adminWorkerLocal.use'));
        expect(status(element)).toBe('');
        link.click();
        expect(local.calls).toContain('use');
        local.set({ phase: 'downloaded' });
        await updated(element);
        expect(status(element)).toBe(t('adminWorkerLocal.saved'));
        expect(deep(element, `a[href="${GET_DOCKER_URL}"]`).textContent).toBe(t('adminWorkerLocal.getDocker'));
        expect(deep(element, 'p[data-open="linux"]').textContent).toBe(t('adminWorkerLocal.open.linux'));
        expect(deep(element, 'pre').textContent).toBe(LINUX_RUN_LINE);
        button(element, t('adminWorkerLocal.copyRun')).click();
        await vi.waitFor(() => {
            expect(write).toHaveBeenCalledWith('sh ~/Downloads/hcm-worker.sh');
        });
        await updated(element);
        expect(deep(element, 'p[data-copied="run"]').textContent).toBe(t('adminWorkerLocal.copied'));
        expect(await axeViolations(element)).toEqual([]);
        local.set({ phase: 'connecting' });
        await updated(element);
        expect(status(element)).toBe(t('adminWorkerLocal.connecting'));
        expect(deepAll(element, 'p[data-open]')).toEqual([]);
        local.set({ phase: 'connected' });
        await updated(element);
        expect(status(element)).toBe(t('adminWorkerLocal.connected'));
        expect(deep(element, 'p[data-local]').getAttribute('role')).toBe('status');
        expect(await axeViolations(element)).toEqual([]);
        write.mockRestore();
    });

    it('happyPath_aComputerSetUpAnotherWayIsLookedForWithNoFile @S-A62-HAPPY-FIND-COMPUTER', async () => {
        const local = new FakeLocal();
        const element = await shown(local);

        button(element, t('adminWorkerLocal.find')).click();
        await updated(element);

        expect(local.calls).toContain('find');
        expect(status(element)).toBe(t('adminWorkerLocal.looking'));
        expect(deepAll(element, 'hcm-button[data-find]')).toEqual([]);
    });

    it('badPath_noHintToGetDockerNorToLookOnceThisComputersWorkerAnswers', async () => {
        const local = new FakeLocal();
        const element = await shown(local);
        expect(deepText(element)).toContain(t('adminWorkerLocal.noDocker'));

        local.set({ phase: 'connected' });
        await updated(element);

        expect(deepText(element)).not.toContain(t('adminWorkerLocal.noDocker'));
        expect(deepAll(element, 'hcm-button[data-find]')).toEqual([]);
    });

    it('happyPath_theSystemIsChosenAndTheWindowsCommandIsPowerShells', async () => {
        const local = new FakeLocal();
        const element = await shown(local);
        const systems = deepAll(deep(element, 'hcm-segmented-button'), 'button');

        expect(systems.map((system) => system.textContent.trim())).toEqual(['Linux', 'macOS', 'Windows']);
        systems[2]?.click();
        await updated(element);
        expect(local.calls).toContain('setOs windows');
        expect(deep(element, 'pre').textContent).toBe(
            workerCommand({ project: 'demo-hcm', city: 'bucharest', digest: DIGEST, code: null, os: 'windows' }),
        );
        expect(deep(element, 'pre').textContent.startsWith('docker rm -f hcm-worker 2>&1 | Out-Null; docker run -d')).toBe(true);
    });

    it('happyPath_advancedMintsTheCommandsCodeAndCopyPutsItOnTheClipboard @S-A62-HAPPY-PANEL', async () => {
        const local = new FakeLocal();
        const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
        const element = await shown(local);
        const details = deep(element, 'details') as HTMLDetailsElement;

        details.open = true;
        await vi.waitFor(() => {
            expect(local.calls).toContain('command');
        });
        await updated(element);
        // Finding 66: one line, nothing to prepare (a named volume), detached, restarted with the computer, replacing an
        // older worker; finding 67: the pairing code signs it in.
        const command =
            'docker rm -f hcm-worker 2>&1 | true; docker run -d --name hcm-worker --restart unless-stopped ' +
            `-p 127.0.0.1:8765:8765 -v hcm-worker:/work us-central1-docker.pkg.dev/demo-hcm/hcm/pipeline@${DIGEST} ` +
            `worker --city bucharest --project demo-hcm --pair ${CODE}`;
        expect(deep(element, 'pre').textContent).toBe(command);
        expect(deep(element, `a[href="${WORKER_PAGE}"]`).getAttribute('rel')).toBe('noopener noreferrer');
        button(element, t('adminWorkerLocal.copy')).click();
        await updated(element);
        expect(write).toHaveBeenCalledWith(command);
        expect(deepText(element)).toContain(t('adminWorkerLocal.copied'));

        write.mockRejectedValue(new Error('denied'));
        button(element, t('adminWorkerLocal.copy')).click();
        await updated(element);
        expect(deepText(element)).toContain(t('adminWorkerLocal.copyFailed'));
        // Closed and opened again with a code already: none is minted again.
        details.open = false;
        await updated(element);
        details.open = true;
        await updated(element);
        expect(local.calls.filter((call) => call === 'command')).toHaveLength(1);
        write.mockRestore();
    });

    it('badPath_withoutItsPartNothingShowsAndALeavingElementListensNoMore', async () => {
        expect(deepText(await shown(null))).toBe('');

        const local = new FakeLocal();
        const element = await shown(local);
        element.remove();
        local.set({ phase: 'connected' });
        expect(deepText(element)).not.toContain(t('adminWorkerLocal.connected'));
    });
});

describe("<hcm-worker-local>: the starter files' links (finding 73 of 2026-11-03)", () => {
    afterEach(cleanup);

    it('happyPath_onMacAndWindowsTheFileIsOpenedFromDownloadsWithNoLineToCopy', async () => {
        const local = new FakeLocal();
        local.set({ os: 'windows', files: linksOf('windows'), phase: 'downloaded' });
        const element = await shown(local);

        expect((deep(element, 'a[data-starter="hcm-worker.bat"]') as HTMLAnchorElement).href).toBe(linksOf('windows').install.url);
        expect(deep(element, 'p[data-open="windows"]').textContent).toBe(t('adminWorkerLocal.open.windows'));
        expect(deepAll(element, 'p[data-copied="run"]')).toEqual([]);
    });

    it('happyPath_stopUsingIsTheRemovalFilesLinkAndSaysWhatToDo @S-A62-HAPPY-STOP-COMPUTER', async () => {
        const local = new FakeLocal();
        const element = await shown(local);
        const link = deep(element, 'a[data-starter="hcm-worker-remove.sh"]') as HTMLAnchorElement;
        link.addEventListener('click', (event) => {
            event.preventDefault();
        });

        expect(link.href).toBe(linksOf('linux').uninstall.url);
        expect(link.textContent.trim()).toBe(t('adminWorkerLocal.stop'));
        link.click();
        await vi.waitFor(() => {
            expect(local.calls).toContain('stopUsing');
        });
        local.set({ phase: 'stopped' });
        await updated(element);
        expect(status(element)).toBe(t('adminWorkerLocal.stopped'));
    });

    it('badPath_aServerThatMakesNoFileGivesNoLinkAndSaysToUpdateTheMap @S-A62-BAD-STARTER-TEMPLATE', async () => {
        const local = new FakeLocal();
        local.set({ starter: false });
        const element = await shown(local);

        expect(deepAll(element, 'a[data-starter]')).toEqual([]);
        expect(deep(element, 'p[data-starter-missing]').textContent).toBe(t('adminWorkerLocal.failed'));
        expect(deep(element, 'p[data-starter-missing]').getAttribute('role')).toBe('alert');
        expect(deep(element, 'details summary').textContent).toBe(t('adminWorkerLocal.advanced'));
    });
});
