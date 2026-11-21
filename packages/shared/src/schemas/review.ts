/**
 * M13's review queue, suggestions and role requests (`docs/research/M13-roles.md`): the fields a photo and a place carry
 * while they wait, and the three new documents of a city. Every field and document here is server-owned but for the
 * `reviewStatus: 'pending'` an uploader's create must carry (`firebase/firestore.rules`).
 */
import { z } from 'zod';

import { LOCALES } from '../i18n/index.js';

import { sha256Schema, stamp, timestampSchema, uidSchema } from './firestore-common.js';
import { daySchema, monthSchema } from './photo-date.js';
import {
    assetUrlSchema,
    bearingSchema,
    coded,
    httpsUrlSchema,
    idSchema,
    isoDateSchema,
    latLngSchema,
    localizedPartial,
    plainText,
    validYearRange,
    yearSchema,
} from './primitives.js';

/** The roles someone can ask for on the Contribute page; `owner` and `editor` only come by invitation. */
export const REQUESTABLE_ROLES = ['uploader', 'moderator'] as const;

export type RequestableRole = (typeof REQUESTABLE_ROLES)[number];

/** `pending` waits for a reviewer, `refused` stays private; a document without the field counts as approved. */
export const REVIEW_STATUSES = ['pending', 'approved', 'refused'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** The longest credit name, a reason and a reviewer's note. */
export const MAX_CREDIT = 100;
export const MAX_REASON = 1000;
export const MAX_REVIEW_NOTE = 500;

/** Suggestions one account may send one city in a day (M13 §4). */
export const SUGGESTIONS_PER_DAY = 20;
/** A refused account may ask for a role again after this many days. */
export const ROLE_REQUEST_RETRY_DAYS = 30;
/** Repeat suggestions group within this grid (about 110 m north to south) and these degrees of direction. */
export const SUGGESTION_GRID_DEGREES = 0.001;
export const SUGGESTION_BEARING_STEP = 30;
/** A group keeps this many accounts and this many reasons; `count` goes on. */
export const SUGGESTION_MAX_ACCOUNTS = 50;
export const SUGGESTION_MAX_REASONS = 10;

export const creditSchemaText = plainText(MAX_CREDIT);

/** The optional fields of `photoDocSchema` and `poiDocSchema` the queue adds. */
export const reviewFields = {
    reviewStatus: z.enum(REVIEW_STATUSES).optional(),
    reviewNote: plainText(MAX_REVIEW_NOTE).optional(),
    reviewedBy: uidSchema.optional(),
    reviewedAt: timestampSchema.optional(),
    /** The name a contributor asked to be credited under, shown publicly once approved. */
    credit: creditSchemaText.optional(),
};

/** A document approved or from before the queue may be public; the manifest builder asks this too. */
export function isReviewCleared(document: { readonly reviewStatus?: ReviewStatus | undefined }): boolean {
    return document.reviewStatus === undefined || document.reviewStatus === 'approved';
}

/** A pending photo's two derivatives in the private bucket (`STORAGE_PATHS.reviewHeld`), until approval moves them. */
export const heldImageSchema = z.strictObject({
    web: z.string().min(1).max(1024),
    thumb: z.string().min(1).max(1024),
    sha256: sha256Schema,
    w: z.number().int().min(1).max(20_000),
    h: z.number().int().min(1).max(20_000),
});

export const ROLE_REQUEST_STATUSES = ['pending', 'approved', 'refused'] as const;

/** `cities/{city}/roleRequests/{uid}`: readable by the city's owners only, for the address it holds. */
export const roleRequestDocSchema = z.strictObject({
    role: z.enum(REQUESTABLE_ROLES),
    reason: plainText(MAX_REASON),
    credit: creditSchemaText.optional(),
    email: z.string().max(254).optional(),
    displayName: plainText(200).optional(),
    status: z.enum(ROLE_REQUEST_STATUSES),
    note: plainText(MAX_REVIEW_NOTE).optional(),
    decidedBy: uidSchema.optional(),
    decidedAt: timestampSchema.optional(),
    createdAt: timestampSchema,
    ...stamp,
});

export const SUGGESTION_KINDS = ['place', 'correction'] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/** What a suggestion proposes: a place and a direction, a date, or both. */
export const suggestionProposalSchema = z
    .strictObject({
        location: latLngSchema.optional(),
        bearing: bearingSchema.optional(),
        year: yearSchema.optional(),
        yearEnd: yearSchema.optional(),
        dateText: plainText(100).optional(),
        /** The language `dateText` was typed in; Romanian when absent. */
        dateLocale: z.enum(LOCALES).optional(),
    })
    .refine(validYearRange, coded('validation.yearRange', ['yearEnd']))
    .refine(
        (proposal) => proposal.dateLocale === undefined || proposal.dateText !== undefined,
        coded('validation.reference', ['dateLocale']),
    );

export type SuggestionProposal = z.infer<typeof suggestionProposalSchema>;

/** `reverted`: an applied decision was taken off again (M13 §4). */
export const SUGGESTION_STATUSES = ['pending', 'approved', 'adjusted', 'rejected', 'reverted'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/** The fields of a photo one decision can write, as the photo stores them. */
const decidedFieldsSchema = z.strictObject({
    location: latLngSchema.optional(),
    bearing: bearingSchema.optional(),
    year: yearSchema.optional(),
    yearEnd: yearSchema.optional(),
    /** A year changed drops the old year's month and day, and a revert brings them back. */
    month: monthSchema.optional(),
    day: daySchema.optional(),
    dateText: localizedPartial(100).optional(),
    credit: creditSchemaText.optional(),
});

/** What one decision wrote and what stood there before: exactly that comes off again, and only while it still stands. */
const suggestionUndoSchema = z.strictObject({ before: decidedFieldsSchema, after: decidedFieldsSchema });

/** One person's words on a suggestion. `name` is their optional credit. */
const suggestionVoiceSchema = z.strictObject({
    uid: uidSchema,
    reason: plainText(MAX_REASON).optional(),
    sourceUrl: httpsUrlSchema.optional(),
    credit: creditSchemaText.optional(),
    at: timestampSchema,
});

/** `cities/{city}/suggestions/{group}`: one proposal for one photo, with everyone who made it. */
export const suggestionDocSchema = z.strictObject({
    photoId: idSchema,
    /** The photo's title and thumbnail when the group began: what the queue lists without reading every photo. */
    photoTitle: localizedPartial(200),
    photoThumb: assetUrlSchema,
    kind: z.enum(SUGGESTION_KINDS),
    proposal: suggestionProposalSchema,
    status: z.enum(SUGGESTION_STATUSES),
    /** How many accounts made this proposal. */
    count: z.number().int().min(1),
    accounts: z.array(uidSchema).max(SUGGESTION_MAX_ACCOUNTS),
    voices: z.array(suggestionVoiceSchema).max(SUGGESTION_MAX_REASONS),
    /** What the reviewer applied, when it differs from the proposal. */
    applied: suggestionProposalSchema.optional(),
    /** The way back of an applied decision, gone once it is taken. */
    undo: suggestionUndoSchema.optional(),
    note: plainText(MAX_REVIEW_NOTE).optional(),
    decidedBy: uidSchema.optional(),
    decidedAt: timestampSchema.optional(),
    createdAt: timestampSchema,
    ...stamp,
});

/** `cities/{city}/contributors/{uid}`: today's count and the block; no client reads or writes the counter. */
export const contributorDocSchema = z.strictObject({
    /** The day `count` is about (the server's clock). */
    day: isoDateSchema,
    count: z.number().int().min(0),
    blocked: z.boolean().optional(),
    blockedBy: uidSchema.optional(),
    blockedAt: timestampSchema.optional(),
    /** What they had written when they were blocked, so whoever reads the list later knows who this was. */
    blockedFor: plainText(MAX_REASON).optional(),
    ...stamp,
});

export type HeldImage = z.infer<typeof heldImageSchema>;
export type RoleRequestDoc = z.infer<typeof roleRequestDocSchema>;
export type SuggestionDoc = z.infer<typeof suggestionDocSchema>;
export type SuggestionUndo = z.infer<typeof suggestionUndoSchema>;
export type ContributorDoc = z.infer<typeof contributorDocSchema>;
