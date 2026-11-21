import { describe, expect, it } from 'vitest';

import { defineUiKit } from '../src/components/define.js';
import * as ui from '../src/index.js';

/** The kit's public API (ui-kit workstream); the viewer's exports (engine-ui) are pinned by its own tests. */
const KIT_EXPORTS = [
    'BASELINE_THEME',
    'COMPACT_HEIGHT_MAX_PX',
    'DOCKED_PANE_MIN_PX',
    'FONT_FILES',
    'HCM_BUTTON_TAG',
    'HCM_CARD_TAG',
    'HCM_CHIP_TAG',
    'HCM_CONSENT_BANNER_TAG',
    'HCM_DIALOG_TAG',
    'HCM_FAB_MENU_TAG',
    'HCM_FAB_TAG',
    'HCM_ICON_BUTTON_TAG',
    'HCM_ICON_TAG',
    'HCM_LANGUAGE_SELECT_TAG',
    'HCM_LIST_ITEM_TAG',
    'HCM_LIST_TAG',
    'HCM_LOADING_INDICATOR_TAG',
    'HCM_OVERLAY_LIST_TAG',
    'HCM_PROGRESS_TAG',
    'HCM_SEGMENTED_BUTTON_TAG',
    'HCM_SHEET_TAG',
    'HCM_SLIDER_TAG',
    'HCM_SNACKBAR_TAG',
    'HCM_SWITCH_TAG',
    'HCM_TOOLBAR_TAG',
    'HEIGHT_CLASS_BREAKPOINTS',
    'HcmButton',
    'HcmCard',
    'HcmChip',
    'HcmConsentBanner',
    'HcmDialog',
    'HcmFab',
    'HcmFabMenu',
    'HcmIcon',
    'HcmIconButton',
    'HcmList',
    'HcmListItem',
    'HcmLoadingIndicator',
    'HcmOverlayList',
    'HcmProgress',
    'HcmSegmentedButton',
    'HcmSheet',
    'HcmSlider',
    'HcmSnackbar',
    'HcmSwitch',
    'HcmToolbar',
    'ICONS',
    'ICON_FONT_AXES',
    'ICON_FONT_FAMILY',
    'MOTION_EASINGS',
    'MOTION_SPRINGS',
    'REDUCED_MOTION_TOKENS',
    'SHAPE_CORNERS',
    'SHEET_DETENTS',
    'STATE_TOKENS',
    'SYSTEM_TOKENS',
    'TEXT_FONT_FAMILY',
    'TEXT_FONT_STACK',
    'THEME_ATTRIBUTE',
    'TOUCH_TARGET_MIN_PX',
    'TYPE_SCALE',
    'UI_ICONS',
    'WINDOW_CLASS_BREAKPOINTS',
    'WindowClassController',
    'accentTokens',
    'applyTheme',
    'atLeast',
    'baseStyles',
    'clearTheme',
    'deepActiveElement',
    'defineHcmButton',
    'defineHcmCard',
    'defineHcmChip',
    'defineHcmConsentBanner',
    'defineHcmDialog',
    'defineHcmFab',
    'defineHcmFabMenu',
    'defineHcmIcon',
    'defineHcmIconButton',
    'defineHcmLanguageSelect',
    'defineHcmList',
    'defineHcmLoadingIndicator',
    'defineHcmOverlayList',
    'defineHcmProgress',
    'defineHcmSegmentedButton',
    'defineHcmSheet',
    'defineHcmSlider',
    'defineHcmSnackbar',
    'defineHcmSwitch',
    'defineHcmToolbar',
    'defineUiKit',
    'detentHeights',
    'focusRing',
    'fontUrl',
    'fractionAt',
    'heightClassFor',
    'installFonts',
    'isBundledIcon',
    'isCompactHeight',
    'isDockable',
    'loadIconFont',
    'observeWindowSize',
    'onlyWindowClass',
    'restoreFocus',
    'settleDetent',
    'stateLayer',
    'tabbableElements',
    'themeRules',
    'touchTarget',
    'trapTab',
    'typeStyles',
    'visuallyHidden',
    'windowClassFor',
    'windowSizeFor',
    'writeThemeSheet',
];

describe('@hcm/ui public API', () => {
    it('happyPath_exportsTheKit', () => {
        expect(Object.keys(ui)).toEqual(expect.arrayContaining(KIT_EXPORTS));
    });

    it('happyPath_neverExportsTheColourLibraryFromTheMainEntry', () => {
        expect(Object.keys(ui)).not.toContain('themeFromSeed');
    });
});

describe('defineUiKit', () => {
    it('happyPath_registersEveryKitTagInAFreshRegistryOnce', () => {
        const defined = new Map<string, CustomElementConstructor>();
        const definitions: string[] = [];
        const registry = {
            get: (tag: string) => defined.get(tag),
            define: (tag: string, element: CustomElementConstructor) => {
                definitions.push(tag);
                defined.set(tag, element);
            },
        } as unknown as CustomElementRegistry;
        const tags = KIT_EXPORTS.filter((name) => name.endsWith('_TAG')).map(
            (name) => (ui as unknown as Record<string, string>)[name] ?? '',
        );

        defineUiKit(registry);
        defineUiKit(registry);
        defineUiKit();

        expect(tags.filter((tag) => registry.get(tag) === undefined)).toEqual([]);
        expect(new Set(definitions)).toEqual(new Set(tags));
        expect(definitions).toHaveLength(tags.length);
        expect(tags.every((tag) => customElements.get(tag) !== undefined)).toBe(true);
    });
});

describe('@hcm/ui/dynamic-color', () => {
    it('happyPath_isASeparateEntryPoint', async () => {
        // A separate entry: @material/material-color-utilities imports without file extensions, which plain Node
        // (the engine's and admin's node tests, Cloud Functions) cannot resolve, so the main entry never loads it.
        const dynamicColor = await import('@hcm/ui/dynamic-color');

        expect(typeof dynamicColor.themeFromSeed).toBe('function');
    });
});
