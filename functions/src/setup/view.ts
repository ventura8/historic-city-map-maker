import {
    PROVISION_ITEMS,
    setupInstallSchema,
    setupReady,
    setupStatusViewSchema,
    timestampSchema,
    timestampToDate,
    type Schema,
    type SetupStatusView,
} from '@hcm/shared';

/**
 * `setup/status` as the Setup Assistant sees it (`setupStatusViewSchema`, M2-interfaces §3.3), projected field by
 * field: a stored field the view does not know, or one that does not validate, is dropped (an area's state falls back
 * to `missing`, its `checkedAt` to null), so one malformed value never breaks the screen and nothing outside the view
 * schema (a secret written there by mistake, a token id, a retiring list) ever leaves the function
 * (S-A03-BAD-NOTHING-SECRET-LEAVES). Timestamps become ISO 8601 strings.
 */
type Fields = Readonly<Record<string, Schema<unknown>>>;
type StoredRecord = Readonly<Record<string, unknown>>;

const VIEW = setupStatusViewSchema.shape;
const ITEM = VIEW.provision.shape.items.element;

function isRecord(value: unknown): value is StoredRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A stored timestamp as ISO 8601; anything else as it is (the field's schema decides). */
function viewValue(value: unknown): unknown {
    const time = timestampSchema.safeParse(value);
    if (!time.success) {
        return value;
    }
    const date = timestampToDate(time.data);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** The fields of `stored` that `fields` knows and accepts. */
function validFields(fields: Fields, stored: unknown): Record<string, unknown> {
    const source = isRecord(stored) ? stored : {};
    return Object.fromEntries(
        Object.entries(fields).flatMap(([key, schema]) => {
            const value = viewValue(source[key]);
            return value !== undefined && schema.safeParse(value).success ? [[key, value]] : [];
        }),
    );
}

function area(fields: Fields, stored: unknown): Record<string, unknown> {
    return { state: 'missing', checkedAt: null, ...validFields(fields, stored) };
}

/** The doctor's items that still validate, at most one list's worth. */
function provisionItems(stored: unknown): unknown[] {
    const items = isRecord(stored) ? stored['items'] : undefined;
    return (Array.isArray(items) ? items : [])
        .map((item) => validFields(ITEM.shape, item))
        .filter((item) => ITEM.safeParse(item).success)
        .slice(0, PROVISION_ITEMS.length);
}

// [section install] owner: installer (M6, docs/research/M6-interfaces.md §1.7)
/** The install targets whose stored record still validates (an invalid one is dropped, never the whole view). */
function installView(stored: unknown): { install?: Record<string, unknown> } {
    const source = isRecord(stored) ? stored : {};
    const valid = Object.fromEntries(
        Object.entries(setupInstallSchema.shape).flatMap(([target, schema]) =>
            source[target] !== undefined && schema.safeParse(source[target]).success ? [[target, source[target]]] : [],
        ),
    );
    return Object.keys(valid).length === 0 ? {} : { install: valid };
}
// [end install]

function revision(value: unknown): number {
    return VIEW.secretsRev.safeParse(value).success ? Number(value) : 0;
}

/** The view of a stored `setup/status` (an empty record when the document does not exist yet). */
export function toSetupStatusView(record: StoredRecord, now: Date): SetupStatusView {
    const view = setupStatusViewSchema.parse({
        billing: area(VIEW.billing.shape, record['billing']),
        provision: { ...area(VIEW.provision.shape, record['provision']), items: provisionItems(record['provision']) },
        mapbox: area(VIEW.mapbox.shape, record['mapbox']),
        usgs: area(VIEW.usgs.shape, record['usgs']),
        analytics: area(VIEW.analytics.shape, record['analytics']),
        crash: area(VIEW.crash.shape, record['crash']),
        secretsRev: revision(record['secretsRev']),
        ready: false,
        generatedAt: now.toISOString(),
        ...installView(record['install']),
    });
    return { ...view, ready: setupReady(view) };
}
