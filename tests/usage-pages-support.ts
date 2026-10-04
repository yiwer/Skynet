import assert from 'node:assert/strict';

// Read only public pages. This reconstruction is also the compatibility oracle
// for the unchanged, complete fixed export; no database or private service reads.
export const sections=['sessions','employees','daily','dailyOutputs','employeeDaily','employeeActiveDates','employeeUnknownReasons','unknownReasons'] as const;
export async function collectUsage(head:any,read:(section:string,offset:number)=>Promise<any>){
  const collections:Record<string,any[]>={};
  for(const section of sections){
    let page=head.pages[section].offset===0?head:await read(section,0),rows:any[]=[];
    for(;;){
      assert.equal(page.version,head.version);assert.equal(page.pages[section].total,head.pages[section].total);
      assert.equal(page.pages[section].offset,rows.length);rows.push(...page[section]);
      const next=page.pages[section].nextOffset;
      if(next===null)break;
      assert.equal(next,rows.length);assert.ok(page[section].length>0||page===head,'requested page must make progress');
      page=await read(section,next);
    }
    assert.equal(rows.length,head.pages[section].total);collections[section]=rows;
  }
  const {readingVersion,pages,employeeDaily,employeeActiveDates,employeeUnknownReasons,...header}=head;
  const {employeeDaily:days,employeeActiveDates:dates,employeeUnknownReasons:reasons,...top}=collections;
  return {...header,...top,nextOffset:null,employees:collections.employees!.map(person=>({...person,
    daily:days!.filter(day=>day.employeeId===person.employeeId).map(({employeeId,...day})=>day),
    activeDates:dates!.filter(day=>day.employeeId===person.employeeId).map(day=>day.date),
    unknownReasons:reasons!.filter(reason=>reason.employeeId===person.employeeId).map(reason=>reason.reason)}))};
}
