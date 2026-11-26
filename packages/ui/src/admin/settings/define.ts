/**
 * Registers the settings area's page, the icon picker and the admin map it renders (`docs/research/M2c-interfaces.md` §8.5;
 * the map of the area and overlays sections, `DECISIONS-for-review.md` §42a: a lazy area chunk defines what it shows). The kit
 * elements (overlay list, slider, dialog, buttons) and the editing kit come with `defineAdminElements`. Idempotent.
 */
import { defineHcmAdminMap } from '../map/hcm-admin-map.js';
import { defineHcmIconPicker } from './hcm-icon-picker.js';
import { defineHcmSettingsPage } from './hcm-settings-page.js';

export function defineSettingsElements(registry: CustomElementRegistry = customElements): void {
    defineHcmAdminMap(registry);
    defineHcmIconPicker(registry);
    defineHcmSettingsPage(registry);
}
