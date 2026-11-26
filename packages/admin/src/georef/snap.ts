/**
 * M16 (`docs/research/M16-recalibrate.md` §0, §3; S-A89-*): Snap my points. On a published version or one waiting for approval, the points
 * the admin placed since the page opened (new manual pairs) are sent as rough points; the pipeline bends the current fit to them and the
 * dense matching snaps them and spreads tiles around them, in a new version. Part of the georeferencer's lazy chunk (`extras.ts`), fetched
 * the first time Snap is pressed; Save's request is `save-request.ts`.
 */
import { RECALIBRATE_MAX_POINTS, type Gcp, type RoughPoint } from '@hcm/shared';

import type { ContentServices } from '../content/services.js';
import { callImagery, refusalOf } from '../imagery/api.js';
import type { NoticeInput } from '../state/state.js';

/** The new manual pairs, as rough points; null for none, or more than the server takes. */
export function roughPointsOf(pairs: readonly Gcp[], base: readonly Gcp[]): RoughPoint[] | null {
    const known = new Set(base.map((pair) => pair.id));
    const rough = pairs.filter((pair) => pair.origin === 'manual' && pair.enabled && !known.has(pair.id));
    return rough.length === 0 || rough.length > RECALIBRATE_MAX_POINTS ? null : rough.map(({ pixel, geo }) => ({ pixel, geo }));
}

/** What a snap leaves on the page: the new version it opens, or why not. */
export interface Snapped {
    readonly saved: string | null;
    readonly refusal: NoticeInput | null;
}

const NONE: Snapped = { saved: null, refusal: { key: 'adminContent.georef.snapNone' } };

/** Sends the rough points of `version` (`imagery.recalibrate`, route `points`); refused in words with none to send. */
export async function snapped(
    services: Pick<ContentServices, 'cityId' | 'callables' | 'notify'>,
    version: { readonly id: string } | null,
    points: RoughPoint[] | null,
): Promise<Snapped> {
    if (version === null || points === null) {
        return NONE;
    }
    try {
        const request = { cityId: services.cityId, versionId: version.id, route: 'points' as const, points };
        const answer = await callImagery(services.callables, 'imagery.recalibrate', request);
        services.notify({ key: 'adminContent.georef.snapped' });
        return { saved: answer.versionId, refusal: null };
    } catch (error) {
        return { saved: null, refusal: refusalOf(error) };
    }
}
