import {insightArrays,insightSections,type SessionInsights,type SessionInsightsPage,type sessionInsightsQuery} from '../../packages/contracts/session-insights.js';
import type {z} from 'zod';
import {HttpError} from './identities.js';

/** One transport projection; never feed these partial collections to reporting. */
export function insightPage(stored:SessionInsights,q:z.infer<typeof sessionInsightsQuery>):SessionInsightsPage{
  const value:SessionInsightsPage={...structuredClone(stored),readingVersion:'session-insights-page-1',pages:{} as SessionInsightsPage['pages']};
  const arrays=insightArrays(value);
  for(const section of insightSections){
    const rows=arrays[section],total=rows.length,offset=q.section===section?q.offset:0;
    if(offset>total)throw new HttpError(400,'会话洞察分页位置超出范围');
    rows.splice(0,offset);rows.splice(q.section&&q.section!==section?0:20);
    value.pages[section]={total,offset,nextOffset:offset+rows.length<total?offset+rows.length:null};
  }
  const fits=()=>{const text=JSON.stringify(value);return Buffer.byteLength(text)<=32*1024&&Buffer.byteLength(JSON.stringify({content:[{type:'text',text}]}))<=48*1024;};
  while(!fits()){
    const section=insightSections.filter(key=>arrays[key].length>(q.section===key?1:0))
      .sort((a,b)=>Buffer.byteLength(JSON.stringify(arrays[b]))-Buffer.byteLength(JSON.stringify(arrays[a])))[0];
    if(!section)throw new HttpError(413,'单条会话洞察超过响应上限；原件与分析引用仍可独立读取');
    arrays[section].pop();value.pages[section].nextOffset=value.pages[section].offset+arrays[section].length;
  }
  return value;
}
