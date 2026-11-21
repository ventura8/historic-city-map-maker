# M14: Start your own map, from a browser

The owner (2026-11-07): "do we have a setup page for someone that wants to start a project from scratch, like fostul-bacau? if not let's build it". Before this milestone the answer was no: the Setup Assistant works once an admin is on a Firebase project, and that first deploy (D1, `M6-interfaces.md` §4.3) needs a terminal; `create-historic-city self-host` waited for CR-M5-7; New city adds a city to a project that exists.

This file is the contract. It says what Google's documents allow from a browser, what stays a human step, and what no test here can prove. Every Google fact below was read on 2026-11-07 at the address beside it; a phrase in quotation marks is Google's. Nothing was tried against real Google: tests never touch it, and creating an OAuth client or publishing the page is the owner's step (§10).

## 1. What is really possible from a browser

| Step | API (read at) | Browser? | Notes |
| --- | --- | --- | --- |
| Create a project | `POST cloudresourcemanager.googleapis.com/v3/projects`, a long-running operation ([projects.create](https://docs.cloud.google.com/resource-manager/reference/rest/v3/projects/create)) | Yes | Scopes `cloud-platform` or `cloudplatformprojects`. Usually "a few seconds, but can sometimes take much longer": poll, and survive a reload (§7). The read before it answers 403 for a project the caller cannot see, "regardless of whether or not it exists" ([AIP-193](https://google.aip.dev/193)), so for a new project a 403 says nothing and the create's own answer decides. `displayName` takes only "lowercase and uppercase letters, numbers, hyphen, single-quote, double-quote, space, and exclamation point", 4 to 30 ([Project](https://docs.cloud.google.com/resource-manager/reference/rest/v3/projects#Project)): the form cleans the city's name to ASCII for it (`Sf. Gheorghe` is `Sf Gheorghe`). |
| List projects to pick one | `GET …/v3/projects:search` ([projects.search](https://docs.cloud.google.com/resource-manager/reference/rest/v3/projects/search)) | Yes | Results "may lag" behind recent changes, so a project just made is never looked up this way. |
| Add Firebase | `POST firebase.googleapis.com/v1beta1/projects/<id>:addFirebase` ([addFirebase](https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects/addFirebase)) | Yes, once the account accepted the terms | Scopes `cloud-platform` or `firebase`. Needs `firebase.projects.update`, `resourcemanager.projects.get`, `serviceusage.services.enable`, `serviceusage.services.get`, which Owner holds. "does not modify any billing account information". |
| The terms | None | **No** | "not possible using the Firebase CLI, REST API, or Terraform" ([existing project](https://firebase.google.com/docs/projects/use-firebase-with-existing-cloud-project)). Once per Google account. See §3. |
| A web app | `POST …/v1beta1/projects/<id>/webApps`, an operation ([webApps.create](https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects.webApps/create)) | Yes | What `/__/firebase/init.json` serves. That the file appears within seconds of a new app is UNVERIFIED (§9). |
| The default Hosting site | `GET firebasehosting.googleapis.com/v1beta1/projects/<id>/sites` ([projects.sites](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/projects.sites)) | Yes | Every project has a `DEFAULT_SITE`, made when Hosting is provisioned. Sites "can take several minutes to propagate": the deployer polls, then creates it with `sites.create?siteId=<id>` when the list stays empty (§9). |
| Deploy files | versions.create, populateFiles, upload, versions.patch, releases.create ([Hosting REST](https://firebase.google.com/docs/hosting/api-deploy)) | Yes on paper | Each file gzipped, then the SHA-256 of the gzip; "a maximum of 1000 file hashes in each API request"; 2 GB per file. Upload is `application/octet-stream` to `uploadUrl/<hash>`. That `upload-firebasehosting.googleapis.com` answers a browser's CORS preflight is **UNVERIFIED** and is the largest open risk (§9). |
| Hosting's rules | `ServingConfig`: `rewrites`, `headers`, `redirects`, `cleanUrls`, `trailingSlashBehavior` ([sites.versions](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.versions)) | Yes | `firebase.json`'s block is translated into it (§6). |
| Google sign-in for the new project | `defaultSupportedIdpConfigs.create` ([Identity Platform](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/projects.defaultSupportedIdpConfigs/create)) needs an OAuth client id and secret of that project | **No** | "The IAP OAuth Admin API was shut down on March 19, 2026": no API makes an OAuth client ([programmatic clients](https://docs.cloud.google.com/iap/docs/programmatic-oauth-clients)). The closest honest path is one console click (§4). |
| Billing, the card | Cloud Billing | **No** | "Cloud Billing accounts also require a payment method" ([plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)). Stays on Google's page, as in the Setup Assistant (M2b step b). |
| Functions, Docker, `firebase-tools` | Cloud Build, from the admin | Not from here | The Setup Assistant's Install the server (`M6-interfaces.md` §1) does it, once Provision ran. The start page never needs Blaze. |

**The honest summary.** One button gets a project, a web app and a live admin. It cannot be literally one click: the first time ever, the owner must accept Firebase's terms in the console, and for every new project the owner must switch on Google sign-in in the console. Both are detected and both are one deep link away.

## 2. The consent screens and the OAuth client

- **Flow.** The start page has no server, so it uses Google's flow for "applications that access APIs only while the user is present". `response_type=token` at `accounts.google.com/o/oauth2/v2/auth`, a random `state`, the token on the hash fragment ([implicit flow](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)).
- **Same tab, no script.** That page allows opening the URL "in the current browser window or a dialog". The start page uses the current window: no popup blocker and no opener lost to a cross-origin policy. No Google script loads before the click, so the page sets no cookie and loads nothing from Google until the visitor asks.
- **A documented warning.** The same page warns that this flow is weaker for single-page apps and recommends the authorization code flow with PKCE. Code flow with PKCE for a web client needs a client secret at Google's token endpoint, which a static page cannot hold, so it is rejected here. What limits the damage: the token stays in memory, the fragment is removed from the address at once, it is never stored, it lives an hour, and a strict CSP allows Google's API hosts only. A later version may move to Google Identity Services' token model, which is the same implicit grant in a library ("based upon the OAuth 2.0 implicit grant flow", [token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)).
- **Scopes.** `cloudplatformprojects` (create and list) and `firebase` ("View and administer all your Firebase data and settings", [scopes](https://developers.google.com/identity/protocols/oauth2/scopes)). Together they cover every call in §1, with Hosting and Identity Toolkit both accepting `firebase`. `cloud-platform` is deliberately not asked here: the admin asks for it itself, later, on the owner's own project.
- **Who owns the client.** The maintainer: one OAuth client of type Web in a small project of the maintainer's own, its authorised JavaScript origin and redirect URI being the start page's address. Only its public id is in the page (`start-config.json`). There is no secret. The new project gets its own client when the owner switches on Google sign-in (§4), and from then on the admin never touches the maintainer's client.
- **The unverified-app warning.** Until verified, a request for sensitive scopes "might display an 'unverified app' screen", and the app is "limited to 100 new users" ([unverified apps](https://support.google.com/cloud/answer/7454865)). Whether these two scopes are classed sensitive could not be read from any public page: the classification shows only on the client's Data Access page in the console (UNVERIFIED, §9). The design assumes yes.
- **What verification takes.** A public home page, a privacy policy on the same domain, domain ownership in Search Console, a justification per scope, an unlisted demo video; "can take up to 10 days" ([sensitive scopes](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)). Brand verification alone takes minutes, or 2 to 3 business days by hand ([brand](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)). The maintainer does this; Claude never does it.
- **Until it is verified.** The page says so in words, before the button: Google may warn that it has not checked this app, what to press, and why the warning exists. Without a client id in `start-config.json` the page shows only the explanation and the terminal road; no button pretends to work.

The self-hosted admin's own sign-in is unaffected: it runs in the owner's project on the owner's client, through Firebase Auth's popup (`M2b-interfaces.md` §2).

## 3. Terms and limits on project creation

- **Firebase's terms.** "You only need to accept the Firebase Terms once for your Google Account"; the console is the only place. What `addFirebase` answers for an account that never accepted is not documented. The deployer treats a 403 or `FAILED_PRECONDITION` from it as "accept the terms", shows the deep link to `console.firebase.google.com/`, and retries on the owner's click (S-A76-BAD-TERMS).
- **Google Cloud's own terms.** A first-time Google Cloud account may meet the same from `projects.create`; the message and the action are the same with `console.cloud.google.com/` (UNVERIFIED wording, §9).
- **Project quota.** "The number of projects any user or service account can create is limited"; outside an organisation the account's own quota counts; the console's New Project page shows what remains when fewer than 30 are left ([limits](https://docs.cloud.google.com/resource-manager/docs/limits)). Quota numbers are not published ([why limits](https://support.google.com/cloud/answer/6330231)). Third-party reports speak of about 25 by default, which is not Google's number and is not stated on the page. A quota refusal shows the request-more link and offers an existing project (S-A76-BAD-QUOTA).
- **Rate.** `CreateProject` costs "10 requests per second" of the OAuth client's own write quota (10 per second, 600 per minute, per consumer project, same page). The start page's client is one consumer for every visitor; at this project's scale that is not a limit.
- **Ids.** Project ids are unique across Google. A taken id (409) offers another one (S-A76-BAD-ID-TAKEN). A 400 of the create names the name or the id, not the terms: it goes back to the form, with no Try again of the same plan (S-A76-BAD-PROJECT-REFUSED); only `FAILED_PRECONDITION` still reads as Cloud's terms.

## 4. Google sign-in: the one click no API can do

The admin signs in through Firebase Auth's Google provider, and that provider needs an OAuth client of the new project. No API makes one since March 2026. So:

1. After the deploy the page opens the step **Turn on Google sign-in**, with the link `https://console.firebase.google.com/project/<id>/authentication/providers`, the same page `create-historic-city self-host` step 5 opens.
2. It reads `GET identitytoolkit.googleapis.com/admin/v2/projects/<id>/defaultSupportedIdpConfigs/google.com`, on load and on **Check again**. An existing project that has it on skips the step.
3. Only then does it say the admin is ready. The address and a link to it are on the step from the start, so nobody is stuck on a page that cannot see the console. A read that fails has its own words, not "not on yet" (S-A76-BAD-PROVIDER-UNREADABLE).

## 5. Where the page is hosted

A Hosting site of its own in the maintainer's project: `start-historic-city.web.app` (multi-site Hosting). Three reasons:

- `/start/` on the map's own site would be erased by **Publish the map**, whose release replaces every file (`M6-interfaces.md` §1.4.3).
- Its origin shares no storage with any admin.
- It must carry the release's files anyway (§6).

The tree is relative-pathed, so any static host works. Nothing about it is deployed by this milestone: it is the owner's ask-first step (§10). `npm run build:start` makes it in `dist/start/`, after the admin's build (which builds the page, `dist/start-app/`) and `build:hosting`; the `build` stage's gate `start-build` runs it.

## 6. The release files: source and integrity

**Source: the start site itself, same origin.**

- GitHub Releases cannot serve a browser: third-party reports agree that the asset hosts send no `Access-Control-Allow-Origin` ([one report](https://github.com/OpenIPC/defib/pull/115)), and GitHub states nothing official.
- jsDelivr's own README puts a GitHub package over 50 MB, or a file over 20 MB, out of reach by default ([README](https://github.com/ashitakaze/jsdelivr), a mirror), and the bundle's `server.tgz` and `hosting.tgz` come close.
- A same-origin folder has neither problem.

```text
dist/start/
  index.html, start.mjs                           the page (row `dist/start-app/start.mjs` of the bundle budget)
  start-config.json                               {oauthClientId} or {} (written at build: HCM_START_OAUTH_CLIENT_ID)
  release/<slug>/start-release.json               startReleaseSchema
  release/<slug>/tree/…                           every file of the tree, as the manifest lists it
```

**`start-release.json`** (`packages/shared/src/schemas/start-release.ts`): `format`, `release`, `slug`, `hosting` (the `ServingConfig`, tokenised), `files` `[{path, bytes, sha256, template?}]`.

**The browser, per file:**

1. Fetches the file.
2. Refuses it unless its SHA-256 is the manifest's (`crypto.subtle`).
3. Replaces `__HCM_PROJECT_ID__` if it is a template.
4. Gzips it (`CompressionStream`).
5. Takes the gzip's SHA-256, which is what Hosting wants.

Generated at deploy, never fetched: `admin/project.json` (§8), and `release.json`.

**Trust.** The manifest and the page come from one origin, so they have the trust of one release, exactly as `M6-interfaces.md` §1.3 says of the install bundle. This protects against a stale or partial file and a mixed cache, not against a compromised start site. A compromised start site would own the page holding the token, whatever the files' origin; that is why the page asks no `cloud-platform`, and why §5 keeps it apart.

**The generic bundle.** The M6 install bundle names one project. For a project nobody knew at build time:

- `manifest.projectId` is `GENERIC_INSTALL_PROJECT` and the admin accepts it (`packages/admin/src/install/bundle.ts`);
- `server.tgz` carries no `.firebaserc` (every build passes `--project $PROJECT_ID`) and `functions/dist/.env` holds the release and `HCM_APP_CHECK` only: "`.env` and project-specific `.env` files" reach all functions ([env](https://firebase.google.com/docs/functions/config-env));
- with no `HCM_VIEWER_ORIGINS` and no `HCM_OAUTH_CLIENT_IDS` the server already falls back to the project's Hosting origins and to the provider's client (`functions/src/deps.ts`, `functions/src/admin/claim.ts`);
- the site's `fetch` step adopts the project: it replaces the token in `firebase.json` and in every file `hosting.tgz`'s `templates.json` lists, which are the tree's own marks and include the city page's policy, and takes `project.json` from the live site (`HCM_ADOPT_PROJECT`, set for a generic bundle only).

**Self-hosting takes the same tree.** `create-historic-city`'s bundle has this release tree as `hosting/`, and `bundle.json` lists its templates, which `self-host` fills in for the project. Without it a self-hosted project had no `admin/install/<slug>/` and no `city/`, so Setup's Install and Publish the map could not start and the map's address served no map. The bundle builds after `build:start`: the `release` stage runs `hosting-build` and `start-build` before `self-host-bundle`.

The start tree holds no Bucharest: no legacy bundle, no site data, no root viewer. Its root is the bilingual "being set up" page until a city exists, its `/<city>/` the generic city page from the first deploy, and after **Publish the map** its root goes to the first city.

## 7. Failure and resume

- **The plan** (`{projectId, displayName, city}`) is kept in `sessionStorage` before any redirect, so a consent round trip or a reload loses nothing. The token never joins it.
- **Every step detects before it acts:** project readable (a 403 on a new project only means not yet this account's), Firebase on, a web app listed, a site listed, the live channel's release (`sites.channels.get`). Each version the page makes carries the label `hcm-start-release: <slug>`. So **Try again** is the same action as the first click, from anywhere, and nothing is made twice.
- **What is live stays.** This very release is not released again; on a project the owner asked to make, nothing live is replaced, since it can only be their earlier run, published since or not. A project picked from the list was warned about (`start.plan.pickWarning`) and is replaced on the first run.
- **After the release** the tab's plan is marked `released`: a reload opens the provider step, and a new consent only reads the provider (S-A76-BAD-RELEASE-AGAIN). Publish the map's site replacing the start-up tree must never be undone from a tab left open.
- **An expired token** stops the run with "Continue", which is one consent and resumes.
- **Files:** an upload of a hash Hosting already holds is skipped by `uploadRequiredHashes`; a version left unfinalised by a crash is abandoned (Hosting keeps it, unreleased, and it does not count against anything visible).
- **Moving away mid-upload** leaves the old release live. Only `releases.create` changes the site.
- **Each failure** names its reason in the catalogue and its action: terms link, quota link, taken id, permission (not an owner of the picked project), a file that fails its digest ("reload the page"), Google unavailable (the transport's retries, then Try again).

## 8. `project.json` and the first city

`project.json` gains optional `firstCity: {id, name: {ro, en?}, bbox?}` and `github` becomes optional (CR-M5-7).

**Why the city is not created by the start page:** a city needs the server (`cities.create`), which needs Blaze, which needs the owner's card on Google's page. So the start page keeps the name and the rectangle, and the admin's **New city** opens with them filled in, a map to draw on and one click. "Using the New city flow" is literal: nothing is duplicated, and a rectangle is optional at this stage because New city can find it by name.

**Rectangle on the start page:** four fields with `cityBoundsProblem`'s words; no map there, because no Mapbox token exists before Setup.

## 9. What cannot be verified without real Google

Every fake in `packages/test-support/src/fakes/google-hosting.ts` follows the documents above. What only a real run proves:

1. **CORS** of `firebasehosting.googleapis.com` and `upload-firebasehosting.googleapis.com` for a browser origin, on POST with `Authorization`. Documented nowhere. **If the upload host refuses preflight, the browser cannot deploy, and the closest honest path is the page saying so and offering `create-historic-city self-host` with the project already created.** The deployer reports this as its own failure kind (`network` on upload) with that command.
2. Whether `cloudplatformprojects` and `firebase` are enough at runtime for each call, and how Google classes them.
3. `addFirebase`'s exact answer before the terms; `projects.create`'s before Cloud's terms.
4. How long `init.json`, the default site and `web.app` take to appear on a new project.
5. That `.env` in `functions/dist` reaches every function through the generic `firebase deploy` of Cloud Build.
6. The unverified-app screen's real text and the 100-user count.
7. That `projects.get` answers 403 and not 404 for a free id (the deployer takes either as absent), and that a version's `labels` come back on the live channel's `release.version`. If they did not, a picked project would be released over again on a second run with the plan gone; a new project is protected either way. That a new default site has no release of Firebase's own: if it had, a new project's first run would keep that release.
8. That Resource Manager takes non-ASCII letters in `displayName` is not stated; only ASCII is sent, so the console shows `Bacau` for `Bacău`.

## 10. What waits for the owner (ask first)

1. Create the OAuth client, set `HCM_START_OAUTH_CLIENT_ID`, and decide whether to submit verification (home page and privacy policy are on the start site).
2. Create the Hosting site `start-historic-city` and deploy `dist/start/`.
3. The first real run from a clean Google account; item by item, §9.

Done 2026-11-09 (the owner's approval): the Web client `Start your map (start-historic-city)` in `bucurestiul-disparut` (origin and redirect `https://start-historic-city.web.app`, with and without the slash; its public id is in the deployed `start-config.json`, the secret is never used), the Hosting site `start-historic-city` created, and `dist/start/` of `1.0.0+25aee1e` deployed there; the README links it. The consent screen is External and in production without verification: Google shows its unverified-app screen and caps sensitive-scope sign-ins at 100 users until verification. Still open: verification, and item 3.

**Own project for the start page's sign-in (2026-11-12, the owner).** The Web client moved to a Google Cloud project of its own, `start-historic-city` (number 499020596181): the client `Start your map`, id `499020596181-urom5vlitv2slhaj1cqliae5ddg3n0g6.apps.googleusercontent.com` (public; the secret is never opened or used), origin `https://start-historic-city.web.app` and redirect URIs `https://start-historic-city.web.app` with and without the slash. Its consent screen and verification ask only the start page's two scopes, never the example city's admin scopes. The Hosting site `start-historic-city` stays in `bucurestiul-disparut`; only the client changed. Every build of `dist/start/` for the live site sets `HCM_START_OAUTH_CLIENT_ID` to that id (and `HCM_START_SITE_VERIFICATION`, below); the older client in `bucurestiul-disparut` is no longer served. DECISIONS §163.

**Verification prep (2026-11-09).** What Google asks of the home page, on the start site's own domain, is in the build (`scripts/site/src/start/legal.ts`, the words in `legal-text.ts`, written against `packages/admin/src/start/`: change one with the other):

- `index.html` keeps the page's name and purpose at the top (its title, lede and *What you get*, before the button) and adds a plain-HTML footer below the element, readable without JavaScript: *Historic City Map Maker* and its purpose in both languages, links to `privacy.html`, `terms.html` and the source.
- `privacy.html`: the two scopes and why (list and create the project; Firebase, the web app, the Hosting site, the Google provider's read, the files and the release), no profile or e-mail asked, the token in the tab's memory only and sent to Google's four API hosts only, `sessionStorage` holding the plan and the consent's `state`, no cookies and no analytics on the start page (it loads no Firebase SDK and no Google script before the click), everything created in the owner's own project, compliance with the Google API Services User Data Policy including Limited Use, revoking at `https://myaccount.google.com/permissions`, contact through the repository's GitHub issues.
- `terms.html`: free and open source, as is with no warranty, the owner responsible for their Google Cloud, Firebase and Mapbox accounts and bills (Blaze included), their own content, third-party terms.
- Both pages hold Romanian then English, with `start-site.css` (system colours) and a policy that allows no script.
- Domain ownership: Search Console's HTML-file method. `HCM_START_SITE_VERIFICATION=<name>` (`^google[0-9a-f]{8,32}\.html$`) makes `build:start` write `<name>` holding `google-site-verification: <name>` at the root; unset or empty writes none, any other value exits 1 before anything is built. The domain is verified with `google81a1ffad6e76455f.html`, placed by hand on the live site: **every deploy of `dist/start/` must set `HCM_START_SITE_VERIFICATION=google81a1ffad6e76455f.html`**, because a release without the file un-verifies the domain.

Left to the owner (ask first): deploy the rebuilt `dist/start/` with that variable, then, on the consent screen's Branding page, set the home page `https://start-historic-city.web.app/`, the privacy policy `…/privacy.html` and the terms `…/terms.html`, write the justification of each scope, record the demo video, and submit.

## 11. Scenarios and tests

Behaviour `A76` (`e2e/scenarios.json`), `e2e/admin/specs/start/`, on the fakes and emulators. `V29`'s rows follow CR-M5-7. Tour states `start.*` in `e2e/admin/specs/start/states.ts`; the verification prep's `S-A76-HAPPY-LEGAL` and `S-A76-BAD-VERIFICATION` in `e2e/admin/specs/start/legal.spec.ts` (states `start.privacy`, `start.terms`).

`S-A76-HAPPY-LIVE` is the owner's question end to end: a seeded Fostul Bacău from nothing. The project id is the emulators' own (`demo-hcm`), because the Functions emulator serves one project; the display name, the city and its id are Fostul Bacău's. The fake Hosting keeps what the page uploaded, the spec unpacks the live release, and the admin server serves those very bytes: the released admin runs Setup without GitHub, the fake Cloud Build plays the install from the released generic bundle, New city opens filled in, and the map boots at `/fostul-bacau/` through the released generic city page; then the real `fetch` step runs over the real generic bundle, as Publish the map's site build does, and what it leaves is served: only the admin's script holds the token, as the text it looks for; the root goes to the first city (S-A76-HAPPY-ROOT) and the map boots again.

What the e2e does not run: Cloud Build's other step scripts (as in M6, tested apart; `fetch` also in `packages/admin/test/install/fetch-script.test.ts`), the site build's `firebase deploy`, real Google anywhere, Mapbox's token step (a project without Mapbox is refused best effort, as in A54; the spec gives the city the token Setup's card would).
