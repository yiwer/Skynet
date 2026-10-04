import {usageSections,type UsageOutputPage,type UsageReadingPage,type UsageQuery} from '../../packages/contracts/usage-output.js';
import {HttpError} from './identities.js';

/** Transport only: never use these partial collections as reporting inputs. */
export function usagePage(stored:UsageOutputPage,q:UsageQuery):UsageReadingPage{
  const {employees,...header}=stored;
  const arrays={sessions:stored.sessions,employees:employees.map(({daily,activeDates,unknownReasons,...summary})=>summary),
    daily:stored.daily,dailyOutputs:stored.dailyOutputs??[],
    employeeDaily:employees.flatMap(person=>person.daily.map(day=>({employeeId:person.employeeId,...day}))),
    employeeActiveDates:employees.flatMap(person=>person.activeDates.map(date=>({employeeId:person.employeeId,date}))),
    employeeUnknownReasons:employees.flatMap(person=>(person.unknownReasons??[]).map(reason=>({employeeId:person.employeeId,reason}))),
    unknownReasons:stored.unknownReasons};
  const page:UsageReadingPage={...header,...arrays,readingVersion:'usage-page-1',pages:{} as UsageReadingPage['pages']};
  const selected=q.section??'sessions';
  for(const section of usageSections){
    const total=arrays[section].length,offset=section===selected?q.offset:0;
    if(offset>total)throw new HttpError(400,'产出分页位置超出范围');
    const count=q.section&&section!==selected?0:section==='sessions'?20:100;
    // Each page owns its slices; the immutable full value is never mutated.
    (page[section] as unknown[])=arrays[section].slice(offset,offset+count);
    page.pages[section]={total,offset,nextOffset:offset+page[section]!.length<total?offset+page[section]!.length:null};
  }
  const sync=()=>{page.nextOffset=page.pages.sessions.nextOffset;};
  const fits=()=>{sync();const text=JSON.stringify(page);return Buffer.byteLength(text)<=32*1024&&Buffer.byteLength(JSON.stringify({content:[{type:'text',text}]}))<=48*1024;};
  while(!fits()){
    const section=usageSections.filter(key=>page[key]!.length>(key===selected?1:0))
      .sort((a,b)=>Buffer.byteLength(JSON.stringify(page[b]))-Buffer.byteLength(JSON.stringify(page[a])))[0];
    if(!section)throw new HttpError(413,`产出单项超过分页上限：版本 ${stored.version}，${selected} 第 ${q.offset} 项；完整版本仍可导出核查`);
    page[section]!.pop();page.pages[section].nextOffset=page.pages[section].offset+page[section]!.length;
  }
  return page;
}
