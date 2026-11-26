/**
 * The deploy files of a self-hosted project (`docs/research/M5-interfaces.md` §4.4, step 6), written into the city
 * folder's `server/` from the self-host bundle the package carries (`npm run build:self-host`):
 *
 * ```text
 * server/.firebaserc                 the project
 * server/firebase.json               the bundle's firebase.template.json for this project (its Hosting site and CSP)
 * server/hosting/                    the start site's release tree for this project: the map's generic city page, and the admin
 *                                    under `admin/` (M6) with Setup's install bundle, project.json (CR-M5-7: no GitHub) and
 *                                    runtime.json
 * server/functions/                  the functions' deploy artifact, with .env.<project> (public values only)
 * server/rules/                      the Firestore and Storage rules and indexes
 * ```
 *
 * `.gitignore` gains `server/`: the folder is no part of the city's public site.
 */
import { START_PROJECT_TOKEN } from '@hcm/shared';

import { refusal } from '../context.js';
import { NPX_COMMAND } from '../version.js';
import { SERVER_FOLDER, type Session } from './session.js';

/** The bundle's files (`dist/self-host/`). */
export const BUNDLE = {
    folders: ['hosting', 'functions', 'rules'],
    firebaseTemplate: 'firebase.template.json',
    release: 'bundle.json',
} as const;

/** The admin's folder in `server/` (the Hosting folder's `admin/`, M6). */
const ADMIN_FOLDER = 'hosting/admin';

/** The token the bundle's `firebase.template.json` holds where the project id goes. */
export const PROJECT_TOKEN = '__PROJECT_ID__';

/** The functions' region (`infra/project.json`). */
const REGION = 'us-central1';

const json = (value: unknown): string => `${JSON.stringify(value, null, 4)}\n`;

function bundlePath(session: Session, file: string): string {
    return `${session.project.bundle}/${file}`;
}

/** The release the bundle was built from (`bundle.json`), for the admin's `runtime.json`. */
function bundleRelease(session: Session): string {
    const parsed = JSON.parse(session.project.files.readBundled(bundlePath(session, BUNDLE.release))) as { readonly release?: unknown };
    return typeof parsed.release === 'string' ? parsed.release : '0.0.0';
}

/** The files of `hosting/` that hold the release's token (`bundle.json`'s `templates`). */
function bundleTemplates(session: Session): readonly string[] {
    const parsed = JSON.parse(session.project.files.readBundled(bundlePath(session, BUNDLE.release))) as { readonly templates?: unknown };
    return Array.isArray(parsed.templates) ? parsed.templates.map(String) : [];
}

/** The hosting tree names no project until here (M14 §6): the city page's policy and bucket, the admin's page. */
function fillTemplates(session: Session): void {
    const { files, id } = session.project;
    for (const path of bundleTemplates(session)) {
        const target = `${SERVER_FOLDER}/hosting/${path}`;
        files.write(target, files.read(target).replaceAll(START_PROJECT_TOKEN, id));
    }
}

/** The admin's `runtime.json`: start-up mode until the server is deployed (`scripts/site/src/admin/runtime.ts`). */
export function writeRuntime(session: Session, startUp: boolean): void {
    const release = bundleRelease(session);
    session.project.files.write(`${SERVER_FOLDER}/${ADMIN_FOLDER}/runtime.json`, json(startUp ? { release, startUp: true } : { release }));
}

function gitignored(session: Session): void {
    const { files } = session.project;
    const current = files.exists('.gitignore') ? files.read('.gitignore') : '';
    if (!current.split('\n').includes(`${SERVER_FOLDER}/`)) {
        const separator = current === '' || current.endsWith('\n') ? '' : '\n';
        files.write('.gitignore', `${current}${separator}${SERVER_FOLDER}/\n`);
    }
}

/** Writes `server/` for `projectNumber`; a package without the bundle refuses before writing anything. */
export function writeServerFiles(session: Session, projectNumber: string, startUp: boolean): void {
    const { project } = session;
    const { files } = project;
    if (!files.bundled(bundlePath(session, BUNDLE.firebaseTemplate))) {
        throw refusal(session.context, 'cli.admin.noBundle', { command: NPX_COMMAND });
    }
    for (const folder of BUNDLE.folders) {
        files.copyFolder(bundlePath(session, folder), `${SERVER_FOLDER}/${folder}`);
    }
    fillTemplates(session);
    const firebase = files.readBundled(bundlePath(session, BUNDLE.firebaseTemplate)).replaceAll(PROJECT_TOKEN, project.id);
    files.write(`${SERVER_FOLDER}/firebase.json`, firebase);
    files.write(`${SERVER_FOLDER}/.firebaserc`, json({ projects: { default: project.id } }));
    files.write(
        `${SERVER_FOLDER}/${ADMIN_FOLDER}/project.json`,
        json({ projectId: project.id, projectNumber, region: REGION, cities: [project.cityId], viewerOrigins: [project.viewerOrigin] }),
    );
    writeRuntime(session, startUp);
    files.write(`${SERVER_FOLDER}/functions/.env.${project.id}`, `HCM_VIEWER_ORIGINS=${project.viewerOrigin}\nHCM_APP_CHECK=monitor\n`);
    gitignored(session);
    session.context.ports.terminal.say(session.context.t('cli.admin.gitignore'));
}

/** Whether `server/` was written before (the `deploy` command then only refreshes `runtime.json`). */
export function hasServerFiles(session: Session): boolean {
    return session.project.files.exists(`${SERVER_FOLDER}/firebase.json`);
}
