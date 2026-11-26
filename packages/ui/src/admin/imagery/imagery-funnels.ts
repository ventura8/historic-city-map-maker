/**
 * The Imagery page's two funnels (`trackFunnel` of `@hcm/shared/funnels`, `docs/ARCHITECTURE.md` → *Wizard funnels*), each
 * only while its tab is on screen:
 *
 * - `usgs_import` (Find): the search, a scene chosen, its import asked for (the callable's own outcome is `admin_action`);
 *   a failed search and a refused import are errors by their keys;
 * - `upload` (Upload, a file from the web or the computer): the file chosen, its year, the upload, the check; a refused
 *   file and a failed upload or check are errors by their keys; the check done completes it.
 */
import { firstOpenStep, type FunnelSnapshot } from '@hcm/shared/funnels';

import type { ImageryViewState, UploadStatePort } from './imagery-port.js';

const USGS_ORDER = ['search', 'choose', 'import'] as const;
const UPLOAD_ORDER = ['choose', 'year', 'upload', 'check'] as const;

function usgsFunnel(view: ImageryViewState): FunnelSnapshot {
    const done = USGS_ORDER.filter(
        (step) =>
            ({
                search: view.search.phase === 'done',
                choose: view.detail?.kind === 'scene',
                import: view.importing !== null,
            })[step],
    );
    const errors = {
        ...(view.search.error === null ? {} : { search: view.search.error.key }),
        ...(view.importRefusal === null ? {} : { import: view.importRefusal.notice.key }),
    };
    return {
        wizard: 'usgs_import',
        order: USGS_ORDER,
        step: firstOpenStep(USGS_ORDER, done),
        done,
        errors,
        complete: view.importing !== null,
    };
}

/** The upload's steps done, by its phase. */
function uploadDone(upload: UploadStatePort): string[] {
    const sent = upload.phase === 'checking' || upload.phase === 'done';
    const done: Readonly<Record<(typeof UPLOAD_ORDER)[number], boolean>> = {
        choose: upload.fileName !== null && upload.phase !== 'refused',
        year: !upload.needsYear || upload.year !== '',
        upload: sent,
        check: upload.phase === 'done',
    };
    return UPLOAD_ORDER.filter((step) => done[step]);
}

/** The code a refused or failed upload shows: its refusal's key, else the phase's own. */
const PHASE_CODES = { refused: 'upload.refused', failed: 'upload.failed' } as const;

function codeOf(upload: UploadStatePort, phase: keyof typeof PHASE_CODES): string {
    return upload.refusal?.key ?? PHASE_CODES[phase];
}

/** The step a refusal or a failure belongs to: the file's choice, else the upload, else the check once it was sent. */
function uploadErrors(upload: UploadStatePort): Record<string, string> {
    const phase = upload.phase;
    if (phase !== 'refused' && phase !== 'failed') {
        return {};
    }
    const step = phase === 'refused' ? 'choose' : failedStep(upload);
    return { [step]: codeOf(upload, phase) };
}

function failedStep(upload: UploadStatePort): string {
    return upload.jobId === null ? 'upload' : 'check';
}

function uploadFunnel(upload: UploadStatePort): FunnelSnapshot {
    const done = uploadDone(upload);
    return {
        wizard: 'upload',
        order: UPLOAD_ORDER,
        step: firstOpenStep(UPLOAD_ORDER, done),
        done,
        errors: uploadErrors(upload),
        complete: upload.phase === 'done',
    };
}

/** The funnel of the tab on screen (Work has none). */
export function imageryFunnels(view: ImageryViewState): readonly FunnelSnapshot[] {
    if (view.tab === 'find') {
        return [usgsFunnel(view)];
    }
    return view.tab === 'upload' ? [uploadFunnel(view.upload)] : [];
}
