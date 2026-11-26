import { defineHcmButton } from './button.js';
import { defineHcmCard } from './card.js';
import { defineHcmChip } from './chip.js';
import { defineHcmConsentBanner } from './consent-banner.js';
import { defineHcmDialog } from './dialog.js';
import { defineHcmFabMenu } from './fab-menu.js';
import { defineHcmFab } from './fab.js';
import { defineHcmIconButton } from './icon-button.js';
import { defineHcmIcon } from './icon.js';
import { defineHcmLanguageSelect } from './language-select.js';
import { defineHcmList } from './list.js';
import { defineHcmLoadingIndicator } from './loading-indicator.js';
import { defineHcmOverlayList } from './overlay-list.js';
import { defineHcmProgress } from './progress.js';
import { defineHcmSegmentedButton } from './segmented-button.js';
import { defineHcmSheet } from './sheet.js';
import { defineHcmSlider } from './slider.js';
import { defineHcmSnackbar } from './snackbar.js';
import { defineHcmSwitch } from './switch.js';
import { defineHcmToolbar } from './toolbar.js';

const DEFINERS: readonly ((registry: CustomElementRegistry) => void)[] = [
    defineHcmIcon,
    defineHcmButton,
    defineHcmIconButton,
    defineHcmFab,
    defineHcmFabMenu,
    defineHcmSwitch,
    defineHcmSlider,
    defineHcmChip,
    defineHcmSegmentedButton,
    defineHcmLanguageSelect,
    defineHcmCard,
    defineHcmList,
    defineHcmSheet,
    defineHcmDialog,
    defineHcmSnackbar,
    defineHcmProgress,
    defineHcmLoadingIndicator,
    defineHcmToolbar,
    defineHcmConsentBanner,
    defineHcmOverlayList,
];

/** Registers every `hcm-*` element of the kit; idempotent (the engine and the admin may both call it). */
export function defineUiKit(registry: CustomElementRegistry = customElements): void {
    for (const define of DEFINERS) {
        define(registry);
    }
}
