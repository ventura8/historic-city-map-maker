import '../global-options.js';

import {
    FIRESTORE_PATHS,
    ROLE_REQUEST_RETRY_DAYS,
    adminDocSchema,
    bboxFromRecord,
    cityDocSchema,
    cityRoleOf,
    contributorDocSchema,
    isReviewCleared,
    photoDocSchema,
    roleRequestDocSchema,
    strongerRole,
    timestampFromDate,
    timestampToDate,
    type AdminDoc,
    type CallableRequest,
    type CallableResponse,
    type CityDoc,
    type CityRole,
    type ContributePhoto,
    type PhotoDoc,
    type RoleRequestDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { emitNotification } from '../api/notification-event.js';
import { compact } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { displayNameOf } from './records.js';

export type ContributeDeps = Pick<Ports, 'documents' | 'auth' | 'clock' | 'log'>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a refused account may ask again. */
function retryAt(request: RoleRequestDoc): Date | undefined {
    if (request.status !== 'refused' || request.decidedAt === undefined) {
        return undefined;
    }
    return new Date(timestampToDate(request.decidedAt).getTime() + ROLE_REQUEST_RETRY_DAYS * DAY_MS);
}

/** What an applicant reads of their own request; the decision's author stays with the city. */
function requestView(request: RoleRequestDoc | undefined): CallableResponse<'contribute.context'>['request'] {
    if (request === undefined) {
        return null;
    }
    return compact<NonNullable<CallableResponse<'contribute.context'>['request']>>({
        role: request.role,
        status: request.status,
        note: request.note,
        retryAt: retryAt(request)?.toISOString(),
    });
}

/**
 * An approved request says nothing once the role is gone (`admins.revoke` leaves the document): they stand as anyone who has not
 * asked, and `contribute.request` already takes a new ask.
 */
function asIfAsked(request: RoleRequestDoc | undefined, role: CityRole | null): RoleRequestDoc | undefined {
    return request?.status === 'approved' && role === null ? undefined : request;
}

/** A photo the public may see: it is on the map or in the gallery. Anything else answers as if it did not exist. */
function publicPhoto(photo: PhotoDoc | undefined): photo is PhotoDoc & { readonly image: NonNullable<PhotoDoc['image']> } {
    return photo?.published === true && isReviewCleared(photo) && photo.image !== undefined;
}

function photoView(id: string, photo: PhotoDoc & { readonly image: NonNullable<PhotoDoc['image']> }): ContributePhoto {
    return compact<ContributePhoto>({
        id,
        title: photo.title,
        thumb: photo.image.thumb,
        location: photo.location,
        bearing: photo.bearing,
        year: photo.year,
        yearEnd: photo.yearEnd,
        dateText: photo.dateText,
    });
}

async function askedPhoto(deps: ContributeDeps, cityId: string, photoId: string | undefined): Promise<ContributePhoto | null> {
    if (photoId === undefined) {
        return null;
    }
    const photo = await deps.documents.get(FIRESTORE_PATHS.photo(cityId, photoId), photoDocSchema);
    if (!publicPhoto(photo)) {
        throw new ApiError('apiError.notFound');
    }
    return photoView(photoId, photo);
}

/** The city, for anyone once it is public, and for its own admins before. */
async function visibleCity(deps: ContributeDeps, cityId: string, role: CityRole | null): Promise<CityDoc> {
    const city = await deps.documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    if (city === undefined || (!city.published && role === null)) {
        throw new ApiError('apiError.notFound');
    }
    return city;
}

async function roleOf(deps: ContributeDeps, uid: string, cityId: string): Promise<CityRole | null> {
    return cityRoleOf((await deps.documents.get(FIRESTORE_PATHS.admin(uid), adminDocSchema))?.cities, cityId);
}

async function isBlocked(deps: Pick<ContributeDeps, 'documents'>, cityId: string, uid: string): Promise<boolean> {
    return (await deps.documents.get(FIRESTORE_PATHS.contributor(cityId, uid), contributorDocSchema))?.blocked === true;
}

function cityView(id: string, city: CityDoc): CallableResponse<'contribute.context'>['city'] {
    const [[west, south], [east, north]] = bboxFromRecord(city.bounds);
    return compact<CallableResponse<'contribute.context'>['city']>({
        id,
        name: city.name,
        bounds: [
            [west, south],
            [east, north],
        ],
        publicToken: city.mapbox?.publicToken,
    });
}

/**
 * `contribute.context` (any verified Google account; `docs/research/M13-roles.md` §3; S-A92-HAPPY-REQUEST, S-A92-BAD-REFUSED-TOLD,
 * S-A92-BAD-NOT-PUBLIC): what the Contribute page shows: the city's public name and view, the caller's standing, and the public
 * photo it was opened for. It reads with the Admin SDK, so a stranger needs no rule and no Firestore: this answer is all they
 * get, and a photo that is not public answers `apiError.notFound`.
 */
async function contributeContext(
    deps: ContributeDeps,
    caller: VerifiedCaller,
    data: CallableRequest<'contribute.context'>,
): Promise<CallableResponse<'contribute.context'>> {
    const role = await roleOf(deps, caller.uid, data.cityId);
    const city = await visibleCity(deps, data.cityId, role);
    const request = await deps.documents.get(FIRESTORE_PATHS.roleRequest(data.cityId, caller.uid), roleRequestDocSchema);
    return {
        city: cityView(data.cityId, city),
        role,
        blocked: await isBlocked(deps, data.cityId, caller.uid),
        request: requestView(asIfAsked(request, role)),
        photo: await askedPhoto(deps, data.cityId, data.photoId),
    };
}

/** A refused account waits; an approved one may ask for more. */
function refuseTooSoon(existing: RoleRequestDoc, now: Date): void {
    const retry = retryAt(existing);
    if (retry !== undefined && now.getTime() < retry.getTime()) {
        throw new ApiError('apiError.contribute.retryLater', { date: retry.toISOString().slice(0, 10) });
    }
}

/** One open request per account. */
function refuseRepeat(existing: RoleRequestDoc | undefined, now: Date): void {
    if (existing === undefined) {
        return;
    }
    if (existing.status === 'pending') {
        throw new ApiError('apiError.contribute.alreadyPending');
    }
    refuseTooSoon(existing, now);
}

/** A role that already covers the ask. */
function refuseCovered(admin: AdminDoc | undefined, data: CallableRequest<'contribute.request'>): void {
    const held = cityRoleOf(admin?.cities, data.cityId);
    if (held !== null && strongerRole(held, data.role) === held) {
        throw new ApiError('apiError.contribute.alreadyMember');
    }
}

interface Asking {
    readonly data: CallableRequest<'contribute.request'>;
    readonly caller: VerifiedCaller;
    readonly displayName: string | undefined;
    readonly now: Date;
}

function requestDoc(asking: Asking): RoleRequestDoc {
    const { data, caller, displayName, now } = asking;
    const at = timestampFromDate(now);
    return compact<RoleRequestDoc>({
        role: data.role,
        reason: data.reason,
        credit: data.credit,
        email: caller.email,
        displayName,
        status: 'pending',
        note: undefined,
        decidedBy: undefined,
        decidedAt: undefined,
        createdAt: at,
        updatedBy: caller.uid,
        updatedAt: at,
    });
}

/** Everything that may refuse the ask, read and written in one transaction, so two tabs make one request. */
async function writeRequest(transaction: DocumentTransaction, asking: Asking): Promise<void> {
    const { data, caller, now } = asking;
    const path = FIRESTORE_PATHS.roleRequest(data.cityId, caller.uid);
    const contributor = await transaction.get(FIRESTORE_PATHS.contributor(data.cityId, caller.uid), contributorDocSchema);
    if (contributor?.blocked === true) {
        throw new ApiError('apiError.contribute.blocked');
    }
    refuseCovered(await transaction.get(FIRESTORE_PATHS.admin(caller.uid), adminDocSchema), data);
    refuseRepeat(await transaction.get(path, roleRequestDocSchema), now);
    await transaction.set(path, roleRequestDocSchema, requestDoc(asking));
}

/**
 * `contribute.request` (any verified Google account; S-A92-HAPPY-REQUEST, S-A92-BAD-ALREADY-PENDING, S-A92-BAD-BLOCKED): asks for
 * `uploader` or `moderator`. A blocked account is refused, so is a repeat or an account whose role already covers it; the
 * city's owners hear of it. The address is kept for the owner to recognise the person, and never logged.
 */
async function contributeRequest(
    deps: ContributeDeps,
    caller: VerifiedCaller,
    data: CallableRequest<'contribute.request'>,
): Promise<CallableResponse<'contribute.request'>> {
    const city = await deps.documents.get(FIRESTORE_PATHS.city(data.cityId), cityDocSchema);
    if (city?.published !== true) {
        throw new ApiError('apiError.notFound');
    }
    const asking = { data, caller, displayName: await displayNameOf(deps.auth, caller.uid), now: deps.clock.now() };
    await deps.documents.transaction((transaction) => writeRequest(transaction, asking));
    await emitNotification(deps, 'admins', {
        kind: 'role.requested',
        parts: [data.cityId, caller.uid.replaceAll(/[^A-Za-z0-9_-]/g, '_').slice(0, 30), String(asking.now.getTime())],
        link: '#/review',
        cityId: data.cityId,
    });
    deps.log.info('role requested', { cityId: data.cityId, uid: caller.uid, role: data.role });
    return { status: 'pending' };
}

/** The `contribute-context` callable. */
export function contextFunction(getDeps: () => ContributeDeps & CallableDeps) {
    return defineCallable('contribute.context', contributeContext, getDeps);
}

/** The `contribute-request` callable. */
export function requestFunction(getDeps: () => ContributeDeps & CallableDeps) {
    return defineCallable('contribute.request', contributeRequest, getDeps);
}
