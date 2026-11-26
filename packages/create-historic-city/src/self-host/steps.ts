/**
 * The nine self-host steps (`docs/research/M5-interfaces.md` §4.4). Each runs the owner's own `firebase` or `gcloud`
 * (a listing first, so what exists is never created twice) or opens the page where the human part happens, after a
 * `y/N` of its own; `--yes` never answers these. Every Google sign-in, consent, terms acceptance and billing entry
 * happens in Google's own pages: the CLI never asks for, reads or prints a credential.
 */
import { refusal } from '../context.js';
import { billingReady } from './billing.js';
import { hasServerFiles, writeRuntime, writeServerFiles } from './server-files.js';
import { capture, consent, open, run, say, SERVER_FOLDER, status, waitForEnter, type HostedProject, type Session } from './session.js';
import {
    commandLine,
    FIREBASE,
    FIREBASE_TOOLS_VERSION,
    firebaseArgs,
    GCLOUD,
    gcloudArgs,
    hasAccount,
    hasSite,
    hasWebApp,
    listedProject,
    otherProjectId,
    pages,
} from './tools.js';

export const STEP_IDS = ['tools', 'login', 'project', 'app', 'provider', 'admin', 'setup', 'server', 'rest'] as const;

type StepId = (typeof STEP_IDS)[number];

/** `done`, or `declined`: the owner said no (a failure throws its reason). */
export type StepOutcome = 'done' | 'declined';

export interface Step {
    readonly id: StepId;
    /** What `--dry-run` prints: the command lines it may run and the pages it may open. */
    readonly plan: (project: HostedProject) => { readonly commands: readonly string[]; readonly pages: readonly string[] };
    readonly run: (session: Session) => Promise<StepOutcome>;
}

const fb = (args: readonly string[]): string => commandLine(FIREBASE, args);

/** A step that runs once the owner says yes. */
async function asking(session: Session, act: () => Promise<void>): Promise<StepOutcome> {
    if (!(await consent(session))) {
        return 'declined';
    }
    await act();
    return 'done';
}

async function tools(session: Session): Promise<StepOutcome> {
    const { runner } = session.context.ports;
    if ((await runner.capture(FIREBASE, firebaseArgs.version)) === null) {
        throw refusal(session.context, 'cli.tools.noFirebase', { version: FIREBASE_TOOLS_VERSION });
    }
    session.gcloud = (await runner.capture(GCLOUD, gcloudArgs.version)) !== null;
    if (!session.gcloud) {
        say(session, session.context.t('cli.tools.noGcloud'));
    }
    return 'done';
}

async function login(session: Session): Promise<StepOutcome> {
    if (hasAccount(await capture(session, FIREBASE, firebaseArgs.loginList))) {
        say(session, session.context.t('cli.login.already'));
        return 'done';
    }
    return asking(session, () => run(session, FIREBASE, firebaseArgs.login));
}

/**
 * Creates the project. A failure is firebase's own message (printed above: the terminal is the owner's) and has two
 * usual causes, which the CLI cannot tell apart: an id that is taken (project ids are unique across Google), for which
 * another id is suggested, and Google's terms not yet accepted, for which the console opens and the creation runs once
 * more after the owner's yes (`docs/LESSONS.md` 240).
 */
async function createProject(session: Session): Promise<void> {
    const { id, cityName } = session.project;
    const args = firebaseArgs.projectsCreate(id, cityName);
    if ((await status(session, FIREBASE, args)) === 0) {
        return;
    }
    const suggestion = otherProjectId(id);
    const { t } = session.context;
    for (const line of [t('cli.project.failed', { project: id }), t('cli.project.otherId', { suggestion }), t('cli.project.terms')]) {
        say(session, line);
    }
    if (!(await consent(session))) {
        throw refusal(session.context, 'cli.project.notCreated', { project: id, suggestion });
    }
    await open(session, pages.console);
    await waitForEnter(session);
    await run(session, FIREBASE, args);
}

async function project(session: Session): Promise<StepOutcome> {
    const { id } = session.project;
    if (listedProject(await capture(session, FIREBASE, firebaseArgs.projectsList), id).listed) {
        say(session, session.context.t('cli.project.exists', { project: id }));
        return 'done';
    }
    return asking(session, () => createProject(session));
}

async function webAppAndSite(session: Session): Promise<void> {
    const { id, cityName } = session.project;
    const { t } = session.context;
    if (hasWebApp(await capture(session, FIREBASE, firebaseArgs.appsList(id)))) {
        say(session, t('cli.app.exists'));
    } else {
        await run(session, FIREBASE, firebaseArgs.appsCreate(id, cityName));
    }
    if (hasSite(await capture(session, FIREBASE, firebaseArgs.sitesList(id)), id)) {
        say(session, t('cli.site.exists', { project: id }));
    } else {
        await run(session, FIREBASE, firebaseArgs.sitesCreate(id));
    }
}

/** The project's number, which the admin's `project.json` names. */
async function projectNumber(session: Session): Promise<string> {
    const { id } = session.project;
    const { number } = listedProject(await capture(session, FIREBASE, firebaseArgs.projectsList), id);
    if (number === null) {
        throw refusal(session.context, 'cli.project.noNumber', { project: id });
    }
    return number;
}

async function startUpAdmin(session: Session): Promise<void> {
    writeServerFiles(session, await projectNumber(session), true);
    await run(session, FIREBASE, firebaseArgs.deployHosting(session.project.id), SERVER_FOLDER);
}

async function deployServer(session: Session): Promise<void> {
    await billingReady(session);
    if (hasServerFiles(session)) {
        writeRuntime(session, false);
    } else {
        writeServerFiles(session, await projectNumber(session), false);
    }
    await run(session, FIREBASE, firebaseArgs.deployServer(session.project.id), SERVER_FOLDER);
}

async function openAndWait(session: Session, url: string): Promise<void> {
    await open(session, url);
    await waitForEnter(session);
}

const none = { commands: [], pages: [] };

export const STEPS: readonly Step[] = [
    {
        id: 'tools',
        plan: () => ({ commands: [fb(firebaseArgs.version), commandLine(GCLOUD, gcloudArgs.version)], pages: [] }),
        run: tools,
    },
    { id: 'login', plan: () => ({ commands: [fb(firebaseArgs.loginList), fb(firebaseArgs.login)], pages: [] }), run: login },
    {
        id: 'project',
        plan: ({ id, cityName }) => ({
            commands: [fb(firebaseArgs.projectsList), fb(firebaseArgs.projectsCreate(id, cityName))],
            pages: [],
        }),
        run: project,
    },
    {
        id: 'app',
        plan: ({ id, cityName }) => ({
            commands: [
                fb(firebaseArgs.appsList(id)),
                fb(firebaseArgs.appsCreate(id, cityName)),
                fb(firebaseArgs.sitesList(id)),
                fb(firebaseArgs.sitesCreate(id)),
            ],
            pages: [],
        }),
        run: (session) => asking(session, () => webAppAndSite(session)),
    },
    {
        id: 'provider',
        plan: ({ id }) => ({ commands: [], pages: [pages.providers(id)] }),
        run: (session) => asking(session, () => openAndWait(session, pages.providers(session.project.id))),
    },
    {
        id: 'admin',
        plan: ({ id }) => ({ commands: [fb(firebaseArgs.deployHosting(id))], pages: [] }),
        run: (session) => asking(session, () => startUpAdmin(session)),
    },
    {
        id: 'setup',
        plan: ({ id }) => ({ commands: [], pages: [pages.admin(id)] }),
        run: (session) => asking(session, () => openAndWait(session, pages.admin(session.project.id))),
    },
    {
        id: 'server',
        plan: ({ id }) => ({
            commands: [commandLine(GCLOUD, gcloudArgs.billing(id)), fb(firebaseArgs.deployServer(id))],
            pages: [pages.billing(id)],
        }),
        run: (session) => asking(session, () => deployServer(session)),
    },
    {
        id: 'rest',
        plan: ({ id }) => ({ ...none, pages: [pages.admin(id)] }),
        run: (session) => asking(session, () => open(session, pages.admin(session.project.id))),
    },
];
