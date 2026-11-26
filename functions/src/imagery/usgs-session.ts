/**
 * One USGS M2M session (`docs/research/M3-interfaces.md` §3.1): the ERS username and application token read from
 * Secret Manager at run time, `login-token` for an API key that is never logged, the work, and `logout` in a `finally`.
 * USGS's failures become the codes the Imagery area explains.
 */
import type { ApiErrorCode, SetupStatusDoc } from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { UpstreamError, type UpstreamFailure } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { usgsRecord } from './records.js';

export type UsgsSessionDeps = Pick<Ports, 'secrets' | 'usgs' | 'setup'>;

const USGS_CODES: Readonly<Partial<Record<UpstreamFailure, ApiErrorCode>>> = {
    unauthorized: 'apiError.usgs.credentials',
    forbidden: 'apiError.usgs.accessPending',
    maintenance: 'apiError.usgs.maintenance',
    unavailable: 'apiError.usgs.unavailable',
    rateLimited: 'apiError.rateLimited',
};

/** The code a USGS failure is answered with (anything else is rethrown as it is). */
export function usgsError(error: unknown): Error {
    const code = error instanceof UpstreamError && error.service === 'usgs' ? USGS_CODES[error.failure] : undefined;
    if (code !== undefined) {
        return new ApiError(code);
    }
    return error instanceof Error ? error : new Error(String(error));
}

type UsgsArea = NonNullable<SetupStatusDoc['usgs']>;

/**
 * USGS can be searched: approved, or waiting for the download role, or set up before (its role kept) but not answering
 * on its last check: a maintenance window of the daily check must not lock the Imagery area for six hours (CR-M3-47);
 * USGS answers each call with its own maintenance or outage then.
 */
export function usgsSearchable(record: UsgsArea | undefined): record is UsgsArea {
    return (
        record !== undefined &&
        (record.state === 'ok' || record.state === 'pending' || (record.state === 'unavailable' && record.role !== undefined))
    );
}

/** USGS lets the account download: the `download` role, approved (or not answering on its last check). */
export function usgsDownloads(record: UsgsArea): boolean {
    return record.role === 'download' && (record.state === 'ok' || record.state === 'unavailable');
}

/** The USGS record when the area can be searched, else `apiError.usgs.notConfigured`. */
export async function requireUsgs(setup: Ports['setup']): Promise<UsgsArea> {
    const record = await usgsRecord(setup);
    if (!usgsSearchable(record)) {
        throw new ApiError('apiError.usgs.notConfigured');
    }
    return record;
}

async function credentials(secrets: Ports['secrets']): Promise<{ readonly username: string; readonly token: string }> {
    const [username, token] = await Promise.all([secrets.read('usgs-username'), secrets.read('usgs-app-token')]);
    if (username === undefined || token === undefined) {
        throw new ApiError('apiError.usgs.notConfigured');
    }
    return { username, token };
}

/** Runs `work` with a fresh API key, logging out afterwards whatever happened; USGS failures become API codes. */
export async function withUsgs<T>(deps: UsgsSessionDeps, work: (apiKey: string) => Promise<T>): Promise<T> {
    const { username, token } = await credentials(deps.secrets);
    const apiKey = await deps.usgs.login(username, token).catch((error: unknown) => {
        throw usgsError(error);
    });
    try {
        return await work(apiKey);
    } catch (error) {
        throw usgsError(error);
    } finally {
        await deps.usgs.logout(apiKey);
    }
}
