import { describe, expect, it } from 'vitest';

import { setupFunnel } from '../../../src/admin/setup/setup-funnel.js';
import { setupView } from './fixtures.js';

describe('setupFunnel', () => {
    it('happyPath_theCardsInOrderTheOpenOneAndThoseDone', () => {
        const snapshot = setupFunnel(setupView({ openStep: 'mapbox' }));
        expect(snapshot).toMatchObject({ wizard: 'setup', step: 'mapbox', errors: {}, complete: false });
        expect(snapshot?.order).toContain('billing');
        expect(snapshot?.done).toEqual(['signIn', 'billing', 'provision', 'deploy', 'claim']);
    });

    it('badPath_aFailingCardIsItsErrorsKeyOrItsDetailsKeyWhileInvalid', () => {
        const snapshot = setupFunnel(
            setupView({
                steps: {
                    mapbox: { state: 'invalid', error: { key: 'apiError.mapbox.tokenInvalid' } },
                    usgs: { state: 'invalid', detail: { key: 'adminSetup.usgs.answers' } },
                    analytics: { state: 'invalid' },
                },
            }),
        );
        expect(snapshot?.errors).toEqual({ mapbox: 'apiError.mapbox.tokenInvalid', usgs: 'adminSetup.usgs.answers', analytics: 'invalid' });
    });

    it('badPath_nothingWhileTheFirstChecksAreOut', () => {
        expect(setupFunnel(setupView({ loading: true }))).toBeNull();
        expect(setupFunnel(setupView({ ready: true }))?.complete).toBe(true);
    });
});
