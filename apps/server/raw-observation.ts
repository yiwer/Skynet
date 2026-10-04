import {AsyncLocalStorage} from 'node:async_hooks';

type Outcome='available'|'missing'|'unreadable'|'hash-mismatch';
type Entry={device:string;hash:string;outcome:Outcome};
type Scope={entries:Map<string,Entry>;bytes:number;overflow:boolean;mixed:boolean;sealed:boolean;parent?:Scope};

/** Observe identity and outcomes only. Bytes are never retained. Each async
 * scope belongs to one RawStore instance and can also feed an enclosing scope. */
export class RawObservations {
  private current=new AsyncLocalStorage<Scope>();
  record(device:string,hash:string,outcome:Outcome){
    for(let scope=this.current.getStore();scope;scope=scope.parent){
      if(scope.sealed||scope.overflow)continue;
      const key=JSON.stringify([device,hash]),previous=scope.entries.get(key);
      if(previous){if(previous.outcome!==outcome)scope.mixed=true;continue;}
      const bytes=Buffer.byteLength(key)+32;
      if(scope.entries.size>=20000||scope.bytes+bytes>4*1024*1024){scope.overflow=true;scope.entries.clear();continue;}
      scope.entries.set(key,{device,hash,outcome});scope.bytes+=bytes;
    }
  }
  async capture<T>(read:()=>Promise<T>){
    const scope:Scope={entries:new Map(),bytes:0,overflow:false,mixed:false,sealed:false,parent:this.current.getStore()};
    try{
      const value=await this.current.run(scope,read);scope.sealed=true;
      return {value,overflow:scope.overflow,verify:async(check:(device:string,hash:string)=>Promise<Outcome>)=>{
        if(scope.overflow||scope.mixed)return false;
        const entries=[...scope.entries.values()];let next=0,stable=true;
        await Promise.all(Array.from({length:Math.min(4,entries.length)},async()=>{
          while(next<entries.length){const entry=entries[next++]!;if(await check(entry.device,entry.hash)!==entry.outcome)stable=false;}
        }));
        return stable;
      },close:()=>scope.entries.clear()};
    }catch(error){scope.sealed=true;scope.entries.clear();throw error;}
  }
}
