import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { defineViewerElements } from '../../src/viewer/define.js';
import { HCM_MAP_VIEWER_TAG, HcmMapViewer, setViewerBootstrap } from '../../src/viewer/hcm-map-viewer.js';
import type { ViewerController } from '../../src/viewer/store-port.js';
import { defineKitDoubles, fireKitEvent, shadowQuery, shadowText } from './doubles.js';
import { FakeStore, idleState, readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';
import { COMPACT, fakeServices, mountViewer, part, publicEvents, setBox } from './viewer-harness.js';

const CONTROLLER: ViewerController = {
    ready: Promise.resolve({ ok: true, cityId: 'bucuresti' }),
    setYear: () => undefined,
    toggleLayer: () => undefined,
    setOverlayOpacity: () => undefined,
    openPhoto: () => undefined,
    openPoi: () => undefined,
    setLang: () => undefined,
    openCompare: () => undefined,
    setComparePosition: () => undefined,
    closeCompare: () => undefined,
    setMapLabels: () => undefined,
    destroy: () => undefined,
};

/** Two animation frames: every ResizeObserver notification of a layout change has been delivered by then. */
async function nextFrames(): Promise<void> {
    for (let frame = 0; frame < 2; frame += 1) {
        await new Promise((resolve) => {
            requestAnimationFrame(resolve);
        });
    }
}

beforeAll(() => {
    defineKitDoubles();
    defineViewerElements();
});

/** The names of the floating controls the e2e tour checks for overlaps (`data-layout-check`), sorted. */
function layoutChecked(element: HTMLElement): string[] {
    return [...(element.shadowRoot?.querySelectorAll('[data-layout-check]') ?? [])]
        .map((node) => node.getAttribute('data-layout-check') ?? '')
        .sort((a, b) => a.localeCompare(b));
}

describe('<hcm-map-viewer>: boot', () => {
    afterEach(() => {
        document.body.replaceChildren();
        setViewerBootstrap(null);
    });

    it('happyPath_aSkeletonUntilAStoreIsAttached', async () => {
        const element = document.createElement(HCM_MAP_VIEWER_TAG);
        setBox(element, COMPACT);
        document.body.append(element);
        await element.updateComplete;

        await expect.element(page.getByRole('status')).toHaveTextContent('Se încarcă harta…');
        expect(element.mapContainer).not.toBeNull();
        expect(element.controller).toBeNull();
        await expect.element(page.getByRole('region', { name: 'Hartă istorică:' })).toBeInTheDocument();
    });

    it('happyPath_readyFiresOnceWithTheCountsAndShowsTheMap', async () => {
        const { element, store } = await mountViewer(idleState(), COMPACT, CONTROLLER);
        const events = publicEvents(element);

        store.set({ status: 'loading' });
        store.set(readyState());
        await element.updateComplete;

        expect(events).toEqual([{ type: 'hcm-ready', detail: { cityId: 'bucuresti', engineVersion: '1.2.3', layers: 2, photos: 3 } }]);
        expect(element.controller).toBe(CONTROLLER);
        await expect.element(page.getByRole('region', { name: 'Hartă istorică: București dispărut' })).toBeInTheDocument();
        await expect.element(page.getByRole('slider', { name: 'Cronologie' })).toBeVisible();
        expect(element.shadowRoot?.querySelector('.status')).toBeNull();
    });

    it('happyPath_attachingAReadyStoreAnnouncesItAtOnce', () => {
        const element = document.createElement(HCM_MAP_VIEWER_TAG);
        element.services = fakeServices();
        document.body.append(element);
        const events = publicEvents(element);

        element.attach(new FakeStore(readyState()), null);

        expect(events.map((event) => event.type)).toEqual(['hcm-ready']);
    });

    it('badPath_aRetryableErrorShowsACardWithRetry', async () => {
        const { element, store } = await mountViewer(idleState());
        const events = publicEvents(element);

        store.set({ status: 'error', error: { code: 'error.manifest.timeout', retryable: true } });
        await element.updateComplete;
        await page.getByRole('button', { name: 'Reîncearcă' }).click();

        await expect
            .element(page.getByRole('alert'))
            .toHaveTextContent('Încărcarea hărții durează prea mult, probabil o conexiune lentă. Încearcă din nou. Reîncearcă');
        expect(store.callsOf('retry')).toHaveLength(1);
        expect(events).toEqual([{ type: 'hcm-error', detail: { code: 'error.manifest.timeout', retryable: true } }]);
    });

    it('badPath_aBootErrorShowsTheConfigurationProblem', async () => {
        const element = document.createElement(HCM_MAP_VIEWER_TAG);
        element.bootError = {
            code: 'error.config.invalid',
            retryable: false,
            params: { detail: 'manifestUrl: Sunt permise doar adrese https://.' },
        };
        element.setAttribute('lang', 'ro');
        document.body.append(element);
        await element.updateComplete;

        await expect
            .element(page.getByRole('alert'))
            .toHaveTextContent('config.js este nevalid: manifestUrl: Sunt permise doar adrese https://.');
        expect(element.shadowRoot?.querySelector('hcm-button')).toBeNull();
    });

    it('badPath_withoutWebglThePhotoListStillWorks', async () => {
        const { element, store } = await mountViewer(readyState(testManifest(), { webgl: false }));

        expect(shadowText(part({ element, store }, 'hcm-error-card'))).toContain('nu poate desena harta');
        expect(element.shadowRoot?.querySelector('hcm-timeline')).toBeNull();
        await page.getByRole('button', { name: /Strada Uranus/ }).click();

        expect(store.callsOf('openPhoto')).toEqual([['uranus-1984']]);
        const items = (part({ element, store }, 'hcm-fab-menu') as HTMLElement & { items: readonly { value: string }[] }).items;
        expect(items.map((item) => item.value)).toEqual(['photos', 'share', 'settings', 'about']);
    });

    it('happyPath_theSheetsDecodedThumbnailEndsThePhotoMeasurement', async () => {
        const { element, store } = await mountViewer(readyState(testManifest(), { selectedPhotoId: 'uranus-1984', sheet: 'photo' }));

        part({ element, store }, 'hcm-photo-sheet').dispatchEvent(
            new CustomEvent('hcm-photo-shown', { bubbles: true, detail: { ok: false } }),
        );

        expect(store.callsOf('photoShown')).toEqual([[false]]);
    });

    it('happyPath_showOnMapReachesTheStoreWithThePhotoAndItsOffset', async () => {
        const { element, store } = await mountViewer(readyState(testManifest(), { selectedPhotoId: 'uranus-1984', sheet: 'photo' }));

        expect((part({ element, store }, 'hcm-photo-sheet') as HTMLElement & { canLocate: boolean }).canLocate).toBe(true);
        part({ element, store }, 'hcm-photo-sheet').dispatchEvent(
            new CustomEvent('hcm-photo-locate', { bubbles: true, detail: { photoId: 'uranus-1984', offset: [0, -120] } }),
        );

        expect(store.callsOf('locatePhoto')).toEqual([['uranus-1984', [0, -120]]]);
    });

    it('badPath_withoutWebglThePhotoSheetCannotLocate', async () => {
        const { element, store } = await mountViewer(
            readyState(testManifest(), { webgl: false, selectedPhotoId: 'uranus-1984', sheet: 'photo' }),
        );

        expect((part({ element, store }, 'hcm-photo-sheet') as HTMLElement & { canLocate: boolean }).canLocate).toBe(false);
    });

    it('happyPath_aDeclarativeElementAsksTheEngineToBootIt', () => {
        const boot = vi.fn();
        setViewerBootstrap(boot);
        const element = document.createElement(HCM_MAP_VIEWER_TAG);
        element.setAttribute('manifest-url', 'https://example.org/manifest.json');
        document.body.append(element);

        expect(boot).toHaveBeenCalledWith(element);
        expect(element.manifestUrl).toBe('https://example.org/manifest.json');
    });

    it('badPath_noBootWithABootErrorOrAStoreOrNoEngine', async () => {
        const boot = vi.fn();
        setViewerBootstrap(boot);
        const failed = document.createElement(HCM_MAP_VIEWER_TAG);
        failed.bootError = { code: 'error.config.missing', retryable: false };
        document.body.append(failed);
        await mountViewer();
        setViewerBootstrap(null);
        document.body.append(document.createElement(HCM_MAP_VIEWER_TAG));

        expect(boot).not.toHaveBeenCalled();
        expect(customElements.get(HCM_MAP_VIEWER_TAG)).toBe(HcmMapViewer);
    });
});

describe('<hcm-map-viewer>: store wiring', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_detachAndReconnectFollowTheStore', async () => {
        const { element, store } = await mountViewer();
        expect(store.listenerCount).toBe(1);

        element.remove();
        expect(store.listenerCount).toBe(0);
        document.body.append(element);
        expect(store.listenerCount).toBe(1);

        element.detach();
        await element.updateComplete;
        expect(store.listenerCount).toBe(0);
        await expect.element(page.getByRole('status')).toHaveTextContent('Se încarcă harta…');
        element.setAttribute('lang', 'en');
        expect(store.callsOf('setLocale')).toEqual([]);
    });

    it('happyPath_theLanguageFollowsTheStoreAndTheAttribute', async () => {
        const { element, store } = await mountViewer();
        expect(element.getAttribute('lang')).toBe('ro');

        element.setAttribute('lang', 'en-GB');
        await element.updateComplete;
        expect(store.callsOf('setLocale')).toEqual([['en']]);
        expect(document.documentElement.lang).toBe('en');
        await expect.element(page.getByRole('slider', { name: 'Timeline' })).toBeVisible();

        element.setAttribute('lang', 'en');
        expect(store.callsOf('setLocale')).toHaveLength(1);
    });

    it('happyPath_theCityThemeIsAppliedAndFollowsTheMode', async () => {
        const { element, store } = await mountViewer();
        const primary = (): string => getComputedStyle(element).getPropertyValue('--md-sys-color-primary').trim();

        expect(primary()).toBe('#875329');
        store.set({ theme: 'dark' });
        expect(primary()).toBe('#ffb68a');
    });

    it('badPath_beforeAManifestTheBaselineThemeApplies', async () => {
        const { element } = await mountViewer(idleState());

        expect(getComputedStyle(element).getPropertyValue('--md-sys-color-primary').trim()).not.toBe('');
    });

    it('happyPath_resizingTheViewerUpdatesItsWindowClass', async () => {
        const mounted = await mountViewer();

        setBox(mounted.element, { width: 1300, height: 800 });

        await vi.waitFor(() => {
            expect(mounted.store.getState().windowClass).toBe('large');
        });
    });

    it('badPath_aResizeAfterDetachIsIgnored', async () => {
        const { element, store } = await mountViewer();
        const before = store.callsOf('setWindowSize').length;
        element.detach();
        setBox(element, { width: 320, height: 620 });

        await nextFrames();
        expect(store.callsOf('setWindowSize')).toHaveLength(before);
        await expect.element(page.getByRole('status')).toHaveTextContent('Se încarcă harta…');
    });

    it('happyPath_toastsShowAndDismiss', async () => {
        const { element, store } = await mountViewer();

        store.showToast('error.tiles');
        await element.updateComplete;
        await expect
            .element(page.getByRole('status'))
            .toHaveTextContent('Unele porțiuni ale hărții nu se încarcă, probabil o conexiune lentă. Mișcă puțin harta ca să reîncerci.');
        fireKitEvent(part({ element, store }, 'hcm-snackbar'), 'hcm-dismiss', { reason: 'timeout' });

        expect(store.getState().toast).toBeNull();
    });

    it('happyPath_theConsentBannerAsksOnceWhenAnalyticsAreConfigured', async () => {
        const { element, store } = await mountViewer();

        await page.getByRole('button', { name: 'Accept' }).click();
        await element.updateComplete;

        expect(store.callsOf('setConsent')).toEqual([['granted']]);
        expect(element.shadowRoot?.querySelector('hcm-consent-banner')).toBeNull();
    });

    it('badPath_noBannerWithoutAMeasurementId', async () => {
        const manifest = testManifest((raw) => {
            (raw['city'] as Record<string, unknown>)['analytics'] = {};
        });
        const { element } = await mountViewer(readyState(manifest));

        expect(element.shadowRoot?.querySelector('hcm-consent-banner')).toBeNull();
        expect(shadowQuery(element, '.frame').hasAttribute('data-timeline')).toBe(true);
        expect(element.shadowRoot?.querySelector('.timeline-note')).toBeNull();
    });

    it('happyPath_aCityWithoutLayersSaysTheyAreComingInsteadOfATimeline', async () => {
        const manifest = testManifest((raw) => {
            raw['layers'] = [];
        });
        const { element, store } = await mountViewer(readyState(manifest));

        expect(element.shadowRoot?.querySelector('hcm-timeline')).toBeNull();
        expect(shadowQuery(element, '.frame').hasAttribute('data-timeline')).toBe(false);
        await expect.element(page.getByText('Harta nu are straturi istorice')).toBeVisible();

        store.set({ locale: 'en' });
        await element.updateComplete;
        expect(shadowQuery(element, '.timeline-note').textContent).toContain('No historical layers on this map');
        expect(layoutChecked(element)).toEqual(['compass', 'consent', 'menu', 'timeline-note', 'zoom']);
    });

    it('happyPath_everyFloatingControlIsNamedForTheLayoutCheck', async () => {
        const { element, store } = await mountViewer();

        store.set({ year: 1977 });
        store.showToast('error.tiles');
        await element.updateComplete;

        expect(layoutChecked(element)).toEqual(['compass', 'consent', 'menu', 'near-year', 'timeline', 'toast', 'zoom']);
    });

    it('badPath_withoutWebglNoTimelineNote', async () => {
        const manifest = testManifest((raw) => {
            raw['layers'] = [];
        });
        const { element } = await mountViewer(readyState(manifest, { webgl: false }));

        expect(element.shadowRoot?.querySelector('.timeline-note')).toBeNull();
    });
});

describe('the keyboard and the gamepad on <hcm-map-viewer>', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    function press(target: EventTarget, key: string): KeyboardEvent {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true });
        target.dispatchEvent(event);
        return event;
    }

    it('happyPath_aShortcutFromThePageBodyActsAndIsTaken', async () => {
        const { store } = await mountViewer(readyState());

        const event = press(document.body, '?');

        expect(store.getState().sheet).toBe('help');
        expect(event.defaultPrevented).toBe(true);
    });

    it('badPath_shortcutsTurnedOffLeaveTheKeyAlone', async () => {
        const { store } = await mountViewer(readyState(testManifest(), { shortcuts: false }));

        const event = press(document.body, 'l');

        expect(store.getState().sheet).toBe('none');
        expect(event.defaultPrevented).toBe(false);
    });

    it('badPath_anotherKeyIsLeftAlone', async () => {
        const { store } = await mountViewer(readyState());

        expect(press(document.body, 'x').defaultPrevented).toBe(false);
        expect(store.getState().sheet).toBe('none');
    });

    it('badPath_gone_noListenerRemains', async () => {
        const { store, element } = await mountViewer(readyState());

        element.remove();
        press(document.body, 'l');

        expect(store.getState().sheet).toBe('none');
    });

    it('badPath_aCommandTheStateRefusesDoesNothing', async () => {
        const { store, element } = await mountViewer(readyState(testManifest(), { lightbox: true }));

        element.runInput('layers');

        expect(store.getState().sheet).toBe('none');
    });

    it('happyPath_aToastAndWhetherTheMapIsCovered', async () => {
        const { store, element } = await mountViewer(readyState());

        element.toast('gamepad.ready');
        expect(store.getState().toast).toEqual({ key: 'gamepad.ready' });
        expect(element.mapCovered()).toBe(false);

        store.set({ sheet: 'about' });
        expect(element.mapCovered()).toBe(true);
        store.set({ sheet: 'none', webgl: false });
        expect(element.mapCovered()).toBe(true);
        store.set({ status: 'loading' });
        expect(element.mapCovered()).toBe(true);
        element.detach();
        expect(element.mapCovered()).toBe(true);
    });

    it('happyPath_theHandlersOfTheHelpPanelReachTheStore', async () => {
        const mounted = await mountViewer(readyState(testManifest(), { sheet: 'about' }));
        const about = part(mounted, 'hcm-about-dialog');

        fireKitEvent(about, 'hcm-help-open');
        expect(mounted.store.getState().sheet).toBe('help');
        fireKitEvent(about, 'hcm-shortcuts-change', { enabled: false });
        expect(mounted.store.getState().shortcuts).toBe(false);
    });
});
