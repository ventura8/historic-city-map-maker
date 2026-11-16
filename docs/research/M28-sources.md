# M28: the map's sources and the app's platform in Setup

The owner's request of 2026-11-13 (beta.1, priority 3): a Setup step, **Sources**, where the city owner chooses which imagery and data sources the map uses, with each source's pros, cons and costs in plain words; then four corrections the same day: the app's platform (Mapbox, Firebase, Firestore and every other required service) is not a source and gets one card of its own before Sources; collections such as Facebook groups, Fortepan or Europeana are drawn from by hand, honestly; uploaders may use the photo and data sources, never the satellite ones; and the Second World War air photos of the US National Archives are a card of their own. Decisions: `DECISIONS-for-review.md` §225 (and the budget line of §215).

## 1. Two new cards

| Step | Letter | Card | Input | Done when |
| --- | --- | --- | --- | --- |
| `platform` | e1 | The app's platform: five sections | none | billing, Prepare the project, Install the server and Mapbox are done (`withPlatform` in `state.ts`, read from them) |
| `sources` | e2 | The map's sources: switches, accounts, the month's estimate | 1 (Save my choice) | the city holds a choice (`cities/{city}.sources`) |

Both come after Mapbox, before USGS (`packages/admin/src/setup/steps.ts`). The platform card is `optional` in the step table only so that it never opens on its own while its steps are still to do; it needs no server. Sources needs the city (normal mode). Neither is in `setupDone`: a map from before M28 stays done, and the Sources card says what is still to choose. The happy path's budget grows by one input (12 inputs, 4 consents).

The old step ids, deep links (`#/setup/billing`, `#/setup/mapbox` …) and funnel steps are unchanged: the platform card restructures what Setup shows, not what the steps do; each section links its own step.

## 2. The sources (`packages/shared/src/schemas/sources.ts`, `sources-catalogue.ts`)

Switches, stored as `cities/{city}.sources` (each an optional boolean; absent: its default):

| Source | Default | Account | Cost (the product's figures) | Licence |
| --- | --- | --- | --- | --- |
| `usgs`: declassified Corona KH-4/4A/4B (7.5/2.75/1.8 m), Argon KH-5 (140 m), Gambit KH-7 (1.2 m), Hexagon KH-9 (6–9 m mapping, 1 m panoramic), 1960–1984 | on | USGS (ERS, M2M access, application token) | free for scanned frames | public domain |
| `usgsOrders`: on-demand scans | off (paid) | USGS | USD 30 a frame + USD 5 an order (`USGS_SCAN_PRICE_USD`, 2024 list), one-off | public domain |
| `landsat`: L4/5 TM 30 m 1982–2013, L7 15 m, L8/9 15 m from 2013 | on | USGS (the same token) | free | public domain, NASA/USGS credit |
| `sentinel2`: 10 m, last three years, the alignment reference | always on | none | free | Copernicus credit |
| `archives`: the owner's scanned maps (M20) | on | none | free (the owner's computer) | per map; rights gate publishing |
| `contributors`: photos sent through Contribute (M13) | on | none | free | per photo; `unknown` refused at review |
| `openData`: OSM (ODbL), OpenHistoricalMap (CC0), Wikidata (CC0), Nominatim (1/s, 300 a day) | on | none | free | as listed |
| `localAi`: the matcher on the owner's computer (M10) | on | none | free | open-source models |
| `cloudAi`: Vertex AI translation drafts | off (paid) | Google (billing) | under USD 0.05 a month expected, capped at USD 0.5 (`AI_MONTHLY_CAP`) | the owner's texts |

Paid scans need the declassified frames (`sourcesOf` reads them off without). The USGS account is needed when the declassified frames **or** Landsat are on (`needsUsgsAccount`): Landsat comes through the same M2M API and token.

### Collections drawn from by hand (no switch)

Nothing here runs on its own, so there is nothing to turn on. Each card says whether its material may go on the public map, how it comes in today (Photos, Imagery → Upload, or Contribute, with author, licence and source address; a helper's item waits in Review), and whether an automatic import is `planned` (not built) or not possible:

| Collection | Public map | Today | Automatic |
| --- | --- | --- | --- |
| Facebook old-photo groups: ask the author, record the permission | only with the author's permission | Photos / Contribute | none: Meta's terms forbid automated collection, and the Groups API was removed on 2024-04-22 (Graph API v19) |
| US National Archives, RG 373 (Luftwaffe GX prints 1939–1945, Allied sorties 1943–1944; scans via NCAP) | per item (the catalogue's use note) | Imagery → Upload | none |
| Wikimedia Commons | per file | Photos / Upload | planned |
| Europeana | per item (rights statement) | Photos / Upload | planned |
| Fortepan | yes, CC BY-SA 3.0, "FORTEPAN / donor" | Photos | planned |
| Romanian National Library, National Archives, the city museum | only with written permission | Photos / Upload | none |
| David Rumsey Map Collection | per item, mostly CC BY-NC-SA 3.0 | Imagery → Upload | planned |
| Library of Congress | per item | Photos / Upload | planned |
| OldMapsOnline | a finder: the holder's licence | — | none |
| Mapillary | yes, CC BY-SA 4.0 (recent, a then-and-now comparison) | Photos | planned |
| Arcanum Maps | only with a written licence | Imagery → Upload | none |

**Not usable, and why** (listed on the card): collecting Facebook posts automatically; copying another historical map site (fostulbucuresti: no licence, reference only); Google Earth or Street View images (terms); Mapbox Satellite to align (terms); web images with no known author or licence.

## 3. Storage and rules

`cities/{city}.sources` (`citySourcesSchema`, in `cityDocSchema`; `CLIENT_WRITES.city`). Like the imagery settings, it is saved on its own: an update that changes only `sources` and the stamp is checked by `validSources` (a map of the eight known keys, each a boolean); `sources` beside any other city field in one write is refused (`firebase/rules-tests/test/cities.test.ts`). The admin writes it with the Firestore SDK (`setupSourcesPort` in `packages/admin/src/app/setup-wiring.ts`); a stored value the schema refuses reads as no choice, so the step asks again.

## 4. The flow (`packages/admin/src/setup/sources.ts`)

- `detect` reads the city's choice in normal mode (start, the switch to normal mode, Check again): a choice makes the step `ok`; none leaves it `missing` with the defaults on the switches; a failed read says so in plain words (`adminSetup.sources.readFailed`) and logs the code.
- `choose(id, on)` turns one switch (one input); `save` writes the switches (one input). A refused write keeps the switches and says to press Save again or open Admins (`adminSetup.sources.saveFailed`).
- A choice without the USGS frames and without Landsat leaves the USGS step out of `order` (and out of the count; `settledSteps` counts it settled), and records USGS as postponed with `setup.recordCloud` (as Do it later does) so that `setupDone`, which reads `setup/status`, holds for Home and the shell too. Turning either on again brings the step back, as Later.

## 5. The cards (`packages/ui/src/admin/setup/hcm-setup-sources.ts`, `hcm-setup-platform.ts`, `sources-parts.ts`)

- **Sources**: the month on top — the platform's fixed line ("always on", about USD 0.5–2 from Setup's Blaze line, the budget alarm's amount, a link to the platform card), the chosen sources' range, the total, a paid scan's one-off price, and "estimates from the figures the app uses, checked on 2026-11-13" (`SOURCES_CHECKED_ON`); then the three groups of switches, each card with its account chip and next action, its details folded (what it gives, example, pros, cons, costs, what to do step by step, licence, recommended for, the provider's pages); then the collections by hand and what is not usable.
- **Account states** come from the steps that hold the accounts, checked automatically as before: USGS `ok` is Signed in; a saved key waiting for USGS's approval (polled every 6 h) is Waiting for approval, "usually 24 to 48 working hours … goes on by itself"; otherwise Account needed with **Create the free USGS account** (ERS's register page) and **Open the USGS step**, where the existing secure paste box takes the token. The cloud AI's account is the billing step. The app never creates an account, types a password or pays.
- **Loading**: the two cards and their catalogue are a chunk of their own (`sources-cards`, `packages/ui/src/admin/setup/sources-cards.ts`), fetched as the setup page is defined.
- **Platform**: five sections — Google Cloud (billing account, Blaze, the budget alarm), Firebase (Auth's Google sign-in, Cloud Functions, Hosting's two sites, App Check), Firestore (the database, its rules and indexes), storage and processing (Cloud Storage's public bucket, Cloud Run and Cloud Build, Artifact Registry, Secret Manager, the Tasks queue and Scheduler), Mapbox (the base map). Each: what it does, costs and free allowance (the figures Setup's cards already use; the providers' pricing pages linked), limits, how to sign up, Ready or To do in its step, **Sign up or sign in** (the provider's page) while to do, and **Open the step**.
- Material 3 Expressive: surface-container cards, tonal chips with an icon and words (never colour alone), 48 px targets, folded details, one column that wraps on a phone.

### Why each platform service is required

| Service | Why the app cannot run without it |
| --- | --- |
| Google Cloud billing (Blaze) and the budget alarm | Firebase runs Cloud Functions only on Blaze; the alarm pauses the imagery work at the budget |
| Firebase Auth | every admin signs in with Google; the rules read the signed-in account |
| Cloud Functions | the server: every callable, the triggers, the publishing |
| Firebase Hosting (two sites) | the public map and the admin are served from it |
| App Check | the callables refuse calls without it |
| Firestore | the admin's data and its role rules |
| Cloud Storage | the published manifest, the photos and the own tiles the public map reads |
| Cloud Run and Cloud Build | the imagery jobs and the in-app installer |
| Artifact Registry | holds the imagery pipeline's image |
| Secret Manager | the Mapbox and USGS keys |
| Cloud Tasks and Cloud Scheduler | the publishing queue and the periodic checks (`ops.tick`) |
| Mapbox | the base map under the historical layers |

Analytics and crash reports stay optional (step g).

## 6. What follows the choice

- Setup: the USGS step leaves the list when no source needs its account (§4).
- Imagery → Find: with the USGS frames and Landsat both off, a plain line says why and links Setup → Sources; Landsat alone keeps Find. Imagery → Upload: with "Your scanned maps" off, the local import's panel gives way to the same line (`hcm-imagery-page.ts`).
- `imagery.tick`'s Landsat part imports nothing for a city that left Landsat out (`functions/src/imagery/landsat-auto.ts`).
- Settings: the list ends with **The map's sources**, which opens Setup's Sources step (Setup stays open after it is done).
- Not yet gated (follow-ups): the harvest's dataset list on the server (the client hides Find), the AI drafts callable when the cloud AI is off, and the local AI's matcher when it is off.

## 7. Uploaders

The owner's rule: uploaders (M13) may use every photo, map and data source the owner turned on — the collections by hand, Facebook's "ask the author", the open data — through Contribute, and everything they bring waits in Review; the online satellite sources (USGS, Landsat, Sentinel-2 searching and importing) stay with the owner and the editors because they cost money or the owner's quota. Enforced today: `imagery.search` and the imports are `cityEditor` in the registry, the `usgsScenes` rules ask for a city member, and the Imagery route is not offered to an uploader (`LIMITED_ROUTES`); the Contribute page tells an uploader why ("Satellite search is for the map's owner, because it uses paid quota …"). An uploader uploading a map or satellite image of their own (a held raster for review) is **planned**: today raster upload is the editors' and the owner's.

## 8. Analytics

The Setup funnel gains the steps `platform` and `sources` (`setupFunnel` follows `order`). On Save my choice each switch reports `step_action` with `source.<id>.<reason>`, the reason one of `on_default`, `off_default`, `turned_on`, `turned_off` (codes only). The old step ids keep their funnel steps.

## 9. Tests and scenarios

Unit: `packages/shared/test/schemas/sources.test.ts` (defaults, schema, every text a card builds exists in both languages, the estimate), `packages/admin/test/setup/sources.test.ts`, `packages/admin/test/app/setup-wiring.test.ts`, `packages/ui/test/admin/setup/hcm-setup-sources.test.ts`, `packages/ui/test/admin/imagery/sources-off.test.ts`, the settings and contribute page tests; rules: `cities.test.ts`; functions: `landsat.test.ts`; e2e: the journey's step 5b with the tour states `setup-platform` and `setup-sources`. Rows: A180, A181, A182 in `e2e/scenarios.json`; A183 and A184 for §10–§11 (`packages/shared/test/schemas/country-sources.test.ts`, `packages/ui/test/admin/setup/sources-finder.test.ts`, `functions/test/ops/country-sources.test.ts`, the rules matrix's `countrySources/{country}` row; the journey's step 5b seeds Romania's list as the tick writes it).

## 10. Where the country keeps its old maps and images (the owner, 2026-11-14)

The Sources card lists, for the city's country, where historical maps, air photos and satellite images can be had, online or in person: national archives, cadastre and mapping agencies, the military mapping agency, libraries, museums, portals and commercial imagery, each with free or paid and the published figures, the years, the materials, what to ask for, and its website.

- **Data model** (`packages/shared/src/schemas/country-sources.ts`): `countrySources/{country}` (ISO 3166-1 alpha-2) holds the institutions' `language`, the `cities` placed in the country, the `places` (`countryPlaceSchema`: kind, access, cost and cost note, years, materials, holdings, https website, `verified`, an `online` part and an `offline` part, `reachable`), `origin` (`curated` or `researched`), `factsCheckedOn`, `refreshedAt` and the stamp. Rules: staff read it, nobody writes it from a client.
- **Curated lists** (`country-seeds.ts`, `country-seed-ro-archives.ts`): Romania first, ten places read on the institutions' own pages and ANCPI's fee order (Ordinul 16/2019) on 2026-11-14: the National Archives' central reading room and its Bucharest service, ANCPI, the Defence Geospatial Information Agency (ex-Military Topographic Directorate), the National Library, the Romanian Academy Library's map and print cabinets, the Bucharest Municipal Museum's Maps and Plans collection, Copernicus Data Space, SkyWatch, Arcanum Maps. What a page did not state (an opening time, a fee) is said to be unpublished, never guessed; GPS points are not stored (Google Maps finds the address).
- **The refresh job** (`functions/src/ops/country-sources.ts`, `ops.tick`'s `sources` step): one city a tick is placed in its country with one Nominatim reverse lookup of its centre (`countryCode`, Nominatim's one request a second); then at most one list a tick that is missing or older than `COUNTRY_SOURCES_REFRESH_DAYS` (30) is built again: the curated list when the country has one, else Wikidata's national archives (Q2122214), national library (Q22806) and national mapping agency (Q6979629) of the country with an https website (`verified: false`, origin `researched`, at most 20); every website is checked to answer through `remote` (https only, no credential, no redirect followed, 64 KB). A second city in a country with a fresh list only joins its `cities`.
- **The admin** (`packages/admin/src/app/country-wiring.ts`) reads the lists and keeps the one naming the city, with the city's name in the institutions' language; before the tick has placed the city the finder says the list comes within the hour; an unreadable list says to press Check again, then to open Admins.
- **Online places** get a guided setup like USGS's: the account (the provider's sign-up page, or "no account needed"), the key (none needed, or "the provider's keys serve only its own tools; the app asks you for none"), what to do on the site, the site's state from the last automatic check, and where the download comes into the app (`#/imagery/upload`, which opens Imagery's Upload tab, or `#/photos`). **Not built:** a secure key box for an online source: none of the verified Romanian sources has a key the app could use; the model's `key` field is ready for one.
- **Places to visit** get a guide: the address with **Open the way there in Google Maps** (Maps URLs, `api=1`, the address as the destination), the hours, a call button, how to get in and what to bring, the request ready to send (a filled-in email to the institution in its own language, `{city}` replaced by the city's name; without a published address, **Print the letter**), what the letter says in the owner's language, the fees, and after the visit: scan or photograph each sheet and open the import from the computer. No step asks the owner to copy anything or type a command.

## 11. Free translation (the owner, 2026-11-14)

A group of six cards (`packages/shared/src/schemas/translation-sources.ts`, `TRANSLATION_CHECKED_ON` 2026-11-14), each with its quality, its free limit and what happens past it, whether sign-up asks for a card, what the provider does with the texts, and a sign-up wizard whose steps each open the provider's page (or the app's place):

| Option | Free limit | Past it | Card | The texts |
| --- | --- | --- | --- | --- |
| Local models (Ollama, TranslateGemma), with the mandatory check | none | — | no | never leave the computers; every text is translated back and compared before use |
| DeepL API Free | 500,000 characters a month (DeepL's figure; its usage endpoint gives the account's own) | stops (HTTP 456) | not stated | its terms let DeepL keep them |
| Google Cloud Translation | 500,000 characters a month (a USD 10 monthly credit) | billed, USD 20 a million | yes (billing) | not used to train |
| Azure AI Translator F0 | 2,000,000 characters a month | stops | yes | not stored |
| LibreTranslate, self-hosted | none | — | no | stay on the computer; the hosted service has no free plan |
| MyMemory | 5,000 characters a day anonymous, 50,000 with an email | not stated | no | not stated |

**Not built (planned):** the app translating through these services. Today the drafts come from Vertex AI when the cloud AI is on; the local models with their check, the key boxes for DeepL, Azure and MyMemory, and LibreTranslate on the household's computers are follow-ups, and each card says so.

## 12. Monthly costs on Home (the owner, 2026-11-16)

Home ends with **Monthly costs** (`packages/admin/src/home/costs.ts`, `packages/ui/src/admin/home/costs.ts`; behaviour A192): one row per paid service, with this month's spend so far, the forecast for the whole month (the spend divided by the share of the month gone, at least one day), whether the number is **measured by the map** or an **estimate** and why, the share of the free tier used, and the service's console in a new tab; then the total, the forecast and the budget.

- Measured: Mapbox's compute units past the free units (`usage/mapbox-<month>`, the publish guard's counter, `USD_PER_COMPUTE_UNIT`); Cloud Run's vCPU and GiB seconds past `CLOUD_RUN_FREE_TIER` at the Tier 1 job prices (`usage/cloudrun-<month>`, M7); the AI drafts' dollars (`usage/ai-<month>`); the budget alert's cost so far and budget (`ops/guard.spend`).
- Estimated, with the reason on the card: Firebase (Hosting, Functions, Firestore, Storage) from `PLATFORM_MONTHLY_USD`, since Google does not tell the map; visitors' Mapbox map loads (not counted by the map, the first 50,000 a month are free); a USGS scan, paid per purchase (`ONE_SCAN_USD` at most as the month's forecast).
- A counter that cannot be read is shown as an estimate with that reason; with no budget alert yet the budget is Setup's default (`setup/budget.ts`). Past the budget, a status says that processing and publishing pause and the public map stays, with Open Jobs and Google Cloud billing.
