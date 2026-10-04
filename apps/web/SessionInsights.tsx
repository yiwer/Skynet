import { useEffect,useState } from 'react';
import { promptElementLabels,taskTypeLabels,type InsightCitation,type SessionInsights as Insights } from '../../packages/contracts/session-insights.js';
import { evidenceLink } from '../../packages/contracts/search.js';
import './session-insights.css';
import {InferenceCorrections} from './InferenceCorrections.js';
const states:Record<Insights['state'],string>={unavailable:'尚未分析',pending:'分析中',failed:'分析失败',legacy:'待生成新版分析',stale:'输入已更新',partial:'部分完成',complete:'已完成'};
function Evidence({citations}:{citations:InsightCitation[]}){
  return <details className="insight-evidence"><summary>原文 · {citations.length}</summary>{citations.map((cite,index)=><div key={index}><a href={evidenceLink(cite.inputSnapshotId,cite.inputLocation)}>第 {cite.inputLocation.kind==='event'?cite.inputLocation.line:'原件'} 行</a><q>{cite.quote}</q>{cite.snapshotId!==cite.inputSnapshotId&&<a href={cite.webPath}>来源会话</a>}</div>)}</details>;
}
export function SessionInsights({snapshotId,request,analysisRefresh=0}:{snapshotId:string;request:(path:string,signal?:AbortSignal,method?:'POST',body?:unknown)=>Promise<Response>;analysisRefresh?:number}){
  const [data,setData]=useState<Insights|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const [hash,setHash]=useState(location.hash);
  useEffect(()=>{const changed=()=>setHash(location.hash);addEventListener('hashchange',changed);return()=>removeEventListener('hashchange',changed);},[]);
  const fixedVersion=new URLSearchParams(hash.split('?')[1]??'').get('insightVersion');
  useEffect(()=>{const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;setData(null);setError('');
    const read=async()=>{try{const value=await(await request(`/api/snapshots/${snapshotId}/insights${fixedVersion?'?version='+encodeURIComponent(fixedVersion):''}`,abort.signal)).json();if(abort.signal.aborted)return;setData(value);if(value.state==='pending'&&!fixedVersion)timer=setTimeout(read,1500);}catch(failure){if(!abort.signal.aborted)setError((failure as Error).message);}};
    void read();return()=>{abort.abort();clearTimeout(timer);};},[snapshotId,refresh,analysisRefresh,fixedVersion]);
  const inferences=data?.inferences;
  return <section className="session-insights" aria-label="会话洞察"><header><h2>会话洞察</h2><button type="button" aria-label="刷新会话洞察" onClick={()=>setRefresh(value=>value+1)}>↻</button></header>
    {error?<p role="alert">{error}</p>:!data?<p role="status">正在读取…</p>:<>
      <div className="insight-status"><span>{states[data.state]}{data.corrections?.appliedIds.length?' · 已更正':''}</span>{inferences&&<strong>{taskTypeLabels[inferences.taskType.value]}</strong>}</div>
      <dl className="insight-counts">{([['已验证',data.metrics.verified],['仅声称',data.metrics.claimed],['返工',data.metrics.rework],['追问',data.metrics.clarifications]] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value===null?'未完成':value}</dd></div>)}</dl>
      <InferenceCorrections key={data.version} view={data} request={request} fixed={!!fixedVersion} onUpdated={()=>setRefresh(value=>value+1)}/>
      {inferences&&<>
        <details><summary>任务类型 · {inferences.taskType.correctionId?'人工更正':'模型推断'}</summary><p>{taskTypeLabels[inferences.taskType.value]}</p><Evidence citations={inferences.taskType.citations}/></details>
        <details><summary>提示词 · {inferences.prompts.length}</summary><div className="insight-items">{inferences.prompts.map((prompt,index)=><article key={prompt.event}><h3>{prompt.first?'首条提示词':`提示词 ${index+1}`}{prompt.rework&&<span className="insight-tag">返工</span>}{prompt.corrections&&<span className="insight-tag">人工更正</span>}</h3><dl className="insight-elements">{Object.entries(promptElementLabels).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{prompt.elements[key as keyof typeof prompt.elements]===null?'未知':prompt.elements[key as keyof typeof prompt.elements]?'有':'无'}</dd></div>)}</dl><Evidence citations={prompt.citations}/></article>)}</div></details>
        <details><summary>Agent 追问 · {inferences.replies.filter(reply=>reply.clarification).length}</summary>{inferences.replies.filter(reply=>reply.clarification).map(reply=><Evidence key={reply.event} citations={reply.citations}/>)}</details>
        <details><summary>会话内成果 · {inferences.outcomes.length}</summary>{inferences.outcomes.map((outcome,index)=><article key={index}><h3>{outcome.status==='verified'?'已验证':outcome.status==='claimed'?'仅声称':'模型推断'}</h3><p>{outcome.text}</p><Evidence citations={outcome.citations}/></article>)}</details>
        {inferences.suggestions.length>0&&<details><summary>写法建议 · 模型推断</summary>{inferences.suggestions.map((suggestion,index)=><article key={index}><p>{suggestion.text}</p><Evidence citations={suggestion.citations}/></article>)}</details>}
      </>}
      <details><summary>原件产出</summary>{([['代码变更行',data.facts.codeChanges],['测试运行',data.facts.tests],['会话内提交',data.facts.commits]] as const).map(([label,fact])=><article key={label}><h3>{label}<span>{fact.value===null?'未知':`${fact.value}${fact.complete?'':'（已知部分）'}`}</span></h3>{fact.passed!==undefined&&<p>通过 {fact.passed} · 失败 {fact.failed}</p>}{fact.added!==undefined&&<p>新增 {fact.added} · 删除 {fact.removed}</p>}{fact.evidence.length>0&&<Evidence citations={fact.evidence}/>}</article>)}</details>
      {data.analysisVersion&&<details><summary>分析版本 · {data.analysisVersion.generation}</summary><dl className="insight-version"><div><dt>任务</dt><dd>{data.analysisVersion.id}</dd></div><div><dt>提示词</dt><dd>{data.analysisVersion.prompt}</dd></div><div><dt>输入</dt><dd>{data.input.hash}</dd></div></dl></details>}
    </>}
  </section>;
}
