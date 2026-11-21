# Self-hosting a city

Without a terminal: the [start page](research/M14-start-your-map.md) does the same steps from a browser.

`create-historic-city` starts a new city's historical map: the starter kit in three files and, if you want the admin app in a Firebase project of your own, the guided steps up to it. The contract is [research/M5-interfaces.md](research/M5-interfaces.md) §3–§4; the page, `city.json` and the engine are described in [ENGINE_API.md](ENGINE_API.md).

## Two roads

| Road | Command | What you get |
| --- | --- | --- |
| The map only (static) | `npx create-historic-city@1.0.0-beta.1 my-city` | `index.html`, `city.json`, `README.md` in a new folder: the map on GitHub Pages or any static host, no Firebase. You edit `city.json` by hand (the kit's README says how). |
| The map with the admin | after the first command, `npx create-historic-city@1.0.0-beta.1 self-host my-city --project <id>` | The same folder (`self-host` needs it: create the city first), plus a Firebase project of your own with the admin app, at `https://<id>.web.app/`. |

`npm create historic-city@1.0.0-beta.1 my-city` is the same as the first command. The commands name the exact release: `@1` would run whatever release carries the name on the day you read this.

## The kit (minimum questions)

The command asks only what no option answered: the city's Romanian name (the id follows it), its rectangle (`west,south,east,north`, in degrees: on openstreetmap.org, the Export button shows them for the area on screen; the default is the example's Bucharest rectangle), the theme's colour (Enter keeps the default) and your **public** Mapbox token (`pk.…`; Enter leaves it for later). A secret token (`sk.…`) is refused: it is neither written nor shown. With `--yes` every question takes its default; `--name-ro`, `--name-en`, `--id`, `--bbox` and `--seed` answer ahead. It writes only into a new or empty folder; one that already holds files is left alone.

## What self-hosting needs

- Node 24.12 or newer;
- the Firebase CLI: `npm install -g firebase-tools@15.36.0` (without it the command stops before running anything and shows this line);
- optionally the Google Cloud CLI (`gcloud`): with it the command checks the billing link itself; without it, it asks you;
- a Google account and, for the server, a card for the Blaze plan, entered in Google's pages only; the Mapbox and USGS accounts come later, from the Setup Assistant.

## The steps

Each step says what it does, why and what it costs, then asks `y/N`; `--yes` never answers these. The command runs only your own tools (`firebase`, `gcloud`), in your terminal, and opens the Google pages where the human part happens.

| # | Step | What runs | Your part | Cost |
| --- | --- | --- | --- | --- |
| 1 | The tools | `firebase --version`, `gcloud --version` | nothing | free |
| 2 | Signing in | `firebase login` (skipped when you are signed in) | Google's sign-in in the browser | free |
| 3 | The project | `firebase projects:create <id>` (skipped when it exists) | Google's terms on first use | free |
| 4 | The web app and Hosting | `firebase apps:create WEB …`, the Hosting site (each only when missing) | nothing | free |
| 5 | Google sign-in for the admin | opens the console: Authentication, Sign-in method | Google, Enable, Save | free |
| 6 | The admin, in start-up mode | writes `server/` into the city folder, then `firebase deploy --only hosting` | nothing | free (Spark) |
| 7 | Setup in the admin | opens `https://<id>.web.app/admin/` (M6: the admin in its folder; the root sends there until the map is published) | signing in, claiming the map, billing and the 5 USD budget, Provision | free until Blaze |
| 8 | The server | checks billing (`gcloud billing projects describe`), then `firebase deploy --only functions,firestore,storage,hosting` | linking billing, if you have not | Blaze; the budget pauses the imagery, never the site |
| 9 | The rest of Setup | opens the admin again | Mapbox, USGS, analytics, your first city (New city) | as you choose |

A project of your own has no GitHub Actions: Setup's Provision makes no `gh-deployer` and no Workload Identity (CR-M5-7, done since M14), and the install card shows no GitHub variables. `--experimental`, from old command lines, is accepted and changes nothing.

A "no" stops the command at that step and lists the steps left (exit status 0). A failed step shows its reason and the command to continue with (exit status 1). The `server/` folder holds the deploy files and goes into `.gitignore`: it is no part of the site.

## Options

| Option | Role |
| --- | --- |
| `--project <id>` | the Firebase project (6–30 lowercase letters, digits, dashes); without it the command asks |
| `--viewer-origin https://<user>.github.io` | the map's public site, which the functions accept (default `https://<id>.web.app`) |
| `--billing-wait <minutes>` | how long step 8 waits for billing, checking every 15 seconds (default 20; 0 checks once after Enter) |
| `--dry-run` | shows the files, commands and pages without writing, running or opening anything |
| `--lang ro`, `--lang en` | the messages' language (else `LANG`, then Romanian) |

## Later

- `npx create-historic-city@1.0.0-beta.1 deploy <folder> --project <id>`: the server alone (steps 1, 8 and 9), once billing is linked;
- `npx create-historic-city@1.0.0-beta.1 doctor <folder>`: Node, the tools, `city.json` (valid, with your token) and the engine release in `index.html`;
- `npx create-historic-city@1.0.0-beta.1 theme <folder> --seed '#1b6c4a'`: the map's colours from one colour (the four schemes of `city.json`, which the map reads, and the page's colour);
- `npx create-historic-city@<version> upgrade <folder>`: rewrites only the engine block of `index.html` at that CLI's release; the page's security policy keeps the sources you added.

## What it never does

It never asks for, writes or shows a password, a secret token or payment details; it creates no account and pays nothing; it runs nothing without your "yes" to that step; from your tools it reads only listings (`--json`) and versions, and it checks the sign-in from the text of `firebase login:list`, never from its JSON, which holds your account's tokens; it downloads nothing and contacts no server by itself. When `firebase projects:create` fails (usually a taken id: project ids are unique across Google), its message stays on screen and the command suggests another id.

## For maintainers

The package is `packages/create-historic-city/` (TypeScript under the repository's rules; its ports in `packages/create-historic-city/src/ports.ts`, the real ones in `packages/create-historic-city/src/node-ports.ts`). `npm run build --workspace create-historic-city` bundles it into one ES module with the kit's three files beside it; `npm run build:self-host` builds the admin and the functions for production, then adds the self-host bundle (the admin's production build without the legacy import, the functions' artifact, the rules and a `firebase.json` template; it refuses the admin's e2e build); the `release` stage's `self-host-bundle` gate assembles it before `release-pack`. Its unit tests are Vitest's `create-historic-city` project; behaviour V29 runs the built CLI with fake tools (`e2e/specs/starter-kit/create-city.spec.ts`). Publishing it to npm is the user's step after a release ([research/M5-interfaces.md](research/M5-interfaces.md) §4.6). Facts only a real run proves (how `firebase projects:create` and the Hosting site listing answer for a new account) are listed there under §10.
