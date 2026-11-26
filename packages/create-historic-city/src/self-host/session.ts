/**
 * One self-host run (`docs/research/M5-interfaces.md` §4.4): the city folder, the project, and the small actions every
 * step is made of. Each tool runs as the owner's own, with the terminal inherited; a missing tool or a failed command
 * stops the run with its reason (a `Refusal`), and nothing after it runs.
 */
import { refusal, type Context } from '../context.js';
import type { Files } from '../ports.js';
import { commandLine } from './tools.js';

/** Where the deploy files go, inside the city folder (kept out of the site by `.gitignore`). */
export const SERVER_FOLDER = 'server';

export interface HostedProject {
    /** The Firebase project id. */
    readonly id: string;
    /** The city folder as the owner named it. */
    readonly dir: string;
    readonly files: Files;
    readonly cityId: string;
    /** The city's name in the run's language (the project's display name, the web app's). */
    readonly cityName: string;
    /** The self-host bundle: `self-host` (the package's own) or an absolute folder (`--bundle`). */
    readonly bundle: string;
    /** The public site's origin the functions accept. */
    readonly viewerOrigin: string;
}

export interface Session {
    readonly context: Context;
    readonly project: HostedProject;
    /** Whether `gcloud` is installed (step 1 finds out): billing is then checked, not asked. */
    gcloud: boolean;
}

const YES = new Set(['y', 'yes', 'd', 'da']);

/** A yes (`y`, `yes`, or Romanian `d`, `da`); anything else is no, the end of the input too. */
export function isYes(answer: string | null): boolean {
    return YES.has((answer ?? '').toLowerCase());
}

/** Asks the step's y/N. */
export async function consent(session: Session): Promise<boolean> {
    return isYes(await session.context.ports.terminal.ask(session.context.t('cli.ask.consent')));
}

/** Runs the owner's `command` with the terminal inherited (its own messages reach the owner) and resolves its exit status. */
export async function status(session: Session, command: string, args: readonly string[], cwd?: string): Promise<number> {
    const { ports, t } = session.context;
    ports.terminal.say(t('cli.step.runs', { command: commandLine(command, args) }));
    const code = await ports.runner.interactive(command, args, cwd === undefined ? undefined : `${session.project.files.root}/${cwd}`);
    if (code === null) {
        throw refusal(session.context, 'cli.step.missing', { command });
    }
    return code;
}

/** Runs the owner's `command` with the terminal inherited; a missing tool or a failed run stops the run. */
export async function run(session: Session, command: string, args: readonly string[], cwd?: string): Promise<void> {
    const code = await status(session, command, args, cwd);
    if (code !== 0) {
        throw refusal(session.context, 'cli.step.failed', { command: commandLine(command, args), code });
    }
}

/** What a listing printed; a missing tool or a failed listing stops the run. */
export async function capture(session: Session, command: string, args: readonly string[]): Promise<string> {
    const result = await session.context.ports.runner.capture(command, args);
    if (result === null) {
        throw refusal(session.context, 'cli.step.missing', { command });
    }
    if (result.code !== 0) {
        throw refusal(session.context, 'cli.step.failed', { command: commandLine(command, args), code: result.code });
    }
    return result.stdout;
}

export async function open(session: Session, url: string): Promise<void> {
    session.context.ports.terminal.say(session.context.t('cli.step.opens', { url }));
    await session.context.ports.opener.open(url);
}

/** Waits for the owner to finish in the page that opened. */
export async function waitForEnter(session: Session): Promise<void> {
    await session.context.ports.terminal.ask(session.context.t('cli.ask.enter'));
}

export function say(session: Session, line: string): void {
    session.context.ports.terminal.say(line);
}
