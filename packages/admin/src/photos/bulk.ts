/**
 * Bulk actions on a selection of photos (`docs/research/M2c-interfaces.md` §1.5, §6.5; behaviours A10, A33): Publish,
 * Unpublish, Confirm rights, Set author, source and licence, Delete. Every document is checked first (the publish gate,
 * `photoDocSchema` over the document as read); the ones that cannot change are listed with their reason and left alone
 * (`S-A10-BAD-NOT-PUBLISHABLE`), the rest are written in Firestore batches of at most 500. A batch is all or none, so a
 * refused batch reports each of its photos.
 */
import { FIRESTORE_PATHS, photoDocSchema, validate, type PhotoDoc } from '@hcm/shared';

import { publishBlock, type PublishBlock } from './model.js';
import { MAX_BATCH_WRITES, type BatchWrite, type ContentStore, type Stored } from '../content/services.js';
import type { WriteFailure } from './messages.js';
import { definedSticky, type StickyFields } from './session.js';

export type BulkAction =
    | { readonly kind: 'publish' }
    | { readonly kind: 'unpublish' }
    | { readonly kind: 'confirmRights' }
    | { readonly kind: 'setFields'; readonly fields: StickyFields }
    | { readonly kind: 'delete' };

type BulkKind = BulkAction['kind'];

/** Why a photo was left alone: its publish gate, the source address, another value the schema refuses, or the batch's refusal. */
type SkipReason = PublishBlock | 'sourceUrl' | 'invalid' | WriteFailure;

interface BulkSkip {
    readonly id: string;
    readonly title: string;
    readonly reason: SkipReason;
}

export interface BulkReport {
    readonly kind: BulkKind;
    /** Photos changed (a photo already as asked counts as done: nothing to write). */
    readonly done: number;
    readonly skipped: readonly BulkSkip[];
}

type Plan = { readonly write: BatchWrite | null } | { readonly skip: SkipReason };

function update(path: string, photo: Stored<PhotoDoc>, fields: Readonly<Record<string, unknown>>): Plan {
    const result = validate(photoDocSchema, { ...photo.data, ...fields });
    if (result.ok) {
        return { write: { kind: 'update', path, fields } };
    }
    return { skip: result.issues.some((issue) => issue.path === 'sourceUrl') ? 'sourceUrl' : 'invalid' };
}

function publishPlan(path: string, photo: Stored<PhotoDoc>, checkPlace: boolean): Plan {
    const block = publishBlock(photo.data, checkPlace);
    if (block !== null) {
        return { skip: block };
    }
    return photo.data.published ? { write: null } : update(path, photo, { published: true });
}

/** Set author, source and licence: an empty field stays as it is; a published photo keeps a known licence. */
function setFieldsPlan(path: string, photo: Stored<PhotoDoc>, fields: StickyFields): Plan {
    if (photo.data.published && fields.license === 'unknown') {
        return { skip: 'license' };
    }
    return update(path, photo, definedSticky(fields));
}

interface PlanContext {
    readonly checkPlace: boolean;
    readonly fields: StickyFields;
}

type Planner = (photo: Stored<PhotoDoc>, path: string, context: PlanContext) => Plan;

const PLANNERS: Readonly<Record<BulkKind, Planner>> = {
    publish: (photo, path, context) => publishPlan(path, photo, context.checkPlace),
    unpublish: (photo, path) => (photo.data.published ? update(path, photo, { published: false }) : { write: null }),
    confirmRights: (photo, path) => (photo.data.rightsReview === true ? update(path, photo, { rightsReview: false }) : { write: null }),
    setFields: (photo, path, context) => setFieldsPlan(path, photo, context.fields),
    delete: (_photo, path) => ({ write: { kind: 'delete', path } }),
};

/** What one photo needs for `action`: a write, nothing (already so), or a skip with its reason. */
export function planFor(action: BulkAction, photo: Stored<PhotoDoc>, path: string, checkPlace: boolean): Plan {
    const fields = action.kind === 'setFields' ? action.fields : {};
    return PLANNERS[action.kind](photo, path, { checkPlace, fields });
}

export interface BulkDeps {
    readonly store: Pick<ContentStore, 'batch'>;
    readonly cityId: string;
    readonly checkPlace: (photoId: string) => boolean;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
    const out: T[][] = [];
    for (let start = 0; start < items.length; start += size) {
        out.push(items.slice(start, start + size));
    }
    return out;
}

interface Planned {
    readonly photo: Stored<PhotoDoc>;
    readonly plan: Plan;
}

const skipOf = (photo: Stored<PhotoDoc>, reason: SkipReason): BulkSkip => ({ id: photo.id, title: photo.data.title.ro, reason });

/** Runs `action` over `photos`, batch by batch; never rejects. */
export async function runBulk(deps: BulkDeps, action: BulkAction, photos: readonly Stored<PhotoDoc>[]): Promise<BulkReport> {
    const planned: Planned[] = photos.map((photo) => ({
        photo,
        plan: planFor(action, photo, FIRESTORE_PATHS.photo(deps.cityId, photo.id), deps.checkPlace(photo.id)),
    }));
    const skipped = planned.flatMap(({ photo, plan }) => ('skip' in plan ? [skipOf(photo, plan.skip)] : []));
    const writes = planned.flatMap(({ photo, plan }) => ('write' in plan && plan.write !== null ? [{ photo, write: plan.write }] : []));
    let done = planned.length - skipped.length - writes.length;
    for (const chunk of chunks(writes, MAX_BATCH_WRITES)) {
        const outcome = await deps.store.batch(chunk.map((entry) => entry.write));
        if (outcome.ok) {
            done += chunk.length;
        } else {
            skipped.push(...chunk.map((entry) => skipOf(entry.photo, outcome.reason)));
        }
    }
    return { kind: action.kind, done, skipped };
}
