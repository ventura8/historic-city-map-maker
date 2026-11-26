/**
 * What the start page says when a step failed (`docs/research/M14-start-your-map.md` §3, §7): the reason in the catalogue
 * and what the owner can do about it. A failure never carries Google's own text or a URL it named.
 */
import type { StartKey } from '@hcm/shared';

import { GoogleApiError, type GoogleFailureKind } from '../google/failure.js';
import type { StartStepId } from './deploy.js';
import { StartFileError, StartReleaseError } from './files.js';

export const FIREBASE_CONSOLE = 'https://console.firebase.google.com/';
export const CLOUD_CONSOLE = 'https://console.cloud.google.com/';
export const QUOTA_REQUEST = 'https://support.google.com/code/contact/project_quota_increase';

export interface StartFailure {
    readonly key: StartKey;
    readonly params?: Readonly<Record<string, string>>;
    readonly link?: { readonly key: StartKey; readonly url: string };
    /** `again`: Try again; `consent`: Continue with Google; `form`: back to the form, which says why. */
    readonly action: 'again' | 'consent' | 'form';
}

interface FailureContext {
    readonly step: StartStepId;
    readonly projectId: string;
    readonly create: boolean;
    /** The terminal road's command. */
    readonly command: string;
}

const AGAIN = 'again';
/** The steps a refusal may mean the terms at: nothing of Firebase exists before them. */
const TERMS_STEPS: ReadonlySet<StartStepId> = new Set(['project', 'firebase']);
const REFUSALS: ReadonlySet<GoogleFailureKind> = new Set(['forbidden', 'invalid']);

/** A quota answer of `projects.create`: `QUOTA_EXCEEDED` (a 429, or Resource Manager's own precondition). */
function quota(error: GoogleApiError): boolean {
    return error.reason === 'QUOTA_EXCEEDED' || (error.kind === 'rateLimited' && error.status === 429);
}

/** Refused before any Firebase resource exists: what §3 reads as the terms, which only the console can accept. */
function termsFailure(context: FailureContext): StartFailure {
    const firebase = context.step === 'firebase';
    return {
        key: 'start.failure.terms',
        link: firebase
            ? { key: 'start.failure.termsLink', url: FIREBASE_CONSOLE }
            : { key: 'start.failure.cloudTermsLink', url: CLOUD_CONSOLE },
        action: AGAIN,
    };
}

/** A 400 of `projects.create` that names no precondition: the name or the id, which the form can change; Try again could not. */
function refusedValues(error: GoogleApiError): boolean {
    return error.kind === 'invalid' && error.reason !== 'FAILED_PRECONDITION';
}

function createFailure(error: GoogleApiError, context: FailureContext): StartFailure | null {
    if (error.kind === 'conflict') {
        return { key: 'start.failure.taken', params: { projectId: context.projectId }, action: 'form' };
    }
    if (refusedValues(error)) {
        return { key: 'start.failure.refused', action: 'form' };
    }
    return quota(error)
        ? { key: 'start.failure.quota', link: { key: 'start.failure.quotaLink', url: QUOTA_REQUEST }, action: 'form' }
        : null;
}

function projectFailure(error: GoogleApiError, context: FailureContext): StartFailure | null {
    return context.step === 'project' && context.create ? createFailure(error, context) : null;
}

function refusedFailure(error: GoogleApiError, context: FailureContext): StartFailure | null {
    if (error.kind === 'forbidden' && !context.create) {
        return { key: 'start.failure.permission', params: { projectId: context.projectId }, action: 'form' };
    }
    return REFUSALS.has(error.kind) && TERMS_STEPS.has(context.step) ? termsFailure(context) : null;
}

function otherFailure(error: GoogleApiError, context: FailureContext): StartFailure {
    if (error.status === 0) {
        return { key: 'start.failure.network', params: { host: error.host ?? '', command: context.command }, action: AGAIN };
    }
    return error.kind === 'unavailable' || error.kind === 'rateLimited'
        ? { key: 'start.failure.unavailable', action: AGAIN }
        : { key: 'start.failure.unknown', params: { step: context.step }, action: AGAIN };
}

function googleFailure(error: GoogleApiError, context: FailureContext): StartFailure {
    if (error.kind === 'unauthorized') {
        return { key: 'start.failure.expired', action: 'consent' };
    }
    return projectFailure(error, context) ?? refusedFailure(error, context) ?? otherFailure(error, context);
}

export function startFailureOf(error: unknown, context: FailureContext): StartFailure {
    if (error instanceof StartFileError) {
        return { key: 'start.failure.file', params: { path: error.path }, action: AGAIN };
    }
    if (error instanceof StartReleaseError) {
        return { key: 'start.failure.release', action: AGAIN };
    }
    return error instanceof GoogleApiError
        ? googleFailure(error, context)
        : { key: 'start.failure.unknown', params: { step: context.step }, action: AGAIN };
}
