/**
 * The admin's web push service worker (`docs/research/M4-interfaces.md` §5.4), written beside the page by the admin's
 * site build (`build.ts`) as `firebase-messaging-sw.js`, the file `packages/admin/src/firebase/messaging.ts` registers
 * before it asks FCM for the browser's token. It is the whole worker, without the Firebase SDK: a `push` event's FCM
 * message (`notification`: title, text, tag; `fcmOptions.link`: the admin page) is shown as a plain-text notification, and
 * a click opens its page, on the admin's own origin only (any other address opens the admin's start page: a pushed link
 * can never send the admin elsewhere). Same-origin script, allowed by the admin's `worker-src 'self'`. The start page is the
 * worker's own scope, the admin's folder (`https://<project>.web.app/admin/` since M6, docs/research/M6-interfaces.md
 * §2.3: the site's root is the public map).
 *
 * The worker is `installPushWorker`, written in TypeScript (typed, linted and tested like the rest) and self-contained:
 * the file is its source text (Node strips the types when the site build runs) called on the worker's `self`.
 *
 * UNVERIFIED until the first real push (M4-interfaces §10): FCM's web push payload names the link `fcmOptions.link`
 * (older messages: `notification.click_action`), as the Firebase SDK's own worker reads it.
 */

/** The worker's file name, next to the admin's `index.html` (its scope: the page's folder). */
export const PUSH_SERVICE_WORKER_FILE = 'firebase-messaging-sw.js';

interface NotificationOptionsLike {
    readonly body: string;
    readonly tag: string;
    readonly data: { readonly link: string };
}

interface PushEventLike {
    readonly data?: { json(): unknown } | null;
    waitUntil(work: Promise<unknown>): void;
}

interface ClickEventLike {
    readonly notification: { readonly data?: unknown; close(): void };
    waitUntil(work: Promise<unknown>): void;
}

/** What the worker uses of its global scope (`self` in a service worker). */
export interface PushWorkerScope {
    readonly location: { readonly origin: string };
    addEventListener(type: 'push', listener: (event: PushEventLike) => void): void;
    addEventListener(type: 'notificationclick', listener: (event: ClickEventLike) => void): void;
    readonly registration: { readonly scope: string; showNotification(title: string, options: NotificationOptionsLike): Promise<void> };
    readonly clients: { openWindow(url: string): Promise<unknown> };
}

/** Installs the worker's two listeners on `scope`. Self-contained: its source text is the worker file. */
export function installPushWorker(scope: PushWorkerScope): void {
    const start = scope.registration.scope.startsWith(`${scope.location.origin}/`) ? scope.registration.scope : `${scope.location.origin}/`;
    const field = (value: unknown, key: string): unknown =>
        typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>)[key] : undefined;
    const text = (value: unknown): string => (typeof value === 'string' ? value : '');
    const ownPage = (link: unknown): string => {
        try {
            const url = new URL(text(link) || start, start);
            return url.origin === scope.location.origin ? url.href : start;
        } catch {
            return start;
        }
    };
    const messageOf = (event: PushEventLike): unknown => {
        try {
            return event.data?.json();
        } catch {
            return undefined;
        }
    };
    scope.addEventListener('push', (event) => {
        const message = messageOf(event);
        const notification = field(message, 'notification');
        const link = field(field(message, 'fcmOptions'), 'link') ?? field(notification, 'click_action');
        const options = { body: text(field(notification, 'body')), tag: text(field(notification, 'tag')), data: { link: ownPage(link) } };
        event.waitUntil(scope.registration.showNotification(text(field(notification, 'title')), options));
    });
    scope.addEventListener('notificationclick', (event) => {
        event.notification.close();
        event.waitUntil(scope.clients.openWindow(ownPage(field(event.notification.data, 'link'))));
    });
}

/** The worker file: `installPushWorker`'s source called on the worker's own scope. */
export const PUSH_SERVICE_WORKER_SOURCE = [
    '// Historic City Map Maker admin: web push (docs/research/M4-interfaces.md §5.4), from scripts/site/src/admin/service-worker.ts.',
    "'use strict';",
    `(${installPushWorker.toString()})(self);`,
    '',
].join('\n');
