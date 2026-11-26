/**
 * `create-historic-city self-host [dir] --project <id>` and `create-historic-city deploy [dir]` (`docs/research/
 * M5-interfaces.md` §4.4): the nine steps in order (deploy: the tools, the server and the rest of Setup), each printing
 * what it does, why and what it costs before its `y/N`. `--dry-run` prints every step's commands and pages and runs,
 * writes and opens nothing. A "no" stops with the steps left (exit status 0); a failed step stops with its reason and
 * the command that resumes (exit status 1).
 *
 * Since CR-M5-7 the admin's Setup runs in a project of the owner's own: its `project.json` has no GitHub settings, so
 * Provision leaves GitHub's deployer out, and the server's deploy finds the service accounts Provision made.
 */
import { resolve } from 'node:path';

import { parseManifestJson } from '@hcm/shared';

import { EXIT, Refusal, refusal, type Context } from '../context.js';
import { NPX_COMMAND } from '../version.js';
import { deployCommand } from './billing.js';
import { SERVER_FOLDER, say, type HostedProject, type Session } from './session.js';
import { STEP_IDS, STEPS, type Step, type StepOutcome } from './steps.js';
import { pages, PROJECT_ID } from './tools.js';

/** The package's own bundle (`dist/self-host/`). */
const PACKAGE_BUNDLE = 'self-host';

const RESUMES_WITH_DEPLOY: readonly Step['id'][] = ['server', 'rest'];

function cityOf(context: Context, files: HostedProject['files'], dir: string): { readonly id: string; readonly name: string } {
    if (!files.exists('city.json')) {
        throw refusal(context, 'cli.admin.noKit', { dir, command: NPX_COMMAND });
    }
    const parsed = parseManifestJson(files.read('city.json'));
    if (!parsed.ok) {
        const detail = parsed.issues.map((issue) => `${issue.path} ${issue.code}`).join(', ');
        throw refusal(context, 'cli.doctor.manifestInvalid', { detail });
    }
    return { id: parsed.value.city.id, name: parsed.value.city.name[context.locale] };
}

/** The project of an earlier run (`server/.firebaserc`), for `deploy` without `--project`. */
function earlierProject(files: HostedProject['files']): string | undefined {
    const path = `${SERVER_FOLDER}/.firebaserc`;
    if (!files.exists(path)) {
        return undefined;
    }
    const parsed = JSON.parse(files.read(path)) as { readonly projects?: { readonly default?: unknown } };
    const project = parsed.projects?.default;
    return typeof project === 'string' ? project : undefined;
}

async function projectId(context: Context, files: HostedProject['files']): Promise<string> {
    const given =
        context.options.project ?? earlierProject(files) ?? (await context.ports.terminal.ask(context.t('cli.ask.project'))) ?? '';
    if (!PROJECT_ID.test(given)) {
        throw refusal(context, 'cli.project.invalid', { project: given });
    }
    return given;
}

function isHttpsOrigin(text: string): boolean {
    if (!URL.canParse(text)) {
        return false;
    }
    const url = new URL(text);
    return url.protocol === 'https:' && url.origin === text;
}

function viewerOrigin(context: Context, project: string): string {
    const origin = context.options.viewerOrigin ?? `https://${project}.web.app`;
    if (!isHttpsOrigin(origin)) {
        throw refusal(context, 'cli.origin.invalid', { origin });
    }
    return origin;
}

async function hostedProject(context: Context): Promise<HostedProject> {
    const dir = context.options.dir ?? '.';
    const files = context.ports.files(dir);
    const city = cityOf(context, files, dir);
    const id = await projectId(context, files);
    const { bundle } = context.options;
    return {
        id,
        dir,
        files,
        cityId: city.id,
        cityName: city.name,
        bundle: bundle === undefined ? PACKAGE_BUNDLE : resolve(context.ports.env.cwd, bundle),
        viewerOrigin: viewerOrigin(context, id),
    };
}

const numberOf = (step: Step): number => STEP_IDS.indexOf(step.id) + 1;

function introduce(session: Session, step: Step): void {
    const { t } = session.context;
    const { id, dir } = session.project;
    say(session, '');
    say(session, t('cli.step.header', { n: numberOf(step), total: STEP_IDS.length, title: t(`cli.step.${step.id}.title`) }));
    say(session, t(`cli.step.${step.id}.what`, { project: id, dir: `${dir}/${SERVER_FOLDER}` }));
}

function printPlan(session: Session, step: Step): void {
    const { t } = session.context;
    const plan = step.plan(session.project);
    for (const command of plan.commands) {
        say(session, t('cli.dryRun.runs', { command }));
    }
    for (const url of plan.pages) {
        say(session, t('cli.dryRun.opens', { url }));
    }
}

/** Runs one step: its outcome, or `failed` once its reason is printed. */
async function attempt(session: Session, step: Step): Promise<StepOutcome | 'failed'> {
    try {
        return await step.run(session);
    } catch (error: unknown) {
        if (!(error instanceof Refusal)) {
            throw error;
        }
        say(session, error.message);
        return 'failed';
    }
}

function resumeCommand(session: Session, step: Step): string {
    const { dir, id } = session.project;
    return RESUMES_WITH_DEPLOY.includes(step.id) ? deployCommand(session) : `${NPX_COMMAND} self-host ${dir} --project ${id}`;
}

/** Stops at `left[0]`: after a "no", the steps left are listed; either way, the command that resumes. */
function stopped(session: Session, left: readonly [Step, ...Step[]], outcome: 'declined' | 'failed'): number {
    const { t } = session.context;
    if (outcome === 'declined') {
        say(session, t('cli.step.declined'));
        for (const step of left) {
            say(session, t('cli.step.left', { n: numberOf(step), title: t(`cli.step.${step.id}.title`) }));
        }
    }
    say(session, t('cli.step.resume', { command: resumeCommand(session, left[0]) }));
    return outcome === 'declined' ? EXIT.done : EXIT.failed;
}

/** A dry run prints the step's plan; a real one runs it. */
async function outcomeOf(session: Session, step: Step): Promise<StepOutcome | 'failed'> {
    if (session.context.options.dryRun) {
        printPlan(session, step);
        return 'done';
    }
    return attempt(session, step);
}

async function runSteps(context: Context, steps: readonly Step[]): Promise<number> {
    const session: Session = { context, project: await hostedProject(context), gcloud: false };
    for (const [index, step] of steps.entries()) {
        introduce(session, step);
        const outcome = await outcomeOf(session, step);
        if (outcome !== 'done') {
            return stopped(session, [step, ...steps.slice(index + 1)], outcome);
        }
    }
    say(session, '');
    say(
        session,
        context.options.dryRun ? context.t('cli.dryRun.nothing') : context.t('cli.selfHost.done', { url: pages.admin(session.project.id) }),
    );
    return EXIT.done;
}

export function selfHost(context: Context): Promise<number> {
    return runSteps(context, STEPS);
}

/** The server's deploy alone, once billing is linked (the steps a self-host run resumes with). */
export function deploy(context: Context): Promise<number> {
    return runSteps(
        context,
        STEPS.filter((step) => step.id === 'tools' || RESUMES_WITH_DEPLOY.includes(step.id)),
    );
}
