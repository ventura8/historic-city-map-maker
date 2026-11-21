import { HCM_MAP_VIEWER_TAG, VIEWER_TAGS } from '@hcm/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ENGINE_VERSION, MAPBOX_GL_VERSION, defineElements, mount } from '../src/index.js';
import { FakeContainer, FakeViewer } from './mount-support.js';

interface RecordingRegistry {
    readonly registry: CustomElementRegistry;
    readonly tags: string[];
}

/** A registry that records definitions (node has no real one). */
function recordingRegistry(): RecordingRegistry {
    const defined = new Map<string, CustomElementConstructor>();
    const tags: string[] = [];
    const registry = {
        get: (tag: string) => defined.get(tag),
        define: (tag: string, element: CustomElementConstructor) => {
            defined.set(tag, element);
            tags.push(tag);
        },
    } as unknown as CustomElementRegistry;
    return { registry, tags };
}

describe('@hcm/engine public API', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('happyPath_pinsTheVersions', () => {
        expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?$/);
        expect(MAPBOX_GL_VERSION).toBe('3.34.1');
    });

    it('happyPath_defineElementsRegistersTheViewerAndTheKitOnce', () => {
        const { registry, tags } = recordingRegistry();

        defineElements(registry);
        defineElements(registry);

        expect(tags).toEqual(expect.arrayContaining([...VIEWER_TAGS, 'hcm-sheet', 'hcm-overlay-list', 'hcm-fab-menu']));
        expect(tags.filter((tag) => tag === HCM_MAP_VIEWER_TAG)).toHaveLength(1);
    });

    it('badPath_mountOnAPageWithAnInvalidConfigShowsTheErrorCard', async () => {
        const viewer = new FakeViewer();
        vi.stubGlobal('window', {
            document: { createElement: () => viewer.element, querySelector: () => null },
            location: { hash: '', href: 'https://example.org/', search: '', pathname: '/' },
            localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
            matchMedia: () => ({ matches: false }),
        });
        const container = new FakeContainer();

        const controller = mount(container.element, { cityId: 'not a valid id!' });

        expect(container.children).toEqual([viewer]);
        expect(viewer.bootError?.code).toBe('error.config.invalid');
        await expect(controller.ready).resolves.toEqual({ ok: false, code: 'error.config.invalid' });
    });
});
