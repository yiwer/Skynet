import { useEffect, useState, type ReactNode } from 'react';
import type { Manifest } from '../../packages/contracts/archive.js';
import { sourceLabel } from '../../packages/contracts/archive.js';
import type { ActivityEvent, ActivitySummary, ActivityContext } from '../../packages/activity.js';
import type { Provenance } from '../../packages/contracts/provenance.js';
import type { Coverage } from './CaptureCoverage.js';
import { CaptureCoverage } from './CaptureCoverage.js';
import { HistoryMaterials } from './HistoryMaterials.js';
import { SessionAnalysis } from './SessionAnalysis.js';
import { ActivityStatistics } from './ActivityStatistics.js';
import { QualificationProof } from './QualificationProof.js';
import { ConversationReader, conversationSelection } from './ConversationReader.js';
import { EvidenceReader } from './EvidenceReader.js';
import type { selectedEvidence } from './EvidenceReader.js';
import type { MetricTotals } from '../../packages/contracts/metrics.js';
export type Detail = { snapshotId:string; employee:string; manifest:Manifest; committedAt:string; events:ActivityEvent[]; activity:ActivitySummary;
 unrecognizedLines:number; partialLine:boolean; nextOffset:number|null; total:number; captureHealth:Coverage; provenance:Provenance;
 recovery:{nativeRuntimeVersion:string|null; preparation:string; nativeBackend:string; limitation:string} };
const date=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const contextLabel:Record<ActivityContext,string>={historical:'历史上下文','after-enrollment':'接入后活动','unknown-time':'来源时间未知','unknown-enrollment':'接入边界未知'};
type Props={detail:Detail;reading:'conversation'|'timeline'|'raw'; conversationHash:string;refresh:number;offset:number;
 evidenceLocation:ReturnType<typeof selectedEvidence>;setOffset:(value:number|((old:number)=>number))=>void;
 request:(path:string,signal?:AbortSignal,method?:'POST',body?:unknown)=>Promise<Response>;
 download:(kind:'raw'|'readable'|'recovery')=>Promise<void>;exporting:boolean;exportStatus:string;exportError:string};
function SessionFacts({snapshotId,request}:{snapshotId:string;request:Props['request']}) {
 const [totals,setTotals]=useState<MetricTotals|null>(null);const [error,setError]=useState('');
 useEffect(()=>{const abort=new AbortController();setTotals(null);setError('');request('/api/snapshots/'+snapshotId+'/metrics?period=since-enrollment',abort.signal).then(r=>r.json()).then(v=>{if(!abort.signal.aborted)setTotals(v.totals);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[snapshotId]);
 const value=(v:number|null|undefined)=>v==null?'未知':v.toLocaleString('zh-CN');
 return <section className="session-facts"><h2>会话数据</h2><dl>{[
   ['任务类型','未知'],['Token',totals?.inputTokens==null&&totals?.outputTokens==null?'未知':`${value(totals?.inputTokens)} / ${value(totals?.outputTokens)}`],
   ['提示词',totals?`${value(totals.userTurns)} 轮 · 返工未知`:'未知'],['工具调用',value(totals?.toolCalls)],['代码变更','未知'],['测试','未知'],['已验证','未知'],['产效比','未知'],['等待回复','未知'],
 ].map(([label,n])=><div key={label}><dt>{label}</dt><dd>{n==='未知'?<span className="session-unknown">未知</span>:n}</dd></div>)}</dl>{error&&<p role="alert">{error}</p>}<p className="muted small">原件中的已确认活动；未上报的用量及尚未分析的结果保留为未知。</p><h3 className="session-wait-heading">Agent 工作与等待</h3><div className="session-wait-unknown">尚无可确认的工作与等待区间</div></section>;
}
export function SessionDetail({detail,reading,conversationHash,refresh,offset,evidenceLocation,setOffset,request,download,exporting,exportStatus,exportError}:Props){
 const selected=detail.snapshotId;
 const [title,setTitle]=useState('');
 useEffect(()=>{setTitle('');},[selected]);
 useEffect(()=>{if(new URLSearchParams(conversationHash.split('?')[1]).get('recover')==='true')document.getElementById('session-recovery')?.scrollIntoView({block:'start'});},[conversationHash]);
 const heading=detail.manifest.project.replaceAll('\\','/').split('/').filter(Boolean).at(-1)||'未归类项目';
 const navigation:ReactNode=<nav className="reading-nav" aria-label="会话阅读方式">{([['conversation','对话视图'],['timeline','时间线'],['raw','原件 JSONL']] as const).map(([mode,label])=><a key={mode} aria-label={label} href={'#'+selected+'?view='+mode} aria-current={reading===mode?'page':undefined}>{mode==='conversation'?'对话':label}</a>)}</nav>;
 return <article className="session-detail" aria-label="会话详情">
 <div className="session-page-heading"><nav className="session-crumbs" aria-label="位置"><a href="#sessions">会话</a><span>/</span><span className="hash">{detail.manifest.sourceSessionId}</span></nav><div className="session-title-row"><div><h1>{title||heading}</h1><p>{detail.employee} · {heading} · {sourceLabel(detail.manifest.source)} · {detail.activity.sourceFrom?date(detail.activity.sourceFrom):'来源时间未知'}</p></div><a className="session-recover-button" href={'#recovery?snapshot='+selected}>找回此会话</a></div></div>
 <div className="session-meta"><span className="badge">原件已提交</span><span>{detail.total} 个已解析事件</span><span>固定快照</span><span className="session-native-id">原生 ID <span className="hash">{detail.manifest.sourceSessionId}</span></span><span>服务器接收 {date(detail.committedAt)}</span></div>
 <div className="session-columns"><section className="session-reading" aria-label="会话内容">
 {reading==='conversation'?<ConversationReader key={selected+':'+conversationHash+':'+refresh} snapshotId={selected} initial={conversationSelection(conversationHash)} request={request} navigation={navigation} onTitle={setTitle}/>:navigation}
 {reading==='raw'&&<EvidenceReader key={'raw:'+selected+':'+refresh} snapshotId={selected} location={{kind:'raw',line:1,textOffset:0}} request={request}/>}
 {reading==='timeline'&&evidenceLocation&&<EvidenceReader key={selected+':'+JSON.stringify(evidenceLocation)+':'+refresh} snapshotId={selected} location={evidenceLocation} request={request}/>}
          {reading === 'timeline' && <><p className="muted">共 {detail.total} 条已解析记录。消息只代表会话中记录的内容。</p>
          {detail.events.map(event => <section className="message" key={`${event.line}:${event.block ?? 0}`}><div className="message-meta"><strong>{event.role}</strong><span>{contextLabel[event.context]}</span><span>原件第 {event.line} 行 · 来源时间：{event.timestamp ? date(event.timestamp) : '未知'}</span></div>
            {event.origin && <p className="muted small">原始归属：{event.origin.employee} · {event.origin.project || '未归类项目'} · 设备 {event.origin.deviceId} · <a href={event.origin.webPath ?? `#${event.origin.snapshotId}`}>原始{event.origin.materialId ? '材料' : '快照'}第 {event.origin.line} 行</a></p>}<QualificationProof origin={event.origin} /><pre>{event.text}</pre></section>)}
          {!evidenceLocation && detail.events.length === 0 && <p>当前原件没有可解析的消息；可下载原件核查。</p>}
          {!evidenceLocation && <div className="pagination"><button disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 100))}>上一页</button><button disabled={detail.nextOffset === null} onClick={() => setOffset(detail.nextOffset ?? 0)}>下一页</button></div>}</>}
</section><aside className="session-side" aria-label="会话数据与存档"><SessionFacts snapshotId={selected} request={request}/><section><h2>组装与去重</h2><span className="badge">原件已提交</span><p>{detail.provenance.relation==='verified-restoration'?'已核对恢复来源与完整原件前缀。':detail.provenance.relation==='same-device-continuation'?'已核对同设备会话延续关系。':'跨设备关系未确认，保持独立原件。'}</p><p className="hash">{detail.manifest.sourceSessionId}</p><p className="muted small">{detail.manifest.byteLength.toLocaleString()} 字节 · {detail.manifest.capture?.materials.length??0} 项关联材料。原始归属与快照保持可追溯。</p></section><details className="session-archive-facts"><summary>原件与来源信息</summary><dl><div><dt>来源环境</dt><dd>{detail.manifest.sourceVersion} / {detail.manifest.sourceOs}</dd></div><div><dt>存档范围</dt><dd>{detail.manifest.byteLength.toLocaleString()} 字节 · {detail.manifest.capture?.materials.length??0} 项材料</dd></div><div><dt>SHA-256</dt><dd className="hash">{detail.manifest.hash}</dd></div></dl><button disabled={exporting} onClick={()=>download('raw')}>下载原件</button></details>          {(detail.unrecognizedLines > 0 || detail.partialLine) && <p className="notice">{detail.unrecognizedLines} 行未解析{detail.partialLine ? '，另有未闭合的末行' : ''}。全部字节仍保存在原件中。</p>}
          <HistoryMaterials key={detail.snapshotId} snapshotId={detail.snapshotId} capture={detail.manifest.capture} request={(path, signal) => request(path, signal)} />
          <CaptureCoverage key={`coverage-${detail.snapshotId}`} initial={detail.captureHealth} path={`/api/snapshots/${detail.snapshotId}/capture-status`} request={path => request(path)} />
          <SessionAnalysis key={`analysis-${detail.snapshotId}`} snapshotId={detail.snapshotId} request={(path, signal, method) => request(path, signal, method)} />
          <section className="recovery" aria-label="历史归属"><h3>历史归属</h3><p>本快照上传员工：{detail.employee}。历史记录按每条证据的原始设备及员工归属；当前项目不覆盖历史项目。</p>
            <p>{detail.provenance.relation === 'verified-restoration' ? '服务器已核对恢复来源与完整原件前缀。' : detail.provenance.relation === 'same-device-continuation' ? '已核对同设备会话的延续关系。' : '跨设备关系未确认。'}</p>
            {detail.provenance.sourceSnapshotId && <a href={`#${detail.provenance.sourceSnapshotId}`}>查看来源快照</a>}
            {detail.provenance.warning && <p className="notice">{detail.provenance.warning}</p>}</section>
          <ActivityStatistics key={`statistics-${detail.snapshotId}:${refresh}`} request={(path, signal) => request(path, signal)} />
          <section className="recovery" aria-label="来源日期与活动"><h3>来源日期与活动</h3>
            <dl><div><dt>设备接入</dt><dd>{detail.activity.enrolledAt ? date(detail.activity.enrolledAt) : '未知（旧设备没有可信登记时间）'}</dd></div>
              <div><dt>宿主登记</dt><dd>{date(detail.manifest.qualifiedAt)}</dd></div>
              <div><dt>来源时间范围</dt><dd>{detail.activity.sourceFrom && detail.activity.sourceTo ? `${date(detail.activity.sourceFrom)} — ${date(detail.activity.sourceTo)}` : '未知'}</dd></div></dl>
            <p>今日活动（北京时间 {detail.activity.today.date}）：{detail.activity.today.counts
              ? `用户轮次 ${detail.activity.today.counts.userTurns} · 工具调用 ${detail.activity.today.counts.toolCalls} · 已解析条目 ${detail.activity.today.counts.records}`
              : '未知，缺少可信设备接入时间。'}</p>
            <p className="muted small">本快照包含的唯一记录（可能有多名原始员工），按已确认活动、历史或关联上下文、未知分类。材料曾被保存不证明当时存在独立员工活动；保留来源时间，不把关联上下文解释为接入前。历史或关联上下文 {detail.activity.historicalRecords} 条、来源时间未知 {detail.activity.unknownTimeRecords} 条、接入边界未知 {detail.activity.unknownEnrollmentRecords} 条；上传与提交时间不作为工作发生时间。跨快照统计见上方去重统计。</p>
            <details><summary>按来源日期查看</summary><ul>{detail.activity.days.map(day => <li key={day.date}>
              <strong>{day.date}</strong>：历史上下文 {day.historicalRecords} 条；接入后用户轮次 {day.afterEnrollment.userTurns}、工具调用 {day.afterEnrollment.toolCalls}
            </li>)}</ul>{detail.activity.days.length === 0 && <p>没有可确定归属的来源日期。</p>}</details>
          </section>
          <section id="session-recovery" className="recovery" aria-label="导出与会话找回"><h3>导出与会话找回</h3>
            <p>{detail.recovery.limitation}</p>
            <p className="muted small">原生运行时：{detail.recovery.nativeRuntimeVersion ?? '未识别'}。{detail.recovery.nativeBackend === 'fixture-tested' ? '相同版本的原生运行时合成续聊已有测试；支持范围以该来源的验证记录为准。' : '该来源版本尚无原生续聊验证记录。'}</p>
            <div className="export-actions"><button disabled={exporting} onClick={() => download('readable')}>导出完整可读材料</button>
              <button disabled={exporting} onClick={() => download('recovery')}>下载恢复包</button></div>
            <p className="muted small">恢复仅允许新建隔离目录，并检查来源、目标版本、操作系统、长度与哈希。现有会话不会被覆盖；代码工作区和登录状态不在恢复范围内。</p>
            {detail.recovery.preparation !== 'candidate' && <p className="notice">当前来源或快照不满足已测恢复准备条件。可下载保存；恢复命令会给出具体原因。</p>}
            <details><summary>{detail.manifest.source === 'codex-cli' ? '查看 CLI 恢复准备步骤' : '查看恢复准备步骤'}</summary><ol><li>保存恢复包，记录上方来源版本；保留原件。</li>
              {detail.manifest.source === 'codex-cli' ? <><li>在 Windows x64 的独立测试环境安装相同 CLI 0.157.1。</li>
                <li>运行 restore，指定包、全新隔离目录、--source-version 0.157.1 和 CLI 绝对路径；校验失败时不写已有目标。</li>
                <li>以恢复目录作为新 CODEX_HOME，在自己的工作区使用原会话 ID 执行原生 resume。配置与登录独立设置；源码、依赖和附件不由此包恢复。</li>
                <li>工具返回值及代码变更仅反映原会话可提供的材料；未记录或未解析的内容不代表没有发生。</li></>
              : detail.manifest.source === 'claude-code-cli' ? <><li>在隔离环境安装相同 Claude Code CLI。当前仅有 Windows x64、2.1.281 的合成续聊记录。</li>
                <li>按部署文档运行 restore，指定包文件、全新配置目录和 Claude 可执行文件；原有配置不会被覆盖。</li>
                <li>核对恢复回执，将 CLAUDE_CONFIG_DIR 指向新目录，自行配置登录后用 --resume 和来源会话 ID 继续。关联材料及真实模型续聊仍待验证。</li></>
              : <><li>在独立测试账户或测试设备安装相同 Desktop 与内置运行时版本。仅有 Windows x64、Desktop 26.924.2738.0、运行时 0.158.0-alpha.2.1 的后端测试记录。</li>
                <li>按部署文档运行 collector 的 restore 命令，指定包文件、全新目录、Desktop 版本及原生运行时路径。</li>
                <li>检查恢复回执。Desktop 中打开并继续原会话的步骤仍待验证，当前不能据此确认 Desktop 找回成功。</li></>}</ol></details>
            {(exporting || exportStatus) && <p role="status">{exporting ? '正在准备下载…' : exportStatus}</p>}
            {exportError && <p className="error" role="alert">{exportError} 可重新点击导出重试。</p>}
          </section>
</aside></div></article>;
}
