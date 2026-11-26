/**
 * The installer's port (`docs/research/M6-interfaces.md` §1.10): what the install flows observe and submit, with the
 * owner's Google token (memory only, never stored, never in a build). The Cloud Build adapter
 * (`cloud-build-installer.ts`) implements it over Google's REST APIs; the flows' tests use the fake upstreams.
 */
import type { InstallTarget } from '@hcm/shared';

import type { CloudBuild } from '../google/cloud-build.js';
import type { BuildLogLine } from '../google/logging.js';
import type { InstalledInfo, InstallMessage } from './model.js';

/** The part of a Google access the installer needs. */
export interface InstallAccess {
    readonly token: string;
}

/** The server's functions against the registry (step d's count, finding 7: shown once). */
export interface ServerProgress {
    readonly ready: number;
    readonly total: number;
    /** Deployed names whose state is `FAILED`. */
    readonly failed: readonly string[];
}

/** One look at a target. */
export interface TargetObservation {
    readonly installed: InstalledInfo;
    /** The target's newest build (null: none yet). */
    readonly build: CloudBuild | null;
    /** The server's functions (the server only; null for the other targets). */
    readonly progress: ServerProgress | null;
    /** Why a build cannot be submitted now (null: it can). */
    readonly blocker: InstallMessage | null;
}

/** How a build is submitted. */
export interface SubmitOptions {
    /**
     * The owner confirmed "Install this admin's version anyway" over a newer release (a rollback, the live finding of
     * 2026-11-12): the build carries the tag `hcm-over`, so Cloud Build's history says so.
     */
    readonly over?: boolean;
}

export interface InstallerPort {
    observe(target: InstallTarget, access: InstallAccess): Promise<TargetObservation>;
    /** Submits the target's build of the admin's own bundle (rejects with a `GoogleApiError` or an `InstallBundleError`). */
    submit(target: InstallTarget, access: InstallAccess, options?: SubmitOptions): Promise<CloudBuild>;
    /** The build's log lines, oldest first, redacted. */
    buildLog(buildId: string, access: InstallAccess): Promise<readonly BuildLogLine[]>;
    /** The Google Cloud console's page of a build. */
    consoleUrl(buildId: string): string;
    /**
     * The target's blocker that needs no Google token (the site's `apiError.install.nothingToShow`: whether the first
     * city's manifest is published, read from Firestore), so a card whose token is gone still sees it lift; the pipeline's
     * `apiError.install.notAvailable` when this admin's bundle names no Docker builder (§67e; finding 43 of 2026-11-01:
     * read from the admin's own origin, so the card knows it before any look at Google; null while the bundle is unread).
     */
    localBlocker(target: InstallTarget): Promise<InstallMessage | null>;
}
