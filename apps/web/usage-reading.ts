import {usageSections,type UsageOutputPage,type UsageReadingPage,type UsageSection} from '../../packages/contracts/usage-output.js';

/** Assemble one immutable transport revision; aborted/late pages never publish. */
export async function readUsageCollections(head:UsageReadingPage,read:(section:UsageSection,offset:number)=>Promise<UsageReadingPage>,signal:AbortSignal):Promise<UsageOutputPage>{
  const arrays={} as Record<UsageSection,unknown[]>;
  for(const section of usageSections){
    let page=head.pages[section].offset===0?head:await read(section,0),rows:unknown[]=[];
    for(;;){
      signal.throwIfAborted();
      const meta=page.pages[section];
      if(page.version!==head.version||meta.total!==head.pages[section].total||meta.offset!==rows.length)throw new Error('用量版本已变化，请刷新');
      const values=page[section]??[];rows.push(...values);
      if(meta.nextOffset===null){if(rows.length!==meta.total)throw new Error('用量分页尚未完整');break;}
      if(meta.nextOffset!==rows.length||(!values.length&&page!==head))throw new Error('用量分页未能继续');
      page=await read(section,meta.nextOffset);
    }
    arrays[section]=rows;
  }
  const {readingVersion,pages,employeeDaily,employeeActiveDates,employeeUnknownReasons,...header}=head;
  const employees=(arrays.employees as UsageReadingPage['employees']).map(person=>({...person,
    daily:(arrays.employeeDaily as UsageReadingPage['employeeDaily']).filter(day=>day.employeeId===person.employeeId).map(({employeeId,...day})=>day),
    activeDates:(arrays.employeeActiveDates as UsageReadingPage['employeeActiveDates']).filter(day=>day.employeeId===person.employeeId).map(day=>day.date),
    unknownReasons:(arrays.employeeUnknownReasons as UsageReadingPage['employeeUnknownReasons']).filter(reason=>reason.employeeId===person.employeeId).map(reason=>reason.reason)}));
  return {...header,employees,sessions:arrays.sessions as UsageOutputPage['sessions'],daily:arrays.daily as UsageOutputPage['daily'],
    dailyOutputs:arrays.dailyOutputs as UsageOutputPage['dailyOutputs'],unknownReasons:arrays.unknownReasons as string[],nextOffset:null};
}
