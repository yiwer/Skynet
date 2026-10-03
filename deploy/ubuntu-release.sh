#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
  cat <<'USAGE'
Usage (Ubuntu, root, Docker Engine + Compose v2.20+ already installed):
  ubuntu-release.sh deploy SOURCE RELEASE HOST [ROOT=/opt/skynet]
  ubuntu-release.sh deploy-proxy SOURCE RELEASE HOST [ROOT=/opt/skynet] [HTTP_PORT=14311]
  ubuntu-release.sh status [ROOT=/opt/skynet]
  ubuntu-release.sh backup [ROOT=/opt/skynet]
  ubuntu-release.sh rollback RELEASE --schema-compatible [ROOT=/opt/skynet]

SOURCE is an unpacked, tested repository snapshot; RELEASE is a unique label.
Existing releases, private configuration and named volumes are preserved.
Rollback changes the application image only, never restores or rewinds data.
deploy-proxy uses an existing HTTPS proxy and binds only 127.0.0.1:HTTP_PORT.
Configure that proxy first; the script still verifies the public HTTPS host.
USAGE
}
die() { printf 'Skynet: %s\n' "$*" >&2; exit 1; }
log() { printf 'Skynet: %s\n' "$*"; }
[[ ${1:-} != --help && ${1:-} != -h ]] || { usage; exit 0; }
ACTION=${1:-}
REQUESTED_MODE=standalone
REQUESTED_PORT=14311
case "$ACTION" in
  deploy) [[ $# -ge 4 && $# -le 5 ]] || { usage; exit 2; }; SOURCE=$2; RELEASE=$3; DEPLOY_HOST=$4; ROOT=${5:-/opt/skynet} ;;
  deploy-proxy) [[ $# -ge 4 && $# -le 6 ]] || { usage; exit 2; }; SOURCE=$2; RELEASE=$3; DEPLOY_HOST=$4; ROOT=${5:-/opt/skynet}; REQUESTED_PORT=${6:-14311}; REQUESTED_MODE=existing-proxy; ACTION=deploy ;;
  status|backup) [[ $# -le 2 ]] || { usage; exit 2; }; ROOT=${2:-/opt/skynet} ;;
  rollback) [[ $# -ge 3 && $# -le 4 && $3 == --schema-compatible ]] || { usage; exit 2; }; RELEASE=$2; ROOT=${4:-/opt/skynet} ;;
  *) usage; exit 2 ;;
esac
[[ $ROOT =~ ^/[A-Za-z0-9._/-]+$ && $ROOT != *..* ]] || die 'Use a dedicated absolute ROOT without spaces or parent traversal.'
[[ $ROOT != / && $ROOT != /opt && $ROOT != /srv && $ROOT != /home && $ROOT != /root ]] || die 'ROOT must be a dedicated child directory.'
if [[ $ACTION == deploy || $ACTION == rollback ]]; then
  [[ $RELEASE =~ ^[a-z0-9][a-z0-9._-]{0,79}$ ]] || die 'RELEASE must use 1-80 lowercase letters, digits, dots, underscores or hyphens.'
fi
[[ $REQUESTED_PORT =~ ^[1-9][0-9]{3,4}$ && $REQUESTED_PORT -ge 1024 && $REQUESTED_PORT -le 65535 ]] || die 'HTTP_PORT must be a decimal port from 1024 through 65535.'
[[ $EUID -eq 0 ]] || die 'Run with sudo; credentials and release state stay root-owned.'
for command in docker curl openssl ss flock realpath tar find sort xargs sha256sum python3; do
  command -v "$command" >/dev/null || die "Missing prerequisite: $command"
done
[[ -z ${DOCKER_HOST:-} && -z ${DOCKER_CONTEXT:-} && $(docker context show) == default ]] || die 'Use the local default Docker context; remote daemons are outside this script.'
docker info >/dev/null 2>&1 || die 'Docker Engine is unavailable; this script does not install or restart it.'
docker compose version >/dev/null || die 'Docker Compose plugin is required.'
[[ ! -L $ROOT && $(realpath -m "$ROOT") == "$ROOT" ]] || die 'ROOT and its ancestors must resolve to the requested path.'
PROJECT=skynet-production
SOURCE_PATHS=(.dockerignore Dockerfile.backup package.json package-lock.json tsconfig.json vite.config.ts apps packages deploy)

if [[ ! -f $ROOT/.skynet-managed ]]; then
  [[ $ACTION == deploy ]] || die 'No deployment exists at ROOT.'
  [[ ! -d $ROOT || -z $(find "$ROOT" -mindepth 1 -maxdepth 1 -print -quit) ]] || die 'Refusing to adopt a nonempty unmanaged ROOT.'
  install -d -m 0700 "$ROOT"
  printf '%s\n' "$PROJECT" > "$ROOT/.skynet-managed"
fi
[[ $(<"$ROOT/.skynet-managed") == "$PROJECT" && $(stat -c %u "$ROOT") == 0 ]] || die 'Deployment owner or marker does not match.'
install -d -m 0700 "$ROOT/private" "$ROOT/releases" "$ROOT/receipts"
exec 9>"$ROOT/private/deploy.lock"
flock -n 9 || die 'Another deployment/backup command owns the lock.'
ENV_FILE=$ROOT/private/runtime.env
read_env() { sed -n "s/^$1=//p" "$ENV_FILE"; }
source_digest() { (cd "$1" && find "${SOURCE_PATHS[@]}" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d ' ' -f 1); }

check_project() {
  local id owner
  if docker network inspect "${PROJECT}_default" >/dev/null 2>&1; then
    [[ $(docker network inspect -f '{{index .Labels "com.skynet.deployment-root"}}' "${PROJECT}_default") == "$ROOT" ]] || die 'The Compose network belongs to another deployment.'
  fi
  while read -r id; do
    [[ -n $id ]] || continue
    owner=$(docker inspect -f '{{index .Config.Labels "com.skynet.deployment-root"}}' "$id")
    [[ $owner == "$ROOT" ]] || die "Compose project $PROJECT already contains an unrelated container: $id"
  done < <(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")
}
check_ports() {
  local port id own service=https
  local ports=(80 443)
  if [[ $REQUESTED_MODE == existing-proxy ]]; then ports=("$REQUESTED_PORT"); service=app; fi
  for port in "${ports[@]}"; do
    own=false
    while read -r id; do
      [[ -n $id ]] || continue
      # Docker's publish filter matches the container port, not the host port.
      # Inspect the binding so 14311:3000 can be retried without mistaking our
      # own app for a foreign listener or overlooking someone else's binding.
      if ! docker inspect -f '{{json .NetworkSettings.Ports}}' "$id" | \
        python3 -c 'import json,sys; ports=json.load(sys.stdin) or {}; sys.exit(0 if any(p.get("HostPort")==sys.argv[1] for bindings in ports.values() for p in (bindings or [])) else 1)' "$port"; then continue; fi
      [[ $(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}/{{index .Config.Labels "com.docker.compose.service"}}/{{index .Config.Labels "com.skynet.deployment-root"}}' "$id") == "$PROJECT/$service/$ROOT" ]] || die "Port $port is published by another container; preserve it and choose a free port or explicit proxy integration."
      own=true
    done < <(docker ps -q)
    if [[ -n $(ss -H -ltn "sport = :$port") && $own == false ]]; then
      die "Port $port is already in use. No nginx, Caddy or other service will be stopped automatically."
    fi
  done
}
pin_image() {
  docker pull "$1" >&2
  docker image inspect -f '{{index .RepoDigests 0}}' "$1"
}
compose() {
  local release=$1; shift
  local files=(-f "$ROOT/releases/$release/deploy/compose.production.yml")
  if [[ $PROXY_MODE == existing-proxy ]]; then files+=(-f "$ROOT/releases/$release/deploy/compose.existing-proxy.yml"); fi
  env -u COMPOSE_PROFILES -u SKYNET_ROOT -u SKYNET_PROJECT -u SKYNET_HOST -u POSTGRES_PASSWORD \
    -u SKYNET_POSTGRES_IMAGE -u SKYNET_CADDY_IMAGE -u SKYNET_APP_IMAGE -u SKYNET_BACKUP_IMAGE -u SKYNET_RELEASE_PATH -u SKYNET_PROXY_MODE -u SKYNET_HTTP_PORT \
    docker compose -p "$PROJECT" --env-file "$ENV_FILE" --env-file "$ROOT/releases/$release/release.env" \
    "${files[@]}" "$@"
}
current_release() {
  [[ -L $ROOT/current ]] || return 0
  local target
  target=$(readlink "$ROOT/current")
  [[ $target =~ ^releases/[a-z0-9][a-z0-9._-]{0,79}$ && -f $ROOT/$target/release.env ]] || die 'Invalid current release pointer.'
  printf '%s' "${target#releases/}"
}
verify_https() {
  local attempt
  if [[ $PROXY_MODE == existing-proxy ]]; then
    curl --silent --show-error --fail --connect-timeout 3 --max-time 5 "http://127.0.0.1:$HTTP_PORT/health" | \
      python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("status") == "ok" else 1)' || die 'Application loopback health verification failed.'
  fi
  for attempt in {1..24}; do
    if curl --silent --show-error --fail --connect-timeout 3 --max-time 5 \
      --resolve "$DEPLOY_HOST:443:127.0.0.1" "https://$DEPLOY_HOST/health" 2>/dev/null | \
      python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("status") == "ok" else 1)' 2>/dev/null; then
      return 0
    fi
    sleep 5
  done
  die 'HTTPS health/certificate verification failed. Last healthy release pointer is unchanged; inspect this project before retrying.'
}
save_current() {
  local release=$1 previous
  previous=$(current_release)
  if [[ -n $previous && $previous != "$release" ]]; then
    ln -s "releases/$previous" "$ROOT/.previous.$$"
    mv -Tf "$ROOT/.previous.$$" "$ROOT/previous"
  fi
  ln -s "releases/$release" "$ROOT/.current.$$"
  mv -Tf "$ROOT/.current.$$" "$ROOT/current"
}
backup_release() {
  local release=$1 receipt helper
  [[ -n $release ]] || die 'A healthy current release is required for backup.'
  [[ $(source_digest "$ROOT/releases/$release") == "$(<"$ROOT/releases/$release/source.sha256")" ]] || die 'Saved release source has changed; preserve it for investigation.'
  helper=skynet-backup:$release
  if ! docker image inspect "$helper" >/dev/null 2>&1; then
    docker build -f "$ROOT/releases/$release/Dockerfile.backup" \
      --label "com.skynet.source-sha256=$(<"$ROOT/releases/$release/source.sha256")" -t "$helper" "$ROOT/releases/$release"
  fi
  [[ $(docker image inspect -f '{{index .Config.Labels "com.skynet.source-sha256"}}' "$helper") == "$(<"$ROOT/releases/$release/source.sha256")" ]] || die 'Backup helper image does not match the saved release source.'
  receipt=$ROOT/receipts/backup-$(date -u +%Y%m%dT%H%M%SZ)-$$.json
  printf '%s' '{"action":"backup","rawDirectory":"/data/raw","backupDirectory":"/backups","failureDomain":"same-host"}' | \
    compose "$release" run --rm --no-deps -T backup > "$receipt.pending"
  python3 -c 'import json,sys; result=json.load(open(sys.argv[1])); assert result.get("state")=="completed"' "$receipt.pending"
  mv "$receipt.pending" "$receipt"
  log "Consistent same-host backup receipt: $receipt (not an off-host recovery drill)."
}

check_project
if [[ $ACTION == deploy ]]; then
  [[ $DEPLOY_HOST =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ && $DEPLOY_HOST == *.* ]] || die 'HOST must be a public DNS name without scheme, port or path.'
  [[ $SOURCE == /* ]] || die 'SOURCE must be absolute.'
  SOURCE=$(realpath "$SOURCE")
  for path in "${SOURCE_PATHS[@]}"; do [[ -e $SOURCE/$path ]] || die "Missing release source: $path"; done
  [[ -f $SOURCE/deploy/Dockerfile.production && -f $SOURCE/deploy/compose.production.yml ]] || die 'Production deployment files are missing.'
  if [[ $REQUESTED_MODE == existing-proxy ]]; then [[ -f $SOURCE/deploy/compose.existing-proxy.yml ]] || die 'Existing-proxy Compose override is missing.'; fi
  [[ -z $(cd "$SOURCE" && find "${SOURCE_PATHS[@]}" -type l -print -quit) ]] || die 'Source release paths must not contain symlinks.'
  check_ports
  if [[ ! -f $ENV_FILE ]]; then
    for suffix in database originals tls-data tls-config backups; do
      ! docker volume inspect "$PROJECT-$suffix" >/dev/null 2>&1 || die 'Existing named volumes need their original private configuration; refusing to generate a new password.'
    done
    POSTGRES_IMAGE=$(pin_image postgres:17.11-alpine)
    # In proxy mode the inactive Caddy service only needs a syntactically valid
    # image reference for Compose interpolation; it is never pulled or started.
    CADDY_IMAGE=caddy:2-alpine
    if [[ $REQUESTED_MODE == standalone ]]; then CADDY_IMAGE=$(pin_image caddy:2-alpine); fi
    PASSWORD=$(openssl rand -hex 32)
    printf 'SKYNET_ROOT=%s\nSKYNET_PROJECT=%s\nSKYNET_HOST=%s\nPOSTGRES_PASSWORD=%s\nSKYNET_POSTGRES_IMAGE=%s\nSKYNET_CADDY_IMAGE=%s\nSKYNET_PROXY_MODE=%s\nSKYNET_HTTP_PORT=%s\n' \
      "$ROOT" "$PROJECT" "$DEPLOY_HOST" "$PASSWORD" "$POSTGRES_IMAGE" "$CADDY_IMAGE" "$REQUESTED_MODE" "$REQUESTED_PORT" > "$ENV_FILE.pending"
    mv "$ENV_FILE.pending" "$ENV_FILE"
    unset PASSWORD
  fi
fi
[[ -f $ENV_FILE && ! -L $ENV_FILE && $(stat -c %u "$ENV_FILE") == 0 && $(stat -c %a "$ENV_FILE") == 600 ]] || die 'Private runtime.env must be an existing root-owned 0600 file.'
[[ $(read_env SKYNET_ROOT) == "$ROOT" && $(read_env SKYNET_PROJECT) == "$PROJECT" ]] || die 'Private configuration belongs to another deployment.'
[[ $(read_env POSTGRES_PASSWORD) =~ ^[0-9a-f]{64}$ ]] || die 'Existing password is not the original generated hex value; resolve configuration manually.'
PROXY_MODE=$(read_env SKYNET_PROXY_MODE); PROXY_MODE=${PROXY_MODE:-standalone}
HTTP_PORT=$(read_env SKYNET_HTTP_PORT); HTTP_PORT=${HTTP_PORT:-14311}
[[ $PROXY_MODE == standalone || $PROXY_MODE == existing-proxy ]] || die 'Unknown preserved proxy mode.'
[[ $HTTP_PORT =~ ^[1-9][0-9]{3,4}$ && $HTTP_PORT -ge 1024 && $HTTP_PORT -le 65535 ]] || die 'Invalid preserved loopback HTTP port.'
[[ $(read_env SKYNET_POSTGRES_IMAGE) == *@sha256:* ]] || die 'PostgreSQL must remain digest-pinned.'
if [[ $PROXY_MODE == standalone ]]; then [[ $(read_env SKYNET_CADDY_IMAGE) == *@sha256:* ]] || die 'Standalone Caddy must remain digest-pinned.'; fi
if [[ $ACTION == deploy ]]; then
  [[ $PROXY_MODE == "$REQUESTED_MODE" && ( $PROXY_MODE == standalone || $HTTP_PORT == "$REQUESTED_PORT" ) ]] || die 'Proxy mode or port differs from preserved configuration; use the original deploy action and port.'
fi
if [[ $ACTION == deploy ]]; then [[ $(read_env SKYNET_HOST) == "$DEPLOY_HOST" ]] || die 'HOST differs from the preserved configuration; explicit migration is required.'; fi
DEPLOY_HOST=$(read_env SKYNET_HOST)
CURRENT=$(current_release)
if [[ $ACTION == deploy && -z $CURRENT && -f $ROOT/private/last-attempt ]]; then
  [[ $(<"$ROOT/private/last-attempt") == "$RELEASE" ]] || die 'First deployment has not passed health checks; repair/retry that same release before introducing a different one.'
fi

case "$ACTION" in
  status)
    [[ -n $CURRENT ]] || die 'No release has passed health verification yet.'
    log "Last healthy release: $CURRENT; mode: $PROXY_MODE; HTTPS: https://$DEPLOY_HOST"
    compose "$CURRENT" ps
    compose "$CURRENT" exec -T db pg_isready -U skynet -d skynet
    verify_https
    ;;
  backup) backup_release "$CURRENT" ;;
  rollback)
    [[ -n $CURRENT && -f $ROOT/releases/$RELEASE/release.env ]] || die 'Choose an existing release and preserve the current deployment.'
    docker image inspect "skynet-app:$RELEASE" >/dev/null || die 'Rollback image is unavailable; do not rebuild an old label with new source.'
    [[ -f $ROOT/releases/$RELEASE/image-id && $(docker image inspect -f '{{.Id}}' "skynet-app:$RELEASE") == "$(<"$ROOT/releases/$RELEASE/image-id")" ]] || die 'Rollback image is not the image that passed the saved release check.'
    backup_release "$CURRENT"
    compose "$RELEASE" up -d --no-deps --wait --wait-timeout 180 app
    verify_https
    save_current "$RELEASE"
    log "Application rolled back to $RELEASE; database, originals and HTTPS state were not rewound."
    ;;
  deploy)
    SOURCE_HASH=$(source_digest "$SOURCE")
    DEST=$ROOT/releases/$RELEASE
    if [[ -e $DEST ]]; then
      [[ ! -L $DEST && -f $DEST/source.sha256 && $(<"$DEST/source.sha256") == "$SOURCE_HASH" ]] || die 'RELEASE already exists with different or incomplete source; use a new label.'
      [[ $(source_digest "$DEST") == "$SOURCE_HASH" ]] || die 'Saved release source changed after upload; refuse to reuse its label.'
    else
      install -d -m 0700 "$DEST"
      tar -C "$SOURCE" -cf - "${SOURCE_PATHS[@]}" | tar -C "$DEST" -xf -
      printf '%s\n' "$SOURCE_HASH" > "$DEST/source.sha256"
      printf 'SKYNET_APP_IMAGE=skynet-app:%s\nSKYNET_BACKUP_IMAGE=skynet-backup:%s\nSKYNET_RELEASE_PATH=%s\n' "$RELEASE" "$RELEASE" "$DEST" > "$DEST/release.env"
    fi
    compose "$RELEASE" config --quiet
    VOLUME_SUFFIXES=(database originals backups)
    if [[ $PROXY_MODE == standalone ]]; then VOLUME_SUFFIXES+=(tls-data tls-config); fi
    for suffix in "${VOLUME_SUFFIXES[@]}"; do
      volume=$PROJECT-$suffix
      if docker volume inspect "$volume" >/dev/null 2>&1; then
        [[ $(docker volume inspect -f '{{index .Labels "com.skynet.deployment-root"}}' "$volume") == "$ROOT" ]] || die "Refusing to adopt unrelated volume: $volume"
      else
        docker volume create --label "com.skynet.deployment-root=$ROOT" "$volume" >/dev/null
      fi
    done
    if docker image inspect "skynet-app:$RELEASE" >/dev/null 2>&1; then
      [[ $(docker image inspect -f '{{index .Config.Labels "com.skynet.source-sha256"}}' "skynet-app:$RELEASE") == "$SOURCE_HASH" ]] || die 'Application image label does not match the release source.'
    else
      docker build -f "$DEST/deploy/Dockerfile.production" --build-arg "SKYNET_RELEASE=$RELEASE" \
        --build-arg "SKYNET_SOURCE_SHA256=$SOURCE_HASH" -t "skynet-app:$RELEASE" "$DEST"
    fi
    if [[ -n $CURRENT && $CURRENT != "$RELEASE" ]]; then backup_release "$CURRENT"; fi
    printf '%s\n' "$RELEASE" > "$ROOT/private/last-attempt"
    SERVICES=(db app)
    if [[ $PROXY_MODE == standalone ]]; then SERVICES+=(https); fi
    compose "$RELEASE" up -d --wait --wait-timeout 180 "${SERVICES[@]}"
    verify_https
    save_current "$RELEASE"
    docker image inspect -f '{{.Id}}' "skynet-app:$RELEASE" > "$DEST/image-id"
    log "Release $RELEASE is healthy at https://$DEPLOY_HOST; analysis worker remains disabled."
    ;;
esac
