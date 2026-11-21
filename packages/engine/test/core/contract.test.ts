/**
 * Pins the engine-core contract of docs/research/M1-interfaces.md §4 and §6 at the type level: the names the viewer
 * (engine-ui) imports and their shapes. A change here is a contract change (a change request), not a refactor.
 */
import type { MapView, MessageKey, Overlay, ViewerLocale } from '@hcm/shared';
import type { WindowClass } from '@hcm/ui';
import { PHOTOS_OVERLAY_ID, type MapErrorKind, type MapEventMap, type ViewerMapPort, type PhotoPointProperties } from '@hcm/ui/map';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { initialState, type Toast } from '../../src/core/state.js';
import {
    createViewerStore,
    type SheetName,
    type ThemeMode,
    type ViewerActions,
    type ViewerDeps,
    type ViewerError,
    type ViewerLocation,
    type ViewerState,
    type ViewerStatus,
    type ViewerStore,
} from '../../src/core/store.js';
import type { TelemetryWindow } from '../../src/telemetry/telemetry.js';
import type { ConsentState, TelemetryPort } from '../../src/telemetry/telemetry-port.js';

describe('engine-core contract', () => {
    it('happyPath_theViewerStateHasTheContractFields', () => {
        expectTypeOf<ViewerStatus>().toEqualTypeOf<'idle' | 'loading' | 'ready' | 'error'>();
        expectTypeOf<ThemeMode>().toEqualTypeOf<'system' | 'light' | 'dark'>();
        expectTypeOf<SheetName>().toEqualTypeOf<
            'none' | 'layers' | 'photo' | 'poi' | 'photos' | 'unplaced' | 'stories' | 'about' | 'help' | 'settings'
        >();
        expectTypeOf<ViewerError['code']>().toEqualTypeOf<MessageKey>();
        expectTypeOf<ViewerState['locale']>().toEqualTypeOf<ViewerLocale>();
        expectTypeOf<ViewerState['view']>().toEqualTypeOf<MapView>();
        expectTypeOf<ViewerState['overlays']>().toEqualTypeOf<readonly Overlay[]>();
        expectTypeOf<ViewerState['windowClass']>().toEqualTypeOf<WindowClass>();
        expectTypeOf<ViewerState['consent']>().toEqualTypeOf<ConsentState>();
        expectTypeOf<ViewerState['toast']>().toEqualTypeOf<Toast | null>();
        expect(initialState('ro', 'system', 'unknown').status).toBe('idle');
    });

    it('happyPath_theStoreActionsAndDepsMatchTheContract', () => {
        expectTypeOf<ViewerStore>().toExtend<ViewerActions>();
        expectTypeOf<ViewerActions['toggleOverlay']>().toEqualTypeOf<(overlayId: string, visible?: boolean) => void>();
        expectTypeOf<ViewerActions['setOverlayOpacity']>().toEqualTypeOf<(overlayId: string, opacity: number, final?: boolean) => void>();
        expectTypeOf<ViewerDeps['map']>().toEqualTypeOf<ViewerMapPort>();
        expectTypeOf<ViewerDeps['telemetry']>().toEqualTypeOf<TelemetryPort>();
        expectTypeOf<ViewerDeps['location']>().toEqualTypeOf<ViewerLocation>();
        expectTypeOf<ViewerLocation['hash']>().toEqualTypeOf<string>();
        expect(createViewerStore).toBeTypeOf('function');
    });

    it('happyPath_theMapPortTypesMatchTheContract', () => {
        expectTypeOf<PhotoPointProperties['bearing']>().toEqualTypeOf<number | null>();
        expectTypeOf<MapErrorKind>().toEqualTypeOf<'style' | 'source' | 'tile' | 'webgl' | 'unknown'>();
        expectTypeOf<MapEventMap['error']['kind']>().toEqualTypeOf<MapErrorKind>();
        expectTypeOf<TelemetryWindow['location']['origin']>().toEqualTypeOf<string>();
        expect(PHOTOS_OVERLAY_ID).toBe('photos');
    });
});
