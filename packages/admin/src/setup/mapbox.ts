/**
 * Step (e), Mapbox (`docs/research/M2b-interfaces.md` §3.3 e; `M2-interfaces.md` §3.3): the owner pastes the secret
 * token, which is saved at once (one input; a typed token goes with Enter or Save). The page explains a public (`pk.`)
 * or malformed paste before any call (`classifyMapboxToken`); a secret goes once to `setup.saveMapbox`, which validates
 * it upstream, stores it in Secret Manager and mints the public tokens. The token is a parameter here and nothing more:
 * it never enters the state, a store or a log line, and the paste box clears itself after the call.
 *
 * Once Mapbox is set up, a public token is replaced with one click and a confirmation (`setup.rotatePublicToken`, the
 * panic button of security review §1.3; S-A06-HAPPY-ROTATE): the new one is in the city and the next manifest at once,
 * the old one is deleted 10 minutes later by `ops.tick`, and the card says when.
 */
import { classifyMapboxToken, type MapboxTokenAudience, type SaveMapboxResponse } from '@hcm/shared';

import type { SetupContext } from './context.js';
import { apiFailure, setupMessage } from './messages.js';
import type { RotationState } from './state.js';

export interface MapboxFlow {
    save(secretToken: string): Promise<void>;
    /** Replaces the public token of `audience` (the visitors' or the admin's). */
    rotate(audience: MapboxTokenAudience): Promise<void>;
}

class Mapbox implements MapboxFlow {
    constructor(private readonly ctx: SetupContext) {}

    async save(secretToken: string): Promise<void> {
        this.ctx.count('mapbox', 'inputs');
        const kind = classifyMapboxToken(secretToken);
        if (kind !== 'secret') {
            this.ctx.patchStep('mapbox', {
                error: setupMessage(kind === 'public' ? 'apiError.mapbox.publicToken' : 'apiError.mapbox.tokenFormat'),
            });
            return;
        }
        this.ctx.patchStep('mapbox', { busy: true, error: null });
        try {
            const response = await this.ctx.deps.backend.saveMapbox({ cityId: this.ctx.deps.host.cityId, secretToken: secretToken.trim() });
            this.saved(response.mapbox);
        } catch (error) {
            await this.ctx.failRecorded('mapbox', apiFailure(error));
        }
    }

    async rotate(audience: MapboxTokenAudience): Promise<void> {
        if (this.ctx.state().mapbox.rotation.busy) {
            return;
        }
        this.setRotation({ audience, busy: true, retiresOldAt: null, done: false, error: null });
        try {
            const answer = await this.ctx.deps.backend.rotatePublicToken({ cityId: this.ctx.deps.host.cityId, audience });
            this.setRotation({ audience, busy: false, retiresOldAt: answer.retiresOldAt, done: true, error: null });
        } catch (error) {
            this.setRotation({ audience, busy: false, retiresOldAt: null, done: false, error: apiFailure(error).message });
        }
    }

    private setRotation(rotation: RotationState): void {
        this.ctx.update((current) => ({ ...current, mapbox: { ...current.mapbox, rotation } }));
    }

    private saved(view: SaveMapboxResponse['mapbox']): void {
        const { state, checkedAt, detail, params, user } = view;
        this.ctx.update((current) => ({ ...current, mapbox: { ...current.mapbox, user: user ?? null } }));
        this.ctx.patchStep('mapbox', { state, checkedAt, busy: false, detail: detail === undefined ? null : setupMessage(detail, params) });
    }
}

export function createMapboxFlow(ctx: SetupContext): MapboxFlow {
    return new Mapbox(ctx);
}
