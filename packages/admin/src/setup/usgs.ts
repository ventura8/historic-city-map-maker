/**
 * Step (f), USGS (`docs/research/M2b-interfaces.md` §3.3 f): the username field (one fill), "Open the USGS token page"
 * (one click: the paste box is focused and the 60 s countdown starts before ERS opens in a new tab), and the paste,
 * which saves at once with `setup.saveUsgs` (no Save click): three inputs. A countdown that ends with nothing pasted
 * says so; the box stays open and the button starts again. After saving, a pending M2M role is `pending` with
 * `apiError.usgs.accessPending` and the next check (`ops.tick`), green on approval. Like the Mapbox token, the
 * application token is only a parameter of the call. M6 (`docs/research/M6-interfaces.md` §4.1, finding 16): **Do it
 * later** (one input) records the step as postponed with `setup.recordCloud` and opens the next step; Setup is done
 * without it, Home reminds the owner, and saving a token later ends the postponement (the server's record is the check's).
 */
import type { SaveUsgsRequest, SaveUsgsResponse } from '@hcm/shared';

import type { SetupContext } from './context.js';
import { createCountdown, USGS_TOKEN_SECONDS, type Countdown } from './countdown.js';
import { apiFailure, setupMessage } from './messages.js';
import { usgsFromView } from './records.js';
import { resumeStep } from './state.js';

export interface UsgsFlow {
    /** "Open the USGS token page": one click (the element focuses the paste box, then the link opens ERS). */
    startCountdown(): void;
    /** The paste, with the username filled: saved at once. */
    save(request: SaveUsgsRequest): Promise<void>;
    /** Do it later (one input): USGS waits, the next step opens. */
    postpone(): Promise<void>;
    dispose(): void;
}

class Usgs implements UsgsFlow {
    private readonly countdown: Countdown;

    constructor(private readonly ctx: SetupContext) {
        this.countdown = createCountdown(
            ctx.deps.clock,
            USGS_TOKEN_SECONDS,
            (secondsLeft) => {
                this.setCountdown(secondsLeft, false);
            },
            () => {
                this.setCountdown(null, true);
            },
        );
    }

    startCountdown(): void {
        this.ctx.count('usgs', 'inputs');
        this.ctx.patchStep('usgs', { error: null });
        this.countdown.start();
    }

    async save(request: SaveUsgsRequest): Promise<void> {
        this.countdown.stop();
        this.setCountdown(null, false);
        this.ctx.patchStep('usgs', { busy: true, error: null });
        try {
            this.saved((await this.ctx.deps.backend.saveUsgs(request)).usgs);
        } catch (error) {
            await this.ctx.failRecorded('usgs', apiFailure(error));
        }
    }

    async postpone(): Promise<void> {
        this.ctx.count('usgs', 'inputs');
        this.countdown.stop();
        this.setCountdown(null, false);
        this.ctx.patchStep('usgs', { busy: true, error: null });
        try {
            this.ctx.applyStatus((await this.ctx.deps.backend.recordCloud({ postponed: { usgs: true } })).status);
            this.ctx.patchStep('usgs', { busy: false });
            this.ctx.update((state) => (state.openStep === 'usgs' ? { ...state, openStep: resumeStep(state, null) } : state));
        } catch (error) {
            this.ctx.fail('usgs', apiFailure(error));
        }
    }

    dispose(): void {
        this.countdown.stop();
    }

    private setCountdown(secondsLeft: number | null, expired: boolean): void {
        this.ctx.update((state) => ({ ...state, usgs: { ...state.usgs, secondsLeft, expired } }));
    }

    private saved(view: SaveUsgsResponse['usgs']): void {
        const now = this.ctx.deps.clock.now();
        this.ctx.update((state) => ({ ...state, usgs: usgsFromView(state.usgs, view, now) }));
        const detail = view.detail === undefined ? null : setupMessage(view.detail, view.params);
        this.ctx.patchStep('usgs', { state: view.state, checkedAt: view.checkedAt, busy: false, detail });
    }
}

export function createUsgsFlow(ctx: SetupContext): UsgsFlow {
    return new Usgs(ctx);
}
