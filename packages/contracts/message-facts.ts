import type {ActivityContext} from '../activity.js';
import type {Source} from './archive.js';
export type RecordedMessage = {
  id:string; eventIds:string[]; role:'user'|'assistant'; length:number; first:boolean|null; previousPromptId:string|null;
  employeeId:string; project:string; sourceDate:string|null; context:ActivityContext; source:Source; sourceSessionId:string;
  originalSnapshotId:string; line:number; materialId:string|null; webPath:string;
};
export type MessageFacts = {complete:boolean;messages:RecordedMessage[]};
