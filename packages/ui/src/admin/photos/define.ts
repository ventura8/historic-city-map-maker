/**
 * Registers the photos page and what it renders (`docs/research/M2c-interfaces.md` §6): the list, the editor and the
 * kit elements they use. Idempotent per registry; its area entry (`../areas/`) hands it to the admin.
 */
import { defineUiKit } from '../../components/define.js';
import { defineEditingElements } from '../editing/define.js';
import { defineHcmAdminMap } from '../map/hcm-admin-map.js';
import { defineHcmAdminPhotoEditor } from './hcm-admin-photo-editor.js';
import { defineHcmAdminPhotoList } from './hcm-admin-photo-list.js';
import { defineHcmPhotosPage } from './hcm-photos-page.js';

export function definePhotosElements(registry: CustomElementRegistry = customElements): void {
    defineUiKit(registry);
    defineEditingElements(registry);
    defineHcmAdminMap(registry);
    defineHcmAdminPhotoList(registry);
    defineHcmAdminPhotoEditor(registry);
    defineHcmPhotosPage(registry);
}
