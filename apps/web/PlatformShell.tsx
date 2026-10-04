import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface PlatformShellProps {
  children: ReactNode;
  authenticated: boolean;
  name: string;
  canManageIdentities: boolean;
  view: string;
  onNavigate: (view: string) => void;
  onLogout: () => void;
  onSearch: () => void;
}

type IconName = 'overview' | 'list' | 'person' | 'folder' | 'session' | 'chart' | 'gauge' | 'quote' | 'clock' | 'restore' | 'layers' | 'device' | 'pulse' | 'search' | 'menu' | 'close' | 'sun' | 'moon' | 'logout';

export function PlatformIcon({ name, className = '' }: { name: IconName; className?: string }) {
  const drawings: Record<IconName, ReactNode> = {
    overview: <><rect x="3.5" y="4.5" width="17" height="16" rx="3" /><path d="M3.5 9.5h17M8 2.8v3.4M16 2.8v3.4" /></>,
    list: <path d="M9 7h10.5M9 12h10.5M9 17h10.5M4.6 7h.6M4.6 12h.6M4.6 17h.6" />,
    person: <><circle cx="12" cy="8" r="3.6" /><path d="M4.8 20c1.3-3.6 3.9-5.5 7.2-5.5s5.9 1.9 7.2 5.5" /></>,
    folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h4.2l2 2.2h6.8a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
    session: <path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H11l-4 3.5v-3.5h-.5a2 2 0 0 1-2-2z" />,
    chart: <path d="M4.5 19.5h15M7.5 16.5v-5M12 16.5V7.5M16.5 16.5v-3" />,
    gauge: <><path d="M4.4 16.2a8 8 0 1 1 15.2 0M12 13.2l3.4-3.6" /><circle cx="12" cy="13.6" r="1.2" /></>,
    quote: <path d="M4.5 5.5h15v10h-8.6l-4.4 3.6v-3.6h-2zM8 9.4h8M8 12.2h5" />,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
    restore: <path d="M4.2 12.5A7.8 7.8 0 1 0 6.6 6.4M4.5 3.8v4.4h4.4M12 8.2V12l2.8 1.7" />,
    layers: <path d="m12 4 8.4 4.4L12 12.8 3.6 8.4zM3.6 12.4l8.4 4.4 8.4-4.4M3.6 16.2l8.4 4.4 8.4-4.4" />,
    device: <><rect x="4.5" y="5" width="15" height="10" rx="1.6" /><path d="M2.8 18.8h18.4" /></>,
    pulse: <path d="M3 12.5h4l2.4-6 5 11.5 2.6-5.5H21" />,
    search: <><circle cx="10.8" cy="10.8" r="6.3" /><path d="m20 20-4.4-4.4" /></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5l1.5 1.5M19 5l-1.5 1.5M6.5 17.5 5 19" /></>,
    moon: <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" />,
    logout: <path d="M9 4H4v16h5M9 12h12M17 8l4 4-4 4" />,
  };
  return <svg className={`platform-icon ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{drawings[name]}</svg>;
}

type NavigationItem = { label: string; icon: IconName; view?: string; activeViews?: string[]; managerOnly?: boolean };
const navigation: { label: string; items: NavigationItem[] }[] = [
  { label: '观察', items: [
    { label: '团队概览', icon: 'overview', view: 'coverage', activeViews: ['coverage', 'daily'] },
    { label: '活动记录', icon: 'list' },
    { label: '员工', icon: 'person' },
    { label: '项目', icon: 'folder', view: 'work' },
    { label: '会话', icon: 'session', view: 'archive' },
  ] },
  { label: '报表', items: [
    { label: '用量与产出', icon: 'chart', view: 'metrics' },
    { label: '会话产效', icon: 'gauge' },
    { label: '提示词分析', icon: 'quote', view:'prompts' },
    { label: '响应与等待', icon: 'clock', view: 'waits' },
  ] },
  { label: '存档', items: [{ label: '会话找回', icon: 'restore', view: 'recovery' }] },
  { label: '运行', items: [
    { label: '数据处理', icon: 'layers', view: 'pipeline' },
    { label: '接入与设备', icon: 'device', view: 'identities', activeViews: ['identities', 'delivery'], managerOnly: true },
    { label: '分析与运行', icon: 'pulse', view: 'analysis', activeViews: ['analysis', 'server'] },
  ] },
];

function storedTheme(): 'light' | 'dark' | undefined {
  try { const value = localStorage.getItem('skynet-theme'); return value === 'light' || value === 'dark' ? value : undefined; }
  catch { return undefined; }
}

export function PlatformShell({ children, authenticated, name, canManageIdentities, view, onNavigate, onLogout, onSearch }: PlatformShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(storedTheme);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const [mobile, setMobile] = useState(() => !matchMedia('(min-width: 60rem)').matches);
  const rail = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawerOpen = menuOpen && mobile;
  const dark = theme ? theme === 'dark' : systemDark;

  useEffect(() => {
    const color = matchMedia('(prefers-color-scheme: dark)');
    const width = matchMedia('(min-width: 60rem)');
    const colorChanged = () => setSystemDark(color.matches);
    const widthChanged = () => { setMobile(!width.matches); if (width.matches) setMenuOpen(false); };
    color.addEventListener('change', colorChanged); width.addEventListener('change', widthChanged);
    return () => { color.removeEventListener('change', colorChanged); width.removeEventListener('change', widthChanged); };
  }, []);

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try { if (theme) localStorage.setItem('skynet-theme', theme); } catch { /* Theme still works when storage is unavailable. */ }
  }, [theme]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k' && authenticated) {
        event.preventDefault(); setMenuOpen(false); onSearch();
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [authenticated, onSearch]);

  useEffect(() => {
    if (!drawerOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(rail.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),[tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); requestAnimationFrame(() => menuButton.current?.focus()); }
      if (event.key === 'Tab') {
        const items = focusable(), first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.body.style.overflow = originalOverflow; document.removeEventListener('keydown', handleKey); };
  }, [drawerOpen]);

  const navigate = (destination: string) => { setMenuOpen(false); onNavigate(destination); };
  const search = () => { setMenuOpen(false); onSearch(); };
  const closeMenu = () => { setMenuOpen(false); requestAnimationFrame(() => menuButton.current?.focus()); };
  const brand = <>
    <svg className="platform-brand-mark" viewBox="0 0 28 28" aria-hidden="true"><rect x="1" y="1" width="26" height="26" rx="8" fill="var(--color-ink)" /><circle cx="14" cy="14" r="5.2" fill="var(--color-accent)" /><circle cx="16.1" cy="11.9" r="1.7" fill="var(--color-paper)" /></svg>
    <span className="platform-brand-name">Skynet</span><span className="platform-brand-sub">观察台</span>
  </>;
  return <div className={`platform-shell${drawerOpen ? ' is-menu' : ''}`}>
    <a className="platform-skip" href="#platform-main" onClick={event => { event.preventDefault(); document.getElementById('platform-main')?.focus(); }}>跳到主要内容</a>
    <header className="platform-topbar" inert={drawerOpen}>
      <a className="platform-brand" href="#coverage" onClick={event => { event.preventDefault(); navigate('coverage'); }} aria-label="Skynet 观察台首页">{brand}</a>
      <div className="platform-topbar-actions">
        <button type="button" className="platform-icon-button" onClick={search} aria-label="搜索" disabled={!authenticated}><PlatformIcon name="search" /></button>
        <button ref={menuButton} type="button" className="platform-icon-button" onClick={() => setMenuOpen(value => !value)} aria-label="打开导航" aria-controls="platform-navigation" aria-expanded={drawerOpen}><PlatformIcon name="menu" /></button>
      </div>
    </header>
    <aside ref={rail} id="platform-navigation" className="platform-rail" aria-label="侧边栏" inert={mobile && !drawerOpen} role={drawerOpen ? 'dialog' : undefined} aria-modal={drawerOpen || undefined}>
      <div className="platform-rail-brand">
        <a className="platform-brand" href="#coverage" onClick={event => { event.preventDefault(); navigate('coverage'); }} aria-label="Skynet 观察台首页">{brand}</a>
        <button type="button" className="platform-icon-button platform-close-menu" onClick={closeMenu} aria-label="关闭导航"><PlatformIcon name="close" /></button>
      </div>
      <button type="button" className="platform-search-button" onClick={search} disabled={!authenticated} aria-keyshortcuts="Control+K Meta+K"><PlatformIcon name="search" /><span>搜索员工、项目、会话</span><kbd>⌘K</kbd></button>
      <nav className="platform-nav" aria-label="平台页面">
        {navigation.map(group => <div className="platform-nav-group" key={group.label}>
          <p className="platform-nav-label">{group.label}</p>
          {group.items.filter(item => item.view).map(item => {
            const destination = item.managerOnly && !canManageIdentities ? 'delivery' : item.view;
            const available = authenticated && !!destination;
            const current = !!item.view && (item.activeViews ?? [item.view]).includes(view);
            return <button type="button" key={item.label} className={`platform-nav-item${current ? ' is-active' : ''}`} disabled={!available} aria-current={current ? 'page' : undefined}
              title={!item.view ? `${item.label}尚未实现` : undefined}
              onClick={() => { if (available) navigate(destination!); }}><PlatformIcon name={item.icon} /><span>{item.label}</span>{!item.view && <span className="platform-sr-only">（待实现）</span>}</button>;
          })}
        </div>)}
      </nav>
      <div className="platform-rail-footer">
        <div className="platform-account"><span className="platform-avatar" aria-hidden="true">{name ? Array.from(name)[0] : '访'}</span><div><p className="platform-account-name">{authenticated ? name : '未登录'}</p></div></div>
        <div className="platform-rail-tools"><span className="platform-timezone"><PlatformIcon name="clock" />北京时间</span><div>
          <button type="button" className="platform-icon-button" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={`切换至${dark ? '浅色' : '深色'}主题`} title={`切换至${dark ? '浅色' : '深色'}主题`}><PlatformIcon name={dark ? 'sun' : 'moon'} /></button>
          {authenticated && <button type="button" className="platform-icon-button" onClick={onLogout} aria-label="退出" title="退出"><PlatformIcon name="logout" /></button>}
        </div></div>
      </div>
    </aside>
    {drawerOpen && <div className="platform-rail-scrim" onClick={closeMenu} aria-hidden="true" />}
    <main id="platform-main" className="platform-main" tabIndex={-1} inert={drawerOpen}><div className="platform-page-content" key={view} data-scroll-region="page">{children}</div></main>
  </div>;
}

export default PlatformShell;
