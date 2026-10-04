import {waitSections,type WaitsPage,type WaitsQuery,type WaitsScope,type WaitsReadingQuery,type WaitsReadingPage,type WaitSection,type WaitEmployee} from '../../packages/contracts/waits.js';
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
  return {version:header.version,header,counts,json};
}

const employeeRows=`SELECT item->>'employeeId' AS "employeeId", min(item->>'employee') AS employee
  FROM wait_revisions CROSS JOIN LATERAL (
    SELECT value AS item FROM jsonb_array_elements(payload->'intervals')
    UNION ALL SELECT value FROM jsonb_array_elements(COALESCE(payload->'unavailableSources','[]'::jsonb))
  ) AS sources WHERE version=$1 GROUP BY item->>'employeeId'`;

/** A public projection of one complete revision. Empty arrays on a different
 * section never mean empty input: every descriptor keeps the full count. */
export async function readWaitPage(reader:ReportReader,q:WaitsReadingQuery):Promise<WaitsReadingPage>{
  const revision=await openWaitRevision(reader,q);
  const employeeCount=Number((await reader.query(`SELECT count(*) AS total FROM (${employeeRows}) AS employees`,[q.version])).rows[0].total);
  const totals={...revision.counts,unavailableSources:revision.counts.unavailableSources??0,employees:employeeCount};
  const selected=q.section??'intervals';
  if(q.offset>totals[selected]!)throw new HttpError(400,'等待记录分页位置超过总量');
  const value:WaitsReadingPage={...revision.header,readingVersion:'wait-page-1',intervals:[],daily:[],unavailableSources:[],employees:[],pages:{} as WaitsReadingPage['pages']};
  for(const section of waitSections){
    const offset=section===selected?q.offset:0;
    value.pages[section]={total:totals[section]!,offset,nextOffset:null};
    if(q.section&&section!==q.section||q.lines&&section!=='intervals')continue;
    if(section==='employees'){
      value.employees=(await reader.query<WaitEmployee>(`SELECT * FROM (${employeeRows}) AS employees ORDER BY "employeeId" LIMIT 100 OFFSET $2`,[q.version,offset])).rows;
    }else if(section==='intervals'&&q.lines){
      value.intervals=(await reader.query<{value:WaitsPage['intervals'][number]}>(`SELECT value FROM wait_revisions
        CROSS JOIN LATERAL jsonb_array_elements(payload->'intervals') WITH ORDINALITY AS items(value,ordinal)
        WHERE version=$1 AND (value->>'displayLine')::integer=ANY($2::integer[])
        AND ($3::uuid IS NULL OR (value->>'snapshotId')::uuid=$3) ORDER BY ordinal`,[q.version,q.lines.split(',').map(Number),q.contextSnapshotId??null])).rows.map(row=>row.value);
      value.pages.intervals.total=value.intervals.length;
    }else{
      const limit=section==='intervals'?25:100;
      const row=(await reader.query(`SELECT jsonb_path_query_array(payload,$2::jsonpath) AS items FROM wait_revisions WHERE version=$1`,[q.version,`$.${section}[${offset} to ${offset+limit-1}]`])).rows[0];
      if(!row)throw new HttpError(503,'等待记录版本不可读取');
      (value[section] as unknown[])=row.items;
    }
  }
  function describe(){
    for(const section of waitSections){const page=value.pages[section],end=page.offset+value[section]!.length;page.nextOffset=end<page.total?end:null;}
    value.nextOffset=q.lines?null:value.pages.intervals.nextOffset;
  }
  const fits=()=>{
    const text=JSON.stringify(value);
    return Buffer.byteLength(text)<=32*1024&&Buffer.byteLength(JSON.stringify({content:[{type:'text',text}]}))<=48*1024;
  };
  describe();
  while(!fits()){
    const removable=waitSections.filter(section=>value[section]!.length>(section===selected?1:0)&&!(q.lines&&section==='intervals'));
    const section=removable.sort((a,b)=>Number(a===selected)-Number(b===selected)||Buffer.byteLength(JSON.stringify(value[b]))-Buffer.byteLength(JSON.stringify(value[a])))[0];
    if(!section)throw new HttpError(413,`等待版本 ${value.version} 的 ${selected} 第 ${q.offset} 项超过读取上限，请下载完整版本`);
    value[section]!.pop();describe();
  }
  return value;
}
