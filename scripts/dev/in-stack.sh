#!/usr/bin/env bash
# Inside the quality image (started by scripts/dev/dev-stack.sh): makes node_modules current the way the pipeline does
# (`npm ci` from the image's npm cache when package-lock.json changed since node_modules/.hcm-install-stamp, the stamp
# scripts/ci/pipeline.py also reads), builds the e2e sites and the admin's e2e bundle when an input changed
# (scripts/ci/e2e_build.py), then becomes the local stack (e2e/stack/main.ts, what `npm run stack:serve` runs; exec'd
# without npm, whose shell would not pass the stop signal on to it, so the emulators get theirs and shut down cleanly).
set -euo pipefail

main() {
	if [[ "${HCM_TEST_IMAGE:-}" != "1" ]]; then
		echo "[ERROR] in-stack.sh runs only inside the quality image; use: bash scripts/dev/dev-stack.sh" >&2
		return 2
	fi
	mkdir -p "${HOME:-/tmp/hcm-home}"
	cd "$(dirname "${BASH_SOURCE[0]}")/../.."
	local lock stamp=node_modules/.hcm-install-stamp
	lock="$(sha256sum package-lock.json | cut -d ' ' -f 1)"
	if [[ ! -f "$stamp" || "$(cat "$stamp")" != "$lock" ]]; then
		npm ci --prefer-offline --no-audit --no-fund
		echo "$lock" >"$stamp"
	fi
	python3 scripts/ci/e2e_build.py
	exec node --import ./scripts/site/register-ts.mjs e2e/stack/main.ts serve
}

main "$@"
