import { PROVISION_ITEMS, PROVISION_SET_VERSION, type ProvisionItem } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { createSetupContext, createSetupStore } from '../../src/setup/context.js';
import type { ProvisionItemResult, SetupCloud } from '../../src/setup/ports.js';
import { createProvisionFlow } from '../../src/setup/provision.js';
import { initialSetupState, withStep } from '../../src/setup/state.js';
import { access, createHarness, functionsError, googleError, provisionedItems, statusView } from './harness.js';

function setup(mode: 'bootstrap' | 'normal' = 'bootstrap') {
    const harness = createHarness();
    const base = ['signIn', 'billing'].reduce(
        (state, id) => withStep(state, id as 'signIn', { state: 'ok' }),
        initialSetupState(harness.host, mode),
    );
    const ctx = createSetupContext(harness.deps, createSetupStore({ ...base, openStep: 'provision' }));
    return { harness, ctx, flow: createProvisionFlow(ctx) };
}

/** A provisioner that reports `results` one by one, then answers them all. */
function reporting(results: readonly ProvisionItemResult[]): SetupCloud['provision'] {
    return (_access, _only, onItem) => {
        for (const result of results) {
            onItem(result);
        }
        return Promise.resolve(results);
    };
}

const ALL_OK: readonly ProvisionItemResult[] = PROVISION_ITEMS.map((id) => ({ id, state: id === 'scheduler' ? 'pending' : 'ok' }));

describe('provision: run', () => {
    it('happyPath_oneClickOneConsentProvisionsEveryItem', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.provision.mockImplementation(reporting(ALL_OK));

        await flow.run();

        expect(harness.google.requests).toEqual(['cloudPlatform']);
        expect(harness.cloud.provision).toHaveBeenCalledWith(harness.google.current, null, expect.any(Function));
        expect(ctx.state().steps.provision).toMatchObject({ state: 'ok', busy: false, used: { inputs: 1, consents: 1 } });
        expect(ctx.state().provision.items.find((item) => item.id === 'scheduler')?.state).toBe('pending');
        expect(ctx.state().openStep).toBe('deploy');
        expect(harness.backend.recordCloud).not.toHaveBeenCalled();
    });

    it('badPath_aFailedItemLeavesTheOthersAndRetryRunsOnlyWhatIsNotOk', async () => {
        const { harness, ctx, flow } = setup();
        const failed = ALL_OK.map((item) =>
            item.id === 'secrets' ? { id: item.id, state: 'unavailable' as const, detail: 'apiError.unavailable' as const } : item,
        );
        harness.cloud.provision.mockImplementationOnce(reporting(failed));

        await flow.run();
        expect(ctx.state().steps.provision.state).toBe('unavailable');
        expect(ctx.state().provision.items.find((item) => item.id === 'secrets')?.detail).toEqual({ key: 'apiError.unavailable' });

        harness.cloud.provision.mockImplementationOnce(
            reporting([
                { id: 'secrets', state: 'ok' },
                { id: 'scheduler', state: 'pending' },
            ]),
        );
        await flow.run();

        expect(harness.cloud.provision.mock.calls[1]?.[1]).toEqual<ProvisionItem[]>(['secrets', 'scheduler']);
        expect(ctx.state().steps.provision).toMatchObject({ state: 'ok', used: { inputs: 2, consents: 1 } });
    });

    it('badPath_aRecordFromBeforeAnItemExistedRetriesEveryItem', async () => {
        // Finding 2 of the M6 review: a map prepared before M6 has 15 items ok and Artifact Registry never reported;
        // running that item alone would never create the installer's account nor its roles (service-accounts, iam).
        const { harness, ctx, flow } = setup();
        const before = ALL_OK.filter((item) => item.id !== 'artifact-registry');
        ctx.update((state) => ({
            ...state,
            provision: {
                items: state.provision.items.map((item) =>
                    before.some((done) => done.id === item.id) ? { ...item, state: 'ok' as const } : item,
                ),
            },
        }));
        harness.cloud.provision.mockImplementation(reporting(ALL_OK));

        await flow.run();

        expect(harness.cloud.provision.mock.calls[0]?.[1]).toBeNull();
        expect(ctx.state().steps.provision.state).toBe('ok');
    });

    it('badPath_aTokenThatExpiresMidRunStopsWithContinue', async () => {
        const { harness, ctx, flow } = setup();
        harness.cloud.provision.mockImplementationOnce((_access, _only, onItem) => {
            onItem({ id: 'apis', state: 'ok' });
            return Promise.reject(googleError('unauthorized'));
        });

        await flow.run();

        expect(ctx.state().steps.provision).toMatchObject({
            busy: false,
            needsContinue: true,
            error: { key: 'adminShell.session.googleExpired' },
        });
        expect(harness.google.dropped).toBe(1);
        expect(ctx.state().provision.items[0]).toEqual({ id: 'apis', state: 'ok', detail: null });
    });

    it('badPath_aRunTheProvisionerStoppedAtA401OffersContinueAndDropsTheToken', async () => {
        const { harness, ctx, flow } = setup('normal');
        // The provisioner reports the refused item and the ones it did, then stops without throwing.
        harness.cloud.provision.mockImplementationOnce(
            reporting([
                { id: 'apis', state: 'ok' },
                { id: 'secrets', state: 'invalid', detail: 'adminShell.session.googleExpired' },
            ]),
        );

        await flow.run();

        expect(ctx.state().steps.provision).toMatchObject({
            busy: false,
            needsContinue: true,
            error: { key: 'adminShell.session.googleExpired' },
        });
        expect(harness.google.dropped).toBe(1);
        expect(harness.backend.recordCloud).toHaveBeenCalledTimes(1);
    });

    it('badPath_aClosedPopupRunsNothing', async () => {
        const { harness, flow } = setup();
        harness.google.answer = () => Promise.resolve(null);

        await flow.run();

        expect(harness.cloud.provision).not.toHaveBeenCalled();
    });
});

describe('provision: normal mode', () => {
    it('happyPath_reCheckRunsTheReadOnlyDoctorAndRecordsIt', async () => {
        const { harness, ctx, flow } = setup('normal');
        harness.cloud.doctor.mockImplementation((_access, _only, onItem) => {
            onItem({ id: 'apis', state: 'ok' });
            onItem({
                id: 'buckets',
                state: 'invalid',
                detail: 'adminSetup.provision.orgPolicy',
                params: { constraint: 'storage.publicAccessPrevention' },
            });
            onItem({ id: 'iam', state: 'invalid', detail: 'apiError.cloud.permission', params: { role: 'roles/owner' } });
            onItem({ id: 'secrets', state: 'unavailable', detail: 'apiError.unavailable' });
            return Promise.resolve([]);
        });
        harness.backend.recordCloud.mockResolvedValue({
            status: statusView({ provision: { state: 'ok', checkedAt: null, items: provisionedItems() } }),
        });

        await flow.recheck();

        expect(harness.cloud.doctor).toHaveBeenCalledWith(harness.google.current, null, expect.any(Function));
        expect(harness.backend.recordCloud).toHaveBeenCalledWith({
            provision: {
                items: [
                    { id: 'apis', state: 'ok' },
                    { id: 'iam', state: 'invalid', detail: 'apiError.cloud.permission', params: { role: 'roles/owner' } },
                    { id: 'buckets', state: 'invalid' },
                    { id: 'secrets', state: 'unavailable', detail: 'apiError.unavailable' },
                ],
            },
        });
        expect(ctx.state().steps.provision.state).toBe('ok');
    });

    it('badPath_aRecordThatFailsIsShown', async () => {
        const { harness, ctx, flow } = setup('normal');
        harness.cloud.provision.mockImplementation(reporting(ALL_OK));
        harness.backend.recordCloud.mockRejectedValue(functionsError('apiError.notAdmin'));

        await flow.run();

        expect(ctx.state().steps.provision.error).toEqual({ key: 'apiError.notAdmin' });
    });

    // M6 server-bugs: a Retry what failed clicked while the previous run's record was on its way lost to it (the server
    // applied the older run last), so the card stays busy until the record is back (S-A04-BAD-API-STILL-DISABLED).
    it('badPath_retryWaitsUntilTheRunIsRecorded', async () => {
        const { harness, ctx, flow } = setup('normal');
        harness.cloud.provision.mockImplementation(reporting(ALL_OK));
        const answers: ((value: { status: ReturnType<typeof statusView> }) => void)[] = [];
        harness.backend.recordCloud.mockReturnValue(
            new Promise((resolve) => {
                answers.push(resolve);
            }),
        );

        const running = flow.run();
        await expect.poll(() => harness.backend.recordCloud.mock.calls.length).toBe(1);
        expect(ctx.state().steps.provision).toMatchObject({ state: 'ok', busy: true });

        answers.forEach((answer) => {
            answer({ status: statusView({ provision: { state: 'ok', checkedAt: null, items: provisionedItems() } }) });
        });
        await running;
        expect(ctx.state().steps.provision).toMatchObject({ state: 'ok', busy: false });
    });

    it('badPath_nothingReportedIsNotRecorded', async () => {
        const { harness, flow } = setup('normal');

        await flow.recheck();

        expect(harness.backend.recordCloud).not.toHaveBeenCalled();
    });
});

/** Normal mode with step c recorded done (every item, the scheduler waiting for the deploy), checked at `CHECKED_AT`. */
const CHECKED_AT = '2026-10-31T12:05:00.000Z';

function recordedDone() {
    const world = setup('normal');
    world.ctx.applyStatus(statusView({ provision: { state: 'ok', checkedAt: CHECKED_AT, items: provisionedItems() } }));
    return world;
}

// Finding 34 of 2026-11-01 (docs/research/manual-test-2026-10-25.md): Re-check never downgrades step c without a Google
// token, and with one the server's record follows what the doctor found, an item gone back to missing included.
/** The items an update runs on a project prepared before M7 (no set version): every one changed since set version 1. */
const DUE_SINCE_M6: readonly ProvisionItem[] = [
    'apis',
    'iam',
    'artifact-registry',
    'bucket-cors',
    'bucket-lifecycle',
    'app-check',
    'api-key',
    'admin-site',
];

describe('provision: an update applies the items that changed (finding 65 of 2026-11-02)', () => {
    /** A project prepared before M7 (no set version recorded), every item ok. */
    function prepared(setVersion?: number) {
        const world = setup('normal');
        world.ctx.update((state) => ({
            ...state,
            provision: {
                items: state.provision.items.map((item) => ({ ...item, state: 'ok' as const })),
                ...(setVersion === undefined ? {} : { setVersion }),
            },
        }));
        return world;
    }

    it('happyPath_theChangedItemsRunWithTheUpdatesTokenAndTheVersionIsRecorded @S-A04-HAPPY-UPDATE-PROVISION', async () => {
        const { harness, ctx, flow } = prepared();
        harness.cloud.provision.mockImplementation(reporting(DUE_SINCE_M6.map((id) => ({ id, state: 'ok' as const }))));
        harness.backend.recordCloud.mockResolvedValue({
            status: statusView({
                provision: { state: 'ok', checkedAt: null, items: provisionedItems(), setVersion: PROVISION_SET_VERSION },
            }),
        });

        await flow.update(access(Date.now(), 'cloudPlatform'));

        // Set version 2 (M7) changed artifact-registry and bucket-lifecycle; 3 (finding 74) iam's run.viewer for fn-admin@;
        // 4 (§203) the apis item's GA4 Data API; 5 (§210) the admin's own site and the allow-lists that name it.
        expect(harness.cloud.provision.mock.calls[0]?.[1]).toEqual<ProvisionItem[]>([...DUE_SINCE_M6]);
        expect(harness.google.requests).toEqual([]);
        expect(harness.backend.recordCloud).toHaveBeenCalledWith({
            provision: {
                items: DUE_SINCE_M6.map((id) => ({ id, state: 'ok' })),
                setVersion: PROVISION_SET_VERSION,
            },
        });
        expect(ctx.state().provision.setVersion).toBe(PROVISION_SET_VERSION);
        expect(ctx.state().install.provisionDue).toEqual([]);
    });

    it('happyPath_theRecordWaitsForTheServerTheSameUpdateInstalls @S-A04-HAPPY-UPDATE-PROVISION-RECORD', async () => {
        // Finding 71 of 2026-11-02: the items ran, but the server before the update refused the record naming the version.
        const { harness, ctx, flow } = prepared();
        harness.cloud.provision.mockImplementation(reporting(DUE_SINCE_M6.map((id) => ({ id, state: 'ok' as const }))));
        harness.backend.recordCloud.mockResolvedValue({ status: statusView() });
        let serverInstalled: () => void = () => undefined;
        const recordAfter = new Promise<void>((resolve) => {
            serverInstalled = resolve;
        });

        const updating = flow.update(access(Date.now(), 'cloudPlatform'), recordAfter);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(harness.cloud.provision).toHaveBeenCalledTimes(1);
        expect(harness.backend.recordCloud).not.toHaveBeenCalled();
        expect(ctx.state().steps.provision.busy).toBe(true);
        serverInstalled();
        await updating;
        expect(harness.backend.recordCloud.mock.calls[0]?.[0]).toMatchObject({ provision: { setVersion: PROVISION_SET_VERSION } });
        expect(ctx.state().steps.provision.busy).toBe(false);
    });

    it('badPath_anItemThatFailsLeavesTheVersionUnrecorded @S-A04-BAD-UPDATE-PROVISION', async () => {
        const { harness, ctx, flow } = prepared();
        harness.cloud.provision.mockImplementation(
            reporting([
                { id: 'artifact-registry', state: 'invalid', detail: 'adminSetup.provision.orgPolicy', params: { constraint: 'x' } },
                { id: 'bucket-lifecycle', state: 'ok' },
            ]),
        );
        harness.backend.recordCloud.mockResolvedValue({ status: statusView() });

        await flow.update(access(Date.now(), 'cloudPlatform'));

        expect(harness.backend.recordCloud.mock.calls[0]?.[0]).not.toHaveProperty('provision.setVersion');
        expect(ctx.state().steps.provision.busy).toBe(false);
    });

    it('happyPath_aProjectAtM7sVersionRunsTheApisIamAndAdminSiteItems', async () => {
        const { harness, flow } = prepared(2);
        harness.cloud.provision.mockImplementation(reporting([{ id: 'iam', state: 'ok' }]));
        harness.backend.recordCloud.mockResolvedValue({ status: statusView() });

        await flow.update(access(Date.now(), 'cloudPlatform'));

        expect(harness.cloud.provision.mock.calls[0]?.[1]).toEqual<ProvisionItem[]>([
            'apis',
            'iam',
            'bucket-cors',
            'app-check',
            'api-key',
            'admin-site',
        ]);
    });

    it('happyPath_aProjectAtVersion3RunsTheApisAndAdminSiteItems', async () => {
        const { harness, flow } = prepared(3);
        harness.cloud.provision.mockImplementation(reporting([{ id: 'apis', state: 'ok' }]));
        harness.backend.recordCloud.mockResolvedValue({ status: statusView() });

        await flow.update(access(Date.now(), 'cloudPlatform'));

        expect(harness.cloud.provision.mock.calls[0]?.[1]).toEqual<ProvisionItem[]>([
            'apis',
            'bucket-cors',
            'app-check',
            'api-key',
            'admin-site',
        ]);
    });

    it.each([
        ['a project at the current version', PROVISION_SET_VERSION],
        ['a project never prepared', undefined],
    ])('badPath_%sRunsNothing', async (name, setVersion) => {
        const world = name.includes('never') ? setup('normal') : prepared(setVersion);

        await world.flow.update(access(Date.now(), 'cloudPlatform'));

        expect(world.harness.cloud.provision).not.toHaveBeenCalled();
    });
});

describe('provision: Re-check and the record', () => {
    it('badPath_withoutAGoogleTokenTheRecordedStateStaysAndSaysWhenItWasLastChecked', async () => {
        const { harness, ctx, flow } = recordedDone();
        harness.google.answer = () => Promise.resolve(null);

        await flow.recheck();

        expect(ctx.state().steps.provision).toMatchObject({
            state: 'ok',
            busy: false,
            checkedAt: CHECKED_AT,
            error: { key: 'adminSetup.provision.lastChecked', params: { time: CHECKED_AT } },
        });
        expect(harness.cloud.doctor).not.toHaveBeenCalled();
        expect(harness.backend.recordCloud).not.toHaveBeenCalled();
    });

    it('badPath_anotherRefusalKeepsItsOwnReason_andAStepNeverCheckedSaysThePopupClosed', async () => {
        const { harness, ctx, flow } = setup('normal');
        harness.google.answer = () => Promise.resolve(null);

        await flow.recheck();

        expect(ctx.state().steps.provision.error).toEqual({ key: 'adminShell.oauth.popupClosed' });
        harness.google.answer = () => Promise.reject(Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' }));
        await flow.recheck();
        expect(ctx.state().steps.provision.error?.key).not.toBe('adminSetup.provision.lastChecked');
    });

    it('happyPath_anItemThatWentBackToMissingIsRecordedSo', async () => {
        const { harness, ctx, flow } = recordedDone();
        harness.cloud.doctor.mockImplementation((_access, _only, onItem) => {
            onItem({ id: 'apis', state: 'ok' });
            onItem({ id: 'secrets', state: 'missing' });
            return Promise.resolve([]);
        });
        const missing = provisionedItems().map((item) => (item.id === 'secrets' ? { id: item.id, state: 'missing' as const } : item));
        harness.backend.recordCloud.mockResolvedValue({
            status: statusView({ provision: { state: 'missing', checkedAt: '2026-10-31T13:00:00.000Z', items: missing } }),
        });

        await flow.recheck();

        expect(harness.backend.recordCloud).toHaveBeenCalledWith({
            provision: {
                items: [
                    { id: 'apis', state: 'ok' },
                    { id: 'secrets', state: 'missing' },
                ],
            },
        });
        expect(ctx.state().steps.provision.state).toBe('missing');
        expect(ctx.state().provision.items.find((item) => item.id === 'secrets')?.state).toBe('missing');
    });

    it('badPath_aTokenRefusedDuringTheCheckLeavesTheRowsAndRecordsOnlyWhatWasChecked', async () => {
        const { harness, ctx, flow } = recordedDone();
        harness.cloud.doctor.mockImplementation((_access, _only, onItem) => {
            onItem({ id: 'apis', state: 'ok' });
            onItem({ id: 'service-accounts', state: 'invalid', detail: 'adminShell.session.googleExpired' });
            return Promise.resolve([]);
        });
        harness.backend.recordCloud.mockResolvedValue({
            status: statusView({ provision: { state: 'ok', checkedAt: CHECKED_AT, items: provisionedItems() } }),
        });

        await flow.recheck();

        expect(harness.backend.recordCloud).toHaveBeenCalledWith({ provision: { items: [{ id: 'apis', state: 'ok' }] } });
        expect(ctx.state().provision.items.find((item) => item.id === 'service-accounts')?.state).toBe('ok');
        expect(ctx.state().steps.provision).toMatchObject({
            state: 'ok',
            needsContinue: true,
            error: { key: 'adminShell.session.googleExpired' },
        });
    });
});

describe('provision: the scheduler after the deployment', () => {
    it('happyPath_theLiveTokenChecksTheSchedulerWithoutAClick', async () => {
        const { harness, ctx, flow } = setup();
        harness.google.grant('cloudPlatform');
        harness.cloud.doctor.mockImplementation((_access, _only, onItem) => {
            onItem({ id: 'scheduler', state: 'ok' });
            return Promise.resolve([]);
        });

        await flow.checkScheduler();

        expect(harness.cloud.doctor).toHaveBeenCalledWith(harness.google.current, ['scheduler'], expect.any(Function));
        expect(ctx.state().provision.items.find((item) => item.id === 'scheduler')?.state).toBe('ok');
        expect(harness.google.requests).toEqual([]);
    });

    it('badPath_withoutATokenTheSchedulerWaitsForTheNextCheck', async () => {
        const { harness, flow } = setup();

        await flow.checkScheduler();

        expect(harness.cloud.doctor).not.toHaveBeenCalled();
    });

    it('badPath_aFailedSchedulerCheckIsLoggedOnly', async () => {
        const { harness, ctx, flow } = setup();
        harness.google.grant('cloudPlatform');
        harness.cloud.doctor.mockRejectedValue(googleError('unavailable'));

        await flow.checkScheduler();

        expect(ctx.state().steps.provision.error).toBeNull();
        expect(harness.logs.records.at(-1)).toMatchObject({ level: 'warn', message: 'scheduler not checked' });
    });
});
