#!/usr/bin/env bash
# SonarQube Cloud analysis of this checkout, then the clean-or-not verdict (scripts/ci/sonar_report.py).
#
# Usage:
#   bash scripts/ci/sonar_scan.sh                # validate the token, scan, then report
#   bash scripts/ci/sonar_scan.sh --check-token  # only validate the token
#
# - Needs the coverage reports of the tests stage (reports/coverage/ts/lcov.info, the Cobertura XML
#   and JUnit files named in sonar-project.properties, which also holds the whole analysis scope):
#   with a token, a missing or empty report stops the run before anything is uploaded
#   (`sonar_report.py --check-reports`), so an analysis without coverage never reaches SonarCloud.
# - The token comes from SONAR_TOKEN or the git-ignored .sonar-token (mode 0600: a file other users
#   can read is refused). It reaches every process through the environment or stdin, never argv:
#   the scanner reads SONAR_TOKEN itself (the image's entrypoint, which would turn it into
#   -Dsonar.token, is bypassed) and curl validates it from a config on stdin (`-K -`). Without a
#   token the analysis is skipped with a notice and exit 0: the CI job runs it with the secret.
# - On the host, the pinned scanner image runs with the repository at the same absolute path (so
#   report paths match) and the report runs in the quality image. Inside the quality image
#   (HCM_TEST_IMAGE=1, the pipeline's `sonar` gate) both run directly: docker/Dockerfile.quality copies
#   the scanner from the same pinned image. There it runs on the image's JDK 21 instead of downloading a
#   JRE per run, and keeps SonarCloud's plugin cache in the git-ignored reports/.cache/sonar.
# - SonarCloud's Automatic Analysis must be OFF; while it is on, the scanner is refused and the
#   analysis is skipped with a notice saying where to turn it off.
#
# Exit status: 0 clean (or skipped), 1 not clean, 2 bad token, not configured or scan failed.
set -euo pipefail

readonly SCANNER_IMAGE="sonarsource/sonar-scanner-cli:12.4.0.4321_8.4.0@sha256:6e6eca4d552695a98fb7dab84f0c1bd0885ebbfe272654d1552e24bd7f452d51"
readonly QUALITY_IMAGE="${HCM_IMAGE:-hcm-quality:local}"
readonly DEFAULT_HOST="https://sonarcloud.io"
readonly REPORT_TASK=".scannerwork/report-task.txt"
readonly SCANNER_LOG="reports/sonar/scanner.log"
readonly SONAR_CACHE="reports/.cache/sonar"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly repo_root
readonly token_file="${repo_root}/.sonar-token"

log() {
	printf '[sonar] %s\n' "$*"
	return 0
}

fail() {
	printf '[sonar] %s\n' "$*" >&2
	exit 2
}

# A token file other users can read is a leaked token waiting to happen.
token_file_is_private() {
	local mode
	mode="$(stat -c '%a' "${token_file}")"
	[[ "${mode}" == *00 ]]
}

# A pasted secret often carries a trailing newline or spaces; the API rejects those.
load_token() {
	SONAR_TOKEN="$(printf '%s' "${SONAR_TOKEN:-}" | tr -d '[:space:]')"
	if [[ -z "${SONAR_TOKEN}" && -f "${token_file}" ]]; then
		token_file_is_private || fail "${token_file} is readable by other users: run chmod 600 .sonar-token"
		SONAR_TOKEN="$(tr -d '[:space:]' <"${token_file}")"
	fi
	export SONAR_TOKEN
	return 0
}

sonar_host() {
	local host
	host="$(sed -n -E 's/^sonar\.host\.url[[:space:]]*[=:][[:space:]]*//p' "${repo_root}/sonar-project.properties" 2>/dev/null | head -n 1)"
	printf '%s' "${host:-${DEFAULT_HOST}}"
	return 0
}

# /api/authentication/validate answers {"valid":true|false}. The token goes to curl in a config on
# stdin (printf is a builtin, so it is never in a process's argv). An unreachable server only warns:
# the scan then decides.
check_token() {
	local host answer
	host="$(sonar_host)"
	[[ "${host}" == https://* ]] || fail "sonar.host.url must be an https:// URL, got ${host}"
	if ! answer="$(printf 'header = "Authorization: Bearer %s"\n' "${SONAR_TOKEN}" |
		curl --silent --show-error --fail --max-time 20 -K - "${host}/api/authentication/validate" 2>&1)"; then
		log "warning: could not reach ${host} to validate the token (${answer}); continuing"
		return 0
	fi
	if [[ "${answer}" == *'"valid":true'* ]]; then
		log "the token is valid"
		return 0
	fi
	fail "the token is invalid or expired: create a new one at ${host}/account/security, then update .sonar-token (local) and the SONAR_TOKEN secret (CI)"
}

project_version() {
	sed -n -E '/^    "version": /{s/^    "version": "([^"]+)",?$/\1/p;q}' "${repo_root}/package.json"
	return 0
}

# The checked-out branch (also before the first commit); empty on a detached HEAD.
current_branch() {
	git -C "${repo_root}" symbolic-ref --short -q HEAD || true
	return 0
}

in_quality_image() {
	[[ "${HCM_TEST_IMAGE:-}" == "1" ]]
}

scanner() {
	if in_quality_image; then
		SONAR_USER_HOME="${SONAR_USER_HOME:-${repo_root}/${SONAR_CACHE}}" \
			sonar-scanner -Dsonar.scanner.skipJreProvisioning=true "$@"
		return
	fi
	docker run --rm --user "$(id -u):$(id -g)" --entrypoint /opt/sonar-scanner/bin/sonar-scanner \
		-e SONAR_TOKEN -e HOME=/tmp/sonar-home -e SONAR_USER_HOME=/tmp/sonar-home/.sonar \
		-v "${repo_root}:${repo_root}" -w "${repo_root}" "${SCANNER_IMAGE}" "$@"
}

report() {
	if in_quality_image; then
		python3 scripts/ci/sonar_report.py "$@"
		return
	fi
	docker run --rm --user "$(id -u):$(id -g)" -e SONAR_TOKEN -e HOME=/tmp/hcm-home \
		-v "${repo_root}:${repo_root}" -w "${repo_root}" "${QUALITY_IMAGE}" python3 scripts/ci/sonar_report.py "$@"
}

scan_and_report() {
	if in_quality_image && ! command -v sonar-scanner >/dev/null 2>&1; then
		fail "sonar-scanner is not installed in the quality image (docker/Dockerfile.quality)"
	fi
	report --check-reports ||
		fail "the coverage and test reports are missing: run PIPELINE_STAGE=tests first (PIPELINE_STAGE=all runs both)"
	local branch
	branch="$(current_branch)"
	local scanner_args=("-Dsonar.projectVersion=$(project_version)")
	local report_args=(--report-task "${REPORT_TASK}")
	if [[ -n "${branch}" ]]; then
		scanner_args+=("-Dsonar.branch.name=${branch}")
		report_args+=(--branch "${branch}")
	fi
	mkdir -p "$(dirname "${SCANNER_LOG}")"
	log "scanning ${branch:-a detached HEAD} (log: ${SCANNER_LOG})"
	if ! scanner "${scanner_args[@]}" >"${SCANNER_LOG}" 2>&1; then
		if grep -q "Automatic Analysis" "${SCANNER_LOG}"; then
			log "[SKIP] SonarCloud refused the scan: turn Automatic Analysis OFF (Administration > Analysis Method)"
			return 0
		fi
		fail "the scanner failed; read ${SCANNER_LOG}"
	fi
	report "${report_args[@]}"
}

main() {
	cd "${repo_root}"
	case "${1:-}" in
	"" | --check-token) ;;
	*) fail "usage: bash scripts/ci/sonar_scan.sh [--check-token]" ;;
	esac
	load_token
	if [[ -z "${SONAR_TOKEN}" ]]; then
		log "[SKIP] no SONAR_TOKEN and no .sonar-token: analysis skipped (docs/SETUP.md explains the token step)"
		return 0
	fi
	check_token
	if [[ "${1:-}" == "--check-token" ]]; then
		return 0
	fi
	scan_and_report
}

main "$@"
