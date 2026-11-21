/**
 * Registers the admin map's elements (docs/research/M2c-interfaces.md §3.3, §4.6): the map's box, the drawing toolbar and
 * the vertex list, with the kit elements they render. Idempotent per registry; every editor page that shows a map uses
 * them.
 */
import { defineHcmAdminMap } from './hcm-admin-map.js';
import { defineHcmDrawToolbar } from './hcm-draw-toolbar.js';
import { defineHcmVertexList } from './hcm-vertex-list.js';

export function defineAdminMapElements(registry: CustomElementRegistry = customElements): void {
    defineHcmAdminMap(registry);
    defineHcmDrawToolbar(registry);
    defineHcmVertexList(registry);
}
