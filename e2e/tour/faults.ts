/** The faults the tour's error journeys put in the browser's way (`states.ts` → ERROR_JOURNEYS). */
import type { Route } from '@playwright/test';

/** The 404 answer of a missing manifest. */
export function notFound(route: Route): Promise<void> {
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
}

/** WebGL refused, as a browser without it does (`getContext` answers null), before the engine probes it. */
export function withoutWebGl(): void {
    const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')?.value as (
        this: HTMLCanvasElement,
        ...args: unknown[]
    ) => unknown;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        value: function getContext(this: HTMLCanvasElement, kind: string, ...rest: unknown[]): unknown {
            return ['webgl', 'webgl2', 'experimental-webgl'].includes(kind) ? null : original.call(this, kind, ...rest);
        },
    });
}
