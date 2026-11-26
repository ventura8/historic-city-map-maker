/**
 * Batch 4: the loopback the admin's Import local files talks to (`local-import.ts`), over `XMLHttpRequest`, the one browser API that
 * says how much of a file's upload is sent. Every request omits credentials; an answer that is not JSON reads as `{}`.
 */
import { LOCAL_WORKER } from './local-import.js';
import type { LocalAnswer, LocalTransport } from './local-state.js';

/** What the transport uses of an `XMLHttpRequest`. */
export interface XhrLike {
    open(method: string, url: string): void;
    setRequestHeader(name: string, value: string): void;
    send(body: Blob | string | null): void;
    abort(): void;
    readonly status: number;
    readonly responseText: string;
    readonly upload: { addEventListener(type: 'progress', listener: (event: { readonly loaded: number }) => void): void };
    addEventListener(type: 'load' | 'error' | 'abort', listener: () => void): void;
}

interface Sent {
    readonly method: string;
    readonly path: string;
    readonly body: Blob | string | null;
    readonly headers: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
    readonly progress?: (loaded: number) => void;
}

function parsed(text: string): Readonly<Record<string, unknown>> {
    try {
        const value: unknown = JSON.parse(text);
        return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

function sent(make: () => XhrLike, base: string, request: Sent): Promise<XhrLike> {
    return new Promise((resolve, reject) => {
        const xhr = make();
        xhr.open(request.method, `${base}${request.path}`);
        for (const [name, value] of Object.entries(request.headers)) {
            xhr.setRequestHeader(name, value);
        }
        const progress = request.progress;
        if (progress !== undefined) {
            xhr.upload.addEventListener('progress', (event) => {
                progress(event.loaded);
            });
        }
        xhr.addEventListener('load', () => {
            resolve(xhr);
        });
        xhr.addEventListener('error', () => {
            reject(new Error('unreachable'));
        });
        xhr.addEventListener('abort', () => {
            reject(new Error('aborted'));
        });
        request.signal.addEventListener('abort', () => {
            xhr.abort();
        });
        xhr.send(request.body);
    });
}

/** The worker on this computer's loopback (`base`), through `make`'s requests (the browser's `XMLHttpRequest` by default). */
export function loopbackTransport(make: () => XhrLike = () => new XMLHttpRequest(), base = LOCAL_WORKER): LocalTransport {
    return {
        async json(path, body, headers, signal): Promise<LocalAnswer> {
            const method = body === null ? 'GET' : 'POST';
            const typed = body === null ? headers : { ...headers, 'content-type': 'application/json' };
            const xhr = await sent(make, base, { method, path, body: body === null ? null : JSON.stringify(body), headers: typed, signal });
            return { status: xhr.status, body: parsed(xhr.responseText) };
        },
        async upload({ path, file, headers, signal, progress }): Promise<number> {
            const typed = { ...headers, 'content-type': 'application/octet-stream' };
            return (await sent(make, base, { method: 'POST', path, body: file, headers: typed, signal, progress })).status;
        },
    };
}
