/**
 * The `archive` chunk's elements (`docs/research/M20-import-local.md` §8): the Imagery page asks its store to register them
 * (`ImageryIntentsPort.archiveElements`, a dynamic import: the admin's entry and the imagery chunk stay as they were).
 */
import { defineHcmButton } from '../../components/button.js';
import { defineOnce } from '../../components/internal.js';
import { defineHcmProgress } from '../../components/progress.js';
import { defineHcmSwitch } from '../../components/switch.js';
import { HCM_ARCHIVE_PANEL_TAG, HcmArchivePanel } from './hcm-archive-panel.js';
import { HCM_ARCHIVE_REPORT_TAG, HcmArchiveReport } from './hcm-archive-report.js';

/** Registers `<hcm-archive-panel>`, `<hcm-archive-report>` and the kit's elements they render; again, a no-op. */
export function defineArchiveElements(registry: CustomElementRegistry = customElements): void {
    defineHcmButton(registry);
    defineHcmProgress(registry);
    defineHcmSwitch(registry);
    defineOnce(registry, HCM_ARCHIVE_PANEL_TAG, HcmArchivePanel);
    defineOnce(registry, HCM_ARCHIVE_REPORT_TAG, HcmArchiveReport);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-archive-panel': HcmArchivePanel;
        'hcm-archive-report': HcmArchiveReport;
    }
}
