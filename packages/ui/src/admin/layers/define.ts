/**
 * Registers the layers area's page and the admin map it shows (`docs/research/M2c-interfaces.md` §8.1–§8.4, §3.3). The kit elements it renders (slider,
 * switch, buttons, dialog) and the editing kit come with `defineAdminElements`. Idempotent.
 */
import { defineHcmAdminMap } from '../map/hcm-admin-map.js';
import { defineHcmLayersPage } from './hcm-layers-page.js';

export function defineLayersElements(registry: CustomElementRegistry = customElements): void {
    defineHcmAdminMap(registry);
    defineHcmLayersPage(registry);
}
