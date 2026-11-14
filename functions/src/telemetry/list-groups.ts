import '../global-options.js';

import { randomBytes } from 'node:crypto';

import { crashNoiseOf, redactText, type CallableRequest, type CallableResponse } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { createRateLimiter, type RateLimiter, type RateLimits } from './rate-limit.js';

export type ListGroupsDeps = Pick<Ports, 'errors' | 'log' | 'clock'>;

/**
 * §203: the crash list and the Statistics view read Error Reporting on a click only; an admin gets at most this many lists a
 * minute (a held-down Refresh), the instance three times that, before `apiError.rateLimited`.
 */
export const LIST_GROUPS_LIMITS: RateLimits = { perClientPerMinute: 20, perInstancePerMinute: 60 };

/** The role `groupStats.list` needs on the runtime service account (CR-M2-5). */
export const ERROR_REPORTING_VIEWER_ROLE = 'roles/errorreporting.viewer';

/** `listGroupsResponseSchema` keeps at most this much of a group's message. */
const MAX_MESSAGE = 500;
const MAX_FRAME = 300;
const MAX_PAGE = 2048;

type Group = CallableResponse<'telemetry.listGroups'>['groups'][number];

/** A refused call names the missing role or the disabled API; anything else Error Reporting fails with is "unavailable, retry". */
function toApiError(error: unknown, deps: ListGroupsDeps): never {
    if (!(error instanceof UpstreamError)) {
        throw error;
    }
    deps.log.warn('error reporting groups unavailable', { failure: error.failure, status: error.status });
    if (error.failure === 'forbidden' && error.api !== undefined) {
        throw new ApiError('apiError.cloud.apiDisabled', { api: error.api });
    }
    if (error.failure === 'forbidden') {
        throw new ApiError('apiError.cloud.permission', { role: ERROR_REPORTING_VIEWER_ROLE });
    }
    throw new ApiError('apiError.errorReporting.unavailable');
}

/**
 * `telemetry.listGroups` (admins; S-A22-HAPPY, S-A22-BAD-ERROR-REPORTING-UNAVAILABLE): the Setup Assistant's "Crash
 * reports" panel, newest group first. Every message is redacted again before it leaves (a group's representative
 * message is whatever a crashing page sent).
 */
async function telemetryListGroups(
    limiter: RateLimiter,
    deps: ListGroupsDeps,
    caller: VerifiedCaller,
    data: CallableRequest<'telemetry.listGroups'>,
): Promise<CallableResponse<'telemetry.listGroups'>> {
    if (!limiter.allow(caller.uid, deps.clock.now())) {
        deps.log.warn('error reporting groups limited', { limit: LIST_GROUPS_LIMITS.perClientPerMinute });
        throw new ApiError('apiError.rateLimited');
    }
    const page = await deps.errors.listGroups(data).catch((error: unknown) => toApiError(error, deps));
    const groups = page.groups.filter((group) => !noiseGroup(group, deps));
    return { ...page, groups: groups.map(redactGroup) };
}

/**
 * A group of errors the page did not cause (`crashNoiseOf`: Firefox for iOS's `__firefox__` reader script and the like, admin sweep
 * 2026-11-14), reported before the reporters dropped them: left out of the list, logged with its reason.
 */
function noiseGroup(group: Group, deps: ListGroupsDeps): boolean {
    const noise = crashNoiseOf({ message: group.message, stack: (group.frames ?? []).join('\n') });
    if (noise !== null) {
        deps.log.info('crash group left out as noise', { reason: noise, count: group.count });
    }
    return noise !== null;
}

/** Every free text of a group redacted again: the message, the top frames and the page. */
function redactGroup(group: Group): Group {
    const { frames, page } = group;
    return {
        ...group,
        message: redactText(group.message).slice(0, MAX_MESSAGE),
        ...(frames === undefined ? {} : { frames: frames.map((frame) => redactText(frame).slice(0, MAX_FRAME)) }),
        ...(page === undefined ? {} : { page: redactText(page).slice(0, MAX_PAGE) }),
    };
}

/** The `telemetry-listGroups` callable; its limiter counts per admin in this instance's memory (salted, hashed uids). */
export function listGroupsFunction(
    getDeps: () => ListGroupsDeps & CallableDeps,
    limiter: RateLimiter = createRateLimiter(randomBytes(16).toString('hex'), LIST_GROUPS_LIMITS),
) {
    return defineCallable('telemetry.listGroups', (deps, caller, data) => telemetryListGroups(limiter, deps, caller, data), getDeps);
}
