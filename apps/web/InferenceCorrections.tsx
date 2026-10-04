import {useEffect,useState} from 'react';
import {taskTypes,taskTypeLabels,promptElementLabels,type SessionInsights} from '../../packages/contracts/session-insights.js';
import type {InferenceCorrection,InferenceCorrectionPage} from '../../packages/contracts/inference-corrections.js';
type Request=(path:string,signal?:AbortSignal,method?:'POST',body?:unknown)=>Promise<Response>;
const judgment=(value:boolean|null)=>value===null?'未知':value?'有':'无';
function formatted(value:InferenceCorrection['previous']){
  if(value===null||typeof value==='boolean')return judgment(value);
  if(typeof value==='string')return taskTypeLabels[value];
  return Object.entries(promptElementLabels).map(([key,label])=>label+' '+judgment(value[key as keyof typeof value])).join(' · ');
}
export function InferenceCorrections({view,request,fixed,onUpdated,promptContinuation}:{view:SessionInsights;request:Request;fixed:boolean;onUpdated:()=>void;promptContinuation?:React.ReactNode}){
  const [target,setTarget]=useState('task-type'),[task,setTask]=useState(view.inferences?.taskType.value??'unknown'),[elements,setElements]=useState({goal:null as boolean|null,constraints:null as boolean|null,context:null as boolean|null,acceptance:null as boolean|null}),[rework,setRework]=useState<boolean|null>(null);
  const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[history,setHistory]=useState<InferenceCorrectionPage>();
  const [base,setBase]=useState(view),[dirty,setDirty]=useState(false),[open,setOpen]=useState(false);
  const path=`/api/snapshots/${view.snapshotId}/inference-corrections`;
  useEffect(()=>{const abort=new AbortController();setHistory(undefined);if(view.corrections)request(path+'?version='+view.version,abort.signal).then(r=>r.json()).then(value=>{if(!abort.signal.aborted)setHistory(value);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[view.version]);
  useEffect(()=>{if(!dirty&&!busy){setBase(view);setTarget('task-type');setTask(view.inferences?.taskType.value??'unknown');}},[view.version,dirty,busy]);
  // Loading another page of the same immutable version expands the selector
  // without resetting a draft or adopting a newly published correction base.
  useEffect(()=>{if(view.version===base.version)setBase(view);},[view,base.version]);
  const conflict=dirty&&base.version!==view.version;
  const prompt=base.inferences?.prompts.find(prompt=>prompt.event===Number(target.split(':')[1]));
  const eventId=prompt?.citations.find(cite=>cite.event===prompt.event&&cite.role==='user')?.origin?.eventId;
  const currentPrompt=eventId?view.inferences?.prompts.find(prompt=>prompt.citations.some(cite=>cite.event===prompt.event&&cite.role==='user'&&cite.origin?.eventId===eventId)):undefined;
  const currentValue=target==='task-type'?view.inferences?.taskType.value:target.startsWith('prompt-elements:')?currentPrompt?.elements:currentPrompt?.rework;
  function choose(value:string){setDirty(true);setTarget(value);setError('');if(value==='task-type')setTask(base.inferences!.taskType.value);else{const prompt=base.inferences!.prompts.find(prompt=>prompt.event===Number(value.split(':')[1]))!;setElements({...prompt.elements});setRework(prompt.rework);}}
  function acceptCurrent(){if(currentValue===undefined||busy)return;if(target!=='task-type')setTarget(target.split(':')[0]+':'+currentPrompt!.event);setBase(view);setError('');}
  async function submit(event:React.FormEvent){event.preventDefault();if(busy||base.version!==view.version||!reason.trim())return;setBusy(true);setError('');
    const [kind,eventNumber]=target.split(':'),value=kind==='task-type'?task:kind==='prompt-elements'?elements:rework;
    try{await request(path,undefined,'POST',{requestId:crypto.randomUUID(),expectedVersion:base.version,kind,value,reason,...(eventNumber?{promptEvent:Number(eventNumber)}:{})});setDirty(false);setReason('');setOpen(false);onUpdated();}
    catch(failure){setError((failure as Error).message);onUpdated();}finally{setBusy(false);}
  }
  return <div className="inference-corrections">
    {fixed&&<a className="inference-current" href={'#'+view.snapshotId}>查看当前洞察</a>}
    {!fixed&&base.inferences&&<details open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>更正推断</summary><form onSubmit={submit} aria-label="更正推断表单">
      {conflict&&<div className="inference-conflict"><p role="alert">洞察已更新，草稿已保留。</p><p>{currentValue===undefined?'新版未提供对应判断，请选择其他字段。':'当前：'+formatted(currentValue)}</p><button type="button" disabled={busy||currentValue===undefined} onClick={acceptCurrent}>核对新版后继续</button></div>}
      <label>更正字段<select value={target} onChange={event=>choose(event.target.value)} disabled={busy}><option value="task-type">任务类型</option>{base.inferences.prompts.map((prompt,index)=><optgroup key={prompt.event} label={`提示词 ${index+1}`}><option value={'prompt-elements:'+prompt.event}>提示词 {index+1} · 要素</option><option value={'rework:'+prompt.event}>提示词 {index+1} · 返工</option></optgroup>)}</select></label>
      {promptContinuation}
      {target==='task-type'?<label>新任务类型<select value={task} disabled={busy} onChange={event=>{setDirty(true);setTask(event.target.value as typeof task);}}>{taskTypes.map(type=><option key={type} value={type}>{taskTypeLabels[type]}</option>)}</select></label>
        :target.startsWith('prompt-elements:')?<div className="inference-edit-elements">{Object.entries(promptElementLabels).map(([key,label])=><label key={key}>{label}判定<select aria-label={label+'判定'} disabled={busy} value={String(elements[key as keyof typeof elements])} onChange={event=>{setDirty(true);setElements(previous=>({...previous,[key]:event.target.value==='null'?null:event.target.value==='true'}));}}><option value="null">未知</option><option value="true">有</option><option value="false">无</option></select></label>)}</div>
        :<label>返工判定<select aria-label="返工判定" disabled={busy} value={String(rework)} onChange={event=>{setDirty(true);setRework(event.target.value==='null'?null:event.target.value==='true');}}><option value="null">未知</option><option value="true">有</option><option value="false">无</option></select></label>}
      <label>更正原因<textarea value={reason} onChange={event=>{setDirty(true);setReason(event.target.value);}} maxLength={1000} required disabled={busy}/></label>
      <button type="submit" disabled={busy||conflict||!reason.trim()}>{busy?'正在保存…':'保存更正'}</button>
    </form></details>}
    {error&&<p role="alert">{error}</p>}
    {view.corrections&&<details><summary>更正历史</summary><div aria-label="推断更正历史">{history?.corrections.map(row=><article key={row.id}>
      <h3>{row.kind==='task-type'?'任务类型':row.kind==='prompt-elements'?'提示词要素':'返工判定'}</h3><p>{formatted(row.previous)} → {formatted(row.value)}</p>
      <p>{row.reason}</p><p className="inference-audit-author">{row.actor} · {new Date(row.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</p>
      <div className="inference-audit-links"><a href={'#'+row.snapshotId+'?insightVersion='+row.insightVersion}>更正前洞察</a>{row.evidence.slice(0,1).map((cite,index)=><a key={index} href={cite.webPath}>原句证据</a>)}</div>
    </article>)}{history?.nextOffset!=null&&<button onClick={async()=>{try{const next=await(await request(path+'?version='+history.version+'&offset='+history.nextOffset)).json();setHistory(previous=>({...next,corrections:[...previous!.corrections,...next.corrections]}));}catch(failure){setError((failure as Error).message);}}}>更多更正</button>}</div></details>}
  </div>;
}
