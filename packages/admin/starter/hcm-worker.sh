#!/bin/sh
# Historic City Map Maker: use this computer for the imagery pipeline's jobs (docs/research/M7-local-worker.md, section 1.5).
#
# The admin's "Use this computer" fills the three values below and gives this file a name (hcm-worker.sh on Linux,
# hcm-worker.command on macOS). It holds no secret: the admin pairs this computer by itself once the worker runs.
#
#   sh hcm-worker.sh            sets this computer up once: checks Docker, copies itself to a folder of yours and
#                               installs a background service of your user (systemd --user on Linux, a LaunchAgent on
#                               macOS; no sudo), which starts with your session and after a reboot
#   sh hcm-worker.sh run        the service itself: asks the server for the installed pipeline image, pulls it by digest,
#                               runs the worker, and when the worker ends (an update, a crash) waits and starts again;
#                               beside it, while a frame needs the local AI, the sidecar on this computer's graphics card
#   sh hcm-worker.sh matcher    that sidecar's loop alone
#   sh hcm-worker.sh governor   the governor's loop alone: host hints and the worker's CPU quota (docs/research/M26-governor.md)
#   sh hcm-worker.sh update     one look for a newer starter of the installed release (the service looks when it starts, whenever
#                               the worker ends, and once a day): checked against the release's list, it replaces this file
#   sh hcm-worker.sh uninstall  removes the service, the worker, the sidecar, their Docker volumes and images, and this helper's
#                               folder; Docker too, after asking, only when this helper installed it (the admin's "Stop using this
#                               computer" gives this file with uninstall already chosen; "Remove this computer" does it remotely)
#
# A computer without a screen (W5, "Add another computer" in the admin): the admin gives one line to paste over SSH,
#   curl -fsSL '<the admin's address of this file>' -o ~/hcm-worker.sh && echo <one-time code> | sh ~/hcm-worker.sh
# which installs Docker from the system's own signed packages when it is missing (one sudo prompt), lets the service run while
# nobody is logged in (loginctl enable-linger), and hands the one-time code to the worker once it runs. The code comes on standard
# input (or HCM_PAIR_CODE), never as an argument and never in a file; it works once, for 45 minutes.
#
# The worker leaves this computer usable (reports/resource-audit.md): it may hold at most 60 % of the memory Docker has
# (an out-of-memory run ends the job, not the desktop) and yields the processor to everything else. To change that, set
# in the service's environment: HCM_WORKER_MEMORY (a Docker size as 8g, or none for no limit) and HCM_WORKER_THREADS
# (how many threads GDAL uses; the worker's own choice is the cores but one).
set -u

# This file's version: the first 12 hex digits of the SHA-256 of both starter templates with this line emptied
# (scripts/site/src/admin/starter.ts; a test fails when the files change and it does not). The worker gets it as HCM_STARTER.
STARTER_VERSION=e0afe8c32568

HCM_PROJECT='__HCM_PROJECT__'
HCM_CITY='__HCM_CITY__'
HCM_ACTION='__HCM_ACTION__'

NAME=hcm-worker
PORT=8765
OUTDATED=75
# The worker's usage error (argparse): an image older than this starter's supervisor (finding 74 of 2026-11-03).
USAGE=2
REFUSALS=3
LABEL=org.historiccitymap.worker
GET_DOCKER_LINUX=https://docs.docker.com/engine/install/
GET_DOCKER_MAC=https://docs.docker.com/desktop/setup/install/mac-install/
GET_HOMEBREW=https://brew.sh
# W5 (household computers): the disk Docker and the pipeline's image need, how long the first start may take before the one-time
# code runs out, the worker's own word that it was asked to remove this computer (76 + 1 with Docker + 2 keeping the scanned maps),
# and the note that this helper installed Docker (so removing it may take Docker too, never one the owner had).
DOCKER_MIN_FREE_KB=10485760
PAIR_WAIT_SECONDS=2700
REMOVE_EXIT=76
DOCKER_MARKER=installed-docker
LOCAL="http://127.0.0.1:8765"
ORIGIN="https://${HCM_PROJECT}.web.app"
PAIR_CODE=''
DOCKER_SG=0
IMAGE_API="https://us-central1-${HCM_PROJECT}.cloudfunctions.net/worker-image"
IMAGE_PREFIX="us-central1-docker.pkg.dev/${HCM_PROJECT}/hcm/pipeline@sha256:"
# The starter the installed release publishes (docs/research/M7-local-worker.md, *The starter updates itself*): the list on the map's
# Hosting (the admin's build writes it: the version and each template's SHA-256) and the file from the server's worker.starter.
STARTER_LIST="https://${HCM_PROJECT}.web.app/admin/starter.json"
STARTER_API="https://us-central1-${HCM_PROJECT}.cloudfunctions.net/worker-starter"
UPDATE_SECONDS=86400
# What the last look said, for the admin (the worker passes it on as HCM_STARTER_UPDATE).
update_said=unchecked
# The local AI (docs/research/M10-local-ai.md): a sidecar with no network, started here because the worker has no Docker socket.
MATCHER=hcm-matcher
AI_FILES=hcm-ai-files
AI_BOX=hcm-ai-box
AI_MIN_FREE_KB=31457280
AI_SECONDS=20
# The sidecar's folder of unpacked packages in the AI's volume: lib for PyTorch's image, lib-cpu for the worker's own (ai_start).
AI_LIB=lib
# The governor (docs/research/M26-governor.md): what only the host can say, every few seconds, and the worker's CPU quota.
GOVERN_SECONDS=5
HINTS=/work/host-hints.json
# Under WSL: Windows' idle reading at most this often, the interop sockets and powershell.exe when PATH has no /mnt/c (windows_idle).
WSL_IDLE_SECONDS=30
WSL_INTEROP_ROOT=${HCM_WSL_INTEROP_ROOT:-/run/WSL}
WINDOWS_POWERSHELL=${HCM_WINDOWS_POWERSHELL:-/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe}
# The worker's share of the memory Docker has, and its weight against other containers (Docker's default is 1024).
WORKER_MEMORY_PCT=60
WORKER_CPU_SHARES=256

say() {
	printf '%s\n' "$*"
}

# Keeps a Terminal window that a double-click opened until the owner has read it.
pause() {
	if [ -t 0 ]; then
		printf '%s' 'Press Enter to close this window. '
		read -r _
	fi
}

is_mac() {
	[ "$(uname -s)" = Darwin ]
}

home_dir() {
	if is_mac; then
		printf '%s' "$HOME/Library/Application Support/$NAME"
	else
		printf '%s' "${XDG_DATA_HOME:-$HOME/.local/share}/$NAME"
	fi
}

open_url() {
	if is_mac; then
		open "$1" >/dev/null 2>&1 || true
	else
		xdg-open "$1" >/dev/null 2>&1 || true
	fi
}

docker_ok() {
	command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

# Root for one command: itself, else sudo (which asks the password on the terminal once).
as_root() {
	if [ "$(id -u)" = 0 ]; then
		"$@"
	else
		sudo "$@"
	fi
}

# The system's own package manager, whose packages its distribution signs: apt, dnf, zypper or pacman; nothing when none is known.
package_manager() {
	for each in apt-get dnf zypper pacman; do
		if command -v "$each" >/dev/null 2>&1; then
			printf '%s' "$each"
			return 0
		fi
	done
	return 1
}

# Docker from the distribution's signed packages (never a downloaded script), unattended.
package_install() {
	case "$1" in
	apt-get) as_root apt-get update -q && as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -q docker.io ;;
	dnf) as_root dnf install -y -q moby-engine ;;
	zypper) as_root zypper --non-interactive install docker ;;
	pacman) as_root pacman -S --noconfirm --needed docker ;;
	esac </dev/null
}

package_remove() {
	case "$1" in
	apt-get) sudo -n env DEBIAN_FRONTEND=noninteractive apt-get remove -y -q docker.io ;;
	dnf) sudo -n dnf remove -y -q moby-engine ;;
	zypper) sudo -n zypper --non-interactive remove docker ;;
	pacman) sudo -n pacman -R --noconfirm docker ;;
	colima) remove_colima ;;
	*) return 1 ;;
	esac </dev/null >/dev/null 2>&1
}

# macOS: Colima's machine and the two Homebrew packages this helper installed (no password: Homebrew's own folder).
remove_colima() {
	brew services stop colima
	colima delete -f
	brew uninstall colima docker
}

free_kb() {
	df -Pk "$1" 2>/dev/null | awk 'NR == 2 { print $4 }'
}

# Docker usable through the docker group this run joined: the group's new member only gets it in a new login, so the service runs
# under sg (which reads the group file again) until then.
docker_by_group() {
	if command -v sg >/dev/null 2>&1 && sg docker -c 'docker info' >/dev/null 2>&1; then
		DOCKER_SG=1
		return 0
	fi
	return 1
}

# W5: on Linux, Docker installed, started and usable by this account, each step said first, with how long and how much disk; on
# failure why and the fix with its link. Re-running is safe: what is there already is kept.
install_docker_linux() {
	if ! command -v docker >/dev/null 2>&1; then
		manager=$(package_manager) || {
			say 'Docker is missing, and this Linux has none of the package managers this helper knows (apt, dnf, zypper, pacman).'
			say "Install Docker by hand, then run this again: $GET_DOCKER_LINUX"
			return 1
		}
		free=$(free_kb /var)
		if [ "${free:-0}" -lt "$DOCKER_MIN_FREE_KB" ]; then
			say "Docker and the map's pipeline need 10 GB free on this computer; it has $((${free:-0} / 1048576)) GB."
			say 'Free some space (empty the trash, remove old downloads), then run this again.'
			return 1
		fi
		say "Step 1 of 3: installing Docker from your system's own signed packages (1 to 3 minutes, about 500 MB)."
		say 'Installing software needs your password once (sudo).'
		if ! package_install "$manager"; then
			say 'Docker could not be installed: the password was refused, or this computer does not allow installing software'
			say "(a work computer's administrator may block it). Ask them to install Docker, or install it yourself: $GET_DOCKER_LINUX"
			return 1
		fi
		mkdir -p "$(home_dir)"
		printf '%s\n' "$manager" >"$(home_dir)/$DOCKER_MARKER"
	fi
	say 'Step 2 of 3: starting Docker and letting your account use it (a few seconds).'
	as_root systemctl enable --now docker >/dev/null 2>&1 || true
	as_root usermod -aG docker "$(id -un)" >/dev/null 2>&1 || true
	install_nvidia_toolkit
	if docker_ok || docker_by_group; then
		return 0
	fi
	say 'Docker is installed but does not answer. Restart this computer, then run this again.'
	say "Help: $GET_DOCKER_LINUX"
	return 1
}

# W5, macOS: Colima (a small free Docker) through Homebrew, which checks every download; its machine set for this Mac's chip (Apple
# silicon runs the pipeline's amd64 image through Rosetta) and started at each login by Homebrew's own launchd agent. Without
# Homebrew the helper does not install it for you (its installer asks for the administrator's password and is a script from the
# internet): it says so and opens its page, or Docker Desktop's.
install_docker_mac() {
	if ! command -v brew >/dev/null 2>&1; then
		say "Docker is missing. On a Mac this helper installs Colima, a small free Docker, with Homebrew, which this Mac does not have."
		say "Install Homebrew first (it asks your password once): $GET_HOMEBREW, then open this file again."
		say "Or install Docker Desktop instead: $GET_DOCKER_MAC"
		open_url "$GET_HOMEBREW"
		return 1
	fi
	free=$(free_kb /)
	if [ "${free:-0}" -lt "$DOCKER_MIN_FREE_KB" ]; then
		say "Docker and the map's pipeline need 10 GB free on this Mac; it has $((${free:-0} / 1048576)) GB. Free some space, then open this file again."
		return 1
	fi
	if ! command -v colima >/dev/null 2>&1; then
		say 'Step 1 of 2: installing Colima and the docker command with Homebrew, which checks each download (about 3 minutes, 1 GB).'
		if ! brew install colima docker </dev/null; then
			say "Homebrew could not install Colima (no internet, or Homebrew needs an update: brew update). Help: $GET_HOMEBREW"
			return 1
		fi
		mkdir -p "$(home_dir)"
		printf 'colima\n' >"$(home_dir)/$DOCKER_MARKER"
	fi
	say "Step 2 of 2: starting Colima, a small Linux for Docker that runs in the background and starts when you log in (about 2 minutes)."
	if [ "$(uname -m)" = arm64 ]; then
		set -- --vm-type vz --vz-rosetta
	else
		set --
	fi
	colima start "$@" --cpu 4 --memory 6 --disk 40 </dev/null >/dev/null 2>&1 || true
	brew services start colima </dev/null >/dev/null 2>&1 || true
	if docker_ok; then
		return 0
	fi
	say 'Colima is installed but Docker does not answer. Restart the Mac, then open this file again.'
	say "Help: https://github.com/abiosoft/colima#readme"
	return 1
}

# The worker's local AI reaches an NVIDIA card only through NVIDIA's container toolkit and its CDI file (2026-11-13: Docker Engine
# without it saw no card on the owner's 5090). Installed from NVIDIA's own apt repository, once, when nvidia-smi names a card.
NVIDIA_REPO=https://nvidia.github.io/libnvidia-container
install_nvidia_toolkit() {
	if ! nvidia-smi -L 2>/dev/null | grep -q '^GPU' || command -v nvidia-ctk >/dev/null 2>&1 || ! command -v apt-get >/dev/null 2>&1; then
		return 0
	fi
	say "An NVIDIA card is here: installing NVIDIA's container toolkit so the local AI can use it (about 1 minute, 50 MB)."
	if curl -fsSL "$NVIDIA_REPO/gpgkey" | as_root gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit.gpg &&
		curl -fsSL "$NVIDIA_REPO/stable/deb/nvidia-container-toolkit.list" |
		sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit.gpg] https://#' |
			as_root tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null &&
		as_root apt-get update -q && as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -q nvidia-container-toolkit </dev/null &&
		as_root nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml >/dev/null 2>&1; then
		as_root nvidia-ctk runtime configure --runtime=docker >/dev/null 2>&1 && as_root systemctl restart docker >/dev/null 2>&1
		return 0
	fi
	say "NVIDIA's toolkit could not be installed: the local AI uses the processor (slower). Help: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html"
}

# Docker must be installed and running, and usable by this account: this helper installs it when it is missing (Linux: the
# system's packages; macOS: Colima with Homebrew).
check_docker() {
	if docker_ok; then
		return 0
	fi
	if is_mac; then
		install_docker_mac
	else
		install_docker_linux
	fi
}

host_os() {
	if is_mac; then printf mac; else printf linux; fi
}

# This computer's own name for the admin's list (a container's host name is its id).
host_name() {
	uname -n 2>/dev/null | tr -cd 'A-Za-z0-9._-' | cut -c1-63
}

# The installed pipeline image, by digest, as the server names it (worker.image); nothing when it cannot say.
current_image() {
	answer=$(curl -fsS -m 30 -X POST -H 'Content-Type: application/json' -d '{"data":{}}' "$IMAGE_API" 2>/dev/null) || return 1
	image=$(printf '%s' "$answer" | sed -n 's/.*"image":"\([^"]*\)".*/\1/p')
	case "$image" in
	"$IMAGE_PREFIX"*) ;;
	*) return 1 ;;
	esac
	digest=${image#"$IMAGE_PREFIX"}
	if [ "${#digest}" -ne 64 ] || [ -n "$(printf '%s' "$digest" | tr -d '0-9a-f')" ]; then
		return 1
	fi
	printf '%s' "$image"
}

# The local AI's image as the worker's /state names it: pytorch/pytorch by digest, or `worker` (the worker's own image, on a computer
# with no NVIDIA card) and nothing else; nothing when it says otherwise. Read inside `ai` only: /state's own `image` (the worker's,
# sha256:…) comes later, and a match over the whole line took it, refused every frame and left the sidecar down (2026-11-13).
ai_image() {
	ai=$(printf '%s' "$1" | sed -n 's/.*"ai": *{\([^}]*\)}.*/\1/p')
	found=$(printf '%s' "$ai" | sed -n 's/.*"image": *"\([^"]*\)".*/\1/p')
	case "$found" in
	worker)
		printf worker
		return 0
		;;
	pytorch/pytorch@sha256:* | pytorch/pytorch:*@sha256:*) ;;
	*) return 1 ;;
	esac
	digest=${found##*@sha256:}
	if [ "${#digest}" -ne 64 ] || [ -n "$(printf '%s' "$digest" | tr -d '0-9a-f')" ]; then
		return 1
	fi
	case "${found%%@*}" in
	*[!A-Za-z0-9/:._-]*) return 1 ;;
	esac
	printf '%s' "$found"
}

# Which sidecar this computer gets (docs/research/M26-governor.md §5): gpu when an NVIDIA card answers here, PyTorch's own image of
# about 10 GB; else cpu, the worker's own image and PyTorch for the processor in the AI's volume, about 1 GB. HCM_AI_VARIANT decides.
ai_variant() {
	case "${HCM_AI_VARIANT:-}" in
	gpu | cpu)
		printf '%s' "$HCM_AI_VARIANT"
		return
		;;
	esac
	if nvidia-smi -L 2>/dev/null | grep -q '^GPU'; then
		printf gpu
	else
		printf cpu
	fi
}

# The image the worker's container runs: what prepares the volumes and reads the disk, since a host's own tools may not see Docker's disk.
worker_image() {
	docker inspect --format '{{.Config.Image}}' "$NAME" 2>/dev/null
}

# Says in the box why the sidecar cannot come (the panel shows it, the worker stops waiting); a word of this file only, never data.
ai_refused() {
	say "local AI: unavailable ($2)"
	docker run --rm -u 10001:10001 --network none -v "$AI_BOX:/ai/box" --entrypoint sh "$1" \
		-c "printf '{\"state\":\"unavailable\",\"why\":\"$2\"}' > /ai/box/starter.json" >/dev/null 2>&1 || true
}

# Free kilobytes where Docker keeps images, read inside a container: on Docker Desktop the host's disk says nothing of it.
docker_free_kb() {
	docker run --rm --network none --entrypoint df "$1" -Pk / 2>/dev/null | sed -n '2s/^[^ ]* *[0-9]* *[0-9]* *\([0-9]*\).*/\1/p'
}

# The image on this computer: pulled once a frame needs it, when there is room for it. One already here is used as it is: every start of
# this loop comes here, and a computer offline, or Docker Hub refusing, must not cost a working sidecar.
ai_pull() {
	if docker image inspect "$2" >/dev/null 2>&1; then
		return 0
	fi
	free=$(docker_free_kb "$1")
	if [ -z "$free" ] || [ "$free" -lt "$AI_MIN_FREE_KB" ]; then
		ai_refused "$1" disk
		return 1
	fi
	say 'local AI: first use: about 10 GB to fetch, once; it runs on this computer, never in a cloud'
	if ! docker pull "$2" >/dev/null; then
		ai_refused "$1" pull
		return 1
	fi
	ai_note "$2"
}

# The images this file pulled, one a line: uninstall removes those and no other. A new pin's pull lets the earlier ones go at once, about
# 10 GB each; one Docker will not remove yet stays noted.
ai_note() {
	mkdir -p "$(home_dir)"
	note="$(home_dir)/ai-image"
	ai_stop
	touch "$note"
	while IFS= read -r old || [ -n "$old" ]; do
		if [ "$old" != "$1" ] && ! docker image rm "$old" >/dev/null 2>&1 </dev/null; then
			printf '%s\n' "$old"
		fi
	done <"$note" >"$note.new"
	printf '%s\n' "$1" >>"$note.new"
	mv "$note.new" "$note"
}

# The volumes' owner is the sidecar's user: one run of the worker's image, whose empty folders Docker copies with their owner.
ai_volumes() {
	docker run --rm --network none -v "$AI_FILES:/ai/files" -v "$AI_BOX:/ai/box" --entrypoint true "$1" >/dev/null 2>&1 || true
}

# What PyTorch sees under these flags, inside the sidecar's own image and limits: 0 it may use the card, else why not, said: a Docker or
# a driver that refused this once is not a computer with no card. `none` is the reason's place: a graphics card needs none, and Windows
# PowerShell drops an empty argument, so both files pass a word.
ai_probe() {
	image=$1
	shift
	docker run --rm "$@" --network none --cap-drop ALL --security-opt no-new-privileges -u 10001:10001 -e HOME=/tmp --tmpfs /tmp \
		-e HCM_AI_ROOT=/ai -e PYTHONPATH=/ai/files/code:/ai/files/$AI_LIB \
		-v "$AI_FILES:/ai/files:ro" -v "$AI_BOX:/ai/box" --entrypoint python "$image" -m matcher.child probe gpu none >/dev/null 2>&1
	code=$?
	case $code in
	0) ;;
	77) say 'local AI: no graphics card seen' ;;
	76) say 'local AI: the graphics card has under 2 GB of memory' ;;
	*) say "local AI: Docker or the graphics driver refused the graphics card (code $code)" ;;
	esac
	return "$code"
}

# The sidecar itself, beside this loop: the loop keeps reading /state. The client in the background keeps its log in this service's and
# carries a stop of the service to the container.
ai_run() {
	image=$1
	device=$2
	why=$3
	shift 3
	docker rm -f "$MATCHER" >/dev/null 2>&1 || true
	docker run --rm --name "$MATCHER" "$@" --network none --cap-drop ALL \
		--security-opt no-new-privileges --memory 4g --memory-swap 4g --cpu-shares 128 --shm-size 1g --pids-limit 512 \
		--tmpfs /tmp -u 10001:10001 -e HOME=/tmp -e HCM_AI_ROOT=/ai -e PYTHONPATH=/ai/files/code:/ai/files/$AI_LIB \
		-e HCM_AI_DEVICE="$device" -e HCM_AI_WHY="$why" \
		-v "$AI_FILES:/ai/files:ro" -v "$AI_BOX:/ai/box" --entrypoint python "$image" -m matcher.serve &
}

# Graphics card first, through each way Docker offers one; only then the processor, said in plain words. Every start probes again, and a
# sidecar lives only while a frame wants it, so a driver installed later, or a card back from a suspend, is found by the next frame. A
# silent processor run is impossible: the sidecar refuses HCM_AI_DEVICE=cpu without a reason.
ai_start() {
	AI_LIB=lib
	if [ "$1" = "$(worker_image)" ]; then
		AI_LIB=lib-cpu
		say "local AI: on the processor, in the worker's own image (no NVIDIA card on this computer)"
		ai_run "$1" cpu no-gpu
	elif ai_probe "$1" --gpus all; then
		say 'local AI: graphics card found'
		ai_run "$1" gpu '' --gpus all
	elif docker info 2>/dev/null | grep -q nvidia.com/gpu && ai_probe "$1" --device nvidia.com/gpu=all; then
		say 'local AI: graphics card found'
		ai_run "$1" gpu '' --device nvidia.com/gpu=all
	else
		say 'local AI: no usable graphics card; using the processor (slower)'
		ai_run "$1" cpu no-gpu
	fi
}

# The sidecar this loop started, by its image, gone: what a frame no longer wants, or a worker no longer here, holds no container.
ai_stop() {
	if [ -n "$sidecar" ]; then
		docker rm -f "$MATCHER" >/dev/null 2>&1 || true
		sidecar=''
	fi
}

ai_up() {
	[ "$(docker inspect --format '{{.State.Running}}' "$MATCHER" 2>/dev/null)" = true ]
}

# The sidecar of the image the worker names, up: a new pin, or one that ended (77, 76, a crash), starts again and probes again.
ai_keep() {
	if [ "$sidecar" = "$1" ] && ai_up; then
		return 0
	fi
	ai_stop
	ai_start "$1"
	sidecar=$1
}

# Beside the worker: polls its /state, and while a frame wants the AI and its files are there, keeps the sidecar up; once none does, or the
# worker has not answered twice running, removes it. Never a Docker socket in the worker: this file, the owner's own, is what may start a
# container. A sidecar an earlier loop left goes first.
run_matcher() {
	pulled=''
	sidecar=''
	missed=0
	supervisor=$$
	docker rm -f "$MATCHER" >/dev/null 2>&1 || true
	trap 'ai_stop; exit 0' TERM INT
	while kill -0 "$supervisor" 2>/dev/null; do
		state=$(curl -fsS -m 5 "http://127.0.0.1:$PORT/state" 2>/dev/null) || state=''
		matcher_heard "$state"
		sleep "$AI_SECONDS"
	done
	ai_stop
}

matcher_heard() {
	case "$1" in
	'')
		missed=$((missed + 1))
		if [ "$missed" -ge 2 ]; then
			ai_stop
		fi
		;;
	*'"wanted": true'* | *'"wanted":true'*)
		missed=0
		matcher_pass "$1"
		;;
	*)
		missed=0
		ai_stop
		;;
	esac
}

matcher_pass() {
	wanted=$(ai_image "$1") || {
		say 'local AI: refused an unexpected program image'
		return 0
	}
	worker=$(worker_image) || return 0
	if [ "$wanted" = worker ]; then
		wanted=$worker
	fi
	if [ "$pulled" != "$wanted" ]; then
		if [ "$wanted" != "$worker" ]; then
			ai_pull "$worker" "$wanted" || return 0
		fi
		ai_volumes "$worker"
		pulled=$wanted
	fi
	case "$1" in
	*'"files": true'* | *'"files":true'*) ai_keep "$wanted" ;;
	esac
}

# Seconds since the last keyboard or mouse input on this computer; nothing when it cannot be read (the governor then never says active).
# GNOME's idle monitor (Wayland and X11), xprintidle, then logind's IdleHint (set only after the desktop's own idle delay); macOS's HID;
# under WSL, Windows' own reading (windows_idle).
idle_seconds() {
	if is_mac; then
		ioreg -c IOHIDSystem 2>/dev/null | awk '/HIDIdleTime/ { print int($NF / 1000000000); exit }'
		return
	fi
	if is_wsl; then
		windows_idle
		return
	fi
	ms=$(gdbus call --session --dest org.gnome.Mutter.IdleMonitor --object-path /org/gnome/Mutter/IdleMonitor/Core \
		--method org.gnome.Mutter.IdleMonitor.GetIdletime 2>/dev/null | sed -n 's/^(uint64 \([0-9]*\),)$/\1/p')
	[ -n "$ms" ] || ms=$(xprintidle 2>/dev/null)
	if [ -n "$ms" ]; then
		printf '%s' $((ms / 1000))
		return
	fi
	logind_idle
}

logind_idle() {
	session=${XDG_SESSION_ID:-$(loginctl list-sessions --no-legend 2>/dev/null | awk -v u="$(id -un)" '$3 == u { print $1; exit }')}
	[ -n "$session" ] || return 0
	case "$(loginctl show-session "$session" -p IdleHint --value 2>/dev/null)" in
	no) printf '0' ;;
	yes)
		since=$(loginctl show-session "$session" -p IdleSinceHint --value 2>/dev/null)
		[ -n "$since" ] && [ "$since" -gt 0 ] && printf '%s' $(($(date +%s) - since / 1000000))
		;;
	esac
}

# Under WSL (the owner's PC, 2026-11-13) neither GNOME's monitor nor xprintidle answers, and logind's IdleHint is always `no` (there is no
# desktop session): every hint said input and Auto never left Quiet. The person's input is Windows': GetLastInputInfo, read as
# hcm-worker.bat reads it, through powershell.exe at most every WSL_IDLE_SECONDS (each call costs about half a second of processor).
is_wsl() {
	grep -qi microsoft "${HCM_PROC_VERSION:-/proc/version}" 2>/dev/null
}

# The cached reading ("<when> <seconds or -> <socket or ->" in the install folder), refreshed when older than WSL_IDLE_SECONDS.
windows_idle() {
	cache="$(home_dir)/windows-idle"
	read -r at seconds socket 2>/dev/null <"$cache" || at=0
	case "$at" in '' | *[!0-9]*) at=0 ;; esac
	now=$(date +%s)
	if [ $((now - at)) -ge "$WSL_IDLE_SECONDS" ] || [ "$now" -lt "$at" ]; then
		reading=$(windows_idle_read "${socket:--}")
		seconds=${reading% *}
		socket=${reading#* }
		mkdir -p "$(dirname "$cache")" && printf '%s %s %s\n' "$now" "$seconds" "$socket" >"$cache"
	fi
	case "$seconds" in '' | *[!0-9]*) ;; *) printf '%s' "$seconds" ;; esac
}

# "<seconds> <socket>" from the first interop socket whose powershell.exe runs in a person's session, else "- -". A systemd service has
# no WSL_INTEROP and Windows refuses /run/WSL/1_interop; a process that sshd's wsl.exe started runs in session 0, whose
# GetLastInputInfo never sees a key (it reads the computer's uptime), so only an answer from a session other than 0 is the person's.
windows_idle_read() {
	script=$(windows_idle_script | iconv -t UTF-16LE 2>/dev/null | base64 2>/dev/null | tr -d '\n')
	powershell=$(command -v powershell.exe || printf '%s' "$WINDOWS_POWERSHELL")
	if [ -n "$script" ] && [ -x "$powershell" ]; then
		for socket in "$1" "${WSL_INTEROP:-}" "$WSL_INTEROP_ROOT"/*_interop; do
			[ -e "$socket" ] || continue
			seconds=$(WSL_INTEROP=$socket timeout 15 "$powershell" -NoProfile -NonInteractive -EncodedCommand "$script" 2>/dev/null |
				tr -d '\r' | awk 'NF == 2 && $1 ~ /^[0-9]+$/ && $1 > 0 && $2 ~ /^[0-9]+$/ { print $2; exit }')
			if [ -n "$seconds" ]; then
				printf '%s %s' "$seconds" "$socket"
				return
			fi
		done
	fi
	printf '%s' '- -'
}

# The PowerShell that prints "<session> <seconds>": the same GetLastInputInfo as hcm-worker.bat's Get-IdleSeconds.
windows_idle_script() {
	cat <<'PS'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class HcmIdle {
    [StructLayout(LayoutKind.Sequential)] struct Info { public uint Size; public uint Time; }
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref Info info);
    public static uint Seconds() { var i = new Info(); i.Size = (uint)Marshal.SizeOf(i); GetLastInputInfo(ref i); return ((uint)Environment.TickCount - i.Time) / 1000; }
}
'@
"$((Get-Process -Id $PID).SessionId) $([HcmIdle]::Seconds())"
PS
}

# The graphics cards and NPUs Docker could pass to the sidecar, as JSON fields: NVIDIA's (nvidia-smi: memory, use, heat; CUDA when
# Docker has the NVIDIA runtime or CDI), Intel's and AMD's render nodes (OpenVINO, ROCm), Intel's NPU (/dev/accel). Never on macOS.
# Only what a command answers on success, in the expected shape, is data (2026-11-13: on the NUC, which has an Intel Arc and no
# NVIDIA driver, nvidia-smi printed its failure on stdout and the worker listed that sentence as a card's name). A card's name is
# lspci's, else the vendor's word; an NVIDIA card nvidia-smi cannot reach says `no-driver`.
DRM_ROOT=${HCM_DRM_ROOT:-/sys/class/drm}
DEV_ROOT=${HCM_DEV_ROOT:-/dev}

# nvidia-smi's rows, only when it succeeds: a name and the memory as whole numbers (use and heat may read [N/A]: 0); quotes and
# backslashes dropped from the name.
nvidia_rows() {
	rows=$(nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu --format=csv,noheader,nounits 2>/dev/null) ||
		return 0
	printf '%s\n' "$rows" | awk -F', *' -v via="$1" 'NF == 5 && $1 != "" && $2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ {
		gsub(/["\\]/, "", $1)
		printf ",{\"vendor\":\"nvidia\",\"name\":\"%s\",\"vramMb\":%d,\"othersMb\":%d,\"busyPct\":%d,\"tempC\":%d,\"via\":%s}", \
			substr($1, 1, 120), $2, $3, $4, $5, via }'
}

# A PCI card's model from lspci (`-mm`: the fourth quoted field), else $2.
card_name() {
	name=$(lspci -mm -s "$1" 2>/dev/null | awk -F'"' 'NF > 6 { print $6; exit }' | tr -d '\042\134' | cut -c1-120)
	printf '%s' "${name:-$2}"
}

# One card's JSON record: vendor, name, and what follows `"via":`.
card_record() {
	printf ',{"vendor":"%s","name":"%s","vramMb":0,"via":%s}' "$1" "$2" "$3"
}

drm_cards() {
	for vendor in "$DRM_ROOT"/card*/device/vendor; do
		[ -r "$vendor" ] || continue
		device=$(dirname "$vendor")
		slot=$(basename "$(readlink -f "$device")")
		case "$(cat "$vendor")" in
		0x8086) [ -e "$DEV_ROOT/dri" ] && card_record intel "$(card_name "$slot" 'Intel graphics')" '"openvino"' ;;
		0x1002) [ -e "$DEV_ROOT/kfd" ] && card_record amd "$(card_name "$slot" 'AMD graphics')" '"rocm"' ;;
		0x10de) [ "$1" = 0 ] && card_record nvidia "$(card_name "$slot" 'NVIDIA graphics')" 'null,"why":"no-driver"' ;;
		esac
	done
}

host_gpus() {
	via=null
	if docker info 2>/dev/null | grep -qi 'nvidia'; then
		via='"cuda"'
	fi
	nvidia=$(nvidia_rows "$via")
	printf '%s' "$nvidia"
	drm_cards "${#nvidia}"
}

host_npus() {
	if [ -e /dev/accel/accel0 ]; then
		printf '%s' '{"vendor":"intel","name":"NPU","via":"openvino"}'
	fi
}

# macOS's battery (a Linux container reads its own from /sys).
host_power() {
	is_mac || return 0
	pmset -g batt 2>/dev/null | awk '/Battery Power/ { b = 1 } /AC Power/ { b = 0 } /[0-9]+%/ { match($0, /[0-9]+%/); p = substr($0, RSTART, RLENGTH - 1) }
		END { printf ",\"power\":{\"source\":\"%s\",\"percent\":%d}", (b ? "battery" : "ac"), p }'
}

# The hints in the worker's volume, by a rename, through the worker's own container (this file never mounts its volume).
write_hints() {
	idle=$(idle_seconds)
	gpus=$(host_gpus | sed 's/^,//')
	json=$(printf '{"at":%s,"idleS":%s,"gpus":[%s],"npus":[%s]%s}' "$(date +%s)" "${idle:-null}" "$gpus" "$(host_npus)" "$(host_power)")
	printf '%s' "$json" | docker exec -i "$NAME" sh -c "cat > $HINTS.part && mv $HINTS.part $HINTS" >/dev/null 2>&1 || true
}

# The budget's threads as the worker's CPU quota: `docker update --cpus`, only when they change (a pause keeps the last quota: the step
# waits at the gate). The worker reads the quota back from its cgroup's cpu.max.
govern_pass() {
	write_hints
	threads=$(printf '%s' "$1" | sed -n 's/.*"budget": *{"threads": *\([0-9]*\).*/\1/p')
	if [ -n "$threads" ] && [ "$threads" -gt 0 ] && [ "$threads" != "$quota" ]; then
		docker update --cpus "$threads" "$NAME" >/dev/null 2>&1 && quota=$threads && say "governor: the worker may use $threads cores"
	fi
}

# Beside the worker, for as long as the supervisor lives: the host's hints and the quota, every GOVERN_SECONDS.
run_governor() {
	quota=''
	supervisor=$$
	while kill -0 "$supervisor" 2>/dev/null; do
		state=$(curl -fsS -m 3 "http://127.0.0.1:$PORT/state" 2>/dev/null) && govern_pass "$state"
		sleep "$GOVERN_SECONDS"
	done
}

# The machine Docker runs on, whatever an emulated image reads from inside (the worker refuses the AI on arm64).
docker_arch() {
	docker version --format '{{.Server.Arch}}' 2>/dev/null
}

# The worker's memory limit in bytes: HCM_WORKER_MEMORY as given (none: no limit), else WORKER_MEMORY_PCT of what Docker
# has (on Docker Desktop, of its virtual machine); nothing when Docker does not say.
worker_memory() {
	case "${HCM_WORKER_MEMORY:-}" in
	none) return ;;
	'') ;;
	*)
		printf '%s' "$HCM_WORKER_MEMORY"
		return
		;;
	esac
	total=$(docker info --format '{{.MemTotal}}' 2>/dev/null)
	case "$total" in
	'' | *[!0-9]*) return ;;
	esac
	printf '%s' "$((total * WORKER_MEMORY_PCT / 100))"
}

# The worker in the foreground, from the image $1: capped in memory (no swap beyond it), light against other containers.
start_worker() {
	image=$1
	set -- --cpu-shares "$WORKER_CPU_SHARES"
	memory=$(worker_memory)
	if [ -n "$memory" ]; then
		set -- "$@" --memory "$memory" --memory-swap "$memory"
	fi
	if [ -n "${HCM_WORKER_THREADS:-}" ]; then
		set -- "$@" -e "GDAL_NUM_THREADS=$HCM_WORKER_THREADS"
	fi
	docker run --restart unless-stopped --name "$NAME" "$@" -p "127.0.0.1:$PORT:$PORT" -v "$NAME:/work" \
		-v "$AI_FILES:/ai/files" -v "$AI_BOX:/ai/box" -e HCM_STARTER="$STARTER_VERSION" -e HCM_STARTER_UPDATE="$update_said" \
		-e HCM_DOCKER_ARCH="$(docker_arch)" -e HCM_AI_VARIANT="$(ai_variant)" -e HCM_HOST_NAME="$(host_name)" \
		-e HCM_HOST_OS="$(host_os)" -e HCM_REMOVABLE=1 "$image" \
		worker --city "$HCM_CITY" --project "$HCM_PROJECT" --supervised --image "sha256:${image##*@sha256:}"
}

# The copy the installer made, which the service runs: the only file that updates itself.
installed_copy() {
	printf '%s' "$(home_dir)/$NAME.sh"
}

sha256_of_input() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum
	else
		shasum -a 256
	fi | sed -n '1s/^\([0-9a-f]\{64\}\).*/\1/p'
}

# The template a served file was filled from: its three values put back as the marks (written here in pieces: the server fills
# every whole mark of this file).
as_template() {
	u=_
	sed -e "s/^HCM_PROJECT=.*/HCM_PROJECT='$u${u}HCM_PROJECT$u$u'/" -e "s/^HCM_CITY=.*/HCM_CITY='$u${u}HCM_CITY$u$u'/" \
		-e "s/^HCM_ACTION=.*/HCM_ACTION='$u${u}HCM_ACTION$u$u'/" "$1"
}

# The version written in a file (the installed copy, once the look beside the worker replaced it).
version_in() {
	sed -n 's/^STARTER_VERSION=\([0-9a-f]*\)$/\1/p' "$1" 2>/dev/null
}

# One look at the starter the installed release publishes: 0 when a newer one, whose SHA-256 is the release's list's, replaced
# this file (update_said=updated); else 1, and update_said says why not: current, not-installed, no-list, no-file, bad-sum, read-only.
starter_update() {
	self=$(installed_copy)
	if [ "$0" != "$self" ]; then
		update_said=not-installed
		return 1
	fi
	listed=$(curl -fsS -m 30 "$STARTER_LIST" 2>/dev/null | tr -d ' \r\n')
	version=$(printf '%s' "$listed" | sed -n 's/.*"version":"\([0-9a-f]\{12\}\)".*/\1/p')
	sum=$(printf '%s' "$listed" | sed -n 's/.*"posix":"\([0-9a-f]\{64\}\)".*/\1/p')
	if [ -z "$version" ] || [ -z "$sum" ]; then
		update_said=no-list
		return 1
	fi
	if [ "$version" = "$STARTER_VERSION" ]; then
		update_said=current
		return 1
	fi
	starter_replace "$self" "$version" "$sum"
}

# The newer file fetched, checked against the list (its SHA-256 as a template, its version line), and put in place by a rename.
starter_replace() {
	os=linux
	if is_mac; then
		os=mac
	fi
	rm -f "$1.part" "$1.new"
	if ! curl -fsS -m 60 -o "$1.part" "$STARTER_API?city=$HCM_CITY&os=$os&action=install" 2>/dev/null; then
		update_said=no-file
	elif [ "$(as_template "$1.part" | sha256_of_input)" != "$3" ] || [ "$(version_in "$1.part")" != "$2" ]; then
		update_said=bad-sum
	elif sed "s/^HCM_ACTION=.*/HCM_ACTION='run'/" "$1.part" >"$1.new" 2>/dev/null && chmod 700 "$1.new" && mv -f "$1.new" "$1"; then
		update_said=updated
	else
		update_said=read-only
	fi
	rm -f "$1.part" "$1.new"
	say "starter: the look for a newer starter said $update_said"
	[ "$update_said" = updated ]
}

# Once a day beside the worker: a newer file waits for the worker to be idle, then the worker stops and the supervisor starts the file.
run_updater() {
	supervisor=$$
	while sleep "$UPDATE_SECONDS" && kill -0 "$supervisor" 2>/dev/null; do
		if starter_update; then
			while curl -fsS -m 5 "http://127.0.0.1:$PORT/state" 2>/dev/null | grep -q '"state": *"busy"'; do
				sleep 60
			done
			docker stop "$NAME" >/dev/null 2>&1 || true
		fi
	done
}

# This process becomes the newer file: the loops beside the worker go first (the file starts its own).
starter_restart() {
	kill "$matcher_pid" "$governor_pid" "$updater_pid" 2>/dev/null || true
	say 'starter: starting the updated file'
	exec /bin/sh "$0" run
}

# After a pipeline update: keep the current image ($1) and the previous one ($2, or the newest other pipeline image), remove older HCM images.
prune_pipeline_images() {
	kept=$2
	docker images --format '{{.Repository}}@{{.Digest}}' 2>/dev/null | grep "^${IMAGE_PREFIX%@sha256:}@" | while IFS= read -r each; do
		if [ "$each" = "$1" ]; then
			continue
		fi
		if [ -z "$kept" ]; then
			kept=$each
			continue
		fi
		if [ "$each" != "$kept" ]; then
			docker image rm "$each" >/dev/null 2>&1 </dev/null || true
		fi
	done
	docker image prune -f --filter "label=$LABEL" >/dev/null 2>&1 || true
}

# The supervisor: a newer starter of the installed release first (this process then runs it), then the worker in the
# foreground, started again whenever it ends (a newer starter, the daily look's too, first): at once after an outdated image (75),
# else after a wait that grows to five minutes while it keeps failing (and starts small again after a long run). A worker
# that refuses the supervisor's arguments (usage error 2) three times in a row runs an image older than this starter:
# that is said once in the log, and the supervisor asks again every five minutes until the map is updated.
run_worker() {
	if starter_update; then
		exec /bin/sh "$0" run
	fi
	say "starter $STARTER_VERSION: the look for a newer starter said $update_said"
	run_matcher &
	matcher_pid=$!
	run_governor &
	governor_pid=$!
	run_updater &
	updater_pid=$!
	wait_seconds=10
	refused=0
	active_image=''
	previous_image=''
	while :; do
		if image=$(current_image) && docker pull "$image" >/dev/null; then
			docker rm -f "$NAME" >/dev/null 2>&1 || true
			if [ -n "$active_image" ] && [ "$image" != "$active_image" ]; then
				previous_image=$active_image
			fi
			active_image=$image
			prune_pipeline_images "$image" "$previous_image"
			started=$(date +%s)
			start_worker "$image"
			code=$?
			# The supervisor decides what follows, not Docker's restart policy (that one is for a reboot before this runs).
			docker rm -f "$NAME" >/dev/null 2>&1 || true
			if [ "$code" -ge "$REMOVE_EXIT" ] && [ "$code" -le $((REMOVE_EXIT + 3)) ]; then
				remove_by_order "$code" "$image"
				exit 0
			fi
			if [ "$code" -eq "$OUTDATED" ] || [ $(($(date +%s) - started)) -gt 600 ]; then
				wait_seconds=0
			fi
			refused=$((code == USAGE ? refused + 1 : 0))
		fi
		if [ "$refused" -eq "$REFUSALS" ]; then
			say "The server named an image that does not support this computer's starter: update the map."
			say 'In the admin: Setup, Update the map. The worker is asked for again every 5 minutes.'
		fi
		if [ "$refused" -ge "$REFUSALS" ]; then
			wait_seconds=300
		fi
		sleep "$wait_seconds"
		if [ "$(version_in "$0")" != "$STARTER_VERSION" ] || starter_update; then
			starter_restart
		fi
		wait_seconds=$((wait_seconds < 145 ? wait_seconds * 2 + 10 : 300))
	done
}

install_linux() {
	unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
	mkdir -p "$unit_dir"
	{
		say '[Unit]'
		say 'Description=Historic City Map Maker worker (the imagery pipeline on this computer)'
		say 'After=network-online.target'
		say '[Service]'
		say "Environment=\"PATH=$PATH\""
		if [ -n "${DOCKER_HOST:-}" ]; then
			say "Environment=\"DOCKER_HOST=$DOCKER_HOST\""
		fi
		if [ "$DOCKER_SG" = 1 ]; then
			say "ExecStart=$(command -v sg) docker -c \"/bin/sh '$1' run\""
		else
			say "ExecStart=/bin/sh \"$1\" run"
		fi
		say 'Restart=always'
		say 'RestartSec=30'
		say '[Install]'
		say 'WantedBy=default.target'
	} >"$unit_dir/$NAME.service"
	systemctl --user daemon-reload >/dev/null 2>&1 && systemctl --user enable "$NAME.service" >/dev/null 2>&1 &&
		systemctl --user restart "$NAME.service" >/dev/null 2>&1
}

# Without systemd's user services: the desktop's autostart at the next login, and the supervisor started now.
install_autostart() {
	rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$NAME.service"
	autostart="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
	mkdir -p "$autostart"
	{
		say '[Desktop Entry]'
		say 'Type=Application'
		say 'Name=Historic City Map Maker worker'
		say "Exec=sh \"$1\" run"
		say 'NoDisplay=true'
	} >"$autostart/$NAME.desktop"
	pkill -f "$NAME.sh run" >/dev/null 2>&1 || true
	nohup sh "$1" run >/dev/null 2>&1 &
}

install_mac() {
	agents="$HOME/Library/LaunchAgents"
	plist="$agents/$LABEL.plist"
	mkdir -p "$agents" "$HOME/Library/Logs"
	cat >"$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$LABEL</string>
	<key>ProgramArguments</key><array><string>/bin/sh</string><string>$1</string><string>run</string></array>
	<key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.docker/bin</string></dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>StandardOutPath</key><string>$HOME/Library/Logs/$NAME.log</string>
	<key>StandardErrorPath</key><string>$HOME/Library/Logs/$NAME.log</string>
</dict>
</plist>
PLIST
	launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
	launchctl bootstrap "gui/$(id -u)" "$plist"
}

install_worker() {
	check_docker || return 1
	folder=$(home_dir)
	mkdir -p "$folder"
	copy="$folder/$NAME.sh"
	sed "s/^HCM_ACTION=.*/HCM_ACTION='run'/" "$0" >"$copy"
	chmod 700 "$copy"
	if is_mac; then
		install_mac "$copy" || return 1
	elif install_linux "$copy"; then
		enable_linger
	else
		install_autostart "$copy"
	fi
	say 'This computer is set up: the worker runs in the background and starts with your session.'
	if [ -n "$PAIR_CODE" ]; then
		pair_now
	else
		say 'Go back to the admin: it connects this computer by itself.'
	fi
}

# W5: a computer with no screen (no graphical session) keeps the service running while nobody is logged in.
enable_linger() {
	if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] || ! command -v loginctl >/dev/null 2>&1; then
		return 0
	fi
	user=$(id -un)
	if [ "$(loginctl show-user "$user" -p Linger --value 2>/dev/null)" = yes ]; then
		return 0
	fi
	say 'No screen here: letting the helper run while nobody is logged in (loginctl enable-linger, a few seconds).'
	if loginctl enable-linger "$user" >/dev/null 2>&1 || as_root loginctl enable-linger "$user" >/dev/null 2>&1; then
		return 0
	fi
	say "The helper stops when you log out: this computer did not allow it. To fix, run: sudo loginctl enable-linger $user"
	say 'Help: https://www.freedesktop.org/software/systemd/man/latest/loginctl.html'
}

# W5: the one-time code of "Add another computer"'s line, from HCM_PAIR_CODE or one line on standard input; never an argument or a
# file, and the variable is cleared at once so no process started from here inherits it.
read_pair_code() {
	code=${HCM_PAIR_CODE:-}
	unset HCM_PAIR_CODE
	if [ -z "$code" ] && [ ! -t 0 ]; then
		IFS= read -r code || true
	fi
	code=$(printf '%s' "$code" | tr -d ' \r')
	if [ -z "$code" ]; then
		return 0
	fi
	if [ "${#code}" -ne 26 ] || [ -n "$(printf '%s' "$code" | tr -d 'a-z2-7')" ]; then
		say "That is not a code from the admin: it is ignored. Copy the whole line again from Add another computer."
		return 0
	fi
	PAIR_CODE=$code
}

local_state() {
	curl -fsS -m 5 -H "Origin: $ORIGIN" "$LOCAL/state" 2>/dev/null
}

# The code to the worker's own page, as the admin's auto-pair sends it (the project's origin, a JSON body read from stdin: never argv).
post_code() {
	printf '{"code":"%s"}' "$PAIR_CODE" | curl -fsS -m 10 -o /dev/null -X POST -H "Origin: $ORIGIN" \
		-H 'Content-Type: application/json' --data-binary @- "$LOCAL/pair" >/dev/null 2>&1
}

# Waits for the worker (the first start downloads the pipeline), gives it the code once, and says how it ended.
pair_now() {
	say 'Step 3 of 3: connecting this computer to your map. The first start downloads the pipeline (about 3 GB): 5 to 20 minutes.'
	waited=0
	posted=0
	while [ "$waited" -lt "$PAIR_WAIT_SECONDS" ]; do
		state=$(local_state)
		case "$state" in
		*'"signedIn": true'*)
			say "This computer is connected. The admin lists it as $(host_name)."
			return 0
			;;
		*'apiError.worker.pairCode'*)
			say 'The map refused the code: it was used already or ran out. In the admin, Add another computer gives a new line;'
			say 'running it again here skips the download.'
			return 1
			;;
		*'"pairable": true'*)
			if [ "$posted" = 0 ] && post_code; then
				posted=1
			fi
			;;
		esac
		if [ $((waited % 120)) -eq 0 ] && [ "$waited" -gt 0 ]; then
			say "Still getting ready ($((waited / 60)) minutes so far)..."
		fi
		sleep 10
		waited=$((waited + 10))
	done
	say 'This computer did not start within 45 minutes, so its code ran out. Is Docker running (docker ps)? Is there disk space?'
	say 'In the admin, Add another computer gives a new line; running it again here skips what is already done.'
	return 1
}

# The local AI's sidecar, volumes and the images this file pulled for it (by the names it noted: the owner's other images stay).
remove_ai() {
	docker rm -f "$MATCHER" >/dev/null 2>&1 || true
	docker volume rm "$AI_FILES" "$AI_BOX" >/dev/null 2>&1 || true
	if [ -s "$(home_dir)/ai-image" ]; then
		while IFS= read -r each || [ -n "$each" ]; do
			docker image rm "$each" >/dev/null 2>&1 </dev/null || true
		done <"$(home_dir)/ai-image"
	fi
}

# The worker's container, its volume (or, keeping the scanned maps, only its sign-in in it), the pipeline's images, this folder.
remove_worker_files() {
	docker rm -f "$NAME" >/dev/null 2>&1 || true
	if [ "$1" = 1 ]; then
		docker run --rm -v "$NAME:/work" --entrypoint sh "$2" -c 'rm -f /work/.hcm-session-*' >/dev/null 2>&1 || true
	else
		docker volume rm "$NAME" >/dev/null 2>&1 || true
	fi
	docker images --format '{{.Repository}}@{{.Digest}}' 2>/dev/null | grep "^${IMAGE_PREFIX%@sha256:}@" | while IFS= read -r each; do
		docker image rm "$each" >/dev/null 2>&1 </dev/null || true
	done
	rm -rf "$(home_dir)"
}

# The service or the autostart entry: last, since removing it may stop this very process.
remove_service() {
	if is_mac; then
		rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
		launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
	else
		rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$NAME.service" "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/$NAME.desktop"
		systemctl --user daemon-reload >/dev/null 2>&1 || true
		systemctl --user disable --now "$NAME.service" >/dev/null 2>&1 || true
		pkill -f "$NAME.sh run" >/dev/null 2>&1 || true
	fi
}

# Docker, only when this helper installed it (its note), on Linux with sudo that needs no password here: true when it is gone.
remove_docker() {
	[ -n "$1" ] && package_remove "$1"
}

# The worker said the admin asked to remove this computer ($1: 76, +1 with Docker, +2 keeping the scanned maps). Clean up first,
# then the worker once more, with the session still in its volume, says done (the server then disconnects it), then the rest goes.
remove_by_order() {
	flags=$(($1 - REMOVE_EXIT))
	say 'The admin asked to remove this computer: cleaning up.'
	kill "$matcher_pid" "$governor_pid" "$updater_pid" >/dev/null 2>&1 || true
	remove_ai
	marker=$(cat "$(home_dir)/$DOCKER_MARKER" 2>/dev/null) || marker=''
	# Docker goes only when asked and this helper installed it; with no password to give here it stays, and the admin says so.
	drop=false
	left=false
	if [ $((flags % 2)) = 1 ] && [ -n "$marker" ]; then
		if [ "$marker" = colima ] || sudo -n true >/dev/null 2>&1; then drop=true; else left=true; fi
	fi
	docker run --rm --name "$NAME" -v "$NAME:/work" -e HCM_REMOVAL=done -e HCM_REMOVAL_DOCKER_LEFT="$left" "$2" \
		worker --city "$HCM_CITY" --project "$HCM_PROJECT" --supervised --image "sha256:${2##*@sha256:}" >/dev/null 2>&1 || true
	remove_worker_files $((flags / 2)) "$2"
	if [ "$drop" = true ] && remove_docker "$marker"; then
		say 'Docker, which this helper had installed, is removed too.'
	fi
	say 'This computer no longer works for the map.'
	remove_service
}

uninstall_worker() {
	image=$(docker images --format '{{.Repository}}@{{.Digest}}' 2>/dev/null | grep "^${IMAGE_PREFIX%@sha256:}@" | head -n 1)
	remove_ai
	marker=$(cat "$(home_dir)/$DOCKER_MARKER" 2>/dev/null) || marker=''
	remove_worker_files "${HCM_KEEP_MAPS:-0}" "$image"
	remove_service
	say 'The worker is removed from this computer.'
	if [ -n "$marker" ] && [ -t 0 ]; then
		printf '%s' 'This helper installed Docker. Remove Docker too? Other programs that use it would stop working. [y/N] '
		read -r answer
		case "$answer" in
		y | Y | yes)
			if remove_docker "$marker" || package_install_remove "$marker"; then
				say 'Docker is removed.'
			fi
			;;
		esac
	fi
}

# Removing Docker by hand asks the password on the terminal (the remote removal never can).
package_install_remove() {
	case "$1" in
	apt-get) sudo apt-get remove -y docker.io ;;
	dnf) sudo dnf remove -y moby-engine ;;
	zypper) sudo zypper --non-interactive remove docker ;;
	pacman) sudo pacman -R --noconfirm docker ;;
	*) return 1 ;;
	esac
}

case "${1:-$HCM_ACTION}" in
run) run_worker ;;
matcher) run_matcher ;;
governor) run_governor ;;
update)
	starter_update
	say "$update_said"
	;;
uninstall)
	uninstall_worker
	pause
	;;
*)
	read_pair_code
	install_worker
	status=$?
	pause
	exit "$status"
	;;
esac
