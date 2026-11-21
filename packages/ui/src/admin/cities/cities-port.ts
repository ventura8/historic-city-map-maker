/**
 * The New city flow as its page reads it (`docs/research/M5-interfaces.md` §1.6), mirroring
 * `packages/admin/src/cities/new-city.ts` (checked at compile time by `packages/admin/test/app/admin-port.test.ts`).
 */
import type { CityBounds } from '@hcm/shared';

import type { AdminNoticeInputPort } from '../notice-port.js';

type MapStatusPort = 'none' | 'loading' | 'ready' | 'no-token' | 'no-webgl' | 'failed';

export interface NewCityViewState {
    readonly nameRo: string;
    readonly nameEn: string;
    readonly cityId: string;
    readonly idEdited: boolean;
    readonly bounds: CityBounds | null;
    readonly problem: 'validation.bounds' | 'validation.tooSmall' | 'validation.tooBig' | null;
    readonly located: string | null;
    readonly seed: string;
    readonly map: MapStatusPort;
    readonly busy: boolean;
    readonly error: AdminNoticeInputPort | null;
    readonly created: { readonly cityId: string; readonly name: string } | null;
}

export interface ScreenPointPort {
    readonly x: number;
    readonly y: number;
}

export interface NewCityIntentsPort {
    setNameRo(name: string): void;
    setNameEn(name: string): void;
    setId(cityId: string): void;
    setArea(bounds: CityBounds | null): void;
    dragArea(from: ScreenPointPort, to: ScreenPointPort, size: { readonly width: number; readonly height: number }): void;
    zoomBy(delta: number): void;
    attachMap(container: HTMLElement): void;
    detachMap(): void;
    create(): Promise<boolean>;
    startOver(): void;
}
