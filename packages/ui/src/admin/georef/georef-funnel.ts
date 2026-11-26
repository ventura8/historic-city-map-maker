/**
 * The georeferencer's funnel, Help-calibrate's too (`#/georef/<version>`; `trackFunnel` of `@hcm/shared/funnels`,
 * `docs/ARCHITECTURE.md` → *Wizard funnels*): the points (enough for a fit), Save, the approval. A point placed or removed
 * is a counted action of the points step (`points_added`, `points_removed`); a fit the points cannot make and a refused
 * save are errors by their codes; a version approved completes it.
 */
import type { LayerVersionState } from '@hcm/shared';
import type { FunnelSnapshot } from '@hcm/shared/funnels';

import type { GeorefViewState } from './georef-port.js';

const ORDER = ['points', 'save', 'approve'] as const;
const APPROVED: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>(['approved', 'publishing', 'published']);

type Step = (typeof ORDER)[number];

function doneSteps(view: GeorefViewState, approved: boolean): Step[] {
    const done: Readonly<Record<Step, boolean>> = {
        points: view.pairs.length > 0 && view.fit.refusal === null,
        save: view.saved !== null && !view.dirty,
        approve: approved,
    };
    return ORDER.filter((step) => done[step]);
}

/** A fit the points cannot make (once some are placed: none at all is the start, not an error) and a refused save. */
function errorsOf(view: GeorefViewState): Record<string, string> {
    const refusal = view.pairs.length > 0 ? view.fit.refusal : null;
    return {
        ...(refusal === null ? {} : { points: `georef.${refusal}` }),
        ...(view.refusal === null ? {} : { save: view.refusal.key }),
    };
}

/** Where the georeferencer stands; null until its version is read. */
export function georefFunnel(view: GeorefViewState): FunnelSnapshot | null {
    const version = view.version;
    if (version === null) {
        return null;
    }
    const approved = APPROVED.has(version.state);
    const done = doneSteps(view, approved);
    const step = ORDER.find((candidate) => !done.includes(candidate)) ?? 'approve';
    return {
        wizard: 'georef',
        order: ORDER,
        step,
        done,
        errors: errorsOf(view),
        complete: approved,
        counts: { points: view.pairs.length },
    };
}
