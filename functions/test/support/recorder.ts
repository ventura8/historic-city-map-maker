/**
 * The call log and scripted failures every in-memory port fake shares (docs/research/M2-interfaces.md §7): a fake
 * records each call with its arguments before it answers, and a test makes the next call of a method fail with
 * `failNext(method, error)` (usually an `UpstreamError`), so failure branches are driven from outside.
 */
interface PortCall<Method extends string> {
    readonly method: Method;
    readonly args: readonly unknown[];
}

export class PortRecorder<Method extends string> {
    readonly calls: PortCall<Method>[] = [];
    readonly #failures = new Map<Method, Error[]>();

    /** The next calls of `method` throw these errors, one per call, in order. */
    failNext(method: Method, ...errors: Error[]): void {
        this.#failures.set(method, [...(this.#failures.get(method) ?? []), ...errors]);
    }

    /** Records a call, then throws its scripted failure, if any (inside an async method: a rejection). */
    enter(method: Method, args: readonly unknown[]): void {
        this.calls.push({ method, args });
        const failure = this.#failures.get(method)?.shift();
        if (failure !== undefined) {
            throw failure;
        }
    }

    /** The arguments of every call of `method`, oldest first. */
    argsOf(method: Method): (readonly unknown[])[] {
        return this.calls.filter((call) => call.method === method).map((call) => call.args);
    }
}

/** `work`'s result as a promise; a throw becomes a rejection, as it would from the adapter's async method. */
export function promised<T>(work: () => T): Promise<T> {
    try {
        return Promise.resolve(work());
    } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
}
