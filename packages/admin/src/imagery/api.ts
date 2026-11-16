/**
 * The imagery callables as the admin calls them (`docs/research/M3-interfaces.md` §9.1): the schemas of
 * `@hcm/shared`'s `api/imagery.ts`, called through the shell's guarded callables and their answers validated here. The
 * registry rows are fn-imagery's (CR-M3-3); until they land a name the registry does not know fails like any internal
 * error, so the admin says the server could not answer instead of breaking. A refusal becomes a notice: its
 * `apiError.*` code and parameters, which the pages translate.
 */
import {
    imageryApproveResponseSchema,
    imageryBrowseResponseSchema,
    imageryChooseResponseSchema,
    imageryConfirmRightsResponseSchema,
    imageryCropResponseSchema,
    imageryDeleteSupersededResponseSchema,
    imageryDeleteVersionResponseSchema,
    imageryImportResponseSchema,
    imageryJoinResponseSchema,
    imageryListSupersededResponseSchema,
    imageryLayoutResponseSchema,
    imageryPreviewUrlResponseSchema,
    imageryProbeResponseSchema,
    imageryRecalibrateResponseSchema,
    imageryRejectResponseSchema,
    imageryResumeGuardResponseSchema,
    imageryRetryResponseSchema,
    imagerySaveGcpsResponseSchema,
    imagerySearchResponseSchema,
    imageryStudioDoneResponseSchema,
} from '@hcm/shared';
import type {
    imageryApproveRequestSchema,
    imageryBrowseRequestSchema,
    imageryChooseRequestSchema,
    imageryConfirmRightsRequestSchema,
    imageryCropRequestSchema,
    imageryDeleteSupersededRequestSchema,
    imageryImportRequestSchema,
    imageryJoinRequestSchema,
    imageryListSupersededRequestSchema,
    imageryAcceptLayoutRequestSchema,
    imagerySaveLayoutRequestSchema,
    imageryProbeRequestSchema,
    imageryRecalibrateRequestSchema,
    imageryResumeGuardRequestSchema,
    imageryRetryRequestSchema,
    imagerySaveGcpsRequestSchema,
    imagerySearchRequestSchema,
    imageryVersionRequestSchema,
} from '@hcm/shared';
import type { z } from 'zod';

import { CallableFailure, type CallablesPort, type CallOptions } from '../firebase/ports.js';
import type { NoticeInput } from '../state/state.js';

/** Each imagery callable's response schema, which checks its answer. */
const IMAGERY_RESPONSES = {
    'imagery.search': imagerySearchResponseSchema,
    'imagery.browse': imageryBrowseResponseSchema,
    'imagery.import': imageryImportResponseSchema,
    'imagery.listSuperseded': imageryListSupersededResponseSchema,
    'imagery.deleteSuperseded': imageryDeleteSupersededResponseSchema,
    'imagery.join': imageryJoinResponseSchema,
    'imagery.approve': imageryApproveResponseSchema,
    'imagery.reject': imageryRejectResponseSchema,
    'imagery.confirmRights': imageryConfirmRightsResponseSchema,
    'imagery.deleteVersion': imageryDeleteVersionResponseSchema,
    'imagery.choose': imageryChooseResponseSchema,
    'imagery.studioDone': imageryStudioDoneResponseSchema,
    'imagery.saveGcps': imagerySaveGcpsResponseSchema,
    'imagery.crop': imageryCropResponseSchema,
    'imagery.retry': imageryRetryResponseSchema,
    'imagery.locateAgain': imageryRetryResponseSchema,
    'imagery.recalibrate': imageryRecalibrateResponseSchema,
    'imagery.previewUrl': imageryPreviewUrlResponseSchema,
    'imagery.probeTiles': imageryProbeResponseSchema,
    'imagery.resumeGuard': imageryResumeGuardResponseSchema,
    // The tile-import wizard (docs/research/M20-import-local.md §19.11).
    'imagery.saveLayout': imageryLayoutResponseSchema,
    'imagery.acceptLayout': imageryLayoutResponseSchema,
} as const;

/**
 * Each callable's request schema, as a type only: the server validates requests, so the admin's chunks carry no request schema (M16: the
 * bytes `editor-shared` needed for `imagery.recalibrate`).
 */
interface ImageryRequests {
    'imagery.search': typeof imagerySearchRequestSchema;
    'imagery.browse': typeof imageryBrowseRequestSchema;
    'imagery.import': typeof imageryImportRequestSchema;
    'imagery.listSuperseded': typeof imageryListSupersededRequestSchema;
    'imagery.deleteSuperseded': typeof imageryDeleteSupersededRequestSchema;
    'imagery.join': typeof imageryJoinRequestSchema;
    'imagery.approve': typeof imageryApproveRequestSchema;
    'imagery.reject': typeof imageryVersionRequestSchema;
    'imagery.confirmRights': typeof imageryConfirmRightsRequestSchema;
    'imagery.deleteVersion': typeof imageryVersionRequestSchema;
    'imagery.choose': typeof imageryChooseRequestSchema;
    'imagery.studioDone': typeof imageryVersionRequestSchema;
    'imagery.saveGcps': typeof imagerySaveGcpsRequestSchema;
    'imagery.crop': typeof imageryCropRequestSchema;
    'imagery.retry': typeof imageryRetryRequestSchema;
    'imagery.locateAgain': typeof imageryVersionRequestSchema;
    'imagery.recalibrate': typeof imageryRecalibrateRequestSchema;
    'imagery.previewUrl': typeof imageryVersionRequestSchema;
    'imagery.probeTiles': typeof imageryProbeRequestSchema;
    'imagery.resumeGuard': typeof imageryResumeGuardRequestSchema;
    'imagery.saveLayout': typeof imagerySaveLayoutRequestSchema;
    'imagery.acceptLayout': typeof imageryAcceptLayoutRequestSchema;
}

export type ImageryCallName = keyof typeof IMAGERY_RESPONSES;
export type ImageryRequest<N extends ImageryCallName> = z.input<ImageryRequests[N]>;
export type ImageryResponse<N extends ImageryCallName> = z.output<(typeof IMAGERY_RESPONSES)[N]>;

/** The shell's `call` without the registry's names (CR-M3-3 adds the imagery rows). */
type AnyCall = (name: string, request: unknown, options: CallOptions) => Promise<unknown>;

const INTERNAL = (): CallableFailure => new CallableFailure('internal', { code: 'apiError.internal' });

/** Calls `name`; rejects with a `CallableFailure` (an answer that fails its schema, or any other error, is internal). */
export async function callImagery<N extends ImageryCallName>(
    callables: CallablesPort,
    name: N,
    request: ImageryRequest<N>,
    options: CallOptions = {},
): Promise<ImageryResponse<N>> {
    const call = callables.call.bind(callables) as unknown as AnyCall;
    let answer: unknown;
    try {
        answer = await call(name, request, options);
    } catch (error) {
        throw error instanceof CallableFailure ? error : INTERNAL();
    }
    const parsed = IMAGERY_RESPONSES[name].safeParse(answer);
    if (!parsed.success) {
        throw INTERNAL();
    }
    return parsed.data as ImageryResponse<N>;
}

/** A failed call as a notice (a failure that is no callable's, such as the network, is `apiError.unavailable`). */
export function refusalOf(error: unknown): NoticeInput {
    if (!(error instanceof CallableFailure)) {
        return { key: 'apiError.unavailable' };
    }
    const { code, params } = error.details;
    return params === undefined ? { key: code } : { key: code, params };
}
