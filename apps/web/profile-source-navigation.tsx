import { z } from 'zod';
import { assessmentPeriod, assessmentPreset } from '../../packages/contracts/assessment.js';
import { navigationReturn } from './profile-navigation.js';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const sourceReturn=z.object({employeeId:z.uuid(),profileVersion:hash,version:hash.optional(),period:assessmentPeriod.optional(),preset:assessmentPreset.optional(),
  returnTo:z.string().refine(value=>navigationReturn(value)!==null).optional()}).strict();
export function fixedProfileReturn(value:string|null):string|null{
  if(!value||value.length>32768||!value.startsWith('#profile?')||value.slice(1).includes('#'))return null;
  const params=new URLSearchParams(value.slice(9));if([...params.keys()].some(key=>params.getAll(key).length!==1))return null;
  return sourceReturn.safeParse(Object.fromEntries(params)).success?value:null;
}
export function withProfileSourceReturn(path:string,origin:string){
  const fixed=fixedProfileReturn(origin);if(!fixed)return path;const [route,query]=path.split('?'),params=new URLSearchParams(query);params.set('profileReturn',fixed);return route+'?'+params;
}
export function ProfileSourceReturn(){const target=fixedProfileReturn(new URLSearchParams(location.hash.split('?')[1]).get('profileReturn'));return target?<a className="profile-return" href={target}>返回员工画像</a>:null;}
