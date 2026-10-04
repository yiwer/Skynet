import type {WaitsPage,WaitsQuery,WaitsScope} from '../../packages/contracts/waits.js';
import type {ReportReader} from './report-download.js';
import {HttpError} from './identities.js';

export function assertWaitScope(q:WaitsQuery,scope:WaitsScope){
  if(q.week&&scope.from!==q.week)throw new HttpError(400,'等待版本与指定周不一致');
  const requested:Partial<WaitsScope>={...(q.snapshotId?{snapshotId:q.snapshotId}:{period:q.period}),
    ...(q.employeeId?{employeeId:q.employeeId}:{}),...(q.source?{source:q.source}:{}),...(q.project!==undefined?{project:q.project}:{})};
  if(!q.contextSnapshotId)for(const key of ['snapshotId','period','employeeId','source','project'] as const)
    if(requested[key]!==scope[key])throw new HttpError(400,'等待记录版本不属于当前范围');
}

const collections=['intervals','daily','unavailableSources'] as const;
type Header=Omit<WaitsPage,typeof collections[number]>;
/** Legacy JSONB history stays in place. The caller owns one read-only snapshot;
 * both passes walk the same fixed arrays without loading the complete report. */
export async function openWaitRevision(reader:ReportReader,q:WaitsQuery){
  const row=(await reader.query<{header:Header;counts:Record<typeof collections[number],number|null>}>(`SELECT
    payload - 'intervals' - 'daily' - 'unavailableSources' AS header,
    jsonb_build_object('intervals',jsonb_array_length(payload->'intervals'),'daily',jsonb_array_length(payload->'daily'),
      'unavailableSources',jsonb_array_length(payload->'unavailableSources')) AS counts
    FROM wait_revisions WHERE version=$1`,[q.version])).rows[0];
  if(!row)throw new HttpError(404,'等待记录版本不存在');
  const {header,counts}=row;assertWaitScope(q,header.scope);
  if(header.version!==q.version||counts.intervals!==header.total||counts.daily===null)
    throw new HttpError(503,'等待记录版本不完整');
  const headerText=JSON.stringify(header);
  if(Buffer.byteLength(headerText)>80*1024)throw new HttpError(413,'等待记录版本元数据超过读取上限');
  async function* json(){
    yield Buffer.from(headerText.slice(0,-1));
    for(const section of collections){
      if(counts[section]===null)continue; // Preserve absent legacy optional arrays.
      yield Buffer.from(','+JSON.stringify(section)+':[');
      await reader.query(`DECLARE wait_download_items NO SCROLL CURSOR FOR SELECT value
        FROM wait_revisions CROSS JOIN LATERAL jsonb_array_elements(payload->$2) WITH ORDINALITY AS items(value,ordinal)
        WHERE version=$1 ORDER BY ordinal`,[q.version,section]);
      let count=0;
      try{
        while(true){
          const rows=(await reader.query<{value:unknown}>('FETCH FORWARD 16 FROM wait_download_items')).rows;
          if(!rows.length)break;
          for(const item of rows){
            const bytes=Buffer.from((count++?',':'')+JSON.stringify(item.value));
            for(let offset=0;offset<bytes.length;offset+=64*1024)yield bytes.subarray(offset,offset+64*1024);
          }
        }
      }finally{await reader.query('CLOSE wait_download_items');}
      if(count!==counts[section])throw new HttpError(503,'等待记录版本不完整');
      yield Buffer.from(']');
    }
    yield Buffer.from('}');
  }
  return {version:header.version,json};
}
