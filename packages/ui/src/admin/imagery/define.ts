/**
 * Registers the Imagery area's page and the admin map it shows (`docs/research/M3-interfaces.md` §10.2). The kit elements
 * it renders (slider, buttons, chips, segmented button, dialog) and the editing kit come with `defineAdminElements`.
 * Idempotent.
 */
import { defineHcmSlider } from '../../components/slider.js';
import { defineHcmAdminMap } from '../map/hcm-admin-map.js';
import { defineHcmImageryPage } from './hcm-imagery-page.js';

export function defineImageryElements(registry: CustomElementRegistry = customElements): void {
    defineHcmSlider(registry);
    defineHcmAdminMap(registry);
    defineHcmImageryPage(registry);
}
