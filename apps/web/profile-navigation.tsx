import type { MouseEvent } from 'react';
import { fixedTeamReportQuerySchema } from '../../packages/contracts/team-report.js';
import { peopleQuery } from '../../packages/contracts/capability-people.js';
import './profile-navigation.css';

export function navigationReturn(value: string | null): { href: string; label: string } | null {
  if (!value || value.length > 8192) return null;
  const match = /^(#coverage|#people)\?([^#]+)$/.exec(value);
  if (!match) return null;
  const params = new URLSearchParams(match[2]);
  if (!params.has('version') || [...params.keys()].some(key => params.getAll(key).length !== 1)) return null;
  const result = (match[1] === '#coverage' ? fixedTeamReportQuerySchema : peopleQuery).safeParse(Object.fromEntries(params));
  if (!result.success) return null;
  return { href: value, label: match[1] === '#coverage' ? '返回团队概览' : '返回员工一览' };
}

export function profileWithReturn(path: string, origin: string | null): string {
  const target = navigationReturn(origin);
  if (!target) return path;
  const [route, query] = path.split('?'), params = new URLSearchParams(query);
  params.set('returnTo', target.href);
  return route + '?' + params;
}

export function profileEntry(path: string, origin: string) {
  return { href: profileWithReturn(path, origin), onClick(event: MouseEvent<HTMLAnchorElement>) {
    const target = navigationReturn(origin);
    if (target && !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      history.replaceState(history.state, '', target.href);
    }
  } };
}

export function ProfileReturn({ value }: { value: string | null }) {
  const target = navigationReturn(value);
  return target ? <a className="profile-return" aria-label={target.label} href={target.href}>← {target.label}</a> : null;
}
