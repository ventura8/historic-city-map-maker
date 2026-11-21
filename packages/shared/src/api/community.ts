/**
 * M13's callables (`docs/research/M13-roles.md`): the Contribute page's (any verified Google account), the review queue's
 * and the suggestions' (a city's reviewers) and the role requests' decision (a city's owners).
 */
import { z } from 'zod';

import { CITY_ROLES } from '../schemas/city-roles.js';
import { uidSchema } from '../schemas/firestore-common.js';
import { cityIdSchema } from '../schemas/paths.js';
import {
    bboxSchema,
    coded,
    httpsUrlSchema,
    idSchema,
    latLngSchema,
    localizedPartial,
    plainText,
    assetUrlSchema,
    yearSchema,
    bearingSchema,
} from '../schemas/primitives.js';
import {
    MAX_CREDIT,
    MAX_REASON,
    MAX_REVIEW_NOTE,
    REQUESTABLE_ROLES,
    ROLE_REQUEST_STATUSES,
    SUGGESTION_KINDS,
    suggestionProposalSchema,
} from '../schemas/review.js';
import { isoTimeSchema } from './common.js';

const creditField = plainText(MAX_CREDIT).optional();

/** `contribute.context`: what the Contribute page shows; with `photoId`, that public photo too. */
export const contributeContextRequestSchema = z.strictObject({ cityId: cityIdSchema, photoId: idSchema.optional() });

export const contributePhotoSchema = z.strictObject({
    id: idSchema,
    title: localizedPartial(200),
    thumb: assetUrlSchema,
    location: latLngSchema.optional(),
    bearing: bearingSchema.optional(),
    year: yearSchema.optional(),
    yearEnd: yearSchema.optional(),
    dateText: localizedPartial(100).optional(),
});

export const contributeContextResponseSchema = z.strictObject({
    city: z.strictObject({
        id: cityIdSchema,
        name: localizedPartial(100),
        bounds: bboxSchema,
        publicToken: z.string().max(2048).optional(),
    }),
    role: z.enum(CITY_ROLES).nullable(),
    blocked: z.boolean(),
    request: z
        .strictObject({
            role: z.enum(REQUESTABLE_ROLES),
            status: z.enum(ROLE_REQUEST_STATUSES),
            note: plainText(MAX_REVIEW_NOTE).optional(),
            /** When a refused account may ask again. */
            retryAt: isoTimeSchema.optional(),
        })
        .nullable(),
    photo: contributePhotoSchema.nullable(),
});

/** `contribute.request`: asks for a role in a city. */
export const contributeRequestSchema = z.strictObject({
    cityId: cityIdSchema,
    role: z.enum(REQUESTABLE_ROLES),
    reason: plainText(MAX_REASON),
    credit: creditField,
});
export const contributeResponseSchema = z.strictObject({ status: z.literal('pending') });

/** `contribute.decide`: a city's owner approves or refuses one account's request. */
export const roleRequestDecideRequestSchema = z.strictObject({
    cityId: cityIdSchema,
    uid: uidSchema,
    decision: z.enum(['approve', 'refuse']),
    note: plainText(MAX_REVIEW_NOTE).optional(),
});
export const roleRequestDecideResponseSchema = z.strictObject({ status: z.enum(['approved', 'refused']) });

/** `review.decide`: a reviewer approves or refuses an uploader's photo, place or (M17) story. */
export const reviewDecideRequestSchema = z
    .strictObject({
        cityId: cityIdSchema,
        entity: z.enum(['photo', 'poi', 'story']),
        id: idSchema,
        decision: z.enum(['approve', 'refuse']),
        /** The item's `updatedAt` as the reviewer read it: an approval is of what they saw, anything newer answers `review.changed`. */
        seenAt: isoTimeSchema.optional(),
        note: plainText(MAX_REVIEW_NOTE).optional(),
    })
    .refine((request) => request.decision !== 'approve' || request.seenAt !== undefined, coded('validation.required', ['seenAt']));
export const reviewDecideResponseSchema = z.strictObject({ status: z.enum(['approved', 'refused']) });

function changesSomething(proposal: z.infer<typeof suggestionProposalSchema>): boolean {
    return Object.values(proposal).some((value) => value !== undefined);
}

/**
 * `suggestions.submit`: a place for an unplaced photo (a location is required) or a correction of a placed one (a reason is
 * required). The account and the limits are checked by the server.
 */
export const suggestionSubmitRequestSchema = z
    .strictObject({
        cityId: cityIdSchema,
        photoId: idSchema,
        kind: z.enum(SUGGESTION_KINDS),
        proposal: suggestionProposalSchema,
        reason: plainText(MAX_REASON).optional(),
        sourceUrl: httpsUrlSchema.optional(),
        credit: creditField,
    })
    .refine((request) => changesSomething(request.proposal), coded('validation.required', ['proposal']))
    .refine(
        (request) => request.kind !== 'place' || request.proposal.location !== undefined,
        coded('validation.required', ['proposal', 'location']),
    )
    .refine((request) => request.kind !== 'correction' || request.reason !== undefined, coded('validation.required', ['reason']))
    .refine(
        (request) => request.proposal.bearing === undefined || request.proposal.location !== undefined || request.kind === 'correction',
        coded('validation.reference', ['proposal', 'bearing']),
    );

/** Whichever the account's standing, a repeat answers the same: nobody learns how to go around a decision. */
export const suggestionSubmitResponseSchema = z.strictObject({ received: z.literal(true), remainingToday: z.number().int().min(0) });

/** `suggestions.decide`: `adjust` needs the reviewer's values; `reject` applies nothing; `revert` takes one applied decision off. */
export const suggestionDecideRequestSchema = z
    .strictObject({
        cityId: cityIdSchema,
        suggestionId: idSchema,
        decision: z.enum(['approve', 'adjust', 'reject', 'revert']),
        adjusted: suggestionProposalSchema.optional(),
        note: plainText(MAX_REVIEW_NOTE).optional(),
    })
    .refine((request) => request.decision !== 'adjust' || request.adjusted !== undefined, coded('validation.required', ['adjusted']));
export const suggestionDecideResponseSchema = z.strictObject({ status: z.enum(['approved', 'adjusted', 'rejected', 'reverted']) });

/** `contributors.setBlocked`: a reviewer blocks or lets back one account of a city. */
export const contributorBlockRequestSchema = z.strictObject({
    cityId: cityIdSchema,
    uid: uidSchema,
    blocked: z.boolean(),
    /** What they had written, kept for whoever reads the list of blocked accounts later. */
    about: plainText(MAX_REASON).optional(),
});
export const contributorBlockResponseSchema = z.strictObject({ blocked: z.boolean() });

export type ContributeContextResponse = z.infer<typeof contributeContextResponseSchema>;
export type ContributePhoto = z.infer<typeof contributePhotoSchema>;

/** One row of M13's table, in the shape of `ADMIN_CALLABLES`. */
function row<
    Access extends 'signedIn' | 'cityReviewer' | 'cityOwner',
    Owner extends 'fn-admin' | 'fn-content',
    Request extends z.ZodType,
    Response extends z.ZodType,
>(access: Access, owner: Owner, request: Request, response: Response) {
    return { access, appCheck: 'enforce', maxInstances: 3, request, response, owner } as const;
}

/** M13's rows of `ADMIN_CALLABLES` (`docs/research/M13-roles.md` §§2 to 4). */
export const COMMUNITY_CALLABLES = {
    'contribute.context': row('signedIn', 'fn-admin', contributeContextRequestSchema, contributeContextResponseSchema),
    'contribute.request': row('signedIn', 'fn-admin', contributeRequestSchema, contributeResponseSchema),
    'contribute.decide': row('cityOwner', 'fn-admin', roleRequestDecideRequestSchema, roleRequestDecideResponseSchema),
    'review.decide': row('cityReviewer', 'fn-content', reviewDecideRequestSchema, reviewDecideResponseSchema),
    'suggestions.submit': row('signedIn', 'fn-content', suggestionSubmitRequestSchema, suggestionSubmitResponseSchema),
    'suggestions.decide': row('cityReviewer', 'fn-content', suggestionDecideRequestSchema, suggestionDecideResponseSchema),
    'contributors.setBlocked': row('cityReviewer', 'fn-content', contributorBlockRequestSchema, contributorBlockResponseSchema),
} as const;
