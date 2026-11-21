/**
 * The admin's web push service worker (`scripts/site/src/admin/service-worker.ts`; `docs/research/M4-interfaces.md`
 * §5.4): a pushed FCM message becomes a plain-text notification and a click opens its admin page on the admin's own
 * origin only (`installPushWorker` over a scripted worker scope); the file the site build writes is that function's
 * source, which Node's type stripping (the site build's loader) leaves valid JavaScript. Every value is a test value.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { buildAdminSite } from '../src/admin/build.js';
import { ADMIN_SCRIPT_FILE, ADMIN_STYLESHEET_FILE } from '../src/admin/page.js';
import {
    PUSH_SERVICE_WORKER_FILE,
    PUSH_SERVICE_WORKER_SOURCE,
    installPushWorker,
    type PushWorkerScope,
} from '../src/admin/service-worker.js';
import { ROOT, cleanup, repositoryWithTemporaryDist } from './support.js';

const ORIGIN = 'https://demo-hcm.web.app';
/** The worker's scope since M6: the admin's folder, its start page (docs/research/M6-interfaces.md §2.3). */
const START = `${ORIGIN}/admin/`;

interface Shown {
    readonly title: string;
    readonly options: { readonly body: string; readonly tag: string; readonly data: { readonly link: string } };
}

type Listener = (event: never) => void;

/** The worker installed on a scope of its own: its listeners, what it showed and what it opened. */
function worker(registrationScope = START) {
    const listeners = new Map<string, Listener>();
    const shown: Shown[] = [];
    const opened: string[] = [];
    const scope = {
        location: { origin: ORIGIN },
        addEventListener: (type: string, listener: Listener) => {
            listeners.set(type, listener);
        },
        registration: {
            scope: registrationScope,
            showNotification: (title: string, options: Shown['options']) => {
                shown.push({ title, options });
                return Promise.resolve();
            },
        },
        clients: {
            openWindow: (url: string) => {
                opened.push(url);
                return Promise.resolve(null);
            },
        },
    } as unknown as PushWorkerScope;
    installPushWorker(scope);
    const fire = async (type: string, event: Readonly<Record<string, unknown>>): Promise<void> => {
        const waits: Promise<unknown>[] = [];
        listeners.get(type)?.({ ...event, waitUntil: (work: Promise<unknown>) => waits.push(work) } as never);
        await Promise.all(waits);
    };
    return { fire, shown, opened };
}

function push(payload: unknown) {
    return { data: { json: () => payload } };
}

describe('the push service worker', () => {
    it('happyPath_anFcmMessageIsShownAsTextAndItsClickOpensItsAdminPage', async () => {
        const { fire, shown, opened } = worker();
        const closed: string[] = [];
        const message = {
            notification: { title: 'Notificări', body: 'Procesarea „<b>Corona</b>” a eșuat.', tag: 'job.failed~c~j~0' },
            fcmOptions: { link: `${ORIGIN}/#/imagery/version/job-1` },
        };

        await fire('push', push(message));
        await fire('notificationclick', { notification: { data: shown[0]?.options.data, close: () => closed.push('closed') } });

        expect(shown).toEqual([
            {
                title: 'Notificări',
                options: {
                    body: 'Procesarea „<b>Corona</b>” a eșuat.',
                    tag: 'job.failed~c~j~0',
                    data: { link: `${ORIGIN}/#/imagery/version/job-1` },
                },
            },
        ]);
        expect([closed, opened]).toEqual([['closed'], [`${ORIGIN}/#/imagery/version/job-1`]]);
    });

    it.each([
        ['another origin', { notification: { title: 'x' }, fcmOptions: { link: 'https://elsewhere.example/#/x' } }, START],
        ['an older click action', { notification: { title: 'x', click_action: '/#/jobs' } }, `${ORIGIN}/#/jobs`],
        ['a link relative to the admin', { notification: { title: 'x', click_action: '#/jobs' } }, `${START}#/jobs`],
        ['no link', { notification: {} }, START],
        ['a link that is no address', { notification: { title: 'x' }, fcmOptions: { link: 'https://[' } }, START],
        ['a link that is not text', { notification: { title: 'x' }, fcmOptions: { link: 42 } }, START],
    ])('badPath_%s_opensTheAdminsOwnPage', async (_name, message, link) => {
        const { fire, shown } = worker();

        await fire('push', push(message));

        expect(shown[0]?.options.data.link).toBe(link);
    });

    it.each([
        ['a push without data', {}],
        ['a payload that is not JSON', { data: { json: () => JSON.parse('not json') as unknown } }],
        ['a payload that is no object', push('text')],
    ])('badPath_%s_showsAnEmptyNotification', async (_name, event) => {
        const { fire, shown, opened } = worker();

        await fire('push', event);
        await fire('notificationclick', { notification: { close: () => undefined } });

        expect(shown).toEqual([{ title: '', options: { body: '', tag: '', data: { link: START } } }]);
        expect(opened).toEqual([START]);
    });

    it('badPath_aScopeOffTheWorkersOriginFallsBackToTheSitesRoot', async () => {
        const { fire, shown } = worker('https://elsewhere.example/admin/');

        await fire('push', push({ notification: {} }));

        expect(shown[0]?.options.data.link).toBe(`${ORIGIN}/`);
    });
});

describe('the worker file', () => {
    it('happyPath_theSiteBuildWritesItBesideThePage', () => {
        const { files } = repositoryWithTemporaryDist();
        files.write(`dist/admin/${ADMIN_SCRIPT_FILE}`, 'bundle');
        files.write(`dist/admin/${ADMIN_STYLESHEET_FILE}`, 'styles');

        buildAdminSite({ outDir: 'dist/admin' }, files);

        // The push worker, with the installable app's lines that keep nothing (`src/admin/app.ts`).
        expect(files.readText(`dist/admin/${PUSH_SERVICE_WORKER_FILE}`).startsWith(PUSH_SERVICE_WORKER_SOURCE)).toBe(true);
        expect(files.readText(`dist/admin/${PUSH_SERVICE_WORKER_FILE}`)).toContain('"offline":false');
        cleanup();
    });

    it('happyPath_underTheSiteBuildsLoaderItIsPlainJavaScriptCalledOnSelf', () => {
        const script =
            "const m = await import('./scripts/site/src/admin/service-worker.ts'); process.stdout.write(m.PUSH_SERVICE_WORKER_SOURCE);";
        const result = spawnSync(process.execPath, ['--import', './scripts/site/register-ts.mjs', '--input-type=module', '-e', script], {
            cwd: ROOT,
            encoding: 'utf8',
        });
        const output = ts.transpileModule(result.stdout, { reportDiagnostics: true, fileName: 'firebase-messaging-sw.js' });

        expect(result.status).toBe(0);
        expect(output.diagnostics).toEqual([]);
        expect(result.stdout).toMatch(/^\/\/ Historic City Map Maker admin: web push/);
        expect(result.stdout.trimEnd().endsWith('})(self);')).toBe(true);
        expect(result.stdout).not.toContain('PushWorkerScope');
    });
});
