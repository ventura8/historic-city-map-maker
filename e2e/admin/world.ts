import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { FIXTURE_VALUES } from '@hcm/test-support/api-fixtures';
import { E2E_PROJECT_CONFIG } from '@hcm/test-support/fakes';

import { E2E_TILE_HOST, MOCK_API_ORIGIN } from '../fixtures/world.js';

/**
 * The admin's e2e world (docs/research/M2b-interfaces.md §6.2): the admin server, the Firebase emulators of project
 * `demo-hcm`, the web configuration the admin reads from `/__/firebase/init.json`, the environment of the Functions
 * emulator (CR-M2-6) and the Google accounts the tests sign in with. Generated test values only; the API key, the
 * project number and the OAuth client are the fixture values of `@hcm/test-support`, so the browser, the Functions
 * emulator and the fake upstreams agree on them.
 */

/**
 * The e2e Hosting server (`e2e/mock-apis/admin-server.ts`): the e2e build's Firebase Hosting tree as Hosting serves it,
 * the public map at its root and the admin's `e2e` build under `/admin/` (M6, docs/research/M6-interfaces.md §2): the
 * admin tier's origin, and the viewer tier's for the Hosting scenarios (V30).
 */
export const ADMIN_PORT = 4312;
export const ADMIN_ORIGIN = `http://127.0.0.1:${String(ADMIN_PORT)}`;
/** The admin's folder on the Hosting site; every admin spec's address is below it (`adminPath`). */
export const ADMIN_PATH = '/admin/';
/** The admin's address on the e2e Hosting server. */
export const ADMIN_URL = `${ADMIN_ORIGIN}${ADMIN_PATH}`;
/** The admin's Hosting folder as its build writes it (its `e2e` Vite build and the site build's page, legacy bundle, ...). */
export const ADMIN_DIST_DIR = 'packages/admin/dist';
/** The e2e Hosting tree (`npm run build:site:e2e`), the public variant and the start-up one (`scripts/site/src/hosting/`). */
export const E2E_HOSTING_DIR = 'dist/e2e-hosting';
/** M14: the start site (`docs/research/M14-start-your-map.md` §5), which the admin server serves at `/start/`. */
export const E2E_START_DIR = 'dist/e2e-start';
/** The start site's OAuth client id in the e2e world: a generated value that names the scenario, no real client. */
export const E2E_START_CLIENT_ID = 'e2e-start-client.apps.googleusercontent.com';
/** The start site's Search Console file in the e2e world (`HCM_START_SITE_VERIFICATION`): a generated name, no real token. */
export const E2E_START_SITE_VERIFICATION = 'google0e2e0e2e.html';
/** Where a test puts what it released on the fake Hosting; the admin server serves it to a browser with the cookie. */
export const E2E_RELEASED_DIR = 'dist/e2e-released';
export const E2E_HOSTING_START_UP_DIR = 'dist/e2e-hosting-start-up';
/**
 * The GitHub Pages redirect tree (`npm run build:site -- --pages-redirect`, M6 §2.7) below the site server's root
 * (`dist/e2e-site/pages-redirect/`): every page sends the visitor to the e2e Hosting server with the same hash.
 */
export const PAGES_REDIRECT_FOLDER = 'pages-redirect';

/** The emulators' project: the `demo-` prefix keeps every real resource out of reach. */
export const E2E_PROJECT_ID = String(FIXTURE_VALUES['projectId']);

/** The private bucket's name, as on a real project created since October 2024 (`STORAGE_BUCKET_URL` below). */
const E2E_BUCKET = `${E2E_PROJECT_ID}.firebasestorage.app`;

export type EmulatorName = 'hub' | 'auth' | 'firestore' | 'storage' | 'functions' | 'pubsub' | 'tasks';

/** The emulators the admin tier starts, in `firebase emulators:start --only` order (the hub starts with them). */
export const ADMIN_EMULATORS: readonly Exclude<EmulatorName, 'hub'>[] = ['auth', 'firestore', 'storage', 'functions', 'pubsub', 'tasks'];

interface EmulatorAddress {
    readonly host: string;
    readonly port: number;
}

/** `firebase.json` → `emulators`, the single place the ports are written. */
function emulatorAddresses(): Readonly<Record<EmulatorName, EmulatorAddress>> {
    const firebaseJson = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../firebase.json'), 'utf8')) as {
        emulators: Record<EmulatorName, EmulatorAddress>;
    };
    return firebaseJson.emulators;
}

const ADDRESSES = emulatorAddresses();

/** `http://127.0.0.1:<port>` of an emulator. */
export function emulatorOrigin(name: EmulatorName): string {
    const { host, port } = ADDRESSES[name];
    return `http://${host}:${String(port)}`;
}

/**
 * The origins the admin's e2e build connects to besides its own: the emulators it uses, the mock APIs, and the e2e tile
 * host of the XYZ layers: an admin whose city has an XYZ layer adds its server to the CSP by hand
 * (`docs/ADMIN_GUIDE.en.md`, CR-M2c-27), as the e2e world does here.
 */
export const ADMIN_CONNECT_ORIGINS: readonly string[] = [
    emulatorOrigin('auth'),
    emulatorOrigin('firestore'),
    emulatorOrigin('storage'),
    emulatorOrigin('functions'),
    MOCK_API_ORIGIN,
    `https://${E2E_TILE_HOST}`,
];

/** What Hosting's `/__/firebase/init.json` answers for `demo-hcm` (the fields `firebaseWebConfigSchema` reads). */
export const ADMIN_WEB_CONFIG = {
    apiKey: String(FIXTURE_VALUES['apiKey']),
    appId: String(FIXTURE_VALUES['appId']),
    authDomain: `${E2E_PROJECT_ID}.firebaseapp.com`,
    messagingSenderId: String(FIXTURE_VALUES['projectNumber']),
    projectId: E2E_PROJECT_ID,
    storageBucket: E2E_BUCKET,
} as const;

/** `/runtime.json` of the e2e admin: no App Check site key, so no App Check (M2b-interfaces §1.4). */
export const ADMIN_RUNTIME = { release: 'e2e' } as const;

/** `/project.json` of the e2e admin: the e2e world's project, whose fake upstreams the provisioner works on (§3.7). */
export const ADMIN_PROJECT = E2E_PROJECT_CONFIG;

/** Firebase Auth's name for the default app, part of the key its IndexedDB persistence stores the user under. */
export const FIREBASE_APP_NAME = '[DEFAULT]';

/**
 * The environment of `firebase emulators:start` (the Functions emulator passes it to the functions): the fake upstreams
 * at the mock APIs (CR-M2-14, CR-M2-22), the admin's e2e origin (CR-M2-39, read once CR-M2b-4 lands), the bucket name,
 * and no metadata-server probe. No `HCM_OAUTH_CLIENT_IDS` (a real project sets it in functions/deploy-env.json), so
 * `admin.claim` takes the path of a project without it: it asks the fake Identity Toolkit for the Google sign-in
 * client, the stand-in consent's (CR-M2b-2). The emulators' JVMs (Firestore, the Storage rules runtime, Pub/Sub) get a
 * heap ceiling of 2 GB each: without one each may grow to a quarter of the machine's memory. `npm test` gives them 6 GB, as
 * it also asks the Firestore emulator for the whole rule-coverage report (DECISIONS-for-review.md §180). Every Node
 * process the emulators start inherits `NODE_OPTIONS`: the Functions emulator keeps one worker per function trigger
 * (at most `HCM_EMULATOR_MAX_WORKERS` live, the least recently used idle one stopped: `e2e/support/emulator-pool.ts`,
 * DECISIONS-for-review.md §202a), and a young generation of 1 MB instead of V8's 16 MB semi-spaces
 * keeps each one's heap at about half (one worker that loaded the functions: 102 to 48 MB of heap, 148 to 122 MB resident;
 * in the e2e stage about 250 to 165 MB a worker, §180i).
 */
export const EMULATOR_ENV: Readonly<Record<string, string>> = {
    JAVA_TOOL_OPTIONS: '-XX:CICompilerCount=2 -Xmx2g',
    NODE_OPTIONS: '--max-semi-space-size=1',
    HCM_UPSTREAM_BASE: MOCK_API_ORIGIN,
    HCM_ADMIN_ORIGINS: ADMIN_ORIGIN,
    STORAGE_BUCKET_URL: E2E_BUCKET,
    METADATA_SERVER_DETECTION: 'none',
};

/** What a Google account may do on the project, as the fake Resource Manager answers it (`GoogleGrant.access`). */
type ProjectAccess = 'owner' | 'editor' | 'none';

export interface Persona {
    readonly email: string;
    /** The Google subject (`sub`): the same account signs in to the same Auth emulator user every time. */
    readonly sub: string;
    readonly displayName: string;
    readonly access: ProjectAccess;
}

/** The Google accounts of the admin tier. */
export const PERSONAS = {
    /** The Google Cloud project's owner, who claims the map. */
    owner: { email: String(FIXTURE_VALUES['ownerEmail']), sub: '100000000000000000001', displayName: 'E2E Owner', access: 'owner' },
    /** An invited admin of the map, with no role on the project. */
    admin: { email: 'admin@e2e.test', sub: '100000000000000000002', displayName: 'E2E Admin', access: 'none' },
    /** A project editor who does not own it. */
    editor: { email: 'editor@e2e.test', sub: '100000000000000000003', displayName: 'E2E Editor', access: 'editor' },
    /** A Google account with nothing to do with the map. */
    stranger: { email: String(FIXTURE_VALUES['strangerEmail']), sub: '100000000000000000004', displayName: 'E2E Stranger', access: 'none' },
} as const satisfies Readonly<Record<string, Persona>>;

export type PersonaName = keyof typeof PERSONAS;

export const PERSONA_NAMES = Object.keys(PERSONAS) as readonly PersonaName[];

/** The persona with `email`, if any. */
export function personaOf(email: string): Persona | undefined {
    return Object.values(PERSONAS).find((persona) => persona.email === email.toLowerCase());
}
