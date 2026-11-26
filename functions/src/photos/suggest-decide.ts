import '../global-options.js';

import {
    FIRESTORE_PATHS,
    cityDocSchema,
    contributorDocSchema,
    photoDocSchema,
    suggestionDocSchema,
    timestampFromDate,
    type CallableRequest,
    type CallableResponse,
    type ContributorDoc,
    type PhotoDoc,
    type SuggestionDoc,
    type SuggestionProposal,
    type SuggestionUndo,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { compact, omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { onCityMap } from './suggest.js';
import { photoWith, photoWithout, undoOf } from './suggest-apply.js';

export type SuggestDecideDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'suggestions.decide'>;

const STATUS_OF = { approve: 'approved', adjust: 'adjusted', reject: 'rejected', revert: 'reverted' } as const;

function appliedProposal(data: Request, group: SuggestionDoc): SuggestionProposal | undefined {
    if (data.decision === 'reject') {
        return undefined;
    }
    return data.decision === 'adjust' ? data.adjusted : group.proposal;
}

/** The first credit a group's people asked for, for a photo that has none. */
function creditOf(photo: PhotoDoc, group: SuggestionDoc): string | undefined {
    return photo.credit ?? group.voices.find((voice) => voice.credit !== undefined)?.credit;
}

interface Applying {
    readonly applied: SuggestionProposal;
    readonly stamp: Pick<PhotoDoc, 'updatedBy' | 'updatedAt'>;
}

function requireOpen(group: SuggestionDoc | undefined): SuggestionDoc {
    if (group === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if (group.status !== 'pending') {
        throw new ApiError('apiError.suggestion.alreadyDecided');
    }
    return group;
}

/**
 * The photo with what was approved, stamped by the reviewer, and the way back of exactly this decision (M13 §4). The history
 * trigger keeps the version before as for any edit.
 */
async function applyToPhoto(
    transaction: DocumentTransaction,
    cityId: string,
    group: SuggestionDoc,
    change: Applying,
): Promise<SuggestionUndo> {
    const { applied, stamp } = change;
    const path = FIRESTORE_PATHS.photo(cityId, group.photoId);
    const [photo, city] = [await transaction.get(path, photoDocSchema), await transaction.get(FIRESTORE_PATHS.city(cityId), cityDocSchema)];
    if (photo === undefined || city === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if (!onCityMap(city, applied.location)) {
        throw new ApiError('apiError.suggestion.outsideCity');
    }
    const credit = creditOf(photo, group);
    const after: PhotoDoc = { ...photoWith(photo, applied), ...(credit === undefined ? {} : { credit }), ...stamp };
    await transaction.set(path, photoDocSchema, after);
    return undoOf(photo, after);
}

/** Decided once, the photo and the group in one transaction: the public photo changes only here. */
async function decide(transaction: DocumentTransaction, data: Request, by: string, now: Date): Promise<void> {
    const path = FIRESTORE_PATHS.suggestion(data.cityId, data.suggestionId);
    const group = requireOpen(await transaction.get(path, suggestionDocSchema));
    const stamp = { updatedBy: by, updatedAt: timestampFromDate(now) };
    const applied = appliedProposal(data, group);
    const undo = applied === undefined ? undefined : await applyToPhoto(transaction, data.cityId, group, { applied, stamp });
    await transaction.set(path, suggestionDocSchema, {
        ...group,
        ...compact<Pick<SuggestionDoc, 'applied' | 'note' | 'undo'>>({
            applied: data.decision === 'adjust' ? applied : undefined,
            note: data.note,
            undo,
        }),
        status: STATUS_OF[data.decision],
        decidedBy: by,
        decidedAt: stamp.updatedAt,
        ...stamp,
    });
}

/** An applied decision that kept its way back; a rejected or reverted group has none, and one still open has nothing to take off. */
function requireRevertable(group: SuggestionDoc | undefined): SuggestionDoc & { readonly undo: SuggestionUndo } {
    if (group === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if (group.status === 'rejected' || group.status === 'reverted') {
        throw new ApiError('apiError.suggestion.alreadyDecided');
    }
    if (group.undo === undefined) {
        throw new ApiError('apiError.suggestion.notRevertable');
    }
    return group as SuggestionDoc & { readonly undo: SuggestionUndo };
}

/** One decision taken off, whatever else happened to the photo since: `history.onPhotoWrite` records this write as any other. */
async function revert(transaction: DocumentTransaction, data: Request, by: string, now: Date): Promise<void> {
    const path = FIRESTORE_PATHS.suggestion(data.cityId, data.suggestionId);
    const group = requireRevertable(await transaction.get(path, suggestionDocSchema));
    const photoPath = FIRESTORE_PATHS.photo(data.cityId, group.photoId);
    const photo = await transaction.get(photoPath, photoDocSchema);
    if (photo === undefined) {
        throw new ApiError('apiError.notFound');
    }
    const stamp = { updatedBy: by, updatedAt: timestampFromDate(now) };
    await transaction.set(photoPath, photoDocSchema, { ...photoWithout(photo, group.undo), ...stamp });
    await transaction.set(path, suggestionDocSchema, { ...omit(group, ['undo']), status: 'reverted', ...stamp });
}

/**
 * `suggestions.decide` (a city's reviewers; `docs/research/M13-roles.md` §4; S-A93-HAPPY-APPROVE, S-A93-HAPPY-ADJUST,
 * S-A93-HAPPY-REJECT, S-A93-HAPPY-REVERT, S-A93-BAD-DECIDED-TWICE, S-A93-BAD-REVERT-STALE): approve applies the proposal, adjust the
 * reviewer's values, reject nothing, revert takes one applied decision off.
 */
async function decideSuggestion(
    deps: SuggestDecideDeps,
    caller: VerifiedCaller,
    data: Request,
): Promise<CallableResponse<'suggestions.decide'>> {
    const decided = data.decision === 'revert' ? revert : decide;
    await deps.documents.transaction((transaction) => decided(transaction, data, caller.uid, deps.clock.now()));
    deps.log.info('suggestion decided', { by: caller.uid, cityId: data.cityId, id: data.suggestionId, decision: data.decision });
    return { status: STATUS_OF[data.decision] };
}

function blockedDoc(
    current: ContributorDoc | undefined,
    data: CallableRequest<'contributors.setBlocked'>,
    by: string,
    now: Date,
): ContributorDoc {
    const at = timestampFromDate(now);
    const rest = omit(current ?? { day: now.toISOString().slice(0, 10), count: 0 }, [
        'blocked',
        'blockedBy',
        'blockedAt',
        'blockedFor',
    ] as never[]);
    const block = compact<Pick<ContributorDoc, 'blocked' | 'blockedBy' | 'blockedAt' | 'blockedFor'>>({
        blocked: true,
        blockedBy: by,
        blockedAt: at,
        blockedFor: data.about,
    });
    return { ...rest, ...(data.blocked ? block : {}), updatedBy: by, updatedAt: at };
}

/**
 * `contributors.setBlocked` (a city's reviewers; S-A93-BAD-BLOCKED): an account of this city can no longer suggest or ask for a
 * role, or can again. It takes no role away: that is `admins.revoke`, the owner's.
 */
async function setBlocked(
    deps: SuggestDecideDeps,
    caller: VerifiedCaller,
    data: CallableRequest<'contributors.setBlocked'>,
): Promise<CallableResponse<'contributors.setBlocked'>> {
    const path = FIRESTORE_PATHS.contributor(data.cityId, data.uid);
    await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, contributorDocSchema);
        await transaction.set(path, contributorDocSchema, blockedDoc(current, data, caller.uid, deps.clock.now()));
    });
    deps.log.info('contributor block changed', { by: caller.uid, cityId: data.cityId, uid: data.uid, blocked: data.blocked });
    return { blocked: data.blocked };
}

/** The `suggestions-decide` and `contributors-setBlocked` callables. */
export function decideFunction(getDeps: () => SuggestDecideDeps & CallableDeps) {
    return defineCallable('suggestions.decide', decideSuggestion, getDeps);
}

export function contributorsFunctions(getDeps: () => SuggestDecideDeps & CallableDeps) {
    return { setBlocked: defineCallable('contributors.setBlocked', setBlocked, getDeps) };
}
