---
description: Deploy the public map and the admin (one Firebase Hosting site since M6), rules and functions (Firebase via Workload Identity Federation, or the admin's in-app installer), the pipeline image, the optional GitHub Pages site and engine releases -- every step ask-first and only after a green local all
---

# Deploy Workflow

Nothing in this workflow runs without the user's explicit yes **for that action**. Every deploy follows a green local `bash scripts/ci/run-all-checks.sh` (`[SUCCESS] stage 'all' passed`) and a green CI on `master`. Status today: the deploy jobs exist in `.github/workflows/ci.yml` (`deploy-pages`, `deploy-firebase`, `deploy-pipeline-image`) but stay off until the repository variable `DEPLOY_ENABLED` is `true` (set in M2, ask first), and the old site on `master` stays live until the user approves the overwrite. `release.yml` publishes tags.

## Targets

| Target | What | How | Trigger |
| --- | --- | --- | --- |
| Public map and admin (M6) | `dist/hosting` on Firebase Hosting (`<proj>.web.app`: the viewer of the first city at `/`, every other city at `/<city>/` or through the generic city page, the admin at `/admin/`; `npm run build:hosting`, `firebase.json` → `hosting`: the admin's CSP header on `/admin/**` only, each viewer page its own meta policy; docs/research/M6-interfaces.md §2) | the admin's **Publish the map** (a Cloud Build build as `hcm-installer@`, the installer's workstream), or `firebase deploy --only hosting` in the `deploy-firebase` job of `ci.yml` through WIF (optional), or D1 from the terminal (the start-up variant, `HCM_ADMIN_START_UP=1`) | the owner's click; green CI on `master`; D1 once |
| GitHub Pages: the project's landing page (DECISIONS-for-review.md §162) | `sites/landing/` as committed (`npm run build:landing`, held by the static `landing` gate) | `.github/workflows/pages.yml` (`actions/deploy-pages`; the repository's Pages source must be GitHub Actions, the owner's setting) | push to `master` touching `sites/landing/**`, or a manual dispatch |
| Rules and indexes | Firestore and Storage rules, Firestore indexes | `firebase deploy --only firestore,storage` through WIF | green CI on `master` |
| Functions | `functions/dist/` (the same artifact the e2e emulator ran, with the locked tree of `functions/deploy-lock/` and `.env.<project>` from `functions/deploy-env.json`) | `firebase deploy --only functions` through WIF (the job installs before it authenticates) | green CI on `master` |
| Raster pipeline | the `pipeline/Dockerfile` `runtime` image | the `deploy-pipeline-image` job pushes it to Artifact Registry; `gcloud run jobs update` joins with M3 | green CI on `master` |
| Engine release | GitHub Release for `vX.Y.Z`; jsDelivr serves the tag's `cdn/engine/` (`@vX.Y.Z` pinned with SRI, `@1` floating) | `release.yml` on the tag (read-only checks and rebuild, then the Release from the uploaded files) | a tag, after `all` (`.agent/skills/quality/prepare_release_skill.md`) |

After a deploy: `setup.selfTest` all green (IAM, secrets, Cloud Run, MTS); `https://<proj>.web.app/` loads the public map with exactly one map load, photos render, the layer toggles work, `/release.json` names the release and `public`; `https://<proj>.web.app/admin/` opens the admin and an old `/#/setup` address forwards there; the admin sign-in creates the owner claim.

## Identity and secrets

- CI authenticates to Google Cloud **keylessly** through Workload Identity Federation as `gh-deployer@`, restricted to `ventura8/historic-city-map-maker` on `refs/heads/master`. No service-account key exists anywhere.
- `SONAR_TOKEN` is the only repository secret. Mapbox and USGS secrets live only in Secret Manager, written by the Setup Assistant.
- The Firebase web config is not committed: the admin reads `/__/firebase/init.json` on Hosting.

## Manual (first time only, each with an explicit yes)

- The first deploy of a new map (D1, the one deploy outside the app): `HCM_ADMIN_START_UP=1 npm run build:hosting` in the image (the start-up variant: the admin at `/admin/`, a "being set up" page at `/`), then `firebase deploy --only hosting --project <project>` from the user's machine after the user ran `firebase login` themselves (`docs/MANUAL_TEST_PLAN.md` → D1). For a project whose server and manifest already exist, the public variant directly (without `HCM_ADMIN_START_UP`).
- Bootstrap of the owner admin claim (no email in the repository): a local script run with the user's own gcloud credentials.
- Org-policy fixes, IAM changes and API enablement are settings changes: ask first, one at a time.

## Never

- Deploy, push or tag without the user's yes; push before `all` is green; deploy from a dirty tree.
- Use `pull_request_target`, an unpinned action or a `:latest` image in a workflow.
- Run the raster pipeline in GitHub Actions (public logs would leak signed USGS URLs); it runs as a Cloud Run Job.
