import { withOverlayOpacity, withOverlayVisibility, type Overlay } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { OverlayChangeTracker, overlayEvents, viewerEvents } from '../../src/viewer/events.js';
import { idleState, readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';

describe('viewerEvents: boot', () => {
    it('happyPath_readyOnceWithTheCounts', () => {
        const tracker = new OverlayChangeTracker();
        const ready = readyState();

        expect(viewerEvents(idleState(), ready, tracker, '1.2.3')).toEqual([
            { type: 'hcm-ready', detail: { cityId: 'bucuresti', engineVersion: '1.2.3', layers: 2, photos: 3 } },
        ]);
        expect(viewerEvents(ready, { ...ready }, tracker, '1.2.3')).toEqual([]);
    });

    it('badPath_errorCarriesItsCodeAndDetail', () => {
        const tracker = new OverlayChangeTracker();
        const loading = { ...idleState(), status: 'loading' as const };
        const error = { ...loading, status: 'error' as const, error: { code: 'error.manifest.notFound' as const, retryable: true } };
        const invalid = {
            ...loading,
            status: 'error' as const,
            error: { code: 'error.config.invalid' as const, retryable: false, params: { detail: 'manifestUrl' } },
        };

        expect(viewerEvents(loading, error, tracker, '1.0.0')).toEqual([
            { type: 'hcm-error', detail: { code: 'error.manifest.notFound', retryable: true } },
        ]);
        expect(viewerEvents(loading, invalid, tracker, '1.0.0')).toEqual([
            { type: 'hcm-error', detail: { code: 'error.config.invalid', retryable: false, detail: 'manifestUrl' } },
        ]);
    });

    it('badPath_anErrorStatusWithoutAnErrorOrAReadyStatusWithoutAManifestFiresNothing', () => {
        const tracker = new OverlayChangeTracker();

        expect(viewerEvents(idleState(), { ...idleState(), status: 'error' }, tracker, '1.0.0')).toEqual([]);
        expect(viewerEvents(idleState(), { ...idleState(), status: 'ready' }, tracker, '1.0.0')).toEqual([]);
        expect(viewerEvents(idleState(), { ...idleState(), status: 'loading' }, tracker, '1.0.0')).toEqual([]);
    });
});

describe('viewerEvents: selections', () => {
    it('happyPath_photoAndPoiOpen', () => {
        const tracker = new OverlayChangeTracker();
        const ready = readyState();
        const photo = { ...ready, selectedPhotoId: 'uranus-1984' };
        const poi = { ...photo, selectedPoiId: 'cvartal' };

        expect(viewerEvents(ready, photo, tracker, '1.0.0')).toEqual([{ type: 'hcm-photo-open', detail: { photoId: 'uranus-1984' } }]);
        expect(viewerEvents(photo, poi, tracker, '1.0.0')).toEqual([{ type: 'hcm-poi-open', detail: { poiId: 'cvartal' } }]);
    });

    it('badPath_closingOrKeepingASelectionFiresNothing', () => {
        const tracker = new OverlayChangeTracker();
        const open = readyState(testManifest(), { selectedPhotoId: 'uranus-1984', selectedPoiId: 'cvartal' });

        expect(viewerEvents(open, { ...open, selectedPhotoId: null, selectedPoiId: null }, tracker, '1.0.0')).toEqual([]);
        expect(viewerEvents(open, { ...open, sheet: 'photo' }, tracker, '1.0.0')).toEqual([]);
    });
});

describe('viewerEvents: overlays', () => {
    function started(): { tracker: OverlayChangeTracker; ready: ReturnType<typeof readyState> } {
        const tracker = new OverlayChangeTracker();
        const ready = readyState();
        viewerEvents(idleState(), ready, tracker, '1.0.0');
        return { tracker, ready };
    }

    it('happyPath_aHistoricalLayerChangeFiresBothEvents', () => {
        const { tracker, ready } = started();
        const shown = { ...ready, overlays: withOverlayVisibility(ready.overlays, 'kh9-1977', true) };

        expect(viewerEvents(ready, shown, tracker, '1.0.0')).toEqual([
            { type: 'hcm-overlay-change', detail: { overlayId: 'kh9-1977', kind: 'raster', visible: true, opacity: 1 } },
            { type: 'hcm-layer-change', detail: { layerId: 'kh9-1977', visible: true, opacity: 1, year: 1977 } },
        ]);
    });

    it('happyPath_photosAndPoiOverlaysFireOverlayChangeOnly', () => {
        const { tracker, ready } = started();
        const faded = { ...ready, overlays: withOverlayOpacity(withOverlayOpacity(ready.overlays, 'photos', 0.5), 'cladiri', 0.2) };

        expect(viewerEvents(ready, faded, tracker, '1.0.0').map((event) => event.detail['overlayId'])).toEqual(['photos', 'cladiri']);
    });

    it('badPath_aDraggedSliderIsHeldBackUntilRelease', () => {
        const { tracker, ready } = started();
        tracker.drag('photos', false);
        const dragging = { ...ready, overlays: withOverlayOpacity(ready.overlays, 'photos', 0.4) };

        expect(viewerEvents(ready, dragging, tracker, '1.0.0')).toEqual([]);

        tracker.drag('photos', true);
        expect(tracker.changes(dragging.overlays).map((overlay) => overlay.id)).toEqual(['photos']);
        expect(tracker.changes(dragging.overlays)).toEqual([]);
    });

    it('badPath_noChangesBeforeReadyOrWithTheSameList', () => {
        const { tracker, ready } = started();

        expect(viewerEvents(ready, { ...ready, year: 1966 }, tracker, '1.0.0')).toEqual([]);
        const loading = { ...ready, status: 'loading' as const, overlays: withOverlayVisibility(ready.overlays, 'photos', false) };
        expect(viewerEvents(ready, loading, tracker, '1.0.0')).toEqual([]);
        expect(viewerEvents(ready, { ...ready, manifest: null, overlays: [] }, tracker, '1.0.0')).toEqual([]);
    });

    it('badPath_anUnknownOverlayIsAnnouncedOnceAndARasterWithoutItsLayerOnlyAsAnOverlay', () => {
        const tracker = new OverlayChangeTracker();
        const stray: Overlay = {
            id: 'missing-layer',
            kind: 'raster',
            label: { ro: 'Strat', en: 'Layer' },
            visible: true,
            opacity: 1,
            defaultVisible: true,
            defaultOpacity: 1,
        };
        const changed = tracker.changes([stray]);

        const overlayOnly = [
            { type: 'hcm-overlay-change', detail: { overlayId: 'missing-layer', kind: 'raster', visible: true, opacity: 1 } },
        ];
        expect(overlayEvents(changed, testManifest())).toEqual(overlayOnly);
        expect(overlayEvents(changed, null)).toEqual(overlayOnly);
    });
});

describe('viewerEvents: swipe compare (M4, V06)', () => {
    const tracker = new OverlayChangeTracker();
    const ready = { ...readyState(), windowClass: 'large' as const };
    const open = { ...ready, compare: { layerId: 'kh9-1977', position: 0.5 } };

    it('happyPath_openingMovingSwitchingModeAndClosingAreAnnounced', () => {
        const moved = { ...open, compare: { layerId: 'kh9-1977', position: 0.3 } };
        const compact = { ...moved, windowClass: 'compact' as const };

        expect(viewerEvents(ready, open, tracker, '1.0.0')).toEqual([
            { type: 'hcm-compare-change', detail: { open: true, mode: 'swipe', layerId: 'kh9-1977', position: 0.5 } },
        ]);
        expect(viewerEvents(open, moved, tracker, '1.0.0').map((event) => event.detail)).toEqual([
            { open: true, mode: 'swipe', layerId: 'kh9-1977', position: 0.3 },
        ]);
        expect(viewerEvents(moved, compact, tracker, '1.0.0').map((event) => event.detail)).toEqual([
            { open: true, mode: 'toggle', layerId: 'kh9-1977', position: 0.3 },
        ]);
        expect(viewerEvents(compact, ready, tracker, '1.0.0').map((event) => event.detail)).toEqual([
            { open: false, mode: null, layerId: null, position: null },
        ]);
    });

    it('badPath_aCompareFromTheHashWaitsForReadyAndAnUnchangedOneIsSilent', () => {
        const loading = { ...open, status: 'loading' as const };

        expect(viewerEvents(idleState(), loading, tracker, '1.0.0')).toEqual([]);
        expect(viewerEvents(open, { ...open, compare: { ...open.compare } }, tracker, '1.0.0')).toEqual([]);
        expect(viewerEvents(loading, open, tracker, '1.0.0').map((event) => event.type)).toEqual(['hcm-ready', 'hcm-compare-change']);
    });
});

describe('viewerEvents: map labels (V31)', () => {
    const tracker = new OverlayChangeTracker();
    const ready = readyState();
    const hidden = { ...ready, mapLabels: { ...ready.mapLabels, shown: { streets: false, pois: true } } };

    it('happyPath_aChangeFiresOnceWithBothLabels', () => {
        expect(viewerEvents(ready, hidden, tracker, '1.0.0')).toEqual([
            { type: 'hcm-map-labels-change', detail: { streets: false, pois: true } },
        ]);
        expect(viewerEvents(hidden, { ...hidden }, tracker, '1.0.0')).toEqual([]);
    });

    it('happyPath_aLinksChoiceFiresAfterTheReadyEvent', () => {
        const loading = { ...hidden, status: 'loading' as const };

        expect(viewerEvents(loading, hidden, tracker, '1.0.0').map((event) => event.type)).toEqual(['hcm-ready', 'hcm-map-labels-change']);
    });

    it('badPath_nothingFiresBeforeTheViewerIsReady', () => {
        const loading = { ...ready, status: 'loading' as const };
        const reloading = { ...hidden, status: 'loading' as const };

        expect(viewerEvents(loading, reloading, tracker, '1.0.0')).toEqual([]);
        expect(viewerEvents(hidden, reloading, tracker, '1.0.0')).toEqual([]);
    });
});
