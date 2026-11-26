import { describe, expect, it } from 'vitest';

import * as ui from '../../src/index.js';
import { HcmMapViewer } from '../../src/viewer/hcm-map-viewer.js';
import * as viewer from '../../src/viewer/index.js';

/** The viewer's public API inside @hcm/ui (engine-ui workstream): what @hcm/engine mounts, drives and types. */
const VIEWER_EXPORTS = [
    'HCM_MAP_VIEWER_TAG',
    'HcmMapViewer',
    'VIEWER_TAGS',
    'defineViewerElements',
    'setViewerBootstrap',
    'sideLoadExtras',
    'watchGamepads',
];

/** A registry of its own, so the test sees every definition the viewer makes. */
function scopedRegistry(): { readonly registry: CustomElementRegistry; readonly defined: Map<string, CustomElementConstructor> } {
    const defined = new Map<string, CustomElementConstructor>();
    const registry = {
        get: (tag: string) => defined.get(tag),
        define: (tag: string, element: CustomElementConstructor) => {
            defined.set(tag, element);
        },
    } as unknown as CustomElementRegistry;
    return { registry, defined };
}

describe('@hcm/ui viewer API', () => {
    it('happyPath_exportsTheViewerAndReExportsItFromThePackage', () => {
        expect(new Set(Object.keys(viewer))).toEqual(new Set(VIEWER_EXPORTS));
        for (const name of VIEWER_EXPORTS) {
            expect(ui).toHaveProperty(name);
        }
        expect(viewer.HcmMapViewer).toBe(HcmMapViewer);
    });

    it('happyPath_defineViewerElementsRegistersEveryTagOnce', () => {
        const { registry, defined } = scopedRegistry();

        viewer.defineViewerElements(registry);
        const first = new Map(defined);
        viewer.defineViewerElements(registry);

        expect(new Set(defined.keys())).toEqual(new Set(viewer.VIEWER_TAGS));
        expect(defined).toEqual(first);
        expect(defined.get(viewer.HCM_MAP_VIEWER_TAG)).toBe(HcmMapViewer);
    });

    it('badPath_theDefaultRegistryKeepsTheFirstRegistration', () => {
        viewer.defineViewerElements();
        viewer.defineViewerElements();

        expect(customElements.get('hcm-map-viewer')).toBe(HcmMapViewer);
    });
});
