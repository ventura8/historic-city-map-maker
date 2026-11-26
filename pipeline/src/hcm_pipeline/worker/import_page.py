"""The worker's import page (docs/research/M20-import-local.md §2.1): choose a folder or a zip on this computer, then scan it.

On the worker's own origin, so no page of the web calls `localhost` (Chrome's Private Network Access and CORS). It works in every browser
without the File System Access API: a folder input (`webkitdirectory`) and a zip input. Each file is posted to the worker over loopback
with the CSRF header; a zip is then read in place by the worker. Its texts are in Romanian and English, as the main page's; nothing inline
runs (the page's policy), and nothing it shows is HTML from data (`textContent` only).
"""

from typing import Final

from hcm_pipeline.worker.page import SETTINGS_ELEMENT

SETTINGS_MARK: Final = "__HCM_IMPORT_SETTINGS__"

IMPORT_HTML: Final = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Historic City Map Maker: import local files</title>
<link rel="stylesheet" href="/import.css">
<script type="application/json" id="{SETTINGS_ELEMENT}">{SETTINGS_MARK}</script>
<script type="module" src="/import.js"></script>
</head>
<body>
<main>
<h1 data-text="title">Import local files</h1>
<p data-text="intro">Your files stay on this computer. Only the map tiles go up, after you approve them.</p>
<p><label><span data-text="folder">Choose a folder</span> <input id="folder" type="file" webkitdirectory multiple></label></p>
<p><label><span data-text="zip">Or choose a zip</span> <input id="zip" type="file" accept=".zip,application/zip"></label></p>
<p data-text="large">For a very large archive, copy it into the worker's import folder instead.</p>
<p id="status" role="status" aria-live="polite"></p>
<p id="error" role="alert"></p>
</main>
</body>
</html>
"""

IMPORT_CSS: Final = """:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; padding: 16px; }
main { max-width: 40rem; margin: 0 auto; }
input { font: inherit; min-height: 48px; }
#error { color: #b3261e; min-height: 1.5em; }
@media (prefers-color-scheme: dark) { #error { color: #f2b8b5; } }
"""

IMPORT_JS: Final = (
    """const settings = JSON.parse(document.getElementById('"""
    + SETTINGS_ELEMENT
    + """').textContent);
const TEXTS = {
    en: {
        title: 'Import local files',
        intro: 'Your files stay on this computer. Only the map tiles go up, after you approve them.',
        folder: 'Choose a folder',
        zip: 'Or choose a zip',
        large: "For a very large archive, copy it into the worker's import folder instead.",
        sending: 'Sending {done} of {total} files to the worker...',
        scanning: 'Reading the files: this can take a while.',
        reported: 'Done: {series} series found. Go back to the admin to check them.',
        failed: 'The scan did not finish. Try again, or start the worker again.',
        refused: 'The worker refused a file or the zip.',
    },
    ro: {
        title: 'Importă fișiere locale',
        intro: 'Fișierele rămân pe acest calculator. Urcă doar dalele hărții, după ce le aprobi.',
        folder: 'Alege un dosar',
        zip: 'Sau alege o arhivă zip',
        large: 'Pentru o arhivă foarte mare, copiaz-o în dosarul de import al worker-ului.',
        sending: 'Se trimit {done} din {total} fișiere worker-ului...',
        scanning: 'Se citesc fișierele: poate dura.',
        reported: 'Gata: {series} serii găsite. Întoarce-te în admin ca să le verifici.',
        failed: 'Scanarea nu s-a terminat. Încearcă din nou sau pornește din nou worker-ul.',
        refused: 'Worker-ul a refuzat un fișier sau arhiva.',
    },
};
const texts = navigator.language.toLowerCase().startsWith('ro') ? TEXTS.ro : TEXTS.en;
document.documentElement.lang = texts === TEXTS.ro ? 'ro' : 'en';
for (const element of document.querySelectorAll('[data-text]')) {
    element.textContent = texts[element.dataset.text];
}
const say = (key, values = {}) => {
    document.getElementById('status').textContent = texts[key].replace(/\\{(\\w+)\\}/g, (_, name) => String(values[name] ?? ''));
};
const fail = (key) => {
    document.getElementById('error').textContent = texts[key];
};
const headers = { 'X-HCM-Worker': settings.csrf };
const post = (path, body) =>
    fetch(path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const send = (id, file, path) =>
    fetch(`/import/${id}/file`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/octet-stream', 'X-HCM-Path': encodeURIComponent(path) },
        body: file,
    });
const follow = async (id) => {
    for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const state = await (await fetch(`/import/${id}`)).json();
        if (state.state === 'reported') return say('reported', state);
        if (state.state === 'failed') return fail('failed');
    }
};
const latitude = Number(new URLSearchParams(location.search).get('lat')) || undefined;
const start = async (files, source, name) => {
    document.getElementById('error').textContent = '';
    const { archiveId } = await (await post('/import/new', {})).json();
    let done = 0;
    for (const file of files) {
        const path = file.webkitRelativePath || file.name;
        if (!(await send(archiveId, file, path)).ok) return fail('refused');
        say('sending', { done: ++done, total: files.length });
    }
    if (source === 'zip' && !(await post(`/import/${archiveId}/zip`, { path: files[0].name })).ok) return fail('refused');
    say('scanning');
    await post(`/import/${archiveId}/scan`, { name, source, latitude });
    return follow(archiveId);
};
document.getElementById('folder').addEventListener('change', (event) => {
    const files = [...event.target.files];
    if (files.length > 0) start(files, 'folder', files[0].webkitRelativePath.split('/')[0]).catch(() => fail('failed'));
});
document.getElementById('zip').addEventListener('change', (event) => {
    const [file] = event.target.files;
    if (file) start([file], 'zip', file.name).catch(() => fail('failed'));
});
"""
)


def render_import_page(settings_json: str) -> bytes:
    """The import page with the main page's settings (the CSRF token among them) written in."""
    return IMPORT_HTML.replace(SETTINGS_MARK, settings_json).encode("utf-8")
