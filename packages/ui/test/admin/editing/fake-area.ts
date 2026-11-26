// A scripted area store for the editor pages' browser tests: the test sets its state, every `open`, `close` and intent
// call is recorded, and an intent answers what the test scripted.
import type { AreaPort } from '../../../src/admin/content-port.js';

export class FakeArea<State, Intents extends object> implements AreaPort<State, Intents> {
    readonly calls: string[] = [];
    readonly intents: Intents;
    readonly #listeners = new Set<(state: State) => void>();
    #state: State;

    /** `answers`: what each intent returns (anything else returns undefined). */
    constructor(state: State, answers: Partial<Record<keyof Intents, unknown>> = {}) {
        this.#state = state;
        // Only intent names answer: Lit probes a bound value for `_$`-prefixed members and `await` probes `then` (CR-M2c-21).
        this.intents = new Proxy({} as Intents, {
            get: (_target, name: string | symbol) =>
                typeof name !== 'string' || name === 'then' || name.startsWith('_$') ? undefined : this.#intent(name, answers),
        });
    }

    #intent(name: string, answers: Partial<Record<keyof Intents, unknown>>) {
        return (...args: unknown[]): unknown => {
            this.calls.push([name, ...args.map((arg) => JSON.stringify(arg))].join(' '));
            return answers[name as keyof Intents];
        };
    }

    get state(): State {
        return this.#state;
    }

    set(patch: Partial<State>): void {
        this.#state = { ...this.#state, ...patch };
        for (const listener of this.#listeners) {
            listener(this.#state);
        }
    }

    subscribe(listener: (state: State) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    open(params: readonly string[]): void {
        this.calls.push(`open ${JSON.stringify(params)}`);
    }

    close(): void {
        this.calls.push('close');
    }

    get listening(): number {
        return this.#listeners.size;
    }

    /** The calls of one intent (or of `open`, `close`). */
    named(name: string): readonly string[] {
        return this.calls.filter((call) => call === name || call.startsWith(`${name} `));
    }
}
