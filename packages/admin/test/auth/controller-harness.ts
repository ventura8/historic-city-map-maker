/**
 * The auth controller's test harness (`controller.test.ts`, `controller-contribute.test.ts`): a controller over the app's
 * fakes, with Google's verdicts, the start-up flag, this browser's memory of the server and the Contribute page's address.
 */
import { expect, vi } from 'vitest';

import { AuthController } from '../../src/auth/controller.js';
import { GoogleAccessStore } from '../../src/auth/google-access.js';
import { GoogleAccessService } from '../../src/auth/google-service.js';
import type { OwnershipVerdict } from '../../src/auth/ownership.js';
import type { AuthUser } from '../../src/firebase/ports.js';
import { GOOGLE_SCOPES } from '../../src/google/scopes.js';
import { FakeAuth, FakeCallables, FakeClock, FakeGoogle, MemoryStore, settle, shellStateAccess, testLog } from '../app/fakes.js';

export const READ_ONLY = [GOOGLE_SCOPES.cloudReadOnly];

export interface Options {
    readonly user?: AuthUser | null;
    readonly verdicts?: OwnershipVerdict[];
    readonly enabled?: boolean;
    readonly startUp?: boolean;
    /** An editor holds unsaved changes. */
    readonly unsaved?: () => boolean;
    /** This browser has had an answer from the server before. */
    readonly seen?: boolean;
    /** M4: what this browser forgets before sign-out (the uids it was called with are recorded). */
    readonly leaving?: boolean;
    /** M13: the page is the Contribute page. */
    readonly contributing?: () => boolean;
}

export function harness(options: Options = {}) {
    const auth = new FakeAuth();
    auth.user = options.user ?? null;
    const callables = new FakeCallables();
    const port = new FakeGoogle(auth);
    const clock = new FakeClock();
    const google = new GoogleAccessService({
        port,
        store: new GoogleAccessStore(() => clock.now()),
        currentUser: () => auth.currentUser(),
        locale: () => 'en',
    });
    const verdicts = options.verdicts ?? [{ kind: 'owner' }];
    const ownership = vi.fn((token: string): Promise<OwnershipVerdict> => {
        expect(token).toMatch(/^ya29\./);
        return Promise.resolve(verdicts.shift() ?? { kind: 'owner' });
    });
    const enableApi = vi.fn(() => Promise.resolve(options.enabled ?? true));
    const shell = shellStateAccess();
    const session = new MemoryStore();
    const { log, recording } = testLog();
    const startUp = options.startUp ?? false;
    const unsaved = options.unsaved ?? (() => false);
    const memory = { seen: options.seen ?? false };
    const serverSeen = {
        known: () => memory.seen,
        remember: () => {
            memory.seen = true;
        },
    };
    const left: string[] = [];
    const leaving = (uid: string): Promise<void> => {
        left.push(uid);
        return Promise.resolve();
    };
    const controller = new AuthController({
        auth,
        callables,
        google,
        ownership,
        enableApi,
        shell,
        session,
        log,
        startUp,
        unsaved,
        serverSeen,
        ...(options.leaving === true ? { leaving } : {}),
        ...(options.contributing === undefined ? {} : { contributing: options.contributing }),
    });
    return {
        ...{ auth, callables, port, google, ownership, enableApi, shell, session, recording, controller, memory, left },
        state: () => shell.get(),
    };
}

export async function started(h: ReturnType<typeof harness>): Promise<void> {
    await h.controller.start();
    await settle();
}
