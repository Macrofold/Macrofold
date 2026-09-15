'use client';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ThemeMenuControl } from './theme';
import { useDashboardMotion } from '../lib/use-dashboard-motion';
import { DashboardAssistant } from './dashboard-assistant';
import { SidebarIcon } from './sidebar-icon';
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Bot,
  ChartNoAxesCombined,
  CalendarClock,
  Check,
  ChevronRight,
  FolderOpen,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  ChevronsUpDown,
  Sparkles,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
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
import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { api, useApi, type Schema } from '../lib/client';
import { useResizablePanel } from '../lib/use-resizable-panel';
import { Modal } from './ui';
import { DashboardFreshness, dashboardIdentityChanged } from './dashboard-freshness';
const navigation = [
  { href: '/', label: 'Home', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderOpen },
  { href: '/runs', label: 'Runs', icon: Activity },
  { href: '/agents', label: 'Agent presets', icon: Bot },
  { href: '/templates', label: 'Templates', icon: LayoutGrid },
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

function SidebarHint({
  enabled,
  label,
  children,
}: {
  enabled: boolean;
  label: string;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip.Root open={enabled && open} onOpenChange={(next) => setOpen(enabled && next)}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      {enabled && (
        <Tooltip.Portal>
          <Tooltip.Content className="sidebar-tooltip" side="right" sideOffset={12} collisionPadding={8}>
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      )}
    </Tooltip.Root>
  );
}

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
  const motion = useDashboardMotion();
  const path = usePathname(),
    router = useRouter();
  const [search, setSearch] = useState(false),
    [term, setTerm] = useState(''),
    [mobile, setMobile] = useState(false);
  const [compactMenus, setCompactMenus] = useState(false);
  const [mobileView, setMobileView] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { width, isResizing, handleProps } = useResizablePanel({
    storageKey: 'macrofold.navigation.width',
    defaultWidth: 234,
    minWidth: 220,
    maxWidth: 360,
  });
  const iconRail = collapsed && !mobileView;
  const identity = useApi<Schema['Identity']>('/v1/me');
  const organization = identity.data?.organizations.find((o) => o.id === identity.data?.organization_id);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 520px)');
    const update = () => setCompactMenus(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setMobileView(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const sync = () => {
      try {
        setCollapsed(localStorage.getItem('macrofold.navigation.collapsed') === 'true');
      } catch {
        // Navigation preferences are optional when storage is unavailable.
      }
    };
    sync();
    const changed = (event: StorageEvent) => {
      if (event.key === 'macrofold.navigation.collapsed' || event.key === null) sync();
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem('macrofold.navigation.collapsed', String(next));
    } catch {
      // Keep the selection for this page when storage is unavailable.
    }
  }
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
    <Tooltip.Provider delayDuration={250}>
      <div
        className={clsx('app-shell mf-app', collapsed && 'sidebar-collapsed')}
        style={{ '--sidebar-width': `${collapsed ? 64 : width}px` } as CSSProperties}
        data-sidebar-resizing={isResizing || undefined}
      >
        <DashboardFreshness organization={identity.data?.organization_id} />
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {mobile && (
          <button
            className="sidebar-backdrop"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          />
        )}
        <aside
          id="workspace-sidebar"
          className={clsx('sidebar', mobile && 'mobile-open')}
          inert={mobileView && !mobile}
        >
          <div className="sidebar-heading">
            <Link href="/" className="brand" aria-label={`${name} home`} onClick={() => setMobile(false)}>
              <img
                className="app-lockup sidebar-wordmark"
                src="/brands/macrofold/lockup.svg"
                alt={name}
                width={142}
                height={32}
              />
              <img
                className="macrofold-mark sidebar-mark"
                src="/brands/macrofold/mark.svg"
                alt=""
                width={26}
                height={26}
              />
            </Link>
            <SidebarHint enabled label={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
              <button
                className="sidebar-collapse icon-button"
                aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
                aria-expanded={!collapsed}
                aria-controls="workspace-navigation"
                onClick={toggleCollapsed}
              >
                <SidebarIcon icon={collapsed ? PanelLeftOpen : PanelLeftClose} size={17} />
              </button>
            </SidebarHint>
          </div>
          <SidebarHint enabled={iconRail} label="Quick navigation (⌘ K)">
            <button className="search-trigger" aria-label="Quick navigation" onClick={() => setSearch(true)}>
              <SidebarIcon icon={Search} size={15} />
              <span className="sidebar-label">Quick navigation</span>
              <kbd>⌘ K</kbd>
            </button>
          </SidebarHint>
          <nav id="workspace-navigation" aria-label="Main navigation">
            <div className="nav-label">Projects</div>
            {navigation.map((item) => (
              <SidebarHint key={item.href} enabled={iconRail} label={item.label}>
                <Link
                  href={item.href}
                  aria-label={item.label}
                  onClick={() => setMobile(false)}
                  aria-current={
                    (item.href === '/' ? path === '/' : path.startsWith(item.href)) ? 'page' : undefined
                  }
                  className={clsx(
                    'nav-item',
                    (item.href === '/' ? path === '/' : path.startsWith(item.href)) && 'active',
                  )}
                >
                  <SidebarIcon icon={item.icon} />
                  <span className="sidebar-label">{item.label}</span>
                </Link>
              </SidebarHint>
            ))}
            <div className="nav-label manage-label">Manage</div>
            {manage.map((item) => (
              <SidebarHint key={item.href} enabled={iconRail} label={item.label}>
                <Link
                  href={item.href}
                  aria-label={item.label}
                  onClick={() => setMobile(false)}
                  aria-current={
                    (item.href === '/' ? path === '/' : path.startsWith(item.href)) ? 'page' : undefined
                  }
                  className={clsx('nav-item', path.startsWith(item.href) && 'active')}
                >
                  <SidebarIcon icon={item.icon} />
                  <span className="sidebar-label">{item.label}</span>
                </Link>
              </SidebarHint>
            ))}
            {operator && (
              <SidebarHint enabled={iconRail} label="Operations">
                <Link
                  className={clsx('nav-item', path === '/operator' && 'active')}
                  href="/operator"
                  aria-label="Operations"
                  onClick={() => setMobile(false)}
                >
                  <SidebarIcon icon={Activity} />
                  <span className="sidebar-label">Operations</span>
                </Link>
              </SidebarHint>
            )}
          </nav>
          <div className="sidebar-bottom">
            <SidebarHint enabled={iconRail} label="Build with AI">
              <Link
                className="sidebar-quickstart"
                href="/developers"
                aria-label="Build with AI"
                onClick={() => setMobile(false)}
              >
                <SidebarIcon icon={Sparkles} size={17} />
                <span className="sidebar-label">
                  <strong>Build with AI</strong>
                  <small>Copy a prompt. Start building.</small>
                </span>
                <ArrowUpRight size={13} className="sidebar-trailing-icon" />
              </Link>
            </SidebarHint>
            <SidebarHint enabled={iconRail} label="API reference">
              <a
                className="nav-item"
                href="/reference"
                aria-label="API reference"
                target="_blank"
                rel="noreferrer"
              >
                <SidebarIcon icon={BookOpen} size={17} />
                <span className="sidebar-label">API reference</span>
                <ArrowUpRight size={13} className="sidebar-trailing-icon" />
              </a>
            </SidebarHint>
            <DropdownMenu.Root modal={false}>
              <SidebarHint enabled={iconRail} label={`Account menu · ${organization?.name || user.name}`}>
                <DropdownMenu.Trigger asChild>
                  <button className="profile profile-trigger" aria-label="Account menu">
                    <div className="avatar">
                      {user.name
                        .split(' ')
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join('')}
                    </div>
                    <div className="sidebar-label">
                      <strong>{user.name}</strong>
                      <span>{organization?.name || user.email}</span>
                    </div>
                    <ChevronsUpDown size={14} className="sidebar-trailing-icon" />
                  </button>
                </DropdownMenu.Trigger>
              </SidebarHint>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="profile-menu"
                  side="top"
                  align="start"
                  sideOffset={8}
                  collisionPadding={12}
                >
                  <DropdownMenu.Label className="profile-menu-heading">{user.email}</DropdownMenu.Label>
                  <ThemeMenuControl />
                  <DropdownMenu.Item
                    onSelect={(event) => {
                      event.preventDefault();
                      motion.toggle();
                    }}
                  >
                    <Sparkles size={15} />
                    {motion.playing ? 'Pause animations' : 'Play animations'}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger aria-label="Current organization">
                      <Users size={15} />
                      <span className="profile-menu-organization">
                        <strong>{organization?.name || 'Your organization'}</strong>
                        <small>{organization?.role || 'Organization'}</small>
                      </span>
                      <ChevronRight size={14} className="profile-menu-chevron" />
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.SubContent
                        className="profile-menu profile-submenu"
                        // Keep the 240px submenu readable by overlapping its parent on small screens.
                        sideOffset={compactMenus ? -232 : 8}
                        collisionPadding={12}
                      >
                        <DropdownMenu.Label className="profile-menu-heading">
                          Organizations
                        </DropdownMenu.Label>
                        <DropdownMenu.RadioGroup
                          value={identity.data?.organization_id || ''}
                          onValueChange={async (next) => {
                            if (next === identity.data?.organization_id) return;
                            try {
                              await api('/account/organization', 'POST', { organization_id: next });
                              dashboardIdentityChanged();
                              location.assign('/');
                            } catch (error) {
                              toast.error((error as Error).message);
                            }
                          }}
                        >
                          {identity.data?.organizations.map((item) => (
                            <DropdownMenu.RadioItem key={item.id} value={item.id}>
                              <span className="profile-menu-check">
                                <DropdownMenu.ItemIndicator>
                                  <Check size={14} />
                                </DropdownMenu.ItemIndicator>
                              </span>
                              {item.name}
                            </DropdownMenu.RadioItem>
                          ))}
                        </DropdownMenu.RadioGroup>
                      </DropdownMenu.SubContent>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Sub>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item asChild>
                    <Link href="/account" onClick={() => setMobile(false)}>
                      <ShieldCheck size={15} />
                      Account & security
                    </Link>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item asChild>
                    <Link href="/team" onClick={() => setMobile(false)}>
                      <Users size={15} />
                      Team settings
                    </Link>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item asChild>
                    <Link href="/docs" onClick={() => setMobile(false)}>
                      <BookOpen size={15} />
                      Documentation
                    </Link>
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    onSelect={async () => {
                      try {
                        await api('/auth/sign-out', 'POST', {});
                        dashboardIdentityChanged();
                        location.assign('/login');
                      } catch (error) {
                        toast.error((error as Error).message);
                      }
                    }}
                  >
                    <LogOut size={15} />
                    Sign out
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
          <div
            {...handleProps}
            className="resize-handle sidebar-resize-handle"
            aria-label="Resize navigation"
            aria-controls="workspace-sidebar"
            data-resizing={isResizing || undefined}
          />
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumbs">
              <button
                className="icon-button mobile-menu"
                aria-label="Open navigation"
                aria-expanded={mobile}
                aria-controls="workspace-sidebar"
                onClick={() => setMobile(true)}
              >
                <Menu size={19} />
              </button>
              <span>Dashboard</span>
              <span className="crumb-slash">/</span>
              <strong>{links.find((v) => v.href !== '/' && path.startsWith(v.href))?.label || 'Home'}</strong>
            </div>
            <div className="topbar-right">
              <span className={clsx('environment', environment === 'simulation' && 'simulation')}>
                <span />
                {environment === 'simulation'
                  ? 'Local simulation'
                  : environment === 'docker'
                    ? 'Local Docker'
                    : 'Dashboard'}
              </span>
              <a href="/docs" className="top-docs">
                Documentation <ArrowUpRight size={13} />
              </a>
            </div>
          </header>
          <main id="main">{children}</main>
        </div>
        <DashboardAssistant organizationId={identity.data?.organization_id} />
        <Modal
          open={search}
          onOpenChange={setSearch}
          title="Go to…"
          description="Navigate your dashboard. Use ⌘ K to open this menu."
        >
          <div className="command-search input-surface">
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
            {!links.some((item) => item.label.toLowerCase().includes(term.toLowerCase())) &&
              !'developer quickstart'.includes(term.toLowerCase()) && (
                <p className="muted">No matching pages. Try projects, runs, or connections.</p>
              )}
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
    </Tooltip.Provider>
  );
}
