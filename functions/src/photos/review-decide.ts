import '../global-options.js';

import {
    DERIVATIVE_WRITTEN_AT,
    FIRESTORE_PATHS,
    hasPlaceYear,
    IMMUTABLE_CACHE_CONTROL,
    STORAGE_PATHS,
    photoDocSchema,
    poiDocSchema,
    publicObjectUrl,
    storyDocSchema,
    timestampFromDate,
    timestampToDate,
    type CallableRequest,
    type CallableResponse,
    type HeldImage,
    type PhotoDoc,
    type PhotoVariant,
    type PoiDoc,
    type Schema,
    type StoryDoc,
    type TimestampLike,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';

export type ReviewDeps = Pick<Ports, 'documents' | 'blobs' | 'clock' | 'config' | 'log'>;

type Request = CallableRequest<'review.decide'>;

/** What a decision writes on the item, whichever kind it is. */
function verdict(data: Request, caller: VerifiedCaller, now: Date) {
    const at = timestampFromDate(now);
    return {
        ...(data.note === undefined ? {} : { reviewNote: data.note }),
        reviewStatus: data.decision === 'approve' ? ('approved' as const) : ('refused' as const),
        reviewedBy: caller.uid,
        reviewedAt: at,
        updatedBy: caller.uid,
        updatedAt: at,
    };
}

/** Still waiting, and still what the reviewer read: an approval is of what they saw (M13 §2), and every write moves `updatedAt`. */
function pendingItem<Item extends { readonly reviewStatus?: string | undefined; readonly updatedAt: TimestampLike }>(
    item: Item | undefined,
    data: Request,
): Item {
    if (item === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if (item.reviewStatus !== 'pending') {
        throw new ApiError('apiError.review.alreadyDecided');
    }
    if (data.seenAt !== undefined && timestampToDate(item.updatedAt).toISOString() !== data.seenAt) {
        throw new ApiError('apiError.review.changed');
    }
    return item;
}

/** A photo can be approved once processed and with a known licence: the rules ask no less of an editor who publishes. */
function requireApprovable(photo: PhotoDoc): HeldImage {
    if (photo.heldImage === undefined || photo.processing !== 'done') {
        throw new ApiError('apiError.review.notReady');
    }
    if (photo.license === 'unknown') {
        throw new ApiError('apiError.review.licenseUnknown');
    }
    return photo.heldImage;
}

/** One held derivative in the public bucket, content-hashed and immutable as any other; a repeat finds it there. */
async function moveOut(deps: ReviewDeps, data: Request, held: HeldImage, variant: PhotoVariant): Promise<string> {
    const path = STORAGE_PATHS.photoDerivative(data.cityId, data.id, held.sha256, variant);
    const bytes = await deps.blobs.read('private', held[variant]);
    await deps.blobs
        .write('public', path, bytes, {
            contentType: 'image/webp',
            cacheControl: IMMUTABLE_CACHE_CONTROL,
            ifGenerationMatch: 0,
            customMetadata: { [DERIVATIVE_WRITTEN_AT]: deps.clock.now().toISOString() },
        })
        .catch((error: unknown) => {
            if (!(error instanceof UpstreamError && error.failure === 'conflict')) {
                throw error;
            }
        });
    return publicObjectUrl(deps.config.buckets.public, path);
}

async function forgetHeld(deps: ReviewDeps, held: HeldImage | undefined): Promise<void> {
    if (held !== undefined) {
        await Promise.all([deps.blobs.delete('private', held.web), deps.blobs.delete('private', held.thumb)]);
    }
}

async function rewritePhoto(deps: ReviewDeps, data: Request, change: (photo: PhotoDoc) => PhotoDoc): Promise<void> {
    const path = FIRESTORE_PATHS.photo(data.cityId, data.id);
    await deps.documents.transaction(async (transaction) => {
        const photo = pendingItem(await transaction.get(path, photoDocSchema), data);
        await transaction.set(path, photoDocSchema, change(photo));
    });
}

/** Files first and the document after, so a public photo always has its pictures; a failure leaves it pending and retryable. */
async function approvePhoto(deps: ReviewDeps, caller: VerifiedCaller, data: Request): Promise<void> {
    const photo = pendingItem(await deps.documents.get(FIRESTORE_PATHS.photo(data.cityId, data.id), photoDocSchema), data);
    const held = requireApprovable(photo);
    const image = {
        web: await moveOut(deps, data, held, 'web'),
        thumb: await moveOut(deps, data, held, 'thumb'),
        sha256: held.sha256,
        w: held.w,
        h: held.h,
    };
    await rewritePhoto(deps, data, (current) => ({
        ...omit(current, ['heldImage']),
        image,
        published: true,
        ...verdict(data, caller, deps.clock.now()),
    }));
    await forgetHeld(deps, held);
}

async function refusePhoto(deps: ReviewDeps, caller: VerifiedCaller, data: Request): Promise<void> {
    const photo = await deps.documents.get(FIRESTORE_PATHS.photo(data.cityId, data.id), photoDocSchema);
    await rewritePhoto(deps, data, (current) => ({
        ...omit(current, ['heldImage']),
        published: false,
        ...verdict(data, caller, deps.clock.now()),
    }));
    await forgetHeld(deps, photo?.heldImage);
}

function decidePhoto(deps: ReviewDeps, caller: VerifiedCaller, data: Request): Promise<void> {
    return data.decision === 'approve' ? approvePhoto(deps, caller, data) : refusePhoto(deps, caller, data);
}

/** What a place and (M17) a story are to a decision: a document with nothing to move, only its verdict and `published`. */
interface Decidable {
    readonly published: boolean;
    readonly reviewStatus?: string | undefined;
    readonly updatedAt: TimestampLike;
}

/** Where a place or a story lives, and (a story) what an approval asks of it first. */
interface TextTarget<Doc> {
    readonly path: string;
    readonly schema: Schema<Doc>;
    readonly requireApprovable?: (item: Doc) => void;
}

/**
 * A story is approved with its text (M17 §2): the builder lists none without it, and an approved story is no longer the
 * uploader's to write, so an empty one would stay invisible and locked. Refusing it stays open.
 */
function requireStoryText(story: StoryDoc): void {
    if (story.body === undefined) {
        throw new ApiError('apiError.review.storyEmpty');
    }
}

/**
 * A place is approved with a year (owner request of 2026-11-12; `placeYearIssues` of @hcm/shared): the editor asks for
 * one before an uploader's Save, so only a place stored before the rule lacks it. Refusing it stays open.
 */
function requirePlaceYear(place: PoiDoc): void {
    if (!hasPlaceYear(place)) {
        throw new ApiError('apiError.review.placeYear');
    }
}

/** A place or a story: the verdict and `published` in one transaction. */
async function decideText<Doc extends Decidable>(
    deps: ReviewDeps,
    caller: VerifiedCaller,
    data: Request,
    at: TextTarget<Doc>,
): Promise<void> {
    await deps.documents.transaction(async (transaction) => {
        const item = pendingItem(await transaction.get(at.path, at.schema), data);
        if (data.decision === 'approve') {
            at.requireApprovable?.(item);
        }
        await transaction.set(at.path, at.schema, {
            ...item,
            published: data.decision === 'approve',
            ...verdict(data, caller, deps.clock.now()),
        });
    });
}

function decideItem(deps: ReviewDeps, caller: VerifiedCaller, data: Request): Promise<void> {
    if (data.entity === 'photo') {
        return decidePhoto(deps, caller, data);
    }
    return data.entity === 'poi'
        ? decideText(deps, caller, data, {
              path: FIRESTORE_PATHS.poi(data.cityId, data.id),
              schema: poiDocSchema,
              requireApprovable: requirePlaceYear,
          })
        : decideText(deps, caller, data, {
              path: FIRESTORE_PATHS.story(data.cityId, data.id),
              schema: storyDocSchema,
              requireApprovable: requireStoryText,
          });
}

/**
 * `review.decide` (a city's reviewers; `docs/research/M13-roles.md` §2; S-A90-HAPPY-APPROVE, S-A90-HAPPY-REFUSE,
 * S-A90-BAD-DECIDED-TWICE, S-A90-BAD-CHANGED-SINCE): the one door out of the queue. The write goes through `history.on*Write` as any edit and the publish
 * triggers rebuild the manifest; the note goes to the uploader.
 */
async function reviewDecide(deps: ReviewDeps, caller: VerifiedCaller, data: Request): Promise<CallableResponse<'review.decide'>> {
    await decideItem(deps, caller, data);
    deps.log.info('review decided', { by: caller.uid, cityId: data.cityId, entity: data.entity, id: data.id, decision: data.decision });
    return { status: data.decision === 'approve' ? 'approved' : 'refused' };
}

/** The `review-decide` callable. */
export function reviewFunctions(getDeps: () => ReviewDeps & CallableDeps) {
    return { decide: defineCallable('review.decide', reviewDecide, getDeps) };
}
