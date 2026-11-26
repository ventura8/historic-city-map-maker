/**
 * Registers the georeferencer's page, its scan pane and the admin map it shows (`docs/research/M3-interfaces.md` §10.4).
 * The kit elements it renders (slider, switch, buttons, segmented button, icon button) and the editing kit come with
 * `defineAdminElements`. Idempotent.
 */
import { defineHcmIconButton } from '../../components/icon-button.js';
import { defineHcmSlider } from '../../components/slider.js';
import { defineHcmSwitch } from '../../components/switch.js';
import { defineHcmAdminMap } from '../map/hcm-admin-map.js';
import { defineHcmGeorefPage } from './hcm-georef-page.js';
import { defineHcmScanViewer } from './hcm-scan-viewer.js';

export function defineGeorefElements(registry: CustomElementRegistry = customElements): void {
    defineHcmSlider(registry);
    defineHcmSwitch(registry);
    defineHcmIconButton(registry);
    defineHcmAdminMap(registry);
    defineHcmScanViewer(registry);
    defineHcmGeorefPage(registry);
}
