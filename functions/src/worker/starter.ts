import { runAs } from '../global-options.js';

import {
    HTTP_ENDPOINTS,
    WORKER_STARTER_FILE_NAMES,
    WORKER_STARTER_PLACEHOLDERS,
    WORKER_STARTER_TEMPLATES,
    workerStarterQuerySchema,
    type WorkerOs,
    type WorkerStarterAction,
} from '@hcm/shared';
import { onRequest } from 'firebase-functions/https';

import type { Ports } from '../ports/index.js';

export type StarterDeps = Pick<Ports, 'config' | 'log' | 'starters'>;

/**
 * `worker.starter` (finding 73 of 2026-11-03, `docs/research/M7-local-worker.md`, its addendum of 2026-11-03;
 * S-A62-HAPPY-STARTER, S-A62-BAD-STARTER-TEMPLATE): the starter file of "Use this computer" as an ordinary download.
 * Live, Chrome saved nothing of the file the admin made in the page (a Blob behind a link clicked after an `await`): a
 * `.sh` is a file type Chrome lets through only for a download the user started, from a site they know. The admin's
 * button is now a link to this function: `GET ?city=<city>&os=<linux|mac|windows>&action=<install|uninstall>` answers
 * the template of the system filled with this project, the city and the action, with `Content-Disposition: attachment`
 * and the file's name. Public, no sign-in: the file holds no secret (the admin pairs the computer by itself). `HEAD`
 * answers the same headers, so the admin can see beforehand that this server makes the file; every answer carries
 * `Access-Control-Allow-Origin: *` for that look (no credentials, nothing private).
 */

/** What one request is, as far as the handler reads it. */
interface StarterRequest {
    readonly method: string;
    readonly query: unknown;
}

interface StarterAnswer {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
}

const COMMON_HEADERS = {
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
} as const;

function plain(status: number, body: string, extra: Readonly<Record<string, string>> = {}): StarterAnswer {
    return { status, headers: { ...COMMON_HEADERS, 'content-type': 'text/plain; charset=utf-8', ...extra }, body };
}

/** The template filled with the project, the city and the action; CRLF on Windows. */
function starterText(
    template: string,
    values: { readonly project: string; readonly city: string; readonly action: string },
    os: WorkerOs,
): string {
    const marks = WORKER_STARTER_PLACEHOLDERS;
    const text = template
        .replaceAll(marks.project, values.project)
        .replaceAll(marks.city, values.city)
        .replaceAll(marks.action, values.action);
    return os === 'windows' ? text.replace(/\r?\n/g, '\r\n') : text;
}

const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

/** A request the query schema accepted. */
interface StarterQuery {
    readonly city: string;
    readonly os: WorkerOs;
    readonly action: WorkerStarterAction;
}

/** The template of `os`, or null (logged) when it cannot be read. */
function templateOf(deps: StarterDeps, os: WorkerOs): Promise<string | null> {
    const name = os === 'windows' ? WORKER_STARTER_TEMPLATES.windows : WORKER_STARTER_TEMPLATES.posix;
    return deps.starters.read(name).catch((error: unknown) => {
        deps.log.error('starter template not readable', { error: String(error) });
        return null;
    });
}

/** The filled file as a download named for its system and action. */
function fileAnswer(deps: StarterDeps, query: StarterQuery, template: string): StarterAnswer {
    const { city, os, action } = query;
    deps.log.info('worker starter given', { city, os, action });
    return {
        status: 200,
        headers: {
            ...COMMON_HEADERS,
            'content-type': 'application/octet-stream',
            'content-disposition': `attachment; filename="${WORKER_STARTER_FILE_NAMES[action][os]}"`,
        },
        body: starterText(template, { project: deps.config.projectId, city, action }, os),
    };
}

/** The answer to one request: the file, or why there is none. */
export async function handleStarterRequest(deps: StarterDeps, request: StarterRequest): Promise<StarterAnswer> {
    if (!READ_METHODS.has(request.method)) {
        return plain(405, 'Only GET and HEAD.', { allow: 'GET, HEAD' });
    }
    const query = workerStarterQuerySchema.safeParse(request.query);
    if (!query.success) {
        return plain(400, 'Ask for ?city=<city>&os=<linux|mac|windows>&action=<install|uninstall>.');
    }
    const template = await templateOf(deps, query.data.os);
    return template === null ? plain(503, 'The starter file cannot be made now: try again later.') : fileAnswer(deps, query.data, template);
}

/** The parts of the express request and response the endpoint uses. */
interface HttpRequest {
    readonly method: string;
    readonly query: unknown;
}

interface HttpResponse {
    status(code: number): this;
    set(headers: Readonly<Record<string, string>>): this;
    send(body: string): unknown;
}

/** The express handler: the request in, {@link handleStarterRequest}'s answer out (express drops a HEAD's body). */
export function serveStarters(getDeps: () => StarterDeps) {
    return async (request: HttpRequest, response: HttpResponse): Promise<void> => {
        const answer = await handleStarterRequest(getDeps(), request);
        response.status(answer.status).set(answer.headers).send(answer.body);
    };
}

/** The `worker-starter` HTTPS function: public, GET and HEAD. */
export function starterFunction(getDeps: () => StarterDeps) {
    const { maxInstances } = HTTP_ENDPOINTS['worker.starter'];
    return onRequest({ maxInstances, invoker: 'public', ...runAs('worker.starter') }, serveStarters(getDeps));
}
