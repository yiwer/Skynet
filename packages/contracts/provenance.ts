import type { ActivityContext } from '../activity.js';
import type { EvidenceLocation } from './search.js';

export interface EventOrigin {
  eventId: string; snapshotId: string; line: number; block: number;
  employeeId: string; employee: string; deviceId: string; project: string;
  context: ActivityContext; sourceDate: string | null;
  // With materialId, line/block belong to that original material. Its location
  // uses raw UTF-16 offsets, not offsets in parsed semantic event text.
  materialId?: string | null; textOffset?: number;
  location?: EvidenceLocation; webPath?: string;
  qualification?: { revision: string; proofSnapshotId: string; proofLine: number; proofBlock: number; enrolledAt: string };
}
export interface Provenance {
  version: 1;
  relation: 'verified-restoration' | 'same-device-continuation' | 'unconfirmed';
  sourceSnapshotId: string | null;
  warning: string | null;
}
