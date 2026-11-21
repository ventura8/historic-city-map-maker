#!/usr/bin/env bash
# Builds the quality image (docker/Dockerfile.quality) and tags it hcm-quality:local (override with
# HCM_IMAGE). Docker's layer cache makes a rebuild with unchanged manifests take seconds.
# scripts/ci/run-all-checks.sh calls this before every stage; CI calls it as the image job.
# Extra `docker build` flags (CI cache import/export) come from HCM_DOCKER_BUILD_FLAGS.
set -euo pipefail

main() {
	local root image
	root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
	image="${HCM_IMAGE:-hcm-quality:local}"
	local -a extra=()
	if [[ -n "${HCM_DOCKER_BUILD_FLAGS:-}" ]]; then
		read -r -a extra <<<"${HCM_DOCKER_BUILD_FLAGS}"
	fi
	DOCKER_BUILDKIT=1 docker build --file "$root/docker/Dockerfile.quality" --tag "$image" "${extra[@]}" "$root"
	return 0
}

main "$@"
