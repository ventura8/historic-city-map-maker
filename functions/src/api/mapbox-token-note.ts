import type { MapboxTokenAudience } from '@hcm/shared';

/** What a token minted for the project is for: a public token's audience, or the pipeline's secret tiles token. */
export type TokenPurpose = MapboxTokenAudience | 'tiles';

/**
 * The note that names a minted token in the Mapbox console (one per project, and per city for the viewer). Shared by the
 * Setup Assistant's mints (`functions/src/setup/mapbox-tokens.ts`) and `ops.tick`'s re-mint of a city's viewer token
 * (`functions/src/ops/viewer-tokens.ts`, M6), so a token is found again by its note whoever minted it.
 */
export function tokenNote(projectId: string, purpose: TokenPurpose, cityId?: string): string {
    const city = purpose === 'viewer' && cityId !== undefined ? ` ${cityId}` : '';
    return `historic-city-map ${projectId} ${purpose}${city} (auto)`;
}
