/** What the start page shows (`docs/research/M14-start-your-map.md`), which `StartController` keeps and `<hcm-start-page>` renders. */
import type { UiLocale, StartKey } from '@hcm/shared';

import { START_STEPS, type StartStepId } from './deploy.js';
import type { StartFailure } from './failure.js';
import { EMPTY_FORM, type StartForm } from './form.js';
import type { OwnProject } from './google.js';
import type { StartPlan } from './plan.js';

type StartScreen = 'closed' | 'intro' | 'plan' | 'work' | 'provider' | 'done';

export type StepState = 'waiting' | 'working' | 'done' | 'failed';

export interface StartView {
    readonly screen: StartScreen;
    readonly locale: UiLocale;
    readonly form: StartForm;
    /** The owner's projects; null until read. */
    readonly projects: readonly OwnProject[] | null;
    /** Said on the first screen: why the consent changed nothing. */
    readonly notice: StartKey | null;
    readonly steps: Readonly<Record<StartStepId, StepState>>;
    readonly files: { readonly done: number; readonly total: number };
    readonly failure: StartFailure | null;
    readonly busy: boolean;
    readonly plan: StartPlan | null;
    /** The provider was checked and is not on yet. */
    readonly providerWaiting: boolean;
    /** Its read failed: not the same as "not on", and the owner cannot tell from here. */
    readonly providerUnreadable: boolean;
    /** The terminal road's command, which the catalogue's texts name. */
    readonly command: string;
}

export const WAITING_STEPS = Object.fromEntries(START_STEPS.map((step) => [step, 'waiting'])) as Record<StartStepId, StepState>;

export const INITIAL: Omit<StartView, 'locale'> = {
    screen: 'intro',
    form: EMPTY_FORM,
    projects: null,
    notice: null,
    steps: WAITING_STEPS,
    files: { done: 0, total: 0 },
    failure: null,
    busy: false,
    plan: null,
    providerWaiting: false,
    providerUnreadable: false,
    command: '',
};

export const NOTICE_OF_ANSWER: Readonly<Record<'denied' | 'wrongState' | 'scope', StartKey>> = {
    denied: 'start.signedOut.denied',
    wrongState: 'start.signedOut.state',
    scope: 'start.signedOut.scope',
};

export function stepStateAt(position: number, current: number): StepState {
    if (position === current) {
        return 'working';
    }
    return position < current ? 'done' : 'waiting';
}
