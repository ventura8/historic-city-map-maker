/**
 * What Settings → Export the city reads of the settings area (M5, `docs/research/M5-interfaces.md` §5.6), mirrored
 * structurally from `packages/admin/src/export/` (`@hcm/ui` sits below `@hcm/admin`); `packages/admin/test/app/admin-port.test.ts`
 * checks that the real store satisfies the settings port that holds it.
 */
import type { ApiErrorCode, ExportState } from '@hcm/shared';

import type { LoadStatusPort, StoreFailurePort } from '../area-port.js';

export interface ExportRecordPort {
    readonly id: string;
    readonly state: ExportState;
    readonly rasters: boolean;
    readonly bytes: number | null;
    readonly sha256: string | null;
    readonly counts: {
        readonly photos: number;
        readonly restrictedPhotos: number;
        readonly layers: number;
        readonly rasters: number;
        readonly pois: number;
    } | null;
    readonly expiresAt: string | null;
    readonly error: { readonly code: ApiErrorCode; readonly params: Readonly<Record<string, string>> } | null;
}

export interface ExportSectionPort {
    readonly status: LoadStatusPort;
    readonly failure: StoreFailurePort | null;
    readonly owner: boolean;
    readonly published: boolean;
    readonly latest: ExportRecordPort | null;
    readonly scans: { readonly count: number; readonly bytes: number };
    readonly includeScans: boolean;
    readonly starting: boolean;
    readonly downloading: boolean;
}

export interface ExportIntentsPort {
    setExportScans(on: boolean): void;
    startExport(): Promise<void>;
    downloadExport(): Promise<{ readonly url: string; readonly fileName: string } | null>;
    retryExport(): void;
}
