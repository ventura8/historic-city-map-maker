import { describe, expect, it } from 'vitest';

import { privacySignal } from '../../src/index.js';
import {
    FUNNEL_EVENT,
    firstOpenStep,
    funnelHelpOpened,
    funnelSignals,
    signalFunnel,
    trackFunnel,
    type FunnelSignal,
    type FunnelSnapshot,
} from '../../src/telemetry/funnels.js';

const ORDER = ['names', 'area', 'create'] as const;

function snapshot(overrides: Partial<FunnelSnapshot> = {}): FunnelSnapshot {
    return { wizard: 'new_city', order: ORDER, step: 'names', done: [], errors: {}, complete: false, ...overrides };
}

/** The signals `target` dispatches while `run` runs. */
function signalsOf(target: EventTarget, run: () => void): FunnelSignal[] {
    const seen: FunnelSignal[] = [];
    const listener = (event: Event): void => {
        seen.push((event as CustomEvent<FunnelSignal>).detail);
    };
    target.addEventListener(FUNNEL_EVENT, listener);
    run();
    target.removeEventListener(FUNNEL_EVENT, listener);
    return seen;
}

describe('funnelSignals', () => {
    it('happyPath_theFirstSnapshotShowsItsStepAndItsErrors', () => {
        expect(funnelSignals(null, snapshot({ done: ['names'], errors: { area: 'validation.tooBig' } }))).toEqual([
            { kind: 'view', wizard: 'new_city', step: 'names', back: false },
            { kind: 'error', wizard: 'new_city', step: 'area', code: 'validation.tooBig' },
        ]);
    });

    it('happyPath_aStepDoneThenTheNextShownThenTheEnd', () => {
        const first = snapshot();
        const second = snapshot({ step: 'area', done: ['names'] });
        expect(funnelSignals(first, second)).toEqual([
            { kind: 'complete', wizard: 'new_city', step: 'names' },
            { kind: 'view', wizard: 'new_city', step: 'area', back: false },
        ]);
        const third = snapshot({ step: 'create', done: ['names', 'area', 'create'], complete: true });
        expect(funnelSignals(second, third)).toEqual([
            { kind: 'complete', wizard: 'new_city', step: 'area' },
            { kind: 'complete', wizard: 'new_city', step: 'create' },
            { kind: 'view', wizard: 'new_city', step: 'create', back: false },
            { kind: 'finish', wizard: 'new_city' },
        ]);
    });

    it('happyPath_anEarlierStepIsBack', () => {
        expect(funnelSignals(snapshot({ step: 'create' }), snapshot({ step: 'names' }))).toEqual([
            { kind: 'view', wizard: 'new_city', step: 'names', back: true },
        ]);
    });

    it('badPath_anUnchangedErrorOrAStepWithoutAnOrderSaysNothingNew', () => {
        const failing = snapshot({ errors: { area: 'validation.tooBig' } });
        expect(funnelSignals(failing, failing)).toEqual([]);
        expect(funnelSignals(failing, snapshot({ errors: { area: 'validation.tooSmall' } }))).toEqual([
            { kind: 'error', wizard: 'new_city', step: 'area', code: 'validation.tooSmall' },
        ]);
        expect(funnelSignals(snapshot({ step: 'elsewhere' }), snapshot({ step: 'other' }))).toEqual([
            { kind: 'view', wizard: 'new_city', step: 'other', back: false },
        ]);
    });

    it('badPath_aWizardAlreadyCompleteOrWithoutAStepSaysNothing', () => {
        expect(funnelSignals(null, snapshot({ complete: true }))).toEqual([]);
        expect(funnelSignals(null, snapshot({ step: null }))).toEqual([]);
        expect(funnelSignals(snapshot({ complete: true }), snapshot({ complete: true }))).toEqual([]);
    });

    it('happyPath_aCountUpOrDownIsAnActionOfTheStepOnScreen', () => {
        const before = snapshot({ wizard: 'georef', order: ['points', 'save'], step: 'points', counts: { points: 3 } });
        expect(funnelSignals(before, { ...before, counts: { points: 5 } })).toEqual([
            { kind: 'action', wizard: 'georef', step: 'points', action: 'points_added' },
        ]);
        expect(funnelSignals(before, { ...before, counts: { points: 2 } })).toEqual([
            { kind: 'action', wizard: 'georef', step: 'points', action: 'points_removed' },
        ]);
    });

    it('badPath_countsOnOpeningOrWithoutAStepAreNoAction', () => {
        const opened = snapshot({ wizard: 'georef', order: ['points'], step: 'points', counts: { points: 12 } });
        expect(funnelSignals(null, opened)).toEqual([{ kind: 'view', wizard: 'georef', step: 'points', back: false }]);
        expect(funnelSignals({ ...opened, counts: {} }, opened)).toEqual([]);
        expect(funnelSignals(opened, { ...opened, step: null, counts: { points: 13 } })).toEqual([]);
    });
});

describe('trackFunnel', () => {
    it('happyPath_eachRenderDispatchesOnlyWhatChangedPerWizard', () => {
        const page = new EventTarget();
        expect(
            signalsOf(page, () => {
                trackFunnel(page, snapshot());
            }),
        ).toEqual([{ kind: 'view', wizard: 'new_city', step: 'names', back: false }]);
        expect(
            signalsOf(page, () => {
                trackFunnel(page, snapshot());
            }),
        ).toEqual([]);
        expect(
            signalsOf(page, () => {
                trackFunnel(page, { ...snapshot(), wizard: 'upload' });
            }),
        ).toHaveLength(1);
        expect(
            signalsOf(page, () => {
                trackFunnel(page, null);
            }),
        ).toEqual([]);
    });

    it('happyPath_theSignalBubblesAndLeavesShadowRoots', () => {
        const target = new EventTarget();
        const events: Event[] = [];
        target.addEventListener(FUNNEL_EVENT, (event) => {
            events.push(event);
        });
        funnelHelpOpened(target, 'setup', 'usgs');
        expect(events.map((event) => [event.bubbles, event.composed, (event as CustomEvent<FunnelSignal>).detail])).toEqual([
            [true, true, { kind: 'help', wizard: 'setup', step: 'usgs' }],
        ]);
    });

    it('badPath_aTargetThatCannotDispatchLosesTheSignalQuietly', () => {
        const broken = {
            dispatchEvent: () => {
                throw new Error('detached');
            },
        } as unknown as EventTarget;
        expect(() => {
            signalFunnel(broken, { kind: 'finish', wizard: 'setup' });
        }).not.toThrow();
    });
});

describe('firstOpenStep', () => {
    it('happyPath_theFirstStepNotDoneElseTheLast', () => {
        expect(firstOpenStep(ORDER, ['names'])).toBe('area');
        expect(firstOpenStep(ORDER, [...ORDER])).toBe('create');
        expect(firstOpenStep([], [])).toBeNull();
    });
});

describe('privacySignal (the index)', () => {
    it('badPath_doNotTrackOrGlobalPrivacyControlIsARefusal', () => {
        expect(privacySignal({ doNotTrack: '1' })).toBe(true);
        expect(privacySignal({ globalPrivacyControl: true })).toBe(true);
    });

    it('happyPath_noSignalLeavesTheChoiceToThePerson', () => {
        expect(privacySignal({ doNotTrack: '0', globalPrivacyControl: false })).toBe(false);
        expect(privacySignal({ doNotTrack: null })).toBe(false);
        expect(privacySignal(undefined)).toBe(false);
    });
});
