# Server backup and fresh recovery

The upload ACK still means **single-copy reception**. A completed backup contains one consistent SQL dump plus every committed chunk at that SQL boundary, including staged ACKed fragments. Later uploads remain outside that boundary. A volume on the same host is a same-host copy; `off-host-declared` records an operator declaration and does not verify a second machine or a second person. No command deletes originals or expires backup generations automatically.

The private operator uses `Dockerfile.backup`: digest-pinned Node24.21.0 and PG17.11 Bookworm tools, UID/GID1000, matching the ordinary application's `node` owner. Host PG tools and native Agent installation are unnecessary. Credentials enter the container's private environment through the existing Compose configuration; keep `.env` outside version control with0600 permissions. Do not put a connection URI/password in CLI arguments or evidence logs. The public error response and stored status use fixed reasons; imported exception text is never displayed.

Run these commands in `deploy/` on the Linux deployment host. The ordinary project already has its private generated password and HTTPS host configured. Build the explicit operator profile:

```sh
docker compose -f compose.yml -f compose.backup.yml build backup
printf '%s' '{"action":"backup","rawDirectory":"/data/raw","backupDirectory":"/backups","failureDomain":"same-host"}' |
  docker compose -f compose.yml -f compose.backup.yml run --rm --no-deps -T backup
```

SQL remains online during this backup. The operator keeps an exported read-only snapshot open throughout custom-format `pg_dump` and keyset enumeration. All referenced bytes are independently verified, streamed to0600 files and fsynced. Manifest pages have at most1000 entries,8192 pages total; individual objects keep the64MiB archive limit. PostgreSQL17 is required; dump subprocesses have a15-minute deadline. An interrupted or over-limit operation retains its private pending files and prior successful backup record. Provision space for SQL dump plus all chunks; `/api/server/operations` reports actual raw filesystem capacity, committed/staged bytes and automatic deletion=false. Capacity precision/read failures remain unknown. Application and backup volumes retain0700 directories and0600 files; do not chmod them to grant another UID access.

Fresh named `backups` and `originals` volumes copy up the helper image's pre-created0700 UID1000 directories. This initializes recovery raw storage **without starting the app or migrations**. Existing volumes must already have that same owner. Linux test helpers instead use the fixture caller UID/GID for private host bind mounts; that does not change production's UID1000. The deployed UID1000 named-volume dump/restore path is exercised independently by `server-backup-volumes.test.ts`.

Before copying a completed generation off-host, verify the entire folder; include `database.dump`, `complete.json`, `published.json`, all `pages/` and `objects/`. A SQL dump alone or only snapshot originals omits ACKed staged fragments. Files and directory ancestors must be ordinary private directories/files, not symlinks. Keep permissions and exact bytes. The portable receipt does not contain device/reader credentials, although the encrypted/private SQL backup contains credential hashes and all business records and requires access control.

```sh
printf '%s' '{"action":"verify","bundleDirectory":"/backups/REPLACE_WITH_BACKUP_UUID"}' |
  docker compose -f compose.yml -f compose.backup.yml run --rm --no-deps -T backup
printf '%s' '{"action":"reconcile","backupDirectory":"/backups"}' |
  docker compose -f compose.yml -f compose.backup.yml run --rm --no-deps -T backup
```

Reconciliation holds the same exclusive operator lock. It verifies published bundles before importing missing portable receipts; pending folders are excluded even if mounted under an alias. A completed receipt is not overwritten by a different receipt; repeated imports do not create new success records. Captured in-progress rows become interrupted once no writer owns the lock. Each batch covers at most32 published UUID folders and returns `nextAfter`; repeat with `after` until null. The directory has a100,000-entry safety ceiling. A rejected/corrupted bundle is counted and never replaces the previous success. No active backup can be reconciled as abandoned.

For recovery, choose a **new dedicated Compose project**, an empty PostgreSQL17 database, and a fresh empty raw volume. Keep all app, analysis worker and gateway processes for that target stopped. Do not start the ordinary app before the SQL restore. Do not restore into a live/nonempty database or overwrite a raw directory. Set private recovery `.env` values, plus `SKYNET_RESTORE_BACKUP_VOLUME` to the existing verified private backup volume (after off-host import if applicable). The UUID below identifies the completed generation:

```sh
docker compose -p skynet-recovery -f compose.yml -f compose.backup.yml up -d db
docker compose -p skynet-recovery -f compose.yml -f compose.backup.yml build restore
printf '%s' '{"action":"restore","bundleDirectory":"/backups/REPLACE_WITH_BACKUP_UUID","rawDirectory":"/data/raw"}' |
  docker compose -p skynet-recovery -f compose.yml -f compose.backup.yml run --rm --no-deps -T restore
```

The helper verifies before modification, then durably creates a raw pending marker, copies originals, restores SQL in one transaction, and compares ALL SQL chunks with the manifest. It fences captured running analysis tokens/leases and worker heartbeats before publishing completion. Attempts, request counts, results, history and unknown monetary reservations remain unchanged; recovery is not a reset of retry/budget limits. Device heartbeat timestamps and historical hourly coverage remain evidence of the old server; current connection is invalid until a genuine target heartbeat arrives. A dump-loaded target that exits before this fence keeps its marker and `createApp` rejects startup before migrations. Leave failed targets offline for private investigation; retry into another fresh dedicated target rather than deleting/overwriting existing data.

After the CLI returns `state=restored`, start that target's ordinary app/gateway and only then its explicitly configured analysis worker. Authenticate with the restored original reader and check `/api/server/operations`, sessions/detail, exact raw/readable exports, recovery packages, fixed daily/work-view revisions, correction history and quoted event references. Status currently labels the restore as **integrity-only**. It is not proof that both native clients can continue or a different operator can rebuild; those require their separate drill evidence. Keep the backup and original source unavailable during a native continuation drill so local fallback cannot masquerade as restored-server recovery.
