import type { ActivityContext } from '../activity.js';

export interface EventOrigin {
  eventId: string; snapshotId: string; line: number; block: number;
  employeeId: string; employee: string; deviceId: string; project: string;
  context: ActivityContext; sourceDate: string | null;
}
export interface Provenance {
  version: 1;
  relation: 'verified-restoration' | 'same-device-continuation' | 'unconfirmed';
  sourceSnapshotId: string | null;
  warning: string | null;
}
