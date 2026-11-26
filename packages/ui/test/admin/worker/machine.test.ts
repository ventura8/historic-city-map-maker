// `<hcm-worker-machine>` (M26, `docs/research/M26-governor.md` §6): "This computer" under the connected computer, its
// size, the owner's profile, the profile in force and why, the budget and where the local AI runs; a worker older than
// the governor asks to be updated.
import type { WorkerMachine } from '@hcm/shared';
import { translateAdminWorkerLocal, type AdminWorkerLocalKey } from '@hcm/shared/admin-worker-local';
import { axeViolations } from '@hcm/test-support/axe';
import { html, type LitElement } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import { defineHcmButton } from '../../../src/components/button.js';
import { defineHcmSegmentedButton } from '../../../src/components/segmented-button.js';
import { defineWorkerLocal } from '../../../src/admin/worker/hcm-worker-local.js';
import { defineWorkerMachine, NVIDIA_DRIVERS_URL } from '../../../src/admin/worker/hcm-worker-machine.js';
import { cleanup, fixture } from '../../helpers.js';
import { deep, deepAll, deepText, updated } from '../shell/fake-app.js';
import { FakeLocal } from './fake-local.js';

defineHcmButton();
defineHcmSegmentedButton();
defineWorkerLocal();
defineWorkerMachine();

const LAPTOP: WorkerMachine = {
    cpu: { cores: 16 },
    memory: { totalMb: 30_720, availableMb: 23_040 },
    power: { source: 'ac' },
    gpus: [{ vendor: 'nvidia', name: 'RTX 3080', vramMb: 8192, via: 'cuda' }],
    npus: [],
    backend: { matcher: 'cuda' },
    profile: { chosen: 'auto', active: 'full', why: 'idle' },
    budget: { threads: 14, memoryMb: 13_824, gpuFraction: 0.7 },
    usage: { cpuPct: 3, othersCpuPct: 10, memoryMb: 600 },
};

function t(locale: 'en' | 'ro', key: AdminWorkerLocalKey, params?: Readonly<Record<string, string>>): string {
    return translateAdminWorkerLocal(locale, key, params);
}

async function shown(local: FakeLocal, locale: 'en' | 'ro' = 'en'): Promise<LitElement> {
    const element = await fixture<LitElement>(
        html`<hcm-worker-local .local=${local} locale=${locale} project="demo-hcm" city="bucharest" image="sha256:x"></hcm-worker-local>`,
    );
    await updated(element);
    return element;
}

function card(element: LitElement): LitElement {
    return deep(element, 'hcm-worker-machine') as LitElement;
}

describe('<hcm-worker-machine>', () => {
    afterEach(cleanup);

    it('happyPath_theConnectedComputerSaysItsSizeItsProfileAndTheOwnerChoosesQuiet @S-A141-HAPPY', async () => {
        const local = new FakeLocal();
        local.set({ phase: 'connected', machine: { kind: 'known', machine: LAPTOP, failed: false } });
        const element = await shown(local);
        const machine = card(element);
        await updated(machine);

        expect(deepText(machine)).toContain(t('en', 'adminWorkerLocal.machine.size', { cores: '16', memory: '30' }));
        expect(deepText(machine)).toContain(t('en', 'adminWorkerLocal.machine.active.full', { threads: '14', memory: '14' }));
        expect(deepText(machine)).toContain(t('en', 'adminWorkerLocal.machine.matcher.cuda'));
        expect(deep(machine, '[data-machine]').getAttribute('role')).toBe('status');
        const choices = deepAll(deep(machine, 'hcm-segmented-button'), 'button');
        expect(choices.map((choice) => choice.textContent.trim())).toEqual(['Automatic', 'Quiet', 'Full']);
        choices[1]?.click();
        await updated(machine);
        expect(local.calls).toContain('profile quiet');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_inRomanianQuietOnBatteryWithNoReachableCard', async () => {
        const local = new FakeLocal();
        const machine: WorkerMachine = {
            ...LAPTOP,
            gpus: [],
            backend: { matcher: 'cpu', why: 'no-gpu' },
            profile: { chosen: 'auto', active: 'quiet', why: 'battery' },
            budget: { threads: 4, memoryMb: 2048, gpuFraction: 0.4 },
        };
        local.set({ phase: 'connected', machine: { kind: 'known', machine, failed: true } });
        const element = await shown(local, 'ro');
        const text = deepText(card(element));

        expect(text).toContain(t('ro', 'adminWorkerLocal.machine.active.quiet', { threads: '4', memory: '2.0' }));
        expect(text).toContain(t('ro', 'adminWorkerLocal.machine.why.battery'));
        expect(text).toContain(t('ro', 'adminWorkerLocal.machine.noGpu'));
        expect(text).toContain(t('ro', 'adminWorkerLocal.machine.failed'));
    });

    it('badPath_anNvidiaCardWithoutItsDriverSaysWhatToInstallAndWhere @S-A141-BAD-NO-DRIVER', async () => {
        const local = new FakeLocal();
        const machine: WorkerMachine = {
            ...LAPTOP,
            gpus: [{ vendor: 'nvidia', name: 'GA104M [GeForce RTX 3080 Mobile]', vramMb: 0, via: null, why: 'no-driver' }],
            backend: { matcher: 'cpu', why: 'no-gpu' },
        };
        local.set({ phase: 'connected', machine: { kind: 'known', machine, failed: false } });
        for (const locale of ['en', 'ro'] as const) {
            const element = await shown(local, locale);
            const text = deepText(card(element));

            expect(text).toContain(t(locale, 'adminWorkerLocal.machine.noDriver'));
            const link = deep(card(element), 'a.external') as HTMLAnchorElement;
            expect(link.href).toBe(NVIDIA_DRIVERS_URL);
            expect(link.textContent.trim()).toBe(t(locale, 'adminWorkerLocal.machine.getDriver'));
            expect(await axeViolations(element)).toEqual([]);
            cleanup();
        }
    });

    it('happyPath_aCardWithItsDriverHasNoDriverLine', async () => {
        const local = new FakeLocal();
        local.set({ phase: 'connected', machine: { kind: 'known', machine: LAPTOP, failed: false } });
        const element = await shown(local);

        expect(deepText(card(element))).not.toContain(t('en', 'adminWorkerLocal.machine.noDriver'));
    });

    it('badPath_anOlderWorkerAsksToBeUpdatedAndNothingShowsBeforeTheComputerIsConnected @S-A141-BAD-OLD-WORKER', async () => {
        const local = new FakeLocal();
        const element = await shown(local);
        expect(deepAll(element, 'hcm-worker-machine')).toEqual([]);

        local.set({ phase: 'connected', machine: { kind: 'old' } });
        await updated(element);
        const machine = card(element);
        await updated(machine);
        expect(deepText(machine)).toContain(t('en', 'adminWorkerLocal.machine.old'));
        expect(deepAll(machine, 'hcm-segmented-button')).toEqual([]);
        local.set({ machine: { kind: 'unknown' } });
        await updated(machine);
        expect(deepText(machine)).toContain(t('en', 'adminWorkerLocal.machine.unknown'));
    });

    it('badPath_pausedTheLocalAiIsOffAndAWorkerlessCardShowsUnknown', async () => {
        const local = new FakeLocal();
        const paused: WorkerMachine = {
            ...LAPTOP,
            backend: { matcher: 'off', why: 'paused' },
            profile: { chosen: 'full', active: 'paused', why: 'battery' },
            budget: { threads: 0, memoryMb: 0, gpuFraction: 0 },
        };
        local.set({ phase: 'connected', machine: { kind: 'known', machine: paused, failed: false } });
        const element = await shown(local);
        expect(deepText(card(element))).toContain(t('en', 'adminWorkerLocal.machine.matcher.off'));

        const alone = await fixture<LitElement>(html`<hcm-worker-machine></hcm-worker-machine>`);
        expect(deepText(alone)).toContain(t('ro', 'adminWorkerLocal.machine.unknown'));
        alone.remove();
    });
});
