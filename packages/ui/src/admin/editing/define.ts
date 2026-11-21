/**
 * Registers the editing kit (`docs/research/M2c-interfaces.md` §9.5) and the kit elements its pieces and the editor
 * pages render: every area's page relies on them, so `defineAdminElements` registers them all at once. Idempotent.
 */
import { defineHcmChip } from '../../components/chip.js';
import { defineHcmIcon } from '../../components/icon.js';
import { defineHcmLoadingIndicator } from '../../components/loading-indicator.js';
import { defineHcmProgress } from '../../components/progress.js';
import { defineHcmSegmentedButton } from '../../components/segmented-button.js';
import { defineHcmConfirmDialog, HCM_CONFIRM_DIALOG_TAG } from './hcm-confirm-dialog.js';
import { defineHcmEmptyState, HCM_EMPTY_STATE_TAG } from './hcm-empty-state.js';
import { defineHcmListDetail, HCM_LIST_DETAIL_TAG } from './hcm-list-detail.js';
import { defineHcmOverflowMenu, HCM_OVERFLOW_MENU_TAG } from './hcm-overflow-menu.js';

/** The editing kit's own tags. */
export const EDITING_TAGS = [HCM_LIST_DETAIL_TAG, HCM_CONFIRM_DIALOG_TAG, HCM_EMPTY_STATE_TAG, HCM_OVERFLOW_MENU_TAG] as const;

export function defineEditingElements(registry: CustomElementRegistry = customElements): void {
    defineHcmIcon(registry);
    defineHcmChip(registry);
    defineHcmProgress(registry);
    defineHcmLoadingIndicator(registry);
    defineHcmSegmentedButton(registry);
    defineHcmListDetail(registry);
    defineHcmConfirmDialog(registry);
    defineHcmEmptyState(registry);
    defineHcmOverflowMenu(registry);
}
