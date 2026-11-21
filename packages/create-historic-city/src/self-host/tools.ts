/**
 * The owner's own tools, their command lines and what the CLI reads from their `--json` listings
 * (`docs/research/M5-interfaces.md` §4.4). The CLI reads only listings and versions (never a credential): an account's
 * presence, a project's number, a web app's presence, a Hosting site's presence, whether billing is linked. A listing
 * it cannot read counts as "not there", so the step asks to create it and the owner's tool says what is wrong.
 *
 * `firebase login:list` is read without `--json`: its JSON answer is every signed-in account with its OAuth tokens
 * (`auth.getAllAccounts()`), its plain text only the line `Logged in as <address>` (`docs/LESSONS.md` 237).
 */

/** The Firebase CLI the repository pins (the root `package.json`); printed when it is missing. */
export const FIREBASE_TOOLS_VERSION = '15.36.0';

export const FIREBASE = 'firebase';
export const GCLOUD = 'gcloud';

/** A Firebase project id (what `firebase projects:create` accepts). */
export const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** The longest project id `PROJECT_ID` takes. */
const MAX_PROJECT_ID = 30;

/** Another id to try when `id` is taken: its number at the end raised (`cluj-harta` → `cluj-harta-2` → `cluj-harta-3`). */
export function otherProjectId(id: string): string {
    const number = /-(\d+)$/.exec(id)?.[1];
    const suffix = `-${String(number === undefined ? 2 : Number(number) + 1)}`;
    const stem = id.replace(/-\d+$/, '');
    return `${withoutTrailingHyphens(stem.slice(0, MAX_PROJECT_ID - suffix.length))}${suffix}`;
}

/** `text` without the hyphens it ends with (a project id cannot end with one). */
function withoutTrailingHyphens(text: string): string {
    let end = text.length;
    while (end > 0 && text[end - 1] === '-') {
        end -= 1;
    }
    return text.slice(0, end);
}

/** The display name of a new project: at most 30 characters. */
const MAX_DISPLAY_NAME = 30;

export const firebaseArgs = {
    version: ['--version'],
    loginList: ['login:list'],
    login: ['login'],
    projectsList: ['projects:list', '--json'],
    projectsCreate: (project: string, name: string) => ['projects:create', project, '--display-name', name.slice(0, MAX_DISPLAY_NAME)],
    appsList: (project: string) => ['apps:list', 'WEB', '--project', project, '--json'],
    appsCreate: (project: string, name: string) => ['apps:create', 'WEB', `${name} admin`, '--project', project],
    sitesList: (project: string) => ['hosting:sites:list', '--project', project, '--json'],
    sitesCreate: (project: string) => ['hosting:sites:create', project, '--project', project],
    deployHosting: (project: string) => ['deploy', '--only', 'hosting', '--project', project],
    deployServer: (project: string) => ['deploy', '--only', 'functions,firestore,storage,hosting', '--project', project],
} as const;

export const gcloudArgs = {
    version: ['--version'],
    billing: (project: string) => ['billing', 'projects', 'describe', project, '--format=json'],
} as const;

/** A command line as the owner would type it (an argument with a space in quotes). */
export function commandLine(command: string, args: readonly string[]): string {
    return [command, ...args.map((arg) => (/[\s"]/.test(arg) ? JSON.stringify(arg) : arg))].join(' ');
}

/** The pages the steps open. */
export const pages = {
    console: 'https://console.firebase.google.com/',
    providers: (project: string) => `https://console.firebase.google.com/project/${project}/authentication/providers`,
    // M6 (docs/research/M6-interfaces.md §2.3): the admin's folder on the project's Hosting site.
    admin: (project: string) => `https://${project}.web.app/admin/`,
    billing: (project: string) => `https://console.cloud.google.com/billing/linkedaccount?project=${project}`,
} as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `result` of a `firebase … --json` answer (`{status, result}`), or null when it is not one. */
function resultOf(stdout: string): unknown {
    try {
        const parsed: unknown = JSON.parse(stdout);
        return isRecord(parsed) ? parsed['result'] : null;
    } catch {
        return null;
    }
}

function listOf(value: unknown): readonly unknown[] {
    return Array.isArray(value) ? value : [];
}

/** The line `firebase login:list` prints for the account in use (no account: a warning to run `firebase login`). */
const SIGNED_IN = /^Logged in as \S/m;

/** `firebase login:list` (plain text, never `--json`): an account is signed in. */
export function hasAccount(stdout: string): boolean {
    return SIGNED_IN.test(stdout);
}

/** `firebase projects:list --json`: whether `project` is listed, and its number. */
export function listedProject(stdout: string, project: string): { readonly listed: boolean; readonly number: string | null } {
    const entry = listOf(resultOf(stdout)).find((item) => isRecord(item) && item['projectId'] === project);
    const number = isRecord(entry) ? entry['projectNumber'] : undefined;
    return { listed: entry !== undefined, number: typeof number === 'string' && /^\d{6,20}$/.test(number) ? number : null };
}

/** `firebase apps:list WEB --json`: the project has a web app. */
export function hasWebApp(stdout: string): boolean {
    return listOf(resultOf(stdout)).length > 0;
}

/** `firebase hosting:sites:list --json`: the default site (`projects/<id or number>/sites/<project>`) exists. */
export function hasSite(stdout: string, project: string): boolean {
    const result = resultOf(stdout);
    const sites = isRecord(result) ? result['sites'] : result;
    return listOf(sites).some((site) => isRecord(site) && String(site['name']).endsWith(`/sites/${project}`));
}

/** `gcloud billing projects describe --format=json`: billing is linked. */
export function billingEnabled(stdout: string): boolean {
    try {
        const parsed: unknown = JSON.parse(stdout);
        return isRecord(parsed) && parsed['billingEnabled'] === true;
    } catch {
        return false;
    }
}
