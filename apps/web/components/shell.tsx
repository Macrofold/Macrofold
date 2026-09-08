'use client';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Bot,
  ChartNoAxesCombined,
  CalendarClock,
  FolderOpen,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  PlugZap,
  Search,
  Settings2,
  ShieldCheck,
  Terminal,
  Users,
  Webhook,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, useApi, type Schema } from '../lib/client';
import { Select } from './select';
import { Logo, Modal } from './ui';
import { DashboardFreshness, dashboardIdentityChanged } from './dashboard-freshness';
const navigation = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderOpen },
  { href: '/runs', label: 'Runs', icon: Activity },
  { href: '/agents', label: 'Agent presets', icon: Bot },
  { href: '/connections', label: 'Connections', icon: PlugZap },
  { href: '/triggers', label: 'Triggers', icon: Webhook },
  { href: '/scheduled-tasks', label: 'Scheduled tasks', icon: CalendarClock },
];
const manage = [
  { href: '/api-keys', label: 'API keys', icon: KeyRound },
  { href: '/webhooks', label: 'Webhooks', icon: Webhook },
  { href: '/usage', label: 'Usage', icon: ChartNoAxesCombined },
  { href: '/billing', label: 'Billing', icon: Settings2 },
  { href: '/account', label: 'Account & security', icon: ShieldCheck },
  { href: '/team', label: 'Team', icon: Users },
];
export function Shell({
  children,
  name,
  environment,
  user,
  operator,
}: {
  children: React.ReactNode;
  name: string;
  environment: 'simulation' | 'docker' | 'cloud';
  user: { name: string; email: string };
  operator: boolean;
}) {
  const path = usePathname(),
    router = useRouter();
  const [search, setSearch] = useState(false),
    [term, setTerm] = useState(''),
    [mobile, setMobile] = useState(false);
  const identity = useApi<Schema['Identity']>('/v1/me');
  const organization = identity.data?.organizations.find((o) => o.id === identity.data?.organization_id);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setSearch((v) => !v);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  const links = [
    ...navigation,
    ...manage,
    ...(operator ? [{ href: '/operator', label: 'Operations', icon: Activity }] : []),
  ];
  return (
    <div className="app-shell">
      <DashboardFreshness organization={identity.data?.organization_id} />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {mobile && (
        <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobile(false)} />
      )}
      <aside className={clsx('sidebar', mobile && 'mobile-open')}>
        <Link href="/" className="brand">
          <Logo />
          <span>{name}</span>
          <span className="brand-beta">BETA</span>
        </Link>
        <div className="organization">
          <div className="organization-icon">{(organization?.name || user.name).slice(0, 1)}</div>
          <div>
            <Select
              aria-label="Current organization"
              value={identity.data?.organization_id || ''}
              onValueChange={async (next) => {
                try {
                  await api('/account/organization', 'POST', { organization_id: next });
                  dashboardIdentityChanged();
                  location.assign('/');
                } catch (error) {
                  toast.error((error as Error).message);
                }
              }}
              options={[...(identity.data?.organizations.map((o) => ({ value: o.id, label: o.name })) ?? [])]}
            />
            <span>{organization?.role || 'Your workspace'}</span>
          </div>
        </div>
        <button className="search-trigger" onClick={() => setSearch(true)}>
          <Search size={15} />
          <span>Quick navigation</span>
          <kbd>⌘ K</kbd>
        </button>
        <nav aria-label="Main navigation">
          <div className="nav-label">WORKSPACE</div>
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobile(false)}
              className={clsx(
                'nav-item',
                (item.href === '/' ? path === '/' : path.startsWith(item.href)) && 'active',
              )}
            >
              <item.icon size={18} />
              {item.label}
              {item.href === '/runs' && <span className="nav-live" />}
            </Link>
          ))}
          <div className="nav-label manage-label">MANAGE</div>
          {manage.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobile(false)}
              className={clsx('nav-item', path.startsWith(item.href) && 'active')}
            >
              <item.icon size={18} />
              {item.label}
            </Link>
          ))}
          {operator && (
            <Link className={clsx('nav-item', path === '/operator' && 'active')} href="/operator">
              <Activity size={18} />
              Operations
            </Link>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="developer-card">
            <Terminal size={18} />
            <strong>Built for your terminal</strong>
            <p>Same workspace. Wherever you work.</p>
            <Link href="/developers">
              Set up the CLI <ArrowUpRight size={13} />
            </Link>
          </div>
          <a className="nav-item" href="/reference" target="_blank" rel="noreferrer">
            <BookOpen size={17} />
            API reference
            <ArrowUpRight size={13} />
          </a>
          <div className="profile">
            <div className="avatar">
              {user.name
                .split(' ')
                .map((v) => v[0])
                .slice(0, 2)
                .join('')}
            </div>
            <div>
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                try {
                  await api('/auth/sign-out', 'POST', {});
                  dashboardIdentityChanged();
                  location.assign('/login');
                } catch (error) {
                  toast.error((error as Error).message);
                }
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={19} />
            </button>
            <span>Workspace</span>
            <span className="crumb-slash">/</span>
            <strong>
              {links.find((v) => v.href !== '/' && path.startsWith(v.href))?.label || 'Overview'}
            </strong>
          </div>
          <div className="topbar-right">
            <span className={clsx('environment', environment === 'simulation' && 'simulation')}>
              <span />
              {environment === 'simulation'
                ? 'Local simulation'
                : environment === 'docker'
                  ? 'Local Docker'
                  : 'Cloud workspace'}
            </span>
            <a href="/reference" target="_blank" rel="noreferrer" className="top-docs">
              Documentation <ArrowUpRight size={13} />
            </a>
          </div>
        </header>
        <main id="main">{children}</main>
      </div>
      <Modal
        open={search}
        onOpenChange={setSearch}
        title="Go to…"
        description="Navigate your workspace. Use ⌘ K to open this menu."
      >
        <div className="command-search">
          <Search size={18} />
          <input
            autoFocus
            placeholder="Search pages…"
            aria-label="Search pages"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <div className="command-list">
          {[...links, { href: '/developers', label: 'Developer quickstart', icon: Terminal }]
            .filter((v) => v.label.toLowerCase().includes(term.toLowerCase()))
            .map((v) => (
              <button
                key={v.href}
                onClick={() => {
                  router.push(v.href);
                  setSearch(false);
                  setMobile(false);
                }}
              >
                <v.icon size={18} />
                {v.label}
                <span>↵</span>
              </button>
            ))}
        </div>
      </Modal>
    </div>
  );
}
