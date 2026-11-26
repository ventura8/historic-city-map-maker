/**
 * The `worker` chunk's elements (`docs/research/M7-local-worker.md` §7): the Jobs page, the pipeline card and a version's
 * page import this module dynamically (never statically: the admin's entry and the imagery chunk stay as they were) and
 * register what it renders.
 */
import { defineHcmButton } from '../../components/button.js';
import { defineOnce } from '../../components/internal.js';
import { defineHcmProgress } from '../../components/progress.js';
import { defineHcmSegmentedButton } from '../../components/segmented-button.js';
import { HCM_JOB_PAUSE_TAG, HcmJobPause } from './hcm-job-pause.js';
import { HCM_RUN_PLACE_TAG, HcmRunPlace } from './hcm-run-place.js';
import { HCM_WORKER_PANEL_TAG, HcmWorkerPanel } from './hcm-worker-panel.js';

/** Registers `<hcm-worker-panel>`, `<hcm-run-place>`, `<hcm-job-pause>` and the kit's elements they render; again, a no-op. */
export function defineWorkerElements(registry: CustomElementRegistry = customElements): void {
    defineHcmButton(registry);
    defineHcmProgress(registry);
    defineHcmSegmentedButton(registry);
    defineOnce(registry, HCM_WORKER_PANEL_TAG, HcmWorkerPanel);
    defineOnce(registry, HCM_RUN_PLACE_TAG, HcmRunPlace);
    defineOnce(registry, HCM_JOB_PAUSE_TAG, HcmJobPause);
}
