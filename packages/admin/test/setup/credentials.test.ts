// Steps (e) Mapbox and (f) USGS: the pasted secrets reach their callable once and nothing else.
import { MAPBOX_TOKENS, USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { createSetupContext, createSetupStore } from '../../src/setup/context.js';
import { createMapboxFlow } from '../../src/setup/mapbox.js';
import { initialSetupState } from '../../src/setup/state.js';
import { createUsgsFlow } from '../../src/setup/usgs.js';
import { START, createHarness, functionsError, statusView } from './harness.js';

const CHECKED = '2026-10-12T09:00:00.000Z';
const MINTED = { tokenId: 'cl0000000000000000000000a', allowedUrls: ['https://ventura8.github.io'] };

function setup() {
    const harness = createHarness();
    const ctx = createSetupContext(harness.deps, createSetupStore(initialSetupState(harness.host, 'normal')));
    return { harness, ctx, mapbox: createMapboxFlow(ctx), usgs: createUsgsFlow(ctx) };
}

describe('mapbox', () => {
    it('happyPath_aSecretTokenIsSavedOnceAndTheCardTurnsGreen', async () => {
        const { harness, ctx, mapbox } = setup();
        harness.backend.saveMapbox.mockResolvedValue({
            mapbox: { state: 'ok', checkedAt: CHECKED, user: 'e2e-mapbox' },
            viewer: MINTED,
            admin: MINTED,
        });

        await mapbox.save(` ${MAPBOX_TOKENS.bootstrap} `);

        expect(harness.backend.saveMapbox).toHaveBeenCalledWith({ cityId: 'bucharest', secretToken: MAPBOX_TOKENS.bootstrap });
        expect(ctx.state().steps.mapbox).toMatchObject({ state: 'ok', busy: false, detail: null, used: { inputs: 1, consents: 0 } });
        expect(ctx.state().mapbox.user).toBe('e2e-mapbox');
        expect(JSON.stringify(ctx.state())).not.toContain(MAPBOX_TOKENS.bootstrap);
        expect(JSON.stringify(harness.logs.records)).not.toContain(MAPBOX_TOKENS.bootstrap);
    });

    it('happyPath_aPublicTokenIsReplacedAndTheCardSaysWhenTheOldOneGoes', async () => {
        const { harness, ctx, mapbox } = setup();
        harness.backend.rotatePublicToken.mockResolvedValue({
            tokenId: 'cl0000000000000000000000b',
            retiresOldAt: '2026-10-12T09:10:00.000Z',
            manifestQueued: true,
        });

        const rotating = mapbox.rotate('viewer');
        const busy = ctx.state().mapbox.rotation.busy;
        await mapbox.rotate('admin');
        await rotating;

        expect(busy).toBe(true);
        expect(harness.backend.rotatePublicToken).toHaveBeenCalledTimes(1);
        expect(harness.backend.rotatePublicToken).toHaveBeenCalledWith({ cityId: 'bucharest', audience: 'viewer' });
        expect(ctx.state().mapbox.rotation).toEqual({
            audience: 'viewer',
            busy: false,
            retiresOldAt: '2026-10-12T09:10:00.000Z',
            done: true,
            error: null,
        });
        // A replacement is a daily action, not one of the Setup step's counted inputs.
        expect(ctx.state().steps.mapbox.used.inputs).toBe(0);
    });

    it('badPath_aRefusedReplacementSaysWhy', async () => {
        const { harness, ctx, mapbox } = setup();
        harness.backend.rotatePublicToken.mockRejectedValue(functionsError('apiError.mapbox.notConfigured'));

        await mapbox.rotate('admin');

        expect(ctx.state().mapbox.rotation).toEqual({
            audience: 'admin',
            busy: false,
            retiresOldAt: null,
            done: false,
            error: { key: 'apiError.mapbox.notConfigured' },
        });
    });

    it('badPath_aPublicTokenIsExplainedBeforeAnyCall', async () => {
        const { harness, ctx, mapbox } = setup();

        await mapbox.save(MAPBOX_TOKENS.defaultPublic);
        expect(ctx.state().steps.mapbox.error).toEqual({ key: 'apiError.mapbox.publicToken' });

        await mapbox.save('not a token');
        expect(ctx.state().steps.mapbox.error).toEqual({ key: 'apiError.mapbox.tokenFormat' });
        expect(harness.backend.saveMapbox).not.toHaveBeenCalled();
    });

    it('badPath_aRefusedTokenSaysWhyAndKeepsTheCard', async () => {
        const { harness, ctx, mapbox } = setup();
        harness.backend.saveMapbox.mockRejectedValue(functionsError('apiError.mapbox.missingScopes', { scopes: 'tokens:write' }));

        await mapbox.save(MAPBOX_TOKENS.missingScopes);

        expect(ctx.state().steps.mapbox).toMatchObject({
            state: 'missing',
            busy: false,
            error: { key: 'apiError.mapbox.missingScopes', params: { scopes: 'tokens:write' } },
        });
    });

    it('badPath_aRevokedTokenTurnsTheChipToWhatTheServerRecorded', async () => {
        const { harness, ctx, mapbox } = setup();
        harness.backend.saveMapbox.mockRejectedValue(functionsError('apiError.mapbox.tokenInvalid'));
        harness.backend.status.mockResolvedValue(
            statusView({ mapbox: { state: 'invalid', checkedAt: CHECKED, detail: 'apiError.mapbox.tokenInvalid' } }),
        );

        await mapbox.save(MAPBOX_TOKENS.revoked);

        expect(harness.backend.status).toHaveBeenCalledTimes(1);
        expect(ctx.state().steps.mapbox).toMatchObject({
            state: 'invalid',
            busy: false,
            error: { key: 'apiError.mapbox.tokenInvalid' },
            detail: { key: 'apiError.mapbox.tokenInvalid' },
        });
    });

    it('badPath_aStatusThatCannotBeReadAfterARefusalLeavesTheChipAndLogs', async () => {
        const { harness, ctx, mapbox } = setup();
        harness.backend.saveMapbox.mockRejectedValue(functionsError('apiError.mapbox.unavailable'));
        harness.backend.status.mockRejectedValue(functionsError('apiError.unavailable'));

        await mapbox.save(MAPBOX_TOKENS.bootstrap);

        expect(ctx.state().steps.mapbox).toMatchObject({ state: 'missing', error: { key: 'apiError.mapbox.unavailable' } });
        expect(JSON.stringify(harness.logs.records)).toContain('setup status not read after a refused save');
    });

    it('badPath_aCardStillWaitingShowsItsReason', async () => {
        const { harness, ctx, mapbox } = setup();
        harness.backend.saveMapbox.mockResolvedValue({
            mapbox: { state: 'invalid', checkedAt: CHECKED, detail: 'apiError.mapbox.mintRefused' },
            viewer: MINTED,
            admin: MINTED,
        });

        await mapbox.save(MAPBOX_TOKENS.trial);

        expect(ctx.state().steps.mapbox).toMatchObject({ state: 'invalid', detail: { key: 'apiError.mapbox.mintRefused' } });
        expect(ctx.state().mapbox.user).toBeNull();
    });
});

describe('usgs', () => {
    it('happyPath_theCountdownRunsSixtySecondsAndThePasteSavesAtOnce', async () => {
        const { harness, ctx, usgs } = setup();
        harness.backend.saveUsgs.mockResolvedValue({ usgs: { state: 'ok', checkedAt: CHECKED, role: 'download' } });

        usgs.startCountdown();
        expect(ctx.state().usgs).toMatchObject({ secondsLeft: 60, expired: false });
        await harness.clock.advance(15_000);
        expect(ctx.state().usgs.secondsLeft).toBe(45);

        await usgs.save({ ...USGS_CREDENTIALS.approved });

        expect(harness.backend.saveUsgs).toHaveBeenCalledWith(USGS_CREDENTIALS.approved);
        expect(ctx.state().usgs).toMatchObject({ secondsLeft: null, expired: false, role: 'download' });
        expect(ctx.state().steps.usgs).toMatchObject({ state: 'ok', used: { inputs: 1, consents: 0 } });
        expect(harness.clock.pending()).toBe(0);
        expect(JSON.stringify(ctx.state())).not.toContain(USGS_CREDENTIALS.approved.applicationToken);
    });

    it('badPath_aCountdownThatEndsSaysSoAndCanStartAgain', async () => {
        const { harness, ctx, usgs } = setup();

        usgs.startCountdown();
        await harness.clock.advance(60_000);
        expect(ctx.state().usgs).toMatchObject({ secondsLeft: null, expired: true });

        usgs.startCountdown();
        expect(ctx.state().usgs).toMatchObject({ secondsLeft: 60, expired: false });
        expect(ctx.state().steps.usgs.used.inputs).toBe(2);
        expect(harness.backend.saveUsgs).not.toHaveBeenCalled();
        usgs.dispose();
        expect(harness.clock.pending()).toBe(0);
    });

    it('badPath_aPendingRoleShowsTheNextCheckAndTheExpiryReminder', async () => {
        const { harness, ctx, usgs } = setup();
        const expiresSoon = new Date(START + 10 * 86_400_000).toISOString();
        harness.backend.saveUsgs.mockResolvedValue({
            usgs: {
                state: 'pending',
                checkedAt: CHECKED,
                detail: 'apiError.usgs.accessPending',
                role: 'search',
                nextCheckAt: CHECKED,
                tokenExpiresAt: expiresSoon,
            },
        });

        await usgs.save({ ...USGS_CREDENTIALS.pending, expiresOn: '2026-10-22' });

        expect(ctx.state().steps.usgs).toMatchObject({ state: 'pending', detail: { key: 'apiError.usgs.accessPending' } });
        expect(ctx.state().usgs).toMatchObject({ role: 'search', nextCheckAt: CHECKED, expiresSoon: true });
    });

    it('badPath_aRejectedTokenIsShownAndNothingKept', async () => {
        const { harness, ctx, usgs } = setup();
        harness.backend.saveUsgs.mockRejectedValue(functionsError('apiError.usgs.credentials'));

        await usgs.save({ ...USGS_CREDENTIALS.expired });

        expect(ctx.state().steps.usgs).toMatchObject({ state: 'missing', busy: false, error: { key: 'apiError.usgs.credentials' } });
    });
});
