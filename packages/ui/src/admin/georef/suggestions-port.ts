/**
 * What the georeferencer's Suggestions panel reads of the store (`packages/admin/src/georef/suggestions.ts`,
 * `docs/research/M4-interfaces.md` §2.5), mirrored structurally because `@hcm/ui` sits below `@hcm/admin`; types only, so
 * `georef-port.ts` imports it without a cycle through the panel's texts.
 */
import type { Gcp } from '@hcm/shared';

type ConfidenceLevelPort = 'high' | 'medium' | 'low' | 'doubtful';

export interface SuggestionRowPort {
    readonly label: string;
    readonly pair: Gcp;
    readonly level: ConfidenceLevelPort;
    /** Ground metres from the page's current fit; null without a fit. */
    readonly offsetM: number | null;
}

/** What the panel reads of the georeferencer's state (`packages/admin/src/georef/suggestions.ts`). */
export interface SuggestionsViewPort {
    /** The matcher ran on the version: the panel shows, even with nothing left to decide. */
    readonly matched: boolean;
    readonly total: number;
    readonly pending: readonly SuggestionRowPort[];
    readonly selected: string | null;
    /** The reliable pairs' count of a version left waiting for points, else null. */
    readonly confident: string | null;
    /** Those pairs lie almost in a line (they are not too few). */
    readonly noSpread: boolean;
    /** The suggestions would put the map outside the city: the panel warns and offers no Accept all. */
    readonly outsideCity: boolean;
}
