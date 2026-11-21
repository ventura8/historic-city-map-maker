import { describe, expect, it } from 'vitest';

import { GOOGLE_SCOPES } from '../../src/google/scopes.js';
import { createSetupContext, createSetupStore } from '../../src/setup/context.js';
import { MIN_TOKEN_LIFE_MS, googleAccess, liveAccess } from '../../src/setup/google-access.js';
import { initialSetupState } from '../../src/setup/state.js';
import { access, createHarness } from './harness.js';

function setup() {
    const harness = createHarness();
    const ctx = createSetupContext(harness.deps, createSetupStore(initialSetupState(harness.host, 'bootstrap')));
    return { harness, ctx };
}

describe('liveAccess', () => {
    it('happyPath_aLiveTokenWithTheScopeIsUsedWithoutAPopup', async () => {
        const { harness, ctx } = setup();
        harness.google.grant('cloudPlatform');

        expect(liveAccess(ctx, 'cloudBilling')).toBe(harness.google.current);
        expect(await googleAccess(ctx, 'billing', 'cloudBilling', true)).toBe(harness.google.current);
        expect(harness.google.requests).toEqual([]);
        expect(ctx.state().steps.billing.used.consents).toBe(0);
    });

    it('badPath_aTokenWithLessThanFiveMinutesLeftIsNotUsed', () => {
        const { harness, ctx } = setup();
        harness.google.current = {
            ...access(harness.clock.now(), 'cloudPlatform'),
            expiresAt: harness.clock.now() + MIN_TOKEN_LIFE_MS - 1,
        };

        expect(liveAccess(ctx, 'cloudPlatform')).toBeNull();
    });
});

describe('googleAccess', () => {
    it('happyPath_aClickOpensOnePopupForTheStepsScope', async () => {
        const { harness, ctx } = setup();
        ctx.patchStep('provision', { needsContinue: true });

        const granted = await googleAccess(ctx, 'provision', 'cloudPlatform', true);

        expect(granted?.scopes).toEqual([GOOGLE_SCOPES.cloudPlatform]);
        expect(harness.google.requests).toEqual(['cloudPlatform']);
        expect(ctx.state().steps.provision).toMatchObject({ used: { inputs: 0, consents: 1 }, needsContinue: false });
    });

    it('badPath_withoutAClickTheStepOffersContinue', async () => {
        const { harness, ctx } = setup();

        expect(await googleAccess(ctx, 'deploy', 'cloudPlatform', false)).toBeNull();
        expect(harness.google.requests).toEqual([]);
        expect(ctx.state().steps.deploy).toMatchObject({ needsContinue: true, error: { key: 'adminShell.session.googleExpired' } });
    });

    it('badPath_aClosedPopupChangesNothing', async () => {
        const { harness, ctx } = setup();
        harness.google.answer = () => Promise.resolve(null);

        expect(await googleAccess(ctx, 'billing', 'cloudBilling', true)).toBeNull();
        expect(ctx.state().steps.billing).toMatchObject({ state: 'missing', busy: false, error: { key: 'adminShell.oauth.popupClosed' } });
    });

    it('badPath_anUntickedScopeIsRefusedBeforeAnyCall', async () => {
        const { harness, ctx } = setup();
        harness.google.answer = () => Promise.resolve(access(harness.clock.now(), 'cloudReadOnly'));

        expect(await googleAccess(ctx, 'billing', 'cloudBilling', true)).toBeNull();
        expect(ctx.state().steps.billing.error).toEqual({ key: 'adminShell.oauth.scopeDenied', params: { scope: 'cloudBilling' } });
    });

    it('badPath_aRefusedPopupSaysWhy', async () => {
        const { harness, ctx } = setup();
        harness.google.answer = () => Promise.reject(Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' }));

        expect(await googleAccess(ctx, 'billing', 'cloudBilling', true)).toBeNull();
        expect(ctx.state().steps.billing.error).toEqual({ key: 'adminShell.oauth.popupBlocked' });
        expect(ctx.state().steps.billing.used.consents).toBe(1);
    });
});
