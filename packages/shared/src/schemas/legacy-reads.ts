/**
 * Reads that tolerate a record an older release or a hand edit left, where refusing the whole document would lock its owner out.
 *
 * A layer version its schema refuses (an older release's shape, or a writer that skipped validation) must still be endable by its owner
 * (finding of 2026-11-12: a KH-9 frame the pipeline stored with `scan.width` 258,271, over `MAX_SCAN_PIXELS`, could be neither rejected nor
 * cancelled, its job held the layer
 * busy for ever, and the tick's automatic search stopped on it). {@link layerVersionReadSchema} reads such a record without the
 * top-level fields the schema refuses (`scan`, `georef`, ...) and without the rule of which fields each state needs, so a page shows
 * it with Reject and Cancel, and an ending writes it back valid in its ended state (which needs none of them). A record whose required
 * fields (its layer, job, state, origin, label, year or stamps) fail is still refused: nothing could end it safely.
 */
import { z } from 'zod';

import { layerVersionFieldsSchema, type LayerVersionDoc } from './imagery.js';
import { setupStatusDocSchema, type SetupStatusDoc } from './firestore-ops.js';
import { validate, type Schema, type ValidationIssue } from './validation.js';

/** What {@link salvageLayerVersion} kept, and the top-level fields it left out. */
export interface SalvagedVersion {
    readonly version: LayerVersionDoc;
    readonly dropped: readonly string[];
}

/** `scan.width` → `scan`, `georef.gcps[0].pixel.x` → `georef`. */
function topField(issue: ValidationIssue): string {
    const end = issue.path.search(/[.[]/);
    return end === -1 ? issue.path : issue.path.slice(0, end);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The record without the fields of `issues`, validated again; undefined when a required field was among them. */
function withoutRefused(raw: Readonly<Record<string, unknown>>, issues: readonly ValidationIssue[]): SalvagedVersion | undefined {
    const dropped = [...new Set(issues.map(topField))];
    const kept = Object.fromEntries(Object.entries(raw).filter(([key]) => !dropped.includes(key)));
    const again = validate(layerVersionFieldsSchema, kept);
    return again.ok ? { version: again.value, dropped } : undefined;
}

/** A stored version as an ending may take it (see the module comment), or undefined when nothing can be kept. */
export function salvageLayerVersion(raw: unknown): SalvagedVersion | undefined {
    const parsed = validate(layerVersionFieldsSchema, raw);
    if (parsed.ok) {
        return { version: parsed.value, dropped: [] };
    }
    return isRecord(raw) ? withoutRefused(raw, parsed.issues) : undefined;
}

/**
 * `cities/{city}/layerVersions/{version}` for the paths that end a version (Reject, Cancel, Stop) and the pages that offer them. Never
 * a write's schema: writes use the strict `layerVersionDocSchema`.
 */
export const layerVersionReadSchema: Schema<LayerVersionDoc> = z.unknown().transform((raw, context) => {
    const salvaged = salvageLayerVersion(raw);
    if (salvaged === undefined) {
        context.addIssue({ code: 'custom', message: 'validation.invalid' });
        return z.NEVER;
    }
    return salvaged.version;
});

/** The areas of `setup/status`, each with its own schema. */
const AREAS = setupStatusDocSchema.shape;

/**
 * `setup/status` as a reader takes it: one malformed area (a record an older release or a hand edit left) reads as absent instead of
 * refusing the whole document, so every other area still answers, and the next write of the document leaves the bad area out (finding of
 * 2026-11-12: an `install` record stored with Firestore timestamps hid USGS from the Imagery area and failed every Setup write). Writers
 * still write with the strict {@link setupStatusDocSchema}; an unknown key is dropped on read.
 */
export const setupStatusReadSchema: Schema<SetupStatusDoc> = z.object({
    billing: AREAS.billing.catch(undefined),
    provision: AREAS.provision.catch(undefined),
    mapbox: AREAS.mapbox.catch(undefined),
    usgs: AREAS.usgs.catch(undefined),
    analytics: AREAS.analytics.catch(undefined),
    crash: AREAS.crash.catch(undefined),
    secretsRev: AREAS.secretsRev.catch(undefined),
    install: AREAS.install.catch(undefined),
    updatedBy: AREAS.updatedBy,
    updatedAt: AREAS.updatedAt,
});
