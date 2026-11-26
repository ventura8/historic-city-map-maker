/**
 * What the georeferencer shows of a fitted transform (`docs/research/M3-interfaces.md` §6.2, §10.4): `fitTransform` of `@hcm/shared`
 * (the same module `imagery.saveGcps` refits with) on every change, its errors, each pair's residual, how many pairs each
 * transform still lacks (a transform without enough is disabled with the count: `S-A16-BAD-TOO-FEW-GCPS`), and whether
 * the checkpoint error is over the city's threshold (a warning naming both; Save stays allowed).
 *
 * M15: while the pairs are the version's own, the page shows what the version page shows, the pipeline's figures and residuals,
 * and previews the map that is published: a frame over terrain through its RPC over the heights it carries (`terrainTransform`, as
 * the warp's `RPC_DEM`), a camera's `georef.lattice` through its nodes (`-tps`, as the warp renders it), both made by the georeferencer's
 * lazy chunk once it is in (`georef-extras.ts`, `extras.ts`), else the pairs' own fit.
 * Once they change, every figure and the preview are a refit through the pairs, and the page says so.
 */
import {
    enabledGcps,
    fitTransform,
    GEOREF_TRANSFORMS,
    MIN_GCPS,
    type FittedTransform,
    type Gcp,
    type Georef,
    type GeorefTransform,
    type LayerVersionDoc,
} from '@hcm/shared';

export interface FitView {
    /** Null when the fit is possible; else why not (too few enabled pairs, or a set that spans no area). */
    readonly refusal: 'too-few' | 'degenerate' | null;
    readonly fitRmseM: number | null;
    readonly checkpointRmseM: number | null;
    readonly checkpointCount: number;
    /** Ground metres by pair id. */
    readonly residuals: Readonly<Record<string, number>>;
    /** The enabled pairs each transform still needs (0: it can be chosen). */
    readonly missing: Readonly<Record<GeorefTransform, number>>;
    /** The checkpoint RMSE is over the city's threshold. */
    readonly overThreshold: boolean;
    /** The figures and the preview are a refit of edited pairs, not the version's own map. */
    readonly refitted: boolean;
}

export interface Fitted {
    readonly view: FitView;
    /** The fitted transform (the warped preview), null when refused. */
    readonly transform: FittedTransform | null;
}

function missingOf(pairs: readonly Gcp[]): Record<GeorefTransform, number> {
    const enabled = enabledGcps(pairs);
    return Object.fromEntries(GEOREF_TRANSFORMS.map((kind) => [kind, Math.max(0, MIN_GCPS[kind] - enabled)])) as Record<
        GeorefTransform,
        number
    >;
}

export function fitOf(kind: GeorefTransform, pairs: readonly Gcp[], thresholdM: number): Fitted {
    const missing = missingOf(pairs);
    const result = fitTransform(kind, pairs);
    if (!result.ok) {
        const view = {
            refusal: result.reason,
            fitRmseM: null,
            checkpointRmseM: null,
            checkpointCount: 0,
            residuals: {},
            missing,
            ...{ overThreshold: false, refitted: false },
        };
        return { view, transform: null };
    }
    const { fitRmseM, checkpointRmseM, checkpointCount } = result;
    return {
        view: {
            ...{ refusal: null, fitRmseM, checkpointRmseM, checkpointCount, residuals: Object.fromEntries(result.residuals), missing },
            overThreshold: isOver(checkpointRmseM, thresholdM),
            refitted: false,
        },
        transform: result.transform,
    };
}

function isOver(checkpointRmseM: number | null, thresholdM: number): boolean {
    return checkpointRmseM !== null && checkpointRmseM > thresholdM;
}

type OwnFigures = Pick<FitView, 'fitRmseM' | 'checkpointRmseM' | 'checkpointCount' | 'residuals'>;

/** The version's own map: its figures and residuals as stored, and the map it publishes (null: its pairs' own fit). */
export interface OwnFit {
    readonly figures: OwnFigures;
    readonly transform: FittedTransform | null;
    /**
     * A camera's lattice (and, over terrain, its RPC and heights) until `publishedMap` of the georeferencer's lazy chunk
     * (`georef-extras.ts`, fetched by `extras.ts`) made `transform` of them; else null.
     */
    readonly published: Pick<Georef, 'lattice' | 'terrain'> | null;
}

function residualsOf(gcps: readonly Gcp[]): Record<string, number> {
    return Object.fromEntries(gcps.flatMap((gcp) => (gcp.residualM === undefined ? [] : [[gcp.id, gcp.residualM]])));
}

function figuresOf(georef: Georef): OwnFigures {
    const { fitRmseM = null, checkpointRmseM = null, checkpointCount = 0 } = georef;
    return { fitRmseM, checkpointRmseM, checkpointCount, residuals: residualsOf(georef.gcps) };
}

/** What the version stored of its fit; null when it stored no figures and no lattice (corner guesses, an upload's own). */
export function ownFitOf(georef: Georef | undefined): OwnFit | null {
    if (georef === undefined || (georef.fitRmseM === undefined && georef.lattice === undefined)) {
        return null;
    }
    return { figures: figuresOf(georef), transform: null, published: georef.lattice === undefined ? null : georef };
}

/** The version's own figures and map while its pairs are unedited; else the refit, marked as one when the version had its own. */
export function shownFit(fitted: Fitted, own: OwnFit | null, edited: boolean, thresholdM: number): Fitted {
    if (own === null || fitted.view.refusal !== null) {
        return fitted;
    }
    if (edited) {
        return { ...fitted, view: { ...fitted.view, refitted: true } };
    }
    const view = { ...fitted.view, ...own.figures };
    return { view: { ...view, overThreshold: isOver(view.checkpointRmseM, thresholdM) }, transform: own.transform ?? fitted.transform };
}

/** The version's own pairs and transform (none yet: affine, no pairs): what Discard returns to and the unsaved guard compares with. */
export function baseOf(doc: LayerVersionDoc): { readonly pairs: readonly Gcp[]; readonly transform: GeorefTransform } {
    const georef = doc.georef;
    return georef === undefined ? { pairs: [], transform: 'affine' } : { pairs: georef.gcps, transform: georef.transform };
}
