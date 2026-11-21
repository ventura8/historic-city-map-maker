/**
 * The CLI's commands over its ports (`docs/research/M5-interfaces.md` §4.2): the entry (`../cli.ts`) passes the real
 * ones, the tests fakes. Exit status 0 done (or stopped by the owner's own "no"), 1 a refusal or a failed step (its
 * reason printed), 2 usage.
 */
import { parseOptions, type CommandName, type Options } from './args.js';
import { EXIT, Refusal, type Context } from './context.js';
import { doctor } from './doctor.js';
import { cliLocale, translator, type CliKey } from './i18n/index.js';
import type { Ports } from './ports.js';
import { scaffold } from './scaffold.js';
import { deploy, selfHost } from './self-host/index.js';
import { theme } from './theme.js';
import { upgrade } from './upgrade.js';
import { CLI_VERSION } from './version.js';

const HELP: readonly CliKey[] = [
    'cli.help.usage',
    'cli.help.npmCreate',
    'cli.help.scaffold',
    'cli.help.scaffoldOptions',
    'cli.help.selfHost',
    'cli.help.deploy',
    'cli.help.theme',
    'cli.help.upgrade',
    'cli.help.doctor',
    'cli.help.common',
];

function help(context: Context): Promise<number> {
    for (const key of HELP) {
        context.ports.terminal.say(context.t(key, { version: CLI_VERSION }));
    }
    return Promise.resolve(EXIT.done);
}

function printVersion(context: Context): Promise<number> {
    context.ports.terminal.say(CLI_VERSION);
    return Promise.resolve(EXIT.done);
}

const RUN: Readonly<Record<CommandName | 'help' | 'version', (context: Context) => Promise<number>>> = {
    help,
    version: printVersion,
    scaffold,
    'self-host': selfHost,
    deploy,
    theme,
    upgrade,
    doctor,
};

async function dispatch(context: Context): Promise<number> {
    try {
        return await RUN[context.options.command](context);
    } catch (error: unknown) {
        if (!(error instanceof Refusal)) {
            throw error;
        }
        context.ports.terminal.say(error.message);
        return EXIT.failed;
    }
}

/** Runs the command line `argv` (`process.argv.slice(2)`) and resolves the exit status (2: a command line it cannot read). */
export function runCli(argv: readonly string[], ports: Ports): Promise<number> {
    let options: Options;
    try {
        options = parseOptions(argv);
    } catch (error: unknown) {
        const t = translator(cliLocale(undefined, ports.env.lang));
        ports.terminal.say(t('cli.error.usage', { detail: (error as Error).message }));
        return Promise.resolve(EXIT.usage);
    }
    const locale = cliLocale(options.lang, ports.env.lang);
    return dispatch({ ports, options, locale, t: translator(locale) });
}
