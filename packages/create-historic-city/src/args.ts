/**
 * The command line (`docs/research/M5-interfaces.md` §4.2): a command (the scaffold when the first word is none),
 * an optional folder, and options. A wrong option or value is a usage error (exit status 2).
 */
import { parseArgs } from 'node:util';

const COMMANDS = ['self-host', 'deploy', 'theme', 'upgrade', 'doctor'] as const;

export type CommandName = 'scaffold' | (typeof COMMANDS)[number];

export interface Options {
    readonly command: CommandName | 'help' | 'version';
    readonly dir: string | undefined;
    readonly nameRo: string | undefined;
    readonly nameEn: string | undefined;
    readonly id: string | undefined;
    readonly bbox: string | undefined;
    readonly seed: string | undefined;
    readonly project: string | undefined;
    /** The self-host bundle to deploy instead of the package's own (`dist/self-host`). */
    readonly bundle: string | undefined;
    /** Where the city's public site lives (the viewer's origin the functions accept); default the project's web.app. */
    readonly viewerOrigin: string | undefined;
    /** How long `deploy` waits for billing to be linked, in minutes (0: check once more, then stop). */
    readonly billingWait: number;
    readonly yes: boolean;
    readonly dryRun: boolean;
    readonly lang: 'ro' | 'en' | undefined;
}

/** A command line the CLI does not understand. */
export class UsageError extends Error {
    override readonly name = 'UsageError';
}

const DEFAULT_BILLING_WAIT_MINUTES = 20;
const MAX_BILLING_WAIT_MINUTES = 120;

const OPTIONS = {
    'name-ro': { type: 'string' },
    'name-en': { type: 'string' },
    id: { type: 'string' },
    bbox: { type: 'string' },
    seed: { type: 'string' },
    project: { type: 'string' },
    bundle: { type: 'string' },
    'viewer-origin': { type: 'string' },
    'billing-wait': { type: 'string' },
    yes: { type: 'boolean', short: 'y' },
    'dry-run': { type: 'boolean' },
    // Accepted and ignored: v1.0.0's notes name it; since CR-M5-7 nothing needs it.
    experimental: { type: 'boolean' },
    lang: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
} as const;

function minutes(value: string | undefined): number {
    if (value === undefined) {
        return DEFAULT_BILLING_WAIT_MINUTES;
    }
    const parsed = Number(value);
    if (!/^\d+$/.test(value) || parsed > MAX_BILLING_WAIT_MINUTES) {
        throw new UsageError(`--billing-wait ${value}`);
    }
    return parsed;
}

function language(value: string | undefined): 'ro' | 'en' | undefined {
    if (value !== undefined && value !== 'ro' && value !== 'en') {
        throw new UsageError(`--lang ${value}`);
    }
    return value;
}

/** The command and its folder from the words before and between the options. */
function commandOf(positionals: readonly string[]): { readonly command: CommandName; readonly dir: string | undefined } {
    const [first, second, ...rest] = positionals;
    const named = (COMMANDS as readonly string[]).includes(first ?? '');
    const extra = named ? rest : [second, ...rest].filter((word) => word !== undefined);
    if (extra.length > 0) {
        throw new UsageError(extra.join(' '));
    }
    return named ? { command: first as CommandName, dir: second } : { command: 'scaffold', dir: first };
}

function parsed(argv: readonly string[]) {
    try {
        return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true });
    } catch (error: unknown) {
        throw new UsageError((error as Error).message);
    }
}

/** `--help` or `--version`, which win over any command. */
function specialOf(values: { readonly help?: boolean; readonly version?: boolean }): 'help' | 'version' | null {
    if (values.help === true) {
        return 'help';
    }
    return values.version === true ? 'version' : null;
}

/** The options of `argv` (`process.argv.slice(2)`); throws `UsageError`. */
export function parseOptions(argv: readonly string[]): Options {
    const { values, positionals } = parsed(argv);
    const { command, dir } = commandOf(positionals);
    return {
        command: specialOf(values) ?? command,
        dir,
        nameRo: values['name-ro'],
        nameEn: values['name-en'],
        id: values.id,
        bbox: values.bbox,
        seed: values.seed,
        project: values.project,
        bundle: values.bundle,
        viewerOrigin: values['viewer-origin'],
        billingWait: minutes(values['billing-wait']),
        yes: values.yes === true,
        dryRun: values['dry-run'] === true,
        lang: language(values.lang),
    };
}
