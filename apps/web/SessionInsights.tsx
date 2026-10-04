import { useEffect,useRef,useState } from 'react';
import { promptElementLabels,taskTypeLabels,insightArrays,type InsightSection,type InsightCitation,type SessionInsightsPage as Insights } from '../../packages/contracts/session-insights.js';
import { evidenceLink } from '../../packages/contracts/search.js';
import './session-insights.css';
import {InferenceCorrections} from './InferenceCorrections.js';
const states:Record<Insights['state'],string>={unavailable:'尚未分析',pending:'分析中',failed:'分析失败',legacy:'待生成新版分析',stale:'输入已更新',partial:'部分完成',complete:'已完成'};
function Evidence({citations,total=citations.length,children}:{citations:InsightCitation[];total?:number;children?:React.ReactNode}){
  return <details className="insight-evidence"><summary>原文 · {total}</summary>{citations.map((cite,index)=><div key={index}><a href={evidenceLink(cite.inputSnapshotId,cite.inputLocation)}>第 {cite.inputLocation.kind==='event'?cite.inputLocation.line:'原件'} 行</a><q>{cite.quote}</q>{cite.snapshotId!==cite.inputSnapshotId&&<a href={cite.webPath}>来源会话</a>}</div>)}{children}</details>;
}
export function SessionInsights({snapshotId,request,analysisRefresh=0}:{snapshotId:string;request:(path:string,signal?:AbortSignal,method?:'POST',body?:unknown)=>Promise<Response>;analysisRefresh?:number}){
  const [data,setData]=useState<Insights|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const [hash,setHash]=useState(location.hash);
  const [busy,setBusy]=useState<Partial<Record<InsightSection,boolean>>>({});
  const paging=useRef<{generation:number;abort:AbortController|null;running:Set<InsightSection>}>({generation:0,abort:null,running:new Set()});
  useEffect(()=>{const changed=()=>setHash(location.hash);addEventListener('hashchange',changed);return()=>removeEventListener('hashchange',changed);},[]);
  const fixedVersion=new URLSearchParams(hash.split('?')[1]??'').get('insightVersion');
  const selection=snapshotId+':'+(fixedVersion??'current'),loadedSelection=useRef(selection);
  useEffect(()=>{const abort=new AbortController();paging.current={generation:paging.current.generation+1,abort,running:new Set()};setBusy({});let timer:ReturnType<typeof setTimeout>|undefined;if(loadedSelection.current!==selection){setData(null);loadedSelection.current=selection;}setError('');
    const read=async()=>{try{const value=await(await request(`/api/snapshots/${snapshotId}/insights${fixedVersion?'?version='+encodeURIComponent(fixedVersion):''}`,abort.signal)).json();if(abort.signal.aborted)return;setData(value);if(value.state==='pending'&&!fixedVersion)timer=setTimeout(read,1500);}catch(failure){if(!abort.signal.aborted)setError((failure as Error).message);}};
    void read();return()=>{abort.abort();clearTimeout(timer);};},[snapshotId,refresh,analysisRefresh,fixedVersion]);
  async function more(section:InsightSection){
    const view=data,context=paging.current,offset=view?.pages[section].nextOffset;
    if(!view||offset==null||context.running.has(section)||!context.abort||context.abort.signal.aborted)return;
    context.running.add(section);setBusy(previous=>({...previous,[section]:true}));setError('');
    try{
      const value:Insights=await(await request(`/api/snapshots/${snapshotId}/insights?`+new URLSearchParams({version:view.version,section,offset:String(offset)}),context.abort.signal)).json();
      if(context.abort.signal.aborted||context.generation!==paging.current.generation)return;
      if(value.version!==view.version||value.snapshotId!==view.snapshotId||value.pages[section].offset!==offset)throw new Error('洞察分页版本不一致，请刷新');
      setData(previous=>{if(!previous||previous.version!==view.version||previous.pages[section].nextOffset!==offset)return previous;
        const next=structuredClone(previous);insightArrays(next)[section].push(...insightArrays(value)[section]);next.pages[section]={...value.pages[section],offset:0};return next;});
    }catch(failure){if(!context.abort.signal.aborted&&context.generation===paging.current.generation)setError((failure as Error).message);}
    finally{context.running.delete(section);if(context.generation===paging.current.generation)setBusy(previous=>({...previous,[section]:false}));}
  }
  const total=(section:InsightSection)=>data?.pages[section].total??0;
  const continuation=(section:InsightSection,label:string)=>data?.pages[section].nextOffset!=null?<button className="insight-more" type="button" disabled={busy[section]} onClick={()=>void more(section)}>{label}</button>:null;
  const inferences=data?.inferences;
  return <section className="session-insights" aria-label="会话洞察"><header><h2>会话洞察</h2><button type="button" aria-label="刷新会话洞察" onClick={()=>setRefresh(value=>value+1)}>↻</button></header>
    {error&&<p role="alert">{error}</p>}{!data?<p role="status">正在读取…</p>:<>
      <div className="insight-status"><span>{data.sourceAvailability?'原件不可读取':states[data.state]}{total('appliedCorrections')?' · 已更正':''}</span>{inferences&&<strong>{taskTypeLabels[inferences.taskType.value]}</strong>}</div>
      <dl className="insight-counts">{([['已验证',data.metrics.verified],['仅声称',data.metrics.claimed],['返工',data.metrics.rework],['追问',data.metrics.clarifications]] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value===null?(data.sourceAvailability?'未知':'未完成'):value}</dd></div>)}</dl>
      <InferenceCorrections key={selection} view={data} request={request} fixed={!!fixedVersion} onUpdated={()=>setRefresh(value=>value+1)} promptContinuation={continuation('prompts','更多可更正提示词')}/>
      {inferences&&<>
        <details><summary>任务类型 · {inferences.taskType.correctionId?'人工更正':'模型推断'}</summary><p>{taskTypeLabels[inferences.taskType.value]}</p><Evidence citations={inferences.taskType.citations}/></details>
        <details><summary>提示词 · {total('prompts')}</summary><div className="insight-items">{inferences.prompts.map((prompt,index)=><article key={prompt.event}><h3>{prompt.first?'首条提示词':`提示词 ${index+1}`}{prompt.rework&&<span className="insight-tag">返工</span>}{prompt.corrections&&<span className="insight-tag">人工更正</span>}</h3><dl className="insight-elements">{Object.entries(promptElementLabels).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{prompt.elements[key as keyof typeof prompt.elements]===null?'未知':prompt.elements[key as keyof typeof prompt.elements]?'有':'无'}</dd></div>)}</dl><Evidence citations={prompt.citations}/></article>)}</div>{continuation('prompts','更多提示词')}</details>
        <details><summary>Agent 回复 · {total('replies')}</summary>{inferences.replies.map((reply,index)=><article key={reply.event}><h3>回复 {index+1}<span>{reply.clarification===null?'追问未知':reply.clarification?'追问':'无追问'}</span></h3><Evidence citations={reply.citations}/></article>)}{continuation('replies','更多 Agent 回复')}</details>
        <details><summary>会话内成果 · {total('outcomes')}</summary>{inferences.outcomes.map((outcome,index)=><article key={index}><h3>{outcome.status==='verified'?'已验证':outcome.status==='claimed'?'仅声称':'模型推断'}</h3><p>{outcome.text}</p><Evidence citations={outcome.citations}/></article>)}{continuation('outcomes','更多会话内成果')}</details>
        {total('suggestions')>0&&<details><summary>写法建议 · 模型推断</summary>{inferences.suggestions.map((suggestion,index)=><article key={index}><p>{suggestion.text}</p><Evidence citations={suggestion.citations}/></article>)}{continuation('suggestions','更多写法建议')}</details>}
      </>}
      <details><summary>原件产出</summary>{([['代码变更行','codeChanges'],['测试运行','tests'],['会话内提交','commits']] as const).map(([label,key])=>{const fact=data.facts[key],evidence=`${key}Evidence` as InsightSection,contributions=`${key}Contributions` as InsightSection;return <article key={key}><h3>{label}<span>{fact.value===null?'未知':`${fact.value}${fact.complete?'':'（已知部分）'}`}</span></h3>{fact.passed!==undefined&&<p>通过 {fact.passed} · 失败 {fact.failed}</p>}{fact.added!==undefined&&<p>新增 {fact.added} · 删除 {fact.removed}</p>}{total(evidence)>0&&<Evidence citations={fact.evidence} total={total(evidence)}>{continuation(evidence,`更多${label}原文`)}</Evidence>}
        {total(contributions)>0&&<details className="insight-contributions"><summary>计数来源 · {total(contributions)}</summary>{fact.contributions.map(row=><div key={row.eventId}><a href={'#'+row.snapshotId}>{row.sourceDate??'来源日期未知'} · {row.value}</a><code title={row.eventId}>{row.eventId.slice(0,12)}</code></div>)}{continuation(contributions,`更多${label}计数来源`)}</details>}</article>;})}</details>
      {data.analysisVersion&&<details><summary>分析版本 · {data.analysisVersion.generation}</summary><dl className="insight-version"><div><dt>任务</dt><dd>{data.analysisVersion.id}</dd></div><div><dt>提示词</dt><dd>{data.analysisVersion.prompt}</dd></div><div><dt>输入</dt><dd>{data.input.hash}</dd></div></dl></details>}
    </>}
  </section>;
}
