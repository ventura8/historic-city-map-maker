import { SETUP_AREAS, SETUP_REQUIRED_AREAS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { nextSetupStep, SETUP_STEP_SPECS, SETUP_STEPS, setupInputBudget, type SetupStepId } from '../../src/setup/steps.js';

const BOOTSTRAP: readonly SetupStepId[] = ['signIn', 'billing', 'provision', 'deploy'];

describe('SETUP_STEP_SPECS', () => {
    it('happyPath_theBootstrapStepsComeFirst_theImageryPipelineAlsoNeedsNoServer', () => {
        const withoutBackend = SETUP_STEPS.filter((id) => !SETUP_STEP_SPECS[id].needsBackend);

        // M28: the platform card reads the other steps' states, so it needs no server either.
        expect(withoutBackend).toEqual([...BOOTSTRAP, 'pipeline', 'platform']);
        expect(SETUP_STEPS.slice(0, BOOTSTRAP.length)).toEqual(BOOTSTRAP);
        expect(SETUP_STEPS.at(-1)).toBe('site');
    });

    it('happyPath_everyPrerequisiteComesEarlierOnTheScreen', () => {
        const late = SETUP_STEPS.flatMap((id, index) =>
            SETUP_STEP_SPECS[id].after.filter((before) => SETUP_STEPS.indexOf(before) >= index).map((before) => `${id} after ${before}`),
        );

        expect(late).toEqual([]);
    });

    it('happyPath_everyRequiredAreaHasARequiredStep', () => {
        const required = SETUP_STEPS.filter((id) => !SETUP_STEP_SPECS[id].optional).map((id) => SETUP_STEP_SPECS[id].area);

        expect(SETUP_REQUIRED_AREAS.every((area) => required.includes(area))).toBe(true);
        const areas = SETUP_STEPS.map((id) => SETUP_STEP_SPECS[id].area).filter((area) => area !== null);

        expect(areas.every((area) => SETUP_AREAS.includes(area))).toBe(true);
    });

    it('happyPath_onlyTheStepsThatAskGoogleCountAConsent', () => {
        const consenting = SETUP_STEPS.filter((id) => SETUP_STEP_SPECS[id].consents > 0);

        expect(consenting).toEqual(['signIn', 'billing', 'provision', 'analytics']);
        expect(consenting.every((id) => SETUP_STEP_SPECS[id].scope !== null)).toBe(true);
    });

    it('happyPath_onlyUsgsCanWait_badPath_noOtherRequiredStepIsPostponable', () => {
        expect(SETUP_STEPS.filter((id) => SETUP_STEP_SPECS[id].postponable)).toEqual(['usgs']);
        expect(SETUP_STEP_SPECS.usgs.optional).toBe(false);
    });

    it('happyPath_theInstallCardsLetters', () => {
        expect([SETUP_STEP_SPECS.deploy.letter, SETUP_STEP_SPECS.pipeline.letter, SETUP_STEP_SPECS.site.letter]).toEqual(['d', 'd3', 'i']);
        expect([SETUP_STEP_SPECS.pipeline.inputs, SETUP_STEP_SPECS.pipeline.optional]).toEqual([0, true]);
    });
});

describe('nextSetupStep', () => {
    it('happyPath_aNewMapStartsWithSignIn', () => {
        expect(nextSetupStep(new Set())).toBe('signIn');
    });

    it('happyPath_afterTheBootstrapStepsTheClaimIsNext', () => {
        expect(nextSetupStep(new Set(BOOTSTRAP))).toBe('claim');
    });

    it('happyPath_afterMapboxComeTheSources_thenUsgs_thenTheOptionalOnes_thenTheSite', () => {
        // M28: the sources come after the platform's steps; the platform card itself is read from them (`withPlatform`).
        expect(nextSetupStep(new Set<SetupStepId>([...BOOTSTRAP, 'claim', 'mapbox']))).toBe('sources');
        const claimed = new Set<SetupStepId>([...BOOTSTRAP, 'claim', 'mapbox', 'platform', 'sources']);

        expect(nextSetupStep(claimed)).toBe('usgs');
        expect(nextSetupStep(new Set<SetupStepId>([...claimed, 'usgs']))).toBe('pipeline');
        expect(nextSetupStep(new Set<SetupStepId>([...claimed, 'usgs', 'pipeline', 'analytics']))).toBe('legacyImport');
        expect(nextSetupStep(new Set<SetupStepId>([...claimed, 'usgs', 'pipeline', 'analytics', 'legacyImport']))).toBe('site');
    });

    it('happyPath_aPostponedStepCountsAsSettled', () => {
        // CR-M6-4: the caller passes the postponed steps with the done ones (`settledSteps` of state.ts).
        expect(nextSetupStep(new Set<SetupStepId>([...BOOTSTRAP, 'claim', 'mapbox', 'platform', 'sources', 'usgs', 'pipeline']))).toBe(
            'analytics',
        );
    });

    it('badPath_aStepWhosePrerequisiteIsMissingIsSkipped', () => {
        expect(nextSetupStep(new Set<SetupStepId>(['mapbox']))).toBe('signIn');
        expect(nextSetupStep(new Set<SetupStepId>(['signIn', 'provision']))).toBe('billing');
    });

    it('happyPath_nothingIsNextWhenEveryStepIsDone', () => {
        expect(nextSetupStep(new Set(SETUP_STEPS))).toBeNull();
    });
});

describe('setupInputBudget', () => {
    it('happyPath_theWholeSetupTakesTwelveInputsAndFourConsents', () => {
        // M6 §4.2: a 1, b 1, c 1, d 1, e 1, f 3, g 1, h 1, i 1; consents a, b, c, g. M28: e1 none, e2 1 (Save my choice).
        expect(setupInputBudget()).toEqual({ inputs: 12, consents: 4 });
    });

    it('happyPath_theBootstrapTakesFourInputsAndThreeConsents', () => {
        expect(setupInputBudget(BOOTSTRAP)).toEqual({ inputs: 4, consents: 3 });
    });

    it('happyPath_theRequiredStepsWithUsgsLaterTakeSevenInputs', () => {
        const required: readonly SetupStepId[] = ['signIn', 'billing', 'provision', 'deploy', 'mapbox', 'site'];

        // Do it later is USGS's one input (setup-ux's skipUsgs budget).
        expect(setupInputBudget(required).inputs + 1).toBe(7);
        expect(setupInputBudget(required).consents).toBe(3);
    });

    it('badPath_noStepsTakeNoInput', () => {
        expect(setupInputBudget([])).toEqual({ inputs: 0, consents: 0 });
    });
});
