"""The local page the owner signs in on (docs/research/M7-local-worker.md §2.1), and its headers.

Static HTML, script and style, no template engine: the only values written into the page are the project id, the city
id and the per-process CSRF token (and, under `--emulators`, the Auth emulator's loopback host), each checked against
its pattern first and written as JSON into a `<script type="application/json">` element with `<`, `>` and `&` escaped.
The script loads the Firebase JS SDK 13.3.0 (the admin's version: a test keeps them equal) from `www.gstatic.com`, the
project's web configuration from the worker (`GET /config`, which the worker read from the project's Hosting), signs in
with Google in a popup (the SDK keeps nothing: in-memory persistence, signed out once the worker holds the tokens),
posts `{idToken, refreshToken}` to `POST /session` with the CSRF token, polls `GET /state` and has Sign out. Its words
are in English and Romanian (the browser's language picks).

Finding 67 of 2026-11-02: the admin's command pairs the worker (`pairing.py`), so the page is for its state; the Google
sign-in stays as a fallback. Finding 69: on the live project that popup never finished (the page stayed "Not signed in",
no error): the SDK's calls from `localhost` carry the project's browser key, which Provision restricts to the Hosting
origins (UNVERIFIED as the cause; Chrome's partitioned storage of the auth iframe is the other suspect). So the sign-in
now gives up after `SIGN_IN_TIMEOUT_MS` with a clear message pointing at the admin's command, and the page still shows
the worker's state when the SDK cannot be loaded at all.

Pause this computer (the owner's request of 2026-11-13): while signed in the page offers Until I resume, For 1 hour and Until
tomorrow (the next day at 08:00 on this computer's clock) and, while paused, Resume (`POST /pause` with the CSRF token); the
state's `paused` says who paused it and until when.
"""

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from hcm_pipeline.paths import CITY_ID
from hcm_pipeline.worker.args import EMULATOR_HOST, PROJECT_ID

FIREBASE_SDK_VERSION: Final = "13.3.0"
# How long the fallback Google sign-in may take before the page gives up and points at the admin's command (finding 69).
SIGN_IN_TIMEOUT_MS: Final = 90_000
SDK_ORIGIN: Final = "https://www.gstatic.com"
SETTINGS_ELEMENT: Final = "hcm-worker-settings"
CSRF_TOKEN: Final = re.compile(r"[0-9a-f]{64}")
_SETTINGS_MARK: Final = "__HCM_WORKER_SETTINGS__"
_ESCAPES: Final = {"<": "\\u003c", ">": "\\u003e", "&": "\\u0026"}


@dataclass(frozen=True)
class PageSettings:
    """The page's three checked values (and the Auth emulator under `--emulators`)."""

    project: str
    city: str
    csrf: str
    auth_emulator: str | None = None

    def __post_init__(self) -> None:
        checks = (
            (PROJECT_ID, self.project),
            (CITY_ID, self.city),
            (CSRF_TOKEN, self.csrf),
            (EMULATOR_HOST, self.auth_emulator or "127.0.0.1:1"),
        )
        if not all(pattern.fullmatch(value) for pattern, value in checks):
            raise ValueError("a value of the local page does not have its expected shape")

    def json(self) -> str:
        """The settings as JSON safe inside a script element."""
        settings = {"projectId": self.project, "cityId": self.city, "csrf": self.csrf, "authEmulator": self.auth_emulator}
        text = json.dumps(settings, ensure_ascii=True)
        for character, escaped in _ESCAPES.items():
            text = text.replace(character, escaped)
        return text


def content_security_policy(project: str, emulator_hosts: Sequence[str] = ()) -> str:
    """The page's policy: its own files, the SDK, Google's sign-in popup, the project's Auth calls; nothing inline runs."""
    local = [f"http://{host}" for host in emulator_hosts]
    directives = (
        "default-src 'none'",
        f"script-src 'self' {SDK_ORIGIN} https://apis.google.com",
        " ".join(("connect-src 'self'", f"https://{project}.web.app", "https://*.googleapis.com", *local)),
        " ".join(("frame-src", f"https://{project}.firebaseapp.com", f"https://{project}.web.app", "https://accounts.google.com", *local)),
        "style-src 'self'",
        "img-src 'self' data:",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
    )
    return "; ".join(directives)


PAGE_HTML: Final = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Historic City Map Maker: this computer's worker</title>
<link rel="stylesheet" href="/page.css">
<script type="application/json" id="{SETTINGS_ELEMENT}">{_SETTINGS_MARK}</script>
<script type="module" src="/page.js"></script>
</head>
<body>
<main>
<h1 data-text="title">Historic City Map Maker: this computer's worker</h1>
<p data-text="intro">Use this computer, in the admin, connects this computer. Sign in with Google only if it did not.</p>
<dl>
<dt data-text="accountLabel">Signed in as</dt><dd id="account"></dd>
<dt data-text="cityLabel">City</dt><dd id="city"></dd>
<dt data-text="workLabel">Work</dt><dd id="work"></dd>
</dl>
<p id="error" role="alert"></p>
<section id="pause" hidden>
<h2 data-text="pauseTitle">Pause this computer</h2>
<p id="paused" role="status"></p>
<p id="pause-note" data-text="pauseNote" hidden>It takes no new work and gave its job back to the queue; nothing is lost.</p>
<p id="pause-choices">
<button type="button" data-pause="resume-only" data-text="untilResume">Until I resume</button>
<button type="button" data-pause="hour" data-text="forHour">For 1 hour</button>
<button type="button" data-pause="tomorrow" data-text="untilTomorrow">Until tomorrow</button>
</p>
<p><button id="resume" type="button" data-text="resume" hidden>Resume</button></p>
</section>
<p>
<button id="sign-in" type="button" data-text="signIn">Sign in with Google</button>
<button id="sign-out" type="button" data-text="signOut" hidden>Sign out</button>
<button id="remove" type="button" data-text="remove">Stop using this computer</button>
</p>
</main>
</body>
</html>
"""

PAGE_CSS: Final = """:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; padding: 16px; }
main { max-width: 40rem; margin: 0 auto; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 8px 16px; }
dt { font-weight: 600; }
dd { margin: 0; overflow-wrap: anywhere; }
#error { color: #b3261e; min-height: 1.5em; }
@media (prefers-color-scheme: dark) { #error { color: #f2b8b5; } }
button { font: inherit; min-height: 48px; padding: 0 24px; border-radius: 24px; cursor: pointer; }
#pause-choices { display: flex; flex-wrap: wrap; gap: 8px; }
#pause-choices[hidden] { display: none; }
"""

PAGE_JS: Final = (
    """const SDK = 'https://www.gstatic.com/firebasejs/"""
    + FIREBASE_SDK_VERSION
    + """';
const SIGN_IN_TIMEOUT_MS = """
    + str(SIGN_IN_TIMEOUT_MS)
    + """;
// The page shows the worker's state even when the SDK cannot be loaded (its sign-in is only the fallback).
const sdk = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`)]).catch(() => undefined);
const settings = JSON.parse(document.getElementById('"""
    + SETTINGS_ELEMENT
    + """').textContent);
const TEXTS = {
    en: {
        title: "Historic City Map Maker: this computer's worker",
        intro: 'Use this computer, in the admin, connects this computer. Sign in with Google only if it did not.',
        accountLabel: 'Signed in as',
        cityLabel: 'City',
        workLabel: 'Work',
        signIn: 'Sign in with Google',
        signOut: 'Sign out',
        notSignedIn: 'Not signed in',
        idle: 'Waiting for a job',
        busy: 'Working on job',
        'signed-out': 'Sign in to start working',
        signedOut: 'Signed out',
        signInAgain: 'Your session ended: sign in again',
        configMissing: "The project's web configuration could not be read",
        'apiError.notAdmin': 'This account is not an editor of this city',
        'apiError.unauthenticated': 'The sign-in was not accepted: sign in again',
        'apiError.invalidRequest': 'The sign-in could not be read: sign in again',
        'apiError.unavailable': 'The server did not answer: try again',
        'apiError.worker.revoked': 'This computer was disconnected in the admin: choose Use this computer in the admin again',
        'apiError.worker.pairCode': 'The pairing code is not valid any more: choose Use this computer in the admin again',
        'apiError.city.notMember': 'This account is not an editor of this city',
        signInTimeout: 'The sign-in did not finish: choose Use this computer in the admin, which connects this computer',
        outdated: 'The imagery pipeline was updated: choose Use this computer in the admin and open the new file',
        pauseTitle: 'Pause this computer',
        untilResume: 'Until I resume',
        forHour: 'For 1 hour',
        untilTomorrow: 'Until tomorrow',
        resume: 'Resume',
        pausedByYou: 'Paused by you',
        pausedUntil: 'Paused by you until {time}',
        pauseNote: 'It takes no new work and gave its job back to the queue; nothing is lost.',
        pauseFailed: 'The pause did not reach the worker: try again',
        remove: 'Stop using this computer',
        removeConfirm: 'Remove the helper, its work and its files from this computer? It is then disconnected from the map.',
        removing: 'Removing the helper from this computer: this page closes in a minute.',
        'no-starter': 'A command started this worker: run docker rm -f hcm-worker, then docker volume rm hcm-worker.',
    },
    ro: {
        title: 'Harta istorică a orașului: lucrătorul acestui calculator',
        intro: 'Folosește acest calculator, din administrare, îl conectează. Conectează-te cu Google doar dacă nu a reușit.',
        accountLabel: 'Conectat ca',
        cityLabel: 'Oraș',
        workLabel: 'Lucru',
        signIn: 'Conectează-te cu Google',
        signOut: 'Deconectează-te',
        notSignedIn: 'Neconectat',
        idle: 'Așteaptă o lucrare',
        busy: 'Lucrează la lucrarea',
        'signed-out': 'Conectează-te ca să înceapă lucrul',
        signedOut: 'Deconectat',
        signInAgain: 'Sesiunea s-a încheiat: conectează-te din nou',
        configMissing: 'Configurația web a proiectului nu a putut fi citită',
        'apiError.notAdmin': 'Acest cont nu este editor al acestui oraș',
        'apiError.unauthenticated': 'Conectarea nu a fost acceptată: conectează-te din nou',
        'apiError.invalidRequest': 'Conectarea nu a putut fi citită: conectează-te din nou',
        'apiError.unavailable': 'Serverul nu a răspuns: încearcă din nou',
        'apiError.worker.revoked': 'Calculatorul a fost deconectat din administrare: alege din nou Folosește acest calculator',
        'apiError.worker.pairCode': 'Codul de asociere nu mai este valabil: alege din nou Folosește acest calculator în administrare',
        'apiError.city.notMember': 'Acest cont nu este editor al acestui oraș',
        signInTimeout: 'Conectarea nu s-a încheiat: alege Folosește acest calculator în administrare, care îl conectează',
        outdated: 'Fluxul de imagini s-a actualizat: alege Folosește acest calculator în administrare și deschide fișierul nou',
        pauseTitle: 'Pune pe pauză acest calculator',
        untilResume: 'Până reiau eu',
        forHour: 'Timp de o oră',
        untilTomorrow: 'Până mâine',
        resume: 'Reia',
        pausedByYou: 'Pus pe pauză de tine',
        pausedUntil: 'Pus pe pauză de tine până la {time}',
        pauseNote: 'Nu mai ia lucrări noi și și-a dat lucrarea înapoi la coadă; nu se pierde nimic.',
        pauseFailed: 'Pauza nu a ajuns la lucrător: încearcă din nou',
        remove: 'Nu mai folosi acest calculator',
        removeConfirm: 'Ștergi ajutorul, lucrul și fișierele lui de pe acest calculator? Apoi e deconectat de la hartă.',
        removing: 'Se șterge ajutorul de pe acest calculator: pagina se închide într-un minut.',
        'no-starter': 'O comandă a pornit acest lucrător: rulează docker rm -f hcm-worker, apoi docker volume rm hcm-worker.',
    },
};
const lang = (navigator.language || 'en').toLowerCase().startsWith('ro') ? 'ro' : 'en';
const text = (key) => TEXTS[lang][key] ?? key;
const byId = (id) => document.getElementById(id);
document.documentElement.lang = lang;
for (const node of document.querySelectorAll('[data-text]')) {
    node.textContent = text(node.dataset.text);
}

async function session(method, body, path = '/session') {
    const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-HCM-Worker': settings.csrf },
        body: JSON.stringify(body ?? {}),
    });
    const answer = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(answer.error ?? `HTTP ${response.status}`);
    }
}

/** When a pause choice ends (ISO), or undefined for Until I resume: an hour from now, or tomorrow at 08:00 on this computer. */
function pauseEnd(choice) {
    if (choice === 'hour') {
        return new Date(Date.now() + 3600 * 1000).toISOString();
    }
    if (choice === 'tomorrow') {
        const end = new Date();
        end.setDate(end.getDate() + 1);
        end.setHours(8, 0, 0, 0);
        return end.toISOString();
    }
    return undefined;
}

async function pause(body) {
    const response = await fetch('/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-HCM-Worker': settings.csrf },
        body: JSON.stringify(body),
    }).catch(() => undefined);
    if (!response?.ok) {
        byId('error').textContent = text('pauseFailed');
    }
}

function pausedText(paused) {
    if (!paused.until) {
        return text('pausedByYou');
    }
    const time = new Date(paused.until).toLocaleString(lang, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    return text('pausedUntil').replace('{time}', time);
}

function showPause(state) {
    byId('pause').hidden = !state.signedIn;
    const paused = state.paused ?? null;
    byId('paused').textContent = paused ? pausedText(paused) : '';
    byId('pause-note').hidden = !paused;
    byId('pause-choices').hidden = Boolean(paused);
    byId('resume').hidden = !paused;
}

// What the page's own last action said (a sign-in that timed out), kept across the state polls until the next action.
let pageError = null;

function show(state) {
    byId('account').textContent = state.signedIn ? (state.email ?? '') : text('notSignedIn');
    byId('city').textContent = state.city;
    const step = state.step ? ` · ${state.step}` : '';
    byId('work').textContent = state.state === 'busy' ? `${text('busy')} ${state.jobId}${step}` : text(state.state);
    const problem = state.lastError ?? pageError ?? (state.outdated ? 'outdated' : null);
    byId('error').textContent = problem ? text(problem) : '';
    byId('sign-in').hidden = state.signedIn;
    byId('sign-out').hidden = !state.signedIn;
    showPause(state);
}

async function poll() {
    const response = await fetch('/state').catch(() => undefined);
    if (response?.ok) {
        show(await response.json());
    }
}

/** The popup's promise, or a refusal `signInTimeout` after `SIGN_IN_TIMEOUT_MS` (finding 69: it may never settle). */
function withTimeout(promise) {
    let timer;
    const late = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('signInTimeout')), SIGN_IN_TIMEOUT_MS);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

let auth;
const auth$ = sdk?.[1];
const configured = sdk ? await fetch('/config').catch(() => undefined) : undefined;
if (configured?.ok) {
    const app = sdk[0].initializeApp(await configured.json());
    auth = auth$.initializeAuth(app, {
        persistence: auth$.inMemoryPersistence,
        popupRedirectResolver: auth$.browserPopupRedirectResolver,
    });
    if (settings.authEmulator) {
        auth$.connectAuthEmulator(auth, `http://${settings.authEmulator}`, { disableWarnings: true });
    }
}

byId('sign-in').addEventListener('click', async () => {
    pageError = null;
    try {
        if (!auth) {
            throw new Error('configMissing');
        }
        const credential = await withTimeout(auth$.signInWithPopup(auth, new auth$.GoogleAuthProvider()));
        const idToken = await credential.user.getIdToken();
        await session('POST', { idToken, refreshToken: credential.user.refreshToken });
        await auth$.signOut(auth);
    } catch (error) {
        pageError = error.message;
        byId('error').textContent = text(error.message);
    }
    await poll();
});
for (const button of document.querySelectorAll('[data-pause]')) {
    button.addEventListener('click', async () => {
        const until = pauseEnd(button.dataset.pause);
        await pause(until ? { action: 'pause', until } : { action: 'pause' });
        await poll();
    });
}
byId('resume').addEventListener('click', async () => {
    await pause({ action: 'resume' });
    await poll();
});
byId('sign-out').addEventListener('click', async () => {
    await session('DELETE').catch((error) => {
        byId('error').textContent = text(error.message);
    });
    await poll();
});
// W5: Stop using this computer: the starter removes the helper, its work and its files, then the map disconnects it.
byId('remove').addEventListener('click', async () => {
    if (!window.confirm(text('removeConfirm'))) {
        return;
    }
    try {
        await session('POST', {}, '/remove');
        pageError = 'removing';
        byId('error').textContent = text('removing');
    } catch (error) {
        pageError = error.message;
        byId('error').textContent = text(error.message);
    }
});
await poll();
setInterval(poll, 3000);
"""
)


def render_page(settings: PageSettings) -> bytes:
    """The page with its settings written in."""
    return PAGE_HTML.replace(_SETTINGS_MARK, settings.json()).encode("utf-8")
