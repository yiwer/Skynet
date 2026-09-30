import {useEffect,useRef,useState} from 'react';

/** Owns just a selected evidence scope: load, fixed pages, retry and polling.
 * A transport may resolve after abort; both the scope and operation must still
 * match before it can change data, errors or loading. */
export function useFixedRevisionReader<T>({identity,load,enabled=true,poll}:{identity:string;
  load:(signal:AbortSignal)=>Promise<T>;enabled?:boolean;poll?:(value:T)=>boolean}){
  const current=useRef({identity,enabled,load,poll});current.current={identity,enabled,load,poll};
  const operation=useRef<{scope:string;abort:AbortController}|undefined>(undefined);
  const [refresh,setRefresh]=useState(0);
  const [state,setState]=useState<{scope:string;data:T|null;error:string;loading:boolean}>({scope:identity,data:null,error:'',loading:enabled});
  const visible=state.scope===identity?state:{scope:identity,data:null,error:'',loading:enabled};
  async function run(read:(signal:AbortSignal)=>Promise<T>,retain=true){
    operation.current?.abort.abort();const owned={scope:identity,abort:new AbortController()};operation.current=owned;
    const active=()=>operation.current===owned&&current.current.identity===owned.scope&&current.current.enabled&&!owned.abort.signal.aborted;
    setState(previous=>({scope:identity,data:retain&&previous.scope===identity?previous.data:null,error:'',loading:true}));
    try{const data=await read(owned.abort.signal);if(!active())return false;setState({scope:identity,data,error:'',loading:false});return true;}
    catch(failure){if(active())setState(previous=>({...previous,error:(failure as Error).message,loading:false}));return false;}
  }
  useEffect(()=>{
    if(enabled)void run(signal=>current.current.load(signal),false);
    else{operation.current?.abort.abort();setState({scope:identity,data:null,error:'',loading:false});}
    return()=>operation.current?.abort.abort();
  },[identity,enabled,refresh]);
  useEffect(()=>{
    if(!visible.data||visible.loading||!enabled||!current.current.poll?.(visible.data))return;
    const timer=setTimeout(()=>setRefresh(value=>value+1),5000);return()=>clearTimeout(timer);
  },[identity,enabled,visible.data,visible.loading]);
  function replace(data:T){if(current.current.identity!==identity)return;operation.current?.abort.abort();setState({scope:identity,data,error:'',loading:false});}
  return {...visible,run,replace,retry:()=>setRefresh(value=>value+1)};
}
