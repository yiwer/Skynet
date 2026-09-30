import { useEffect,useState } from 'react';
import type { ServerOperations as Operations } from '../../packages/contracts/server-operations.js';
const bytes=(value:number|null)=>value===null?'未知':`${value.toLocaleString('zh-CN')} 字节`;
const at=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
export function ServerOperations({request}:{request:(path:string,signal?:AbortSignal)=>Promise<Response>}){
  const [data,setData]=useState<Operations>(),[error,setError]=useState('');
  useEffect(()=>{
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function read(){try{const value=await(await request('/api/server/operations',abort.signal)).json();if(!abort.signal.aborted){setData(value);setError('');}}
      catch(failure){if(!abort.signal.aborted)setError((failure as Error).message);}
      if(!abort.signal.aborted)timer=setTimeout(read,5000);
    }
    void read();return()=>{abort.abort();clearTimeout(timer);};
  },[]);
  return <section aria-label="服务器运行与备份"><h1>服务器运行与备份</h1>
    <p className="notice">上传确认仅表示单副本接收。成功备份与恢复演练各自记录范围，原件不自动删除。</p>
    {error&&<p role="alert">{error}</p>}{!data?(error?<p>状态尚未读到；稍后自动重试。</p>:<p role="status">正在读取服务器状态…</p>):<>
    <h2>原件容量</h2><dl><div><dt>原件文件系统容量</dt><dd>{bytes(data.storage.filesystemBytes)}</dd></div>
      <div><dt>可用空间</dt><dd>{bytes(data.storage.freeBytes)}</dd></div><div><dt>已提交原件</dt><dd>{data.storage.committedObjects??'未知'} 个对象 · {bytes(data.storage.committedBytes)}</dd></div>
      <div><dt>已接收暂存对象</dt><dd>{data.storage.stagedObjects??'未知'} 个；尚未归入快照</dd></div><div><dt>自动删除</dt><dd>关闭；原件持续保留</dd></div></dl>
    {data.storage.capacityError&&<p className="notice">{data.storage.capacityError}</p>}
    <h2>上次成功备份</h2>{data.latestBackup?<><p>完成时间：{at(data.latestBackup.completedAt)}；SQL与全部已提交原件边界：{at(data.latestBackup.snapshotAt)}。</p>
      <p>{data.latestBackup.objects} 个对象 · {bytes(data.latestBackup.bytes)} · {data.latestBackup.failureDomain==='same-host'?'同机副本':data.latestBackup.failureDomain==='off-host-declared'?'维护者声明异机；尚未独立验证':'副本所在故障范围未知'}。</p>
      <p>备份包字节与清单完整性已核对；不等于第二维护者重建或原生续聊通过。</p><p className="hash">备份编号 {data.latestBackup.id}</p></>:<p>尚无成功备份记录。</p>}
    <h2>最近操作记录</h2>{data.latestAttempt?<p>{({'in-progress':'记录未完成，需维护者核查','completed':'备份已完成','failed':'备份失败','interrupted':'旧过程已中断','unknown':'状态未知'} as Record<string,string>)[data.latestAttempt.state]??'状态未知'} · {at(data.latestAttempt.startedAt)}{data.latestAttempt.error&&`；${data.latestAttempt.error}`}</p>:<p>尚无备份操作记录。</p>}
    <h2>恢复演练</h2>{data.latestRestore?<><p>恢复目标已完成SQL与全部已提交原件完整性校验：{at(data.latestRestore.verifiedAt)}。</p>
      <p>仅完整性校验；尚未验证原生续聊、异机重建和第二维护者操作。</p><p className="hash">恢复来源 {data.latestRestore.backupId}</p></>:<p>尚无恢复完整性校验记录。</p>}
    <p className="muted">服务器状态更新于 {at(data.observedAt)}。备份和恢复由维护者在私有操作环境执行。</p></>}
  </section>;
}
