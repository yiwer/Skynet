export interface ServerOperations {
  observedAt: string;
  storage: { committedObjects: number | null; committedBytes: number | null; stagedObjects: number | null;
    filesystemBytes: number | null; freeBytes: number | null; capacityError: string | null; automaticDeletion: false };
  latestBackup: null | { id: string; snapshotAt: string; completedAt: string; objects: number; bytes: number; dumpHash: string;
    failureDomain: 'same-host' | 'off-host-declared' | 'unknown'; verification: 'bundle-integrity'; scope: 'database-and-all-committed-chunks' };
  latestRestore: null | { id: string; backupId: string; verifiedAt: string; scope: 'database-and-all-committed-chunks'; verification: 'integrity-only' };
  latestAttempt: null | { id: string; state: string; startedAt: string; finishedAt: string | null; error: string | null };
  reception: 'single-copy';
}
