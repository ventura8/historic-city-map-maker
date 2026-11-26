// Review of M18 item 1 (docs/research/M18-improvements.md): the app's self-reload waits for an upload still being sent.
import { FakeContentStore } from '@hcm/test-support/fake-content-store';
import { describe, expect, it, vi } from 'vitest';

import { mount } from '../../src/app/mount.js';
import type { AreaModule } from '../../src/content/areas.js';
import type { ContentDeps } from '../../src/content/registry.js';
import { asContentStore, NO_AREA_SERVICES } from '../content/world.js';
import { FakeVisibility, settle, undeployed } from './fakes.js';
import { mountWorld as world } from './mount-world.js';

describe('mount: the self-reload waits for an upload', () => {
    function busyWorld(busy: boolean) {
        const w = world();
        undeployed(w.callables);
        const heard: { listener?: (release: string) => void } = {};
        const releases = {
            onNewer: vi.fn((listener: (release: string) => void) => {
                heard.listener = listener;
                return vi.fn();
            }),
            stop: vi.fn(),
        };
        const module: AreaModule<null, null> = {
            area: 'imagery',
            create: () => ({
                ...{ state: null, subscribe: () => () => undefined, intents: null, open: () => undefined, close: () => undefined },
                ...{ hasUnsavedChanges: () => false, busy: () => busy, destroy: () => undefined },
            }),
        };
        const store = asContentStore(new FakeContentStore());
        const theme = (): ReturnType<ContentDeps['theme']> => ({ light: {}, dark: {}, highContrastLight: {}, highContrastDark: {} });
        const visibility = new FakeVisibility();
        visibility.shown = false;
        const app = mount({
            ...w.deps,
            ...{ releases, visibility },
            content: { modules: { imagery: module as never }, store, theme, areas: NO_AREA_SERVICES, cityId: null },
        });
        const serve = (release: string): void => {
            heard.listener?.(release);
        };
        return { w, app, serve };
    }

    it('happyPath_noUploadRuns_theHiddenTabReloadsItself', async () => {
        const { w, app, serve } = busyWorld(false);
        await settle();
        expect(app.content.imagery).not.toBeNull();

        serve('1.0.1+def5678');
        expect([w.location.reloads, app.state.newRelease]).toEqual([1, null]);
    });

    it('badPath_anUploadIsStillBeingSent_theBannerStaysAndNothingReloads', async () => {
        const { w, app, serve } = busyWorld(true);
        await settle();
        expect(app.content.imagery).not.toBeNull();

        serve('1.0.1+def5678');
        expect([w.location.reloads, app.state.newRelease, app.hasUnsavedChanges()]).toEqual([0, '1.0.1+def5678', false]);
    });
});
