import type {Source} from '../contracts/archive.js';

/** Native IDs are scoped by the caller to a bound device/source/session. Text
 * equality alone never establishes original ownership. */
export function nativeKey(line:string,source:Source):string|null {
  try {
    const value=JSON.parse(line);
    if(source==='claude-code-cli'&&typeof value.uuid==='string'&&value.uuid.length)return `uuid:${value.uuid}`;
    if(source!=='claude-code-cli'&&value.type==='response_item'&&typeof value.payload?.call_id==='string')return `call:${value.payload.type}:${value.payload.call_id}`;
  }catch { /* Unsupported source records remain original evidence. */ }
  return null;
}
