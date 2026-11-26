/** What every command gets: the ports, the options, and the texts in the run's language. */
import type { Options } from './args.js';
import type { CliKey, CliLocale, Translate } from './i18n/index.js';
import type { Ports } from './ports.js';

export interface Context {
    readonly ports: Ports;
    readonly options: Options;
    readonly locale: CliLocale;
    readonly t: Translate;
}

/** A refusal the owner can act on: its message is printed and the CLI ends with exit status 1, nothing half done. */
export class Refusal extends Error {
    override readonly name = 'Refusal';
}

/** A refusal with a catalogue message. */
export function refusal(context: Pick<Context, 't'>, key: CliKey, params?: Readonly<Record<string, string | number>>): Refusal {
    return new Refusal(context.t(key, params));
}

/** Exit statuses (§4.2): done, or stopped by the owner's own "no"; a refusal or a failed step; a usage error. */
export const EXIT = { done: 0, failed: 1, usage: 2 } as const;
