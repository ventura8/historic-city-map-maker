/**
 * Registers the places page and what it renders (docs/research/M2c-interfaces.md §7): the list, the editor, the admin
 * map's elements and the kit elements they use. Idempotent per registry; its area entry (`../areas/`) hands it to the admin.
 */
import { defineUiKit } from '../../components/define.js';
import { defineEditingElements } from '../editing/define.js';
import { defineAdminMapElements } from '../map/define.js';
import { defineHcmPoiEditor } from './hcm-poi-editor.js';
import { defineHcmPoiList } from './hcm-poi-list.js';
import { defineHcmPoisPage } from './hcm-pois-page.js';

export function definePoisElements(registry: CustomElementRegistry = customElements): void {
    defineUiKit(registry);
    defineEditingElements(registry);
    defineAdminMapElements(registry);
    defineHcmPoiList(registry);
    defineHcmPoiEditor(registry);
    defineHcmPoisPage(registry);
}
