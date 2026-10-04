# Fixed report downloads

`apps/server/report-download.ts` owns the HTTP download lifecycle. Resolve and
persist a current report first; `prepareReportDownload(db, prepare)` then opens a
read-only repeatable-read transaction. `prepare(reader)` opens the fixed version,
validates its scope, and returns `{ version, json }`. `json()` must be repeatable,
yield bounded UTF-8 buffers containing the complete JSON, and use only the supplied
reader for persisted content. It must not materialize a new report or modify data.

The helper first reads the entire fixed content to calculate byte length and
SHA-256 and surface missing or invalid chunks before HTTP success. The response
uses a second pass in that same transaction snapshot, under stream backpressure.
The returned `close()` is idempotent, rejects subsequent reads, drains active
queries, rolls back the read-only transaction, and releases the connection.
`sendReportDownload` handles normal completion, stream errors and client close,
sets a versioned attachment filename, ETag, Content-Length and
X-Skynet-Content-SHA256, and sends the bounded stream.

The first public efficiency download regression verifies complete segment data,
fixed scope, exact response hash and length, versioned filename, new input and
restart preserving the previous bytes. This helper is available for the later
waits download slice; report-specific storage and JSON order belong to that
report's revision adapter. This is not an AC32 performance result or acceptance
of the remaining large-result and disconnect cases.
