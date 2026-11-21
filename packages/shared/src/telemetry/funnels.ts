/**
 * `@hcm/shared/funnels`: the wizard funnel (`wizard-funnel.ts`, the pages' half) and its hub (`funnel-hub.ts`, the app's
 * half), apart from the package's index so the public viewer's engine never carries them (docs/LESSONS.md 532).
 */
export {
    FUNNEL_EVENT,
    WIZARD_IDS,
    firstOpenStep,
    funnelHelpOpened,
    funnelSignals,
    signalFunnel,
    trackFunnel,
    type FunnelSignal,
    type FunnelSnapshot,
    type WizardId,
} from './wizard-funnel.js';
export {
    FUNNEL_EVENT_NAMES,
    FUNNEL_FLUSH_MS,
    FunnelHub,
    type FunnelEventName,
    type FunnelHubDeps,
    type FunnelWindow,
} from './funnel-hub.js';
