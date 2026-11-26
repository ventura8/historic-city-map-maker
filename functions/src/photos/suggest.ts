import '../global-options.js';

import { createHash } from 'node:crypto';

import {
    FIRESTORE_PATHS,
    PHOTO_LOCATION_SLACK_DEG,
    SUGGESTIONS_PER_DAY,
    SUGGESTION_BEARING_STEP,
    SUGGESTION_GRID_DEGREES,
    SUGGESTION_MAX_ACCOUNTS,
    SUGGESTION_MAX_REASONS,
    adminDocSchema,
    bboxContains,
    bboxExpand,
    bboxFromRecord,
    cityDocSchema,
    cityRoleOf,
    contributorDocSchema,
    isReviewCleared,
    photoDocSchema,
    suggestionDocSchema,
    timestampFromDate,
    type CallableRequest,
    type CallableResponse,
    type CityDoc,
    type ContributorDoc,
    type PhotoDoc,
    type SuggestionDoc,
    type SuggestionProposal,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { emitNotification } from '../api/notification-event.js';
import { compact } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { changedProposal } from './suggest-apply.js';

export type SuggestDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'suggestions.submit'>;

/** Whether `location` lies on the city's map: the bounds and the slack the manifest allows a photo. */
export function onCityMap(city: CityDoc, location: SuggestionProposal['location']): boolean {
    if (location === undefined) {
        return true;
    }
    return bboxContains(bboxExpand(bboxFromRecord(city.bounds), PHOTO_LOCATION_SLACK_DEG), [location.lng, location.lat]);
}

/** The cell of the grid a coordinate falls in. */
function cell(value: number): number {
    return Math.floor(value / SUGGESTION_GRID_DEGREES);
}

/**
 * M13 §4: the group of a proposal: the same photo, the same kind, the same cell of the map, the same sector of direction, the
 * same date. Repeats land on one document.
 */
export function suggestionGroupId(request: Pick<Request, 'photoId' | 'kind' | 'proposal'>): string {
    const { location, bearing, year, yearEnd, dateText, dateLocale } = request.proposal;
    const place = location === undefined ? '' : `${String(cell(location.lat))},${String(cell(location.lng))}`;
    const sector = bearing === undefined ? '' : String(Math.floor(bearing / SUGGESTION_BEARING_STEP));
    const date = [year, yearEnd, dateText, dateLocale].map((part) => String(part ?? ''));
    const key = [request.photoId, request.kind, place, sector, ...date].join('|');
    return createHash('sha256').update(key).digest('hex').slice(0, 40);
}

async function isMember(deps: SuggestDeps, caller: VerifiedCaller, cityId: string): Promise<boolean> {
    const admin = await deps.documents.get(FIRESTORE_PATHS.admin(caller.uid), adminDocSchema);
    return cityRoleOf(admin?.cities, cityId) !== null;
}

/** As `contribute.context`: the city is for anyone once it is public, and for its own people before; ids cannot be probed. */
async function visibleCity(deps: SuggestDeps, caller: VerifiedCaller, cityId: string): Promise<CityDoc> {
    const city = await deps.documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    if (city === undefined || (!city.published && !(await isMember(deps, caller, cityId)))) {
        throw new ApiError('apiError.notFound');
    }
    return city;
}

/** Only what the public sees can be suggested on. */
function isPublicPhoto(photo: PhotoDoc | undefined): photo is PhotoDoc {
    return photo?.published === true && isReviewCleared(photo) && photo.image !== undefined;
}

/** A place is for a photo with none, a correction for a photo that has one. */
function targetOf(photo: PhotoDoc | undefined, kind: Request['kind']): PhotoDoc {
    if (!isPublicPhoto(photo)) {
        throw new ApiError('apiError.notFound');
    }
    if ((kind === 'place') !== (photo.location === undefined)) {
        throw new ApiError('apiError.suggestion.wrongKind');
    }
    return photo;
}

function usedToday(contributor: ContributorDoc | undefined, today: string): number {
    return contributor?.day === today ? contributor.count : 0;
}

/** Today's count of the account; refuses a blocked account and the one over its limit. */
function countedToday(contributor: ContributorDoc | undefined, today: string): number {
    if (contributor?.blocked === true) {
        throw new ApiError('apiError.contribute.blocked');
    }
    const used = usedToday(contributor, today);
    if (used >= SUGGESTIONS_PER_DAY) {
        throw new ApiError('apiError.suggestion.dailyLimit', { max: String(SUGGESTIONS_PER_DAY) });
    }
    return used + 1;
}

interface Submission {
    readonly data: Request;
    readonly caller: VerifiedCaller;
    readonly now: Date;
}

function voiceOf({ data, caller, now }: Submission): SuggestionDoc['voices'][number] {
    return compact<SuggestionDoc['voices'][number]>({
        uid: caller.uid,
        reason: data.reason,
        sourceUrl: data.sourceUrl,
        credit: data.credit,
        at: timestampFromDate(now),
    });
}

function newGroup(submission: Submission, photo: PhotoDoc): SuggestionDoc {
    const { data, caller, now } = submission;
    const at = timestampFromDate(now);
    return {
        photoId: data.photoId,
        photoTitle: photo.title,
        photoThumb: photo.image?.thumb ?? '',
        kind: data.kind,
        proposal: data.proposal,
        status: 'pending',
        count: 1,
        accounts: [caller.uid],
        voices: [voiceOf(submission)],
        createdAt: at,
        updatedBy: caller.uid,
        updatedAt: at,
    };
}

/**
 * One more person in the group: counted once per account, their words kept while there is room. A decided group changes by
 * nothing but the count, so a repeat after a refusal reopens nothing.
 */
function joined(group: SuggestionDoc, submission: Submission): SuggestionDoc {
    const { caller, now } = submission;
    if (group.accounts.includes(caller.uid)) {
        return group;
    }
    const open = group.status === 'pending';
    return {
        ...group,
        count: group.count + 1,
        accounts: group.accounts.length < SUGGESTION_MAX_ACCOUNTS ? [...group.accounts, caller.uid] : group.accounts,
        voices: open && group.voices.length < SUGGESTION_MAX_REASONS ? [...group.voices, voiceOf(submission)] : group.voices,
        updatedBy: caller.uid,
        updatedAt: timestampFromDate(now),
    };
}

/** The limit and the group in one transaction. Whether the group is new is what the reviewers are told about. */
async function record(
    transaction: DocumentTransaction,
    submission: Submission,
    target: { readonly groupId: string; readonly photo: PhotoDoc },
): Promise<{ readonly isNew: boolean; readonly used: number }> {
    const { data, caller, now } = submission;
    const counter = FIRESTORE_PATHS.contributor(data.cityId, caller.uid);
    const today = now.toISOString().slice(0, 10);
    const contributor = await transaction.get(counter, contributorDocSchema);
    const used = countedToday(contributor, today);
    const groupPath = FIRESTORE_PATHS.suggestion(data.cityId, target.groupId);
    const group = await transaction.get(groupPath, suggestionDocSchema);
    const stamp = { updatedBy: caller.uid, updatedAt: timestampFromDate(now) };
    await transaction.set(counter, contributorDocSchema, { ...contributor, day: today, count: used, ...stamp });
    await transaction.set(
        groupPath,
        suggestionDocSchema,
        group === undefined ? newGroup(submission, target.photo) : joined(group, submission),
    );
    return { isNew: group === undefined, used };
}

/**
 * `suggestions.submit` (any verified Google account, no role; `docs/research/M13-roles.md` §4; S-A93-HAPPY-PLACE,
 * S-A93-HAPPY-CORRECTION, S-A93-BAD-DAILY-LIMIT, S-A93-BAD-BLOCKED, S-A93-BAD-OUTSIDE, S-A93-HAPPY-GROUP, S-A93-HAPPY-ONLY-CHANGED,
 * S-A93-BAD-NOT-PUBLIC-CITY): a place for an unplaced photo, or a contested date, location or direction of a
 * placed one, on public photos of a public city only. Only what would change is kept. Nothing public
 * changes here. A repeat of a decided proposal is answered like any other.
 */
async function submitSuggestion(
    deps: SuggestDeps,
    caller: VerifiedCaller,
    request: Request,
): Promise<CallableResponse<'suggestions.submit'>> {
    const city = await visibleCity(deps, caller, request.cityId);
    const target = targetOf(await deps.documents.get(FIRESTORE_PATHS.photo(request.cityId, request.photoId), photoDocSchema), request.kind);
    const proposal = changedProposal(target, request.proposal);
    if (!onCityMap(city, proposal.location)) {
        throw new ApiError('apiError.suggestion.outsideCity');
    }
    const data = { ...request, proposal };
    const groupId = suggestionGroupId(data);
    const submission = { data, caller, now: deps.clock.now() };
    const { isNew, used } = await deps.documents.transaction((transaction) => record(transaction, submission, { groupId, photo: target }));
    if (isNew) {
        await emitNotification(deps, 'photos', {
            kind: 'suggestion.waiting',
            parts: [data.cityId, groupId],
            link: '#/review',
            cityId: data.cityId,
        });
    }
    deps.log.info('suggestion received', { cityId: data.cityId, photoId: data.photoId, kind: data.kind, group: groupId, isNew });
    return { received: true, remainingToday: Math.max(0, SUGGESTIONS_PER_DAY - used) };
}

/** The `suggestions-submit` callable. */
export function submitFunction(getDeps: () => SuggestDeps & CallableDeps) {
    return defineCallable('suggestions.submit', submitSuggestion, getDeps);
}
