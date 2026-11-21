#!/usr/bin/env bash
# Entry point inside the quality image (started by scripts/ci/run-all-checks.sh). Refuses to run
# anywhere else, because the gates depend on the image's pinned toolchain, then hands over to
# scripts/ci/pipeline.py, which owns the stage and gate registry.
set -euo pipefail

main() {
	if [[ "${HCM_TEST_IMAGE:-}" != "1" ]]; then
		echo "[ERROR] in-container.sh runs only inside the quality image; use: PIPELINE_STAGE=<stage> bash scripts/ci/run-all-checks.sh" >&2
		return 2
	fi
	mkdir -p "${HOME:-/tmp/hcm-home}"
	cd "$(dirname "${BASH_SOURCE[0]}")/../.."
	exec python3 scripts/ci/pipeline.py --stage "${PIPELINE_STAGE:-all}"
}

main "$@"
