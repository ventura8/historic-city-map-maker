#!/usr/bin/env bash
# Builds the quality image (docker/Dockerfile.quality) and tags it hcm-quality:local (override with
# HCM_IMAGE). Docker's layer cache makes a rebuild with unchanged manifests take seconds.
# scripts/ci/run-all-checks.sh calls this before every stage; CI calls it as the image job.
# Extra `docker buildx build` flags (CI cache import/export) come from HCM_DOCKER_BUILD_FLAGS.
# When those flags are set, use the active Buildx builder (CI's docker-container from
# `.github/actions/quality-image`); plain `docker build` cannot export type=gha (DECISIONS §255).
# Locally, with no flags, pin `--builder default` so another project's selected docker-container
# builder cannot steal the build and skip loading the tag into the daemon.
set -euo pipefail

main() {
	local root image
	root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
	image="${HCM_IMAGE:-hcm-quality:local}"
	if [[ -n "${HCM_DOCKER_BUILD_FLAGS:-}" ]]; then
		local -a extra=()
		read -r -a extra <<<"${HCM_DOCKER_BUILD_FLAGS}"
		DOCKER_BUILDKIT=1 docker buildx build --file "$root/docker/Dockerfile.quality" --tag "$image" "${extra[@]}" "$root"
	else
		DOCKER_BUILDKIT=1 docker buildx build --builder default --file "$root/docker/Dockerfile.quality" --tag "$image" "$root"
	fi
	return 0
}

main "$@"
