/**
 * The first step of every install build (`fetch`, `docs/research/M6-interfaces.md` §1.4): a Node program passed inline
 * to the pinned Node image (`node --input-type=module --eval`), because the bundle's own step scripts are inside the
 * tarball it fetches. It downloads `manifest.json` from the admin's own bundle folder (`HCM_BUNDLE_URL`), refuses to go
 * on unless its SHA-256 is the one the admin computed (`HCM_MANIFEST_SHA256`) and it names the admin's release and its
 * build time (`HCM_RELEASE_TIME`, empty for a build that knows none: finding 39 of 2026-11-01), then
 * downloads each tarball of `HCM_FILES` (the target's first) and refuses any whose SHA-256 is not the manifest's, the
 * target's also not the one the admin chose (`HCM_FILE_SHA256`). It unpacks the target's tarball into `HCM_OUT` with
 * the image's `tar`, and each other fetched tarball `HCM_UNPACK` names (§73k: the site build's `legacy.tgz` while the
 * legacy import is not complete); the site build also puts the bundle files back under `HCM_KEEP_BUNDLE` (a Hosting
 * release replaces every file, so the bundle must stay in it). M14 (`docs/research/M14-start-your-map.md` §6): a site build
 * of a bundle made for no project (`HCM_ADOPT_PROJECT`) replaces the token with this project's id in `firebase.json` and in
 * every file the tarball's `templates.json` lists, the city page's policy among them, and takes `admin/project.json` from the live
 * site (`HCM_ADOPT_FROM`). Every other file stays byte for byte: the admin's script holds the token as this very text.
 *
 * §210: a server build whose admin runs on its own Hosting site (`HCM_ADMIN_SITE`) adds that site to the functions' `.env`
 * (`functions/dist/.env`, which `firebase-tools` reads beside `.env.<project>`), so their links open it directly.
 *
 * §210: the public map's `/admin/…` answers 301 to the admin's own site once the project has it, so an admin still open on
 * the old address names a bundle there: one redirect is followed, and only to `HCM_REDIRECT_ORIGIN` (the project's admin
 * site); any other redirect fails the step (lesson 675).
 *
 * Every download is tried up to four times (2026-11-12: one 10 s connect timeout to Hosting failed a whole Update the map):
 * a network error, a 408, a 429 or a 5xx waits `HCM_FETCH_WAITS` (seconds, comma-separated; 5, 15 and 30 by default) and
 * tries again, each wait one line of the step's log; any other answer (a 404, a digest that differs) fails at once.
 *
 * The program holds no `$`: Cloud Build substitutes `$NAME` in every argument. `fetch-script.test.ts` runs it.
 */
export const FETCH_BUNDLE_SCRIPT = [
    "import { createHash } from 'node:crypto';",
    "import { execFileSync } from 'node:child_process';",
    "import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    'const env = process.env;',
    "const fail = (message) => { process.stderr.write('fetch: ' + message + '\\n'); process.exit(1); };",
    "const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');",
    "const waits = (env.HCM_FETCH_WAITS || '5,15,30').split(',').map(Number);",
    'const passing = (status) => status === 408 || status === 429 || status >= 500;',
    'const pause = (seconds) => new Promise((done) => setTimeout(done, seconds * 1000));',
    'async function attempt(url, name) {',
    '    try {',
    "        let response = await fetch(url, { redirect: 'manual' });",
    "        const to = response.headers.get('location') && new URL(response.headers.get('location'), url);",
    "        if (to && to.origin !== env.HCM_REDIRECT_ORIGIN) fail(name + ': redirected to ' + to.origin);",
    "        if (to) response = await fetch(to, { redirect: 'error' });",
    '        if (response.ok) return { bytes: Buffer.from(await response.arrayBuffer()) };',
    "        if (!passing(response.status)) fail(name + ': HTTP ' + response.status);",
    "        return { why: 'HTTP ' + response.status };",
    '    } catch (error) {',
    '        return { why: String(error.cause?.code ?? error.cause?.message ?? error.message) };',
    '    }',
    '}',
    'async function download(url, name) {',
    '    const tries = waits.length + 1;',
    '    for (let count = 1; ; count += 1) {',
    '        const got = await attempt(url, name);',
    '        if (got.bytes) return got.bytes;',
    "        if (count === tries) fail(name + ': no answer after ' + tries + ' attempts (' + got.why + ')');",
    "        const line = name + ': attempt ' + count + ' of ' + tries + ' failed (' + got.why + ')';",
    "        process.stdout.write('fetch: ' + line + ', trying again in ' + waits[count - 1] + ' s\\n');",
    '        await pause(waits[count - 1]);',
    '    }',
    '}',
    'const get = (name) => download(new URL(name, env.HCM_BUNDLE_URL), name);',
    "const bundleDir = join(env.HCM_WORKSPACE || '/workspace', 'bundle');",
    'mkdirSync(bundleDir, { recursive: true });',
    "const manifestBytes = await get('manifest.json');",
    "if (sha(manifestBytes) !== env.HCM_MANIFEST_SHA256) fail('manifest.json is not the one the admin read');",
    "const manifest = JSON.parse(manifestBytes.toString('utf8'));",
    "if (manifest.release !== env.HCM_RELEASE) fail('manifest.json names another release');",
    "if (String(manifest.releaseTime ?? '') !== (env.HCM_RELEASE_TIME || '')) fail('manifest.json names another build time');",
    "writeFileSync(join(bundleDir, 'manifest.json'), manifestBytes);",
    "const targets = env.HCM_FILES.split(',');",
    "const unpacked = [targets[0], ...(env.HCM_UNPACK ? env.HCM_UNPACK.split(',') : [])];",
    'for (const target of unpacked) {',
    "    if (!targets.includes(target)) fail(target + ' is unpacked but not fetched');",
    '}',
    'for (const target of targets) {',
    '    const entry = manifest.files[target];',
    "    if (!entry) fail('manifest.json names no file for ' + target);",
    '    const bytes = await get(entry.name);',
    "    if (sha(bytes) !== entry.sha256) fail(entry.name + ' is not the file the manifest names');",
    '    writeFileSync(join(bundleDir, entry.name), bytes);',
    '}',
    'const main = manifest.files[targets[0]];',
    "if (main.sha256 !== env.HCM_FILE_SHA256) fail(main.name + ' is not the file the admin chose');",
    'mkdirSync(env.HCM_OUT, { recursive: true });',
    'for (const target of unpacked) {',
    "    execFileSync('tar', ['-xzf', join(bundleDir, manifest.files[target].name), '-C', env.HCM_OUT], { stdio: 'inherit' });",
    '}',
    'if (env.HCM_KEEP_BUNDLE) {',
    '    const keep = join(env.HCM_OUT, env.HCM_KEEP_BUNDLE);',
    '    mkdirSync(keep, { recursive: true });',
    "    for (const name of ['manifest.json', ...targets.map((target) => manifest.files[target].name)]) {",
    '        copyFileSync(join(bundleDir, name), join(keep, name));',
    '    }',
    '}',
    'if (env.HCM_ADOPT_PROJECT) {',
    "    const templates = JSON.parse(readFileSync(join(env.HCM_OUT, 'templates.json'), 'utf8'));",
    "    for (const file of ['firebase.json', ...templates.map((path) => 'public/' + path)]) {",
    '        const path = join(env.HCM_OUT, file);',
    "        writeFileSync(path, readFileSync(path, 'utf8').replaceAll('__HCM_PROJECT_ID__', env.HCM_ADOPT_PROJECT));",
    '    }',
    "    const live = await download(env.HCM_ADOPT_FROM, 'project.json');",
    "    mkdirSync(join(env.HCM_OUT, 'public/admin'), { recursive: true });",
    "    writeFileSync(join(env.HCM_OUT, 'public/admin/project.json'), live);",
    '}',
    'if (env.HCM_ADMIN_SITE) {',
    "    mkdirSync(join(env.HCM_OUT, 'functions/dist'), { recursive: true });",
    "    appendFileSync(join(env.HCM_OUT, 'functions/dist/.env'), '\\nHCM_ADMIN_SITE=' + env.HCM_ADMIN_SITE + '\\n');",
    '}',
    "process.stdout.write('fetch: ' + main.name + ' checked and unpacked\\n');",
].join('\n');
