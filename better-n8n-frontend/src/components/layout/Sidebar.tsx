import { Link, useLocation, useNavigate } from "react-router-dom";
import { cn } from "../../lib/utils";
import {
  GitGraph,
  Key,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  User,
} from "lucide-react";
import { useState, useEffect } from "react";
import { navGroups } from "../../lib/navigation";
import { OPEN_SIDEBAR_EVENT } from "./sidebarBus";
import { useQuery } from "@tanstack/react-query";
import { useHitlPending } from "../../hooks/useHitlPending";
import { useLiveCount } from "../../hooks/useActivityLive";
import { useAuth } from "../../contexts/authState";
import { useImagineOptional } from "../../contexts/imagineState";
import { notificationsService } from "../../api";
import { toast } from "sonner";


/* One shared query object for the whole module: `md` in Tailwind's default
   scale. Kept module-level so the initial `useState` and the subscription can
   never disagree about the breakpoint. */
const MOBILE_QUERY = window.matchMedia('(max-width: 767px)');

const Sidebar = () => {
    const location = useLocation();
    const navigate = useNavigate();
    /* `matchMedia`, not a `resize` listener reading `innerWidth`.
       A resize listener fires for *height* changes too, and on a phone the
       height changes constantly: the URL bar collapses on scroll, and opening
       the keyboard shrinks the visual viewport by ~40%. The old handler
       re-asserted `collapsed` on every one of those, so the drawer slammed
       shut mid-interaction and a desktop user's icon-rail choice was undone by
       any window resize. A media query only notifies when the breakpoint is
       actually *crossed*, which is the only moment the default should move. */
    const [isMobile, setIsMobile] = useState(() => MOBILE_QUERY.matches);
    // On mobile: collapsed = fully hidden drawer. On desktop: collapsed = icon rail.
    const [collapsed, setCollapsed] = useState(() => MOBILE_QUERY.matches);

    useEffect(() => {
        const onCross = (e: MediaQueryListEvent) => {
            setIsMobile(e.matches);
            // Crossing the breakpoint is the one event that resets the default:
            // hidden drawer below it, expanded rail above it. Within a
            // breakpoint the user's own choice stands.
            setCollapsed(e.matches);
        };
        MOBILE_QUERY.addEventListener('change', onCross);
        return () => MOBILE_QUERY.removeEventListener('change', onCross);
    }, []);

    // Auto-close drawer on mobile when route changes. During render rather
    // than in an effect, so the new page never paints under an open drawer.
    const [seenPath, setSeenPath] = useState(location.pathname);
    if (location.pathname !== seenPath) {
        setSeenPath(location.pathname);
        if (isMobile) setCollapsed(true);
    }

    // Escape closes the mobile drawer — it is a modal overlay, and the only
    // other way out is hitting the backdrop, which is a small target beside a
    // 320px panel.
    useEffect(() => {
        if (!isMobile || collapsed) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCollapsed(true); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isMobile, collapsed]);

    // Lock body scroll while mobile drawer is open
    useEffect(() => {
        if (isMobile && !collapsed) {
            const prev = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            return () => { document.body.style.overflow = prev; };
        }
    }, [isMobile, collapsed]);
    const { user, isAuthenticated } = useAuth();
    const customName = user?.instance_name?.trim();
    const brand = customName && customName !== 'AIAAS Instance' ? customName : 'AIAAS';
    const isGuest = !isAuthenticated;
    const imagine = useImagineOptional();
    const imaginePending = imagine?.activeCount ?? 0;

    // Badge counts: what is waiting on you (blue count) and what the agent is
    // doing unattended (violet dot). Polled, because the nav outlives any one
    // execution WebSocket.
    // The pending query lives in useHitlPending so that Activity and the
    // reminders, which want the same URL and the same data, share one timer
    // instead of each declaring their own interval over the shared key.
    const { data: pending = [] } = useHitlPending(isAuthenticated);
    const pendingCount = pending.length;
    // No global "something is running" push exists (the execution socket is
    // per-run), so this one genuinely has to poll. A minute is enough for a dot.
    const runningCount = useLiveCount(isAuthenticated);
    // Unread notification rows. Shared key with NotificationsTab and the
    // socket hook, so a push refreshes this without waiting for the poll.
    const { data: notifications = [] } = useQuery({
        queryKey: ['notifications'],
        enabled: isAuthenticated,
        refetchInterval: 30_000,
        queryFn: notificationsService.getNotifications,
    });
    const unreadCount = notifications.filter((n) => !n.is_read).length;

    // Intercepts clicks on auth-only nav items for guests: show a "log in" toast
    // and route them to /login instead of letting them hit a protected page that
    // would just redirect anyway.
    const guardGuest = (label: string) => (e: React.MouseEvent) => {
        if (isGuest) {
            e.preventDefault();
            toast.info(`Log in to use ${label}`);
            navigate('/login');
        }
    };

    // Generate initials from user name or email
    const getInitials = () => {
        if (user?.name) {
            const parts = user.name.split(' ');
            if (parts.length >= 2) {
                return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
            }
            return user.name.slice(0, 2).toUpperCase();
        }
        if (user?.email) {
            return user.email.slice(0, 2).toUpperCase();
        }
        return '??';
    };

    /* Groups come from lib/navigation so the topbar, sidebar and mobile bars
       can never disagree about what exists. Badges: `pending` = blue count
       waiting on you, `agent` = violet running-unattended dot. */

    /* Title bars own their menu button now (`SidebarMenuButton`, in-flow at the
       start of each header). It fires this event; the sidebar just opens.
       There is deliberately no floating button here any more: a `fixed`
       hamburger needed `pl-12` clearance hacks on every page and painted over
       drawer headers (the "Conversations" collision) on phones. */
    useEffect(() => {
        const open = () => setCollapsed(false);
        window.addEventListener(OPEN_SIDEBAR_EVENT, open);
        return () => window.removeEventListener(OPEN_SIDEBAR_EVENT, open);
    }, []);

    return (
        <>
        {/* Mobile: backdrop when drawer is open */}
        {isMobile && !collapsed && (
            <div
                className="md:hidden fixed inset-0 z-[55] bg-black/50 animate-in fade-in duration-200"
                onClick={() => setCollapsed(true)}
            />
        )}

        <div
            id="app-sidebar"
            role={isMobile ? 'dialog' : undefined}
            aria-modal={isMobile && !collapsed ? true : undefined}
            aria-hidden={isMobile && collapsed ? true : undefined}
            className={cn(
                "border-r flex flex-col transition-colors duration-150 overflow-hidden",
                // Mobile: fixed drawer, slides in from left, fully hidden when collapsed
                isMobile
                    ? cn(
                        "fixed left-0 top-0 z-[60] h-viewport w-72 shadow-lg",
                        collapsed ? "-translate-x-full" : "translate-x-0"
                      )
                    // Desktop: in-flow, collapses to icon rail
                    : cn(
                        "relative h-full flex-shrink-0 z-50",
                        collapsed ? "w-16" : "w-64"
                      )
            )}
            style={{
                backgroundColor: 'hsl(var(--sidebar-bg))',
                borderColor: 'hsl(var(--sidebar-border))'
            }}
        >
            {isMobile && <div className={cn(
                "p-4 flex items-center border-b transition-all duration-300",
                collapsed ? "justify-center" : "justify-between"
            )} style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
                <div className={cn(
                    "flex items-center gap-2.5 transition-all duration-300 overflow-hidden",
                    collapsed ? "opacity-0 invisible w-0" : "opacity-100 visible w-auto"
                )}>
                    <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shadow-sm shrink-0">
                        <GitGraph className="w-4 h-4 text-primary" />
                    </div>
                    {/* Settings → "Instance name", which was saved and shown nowhere. The
                        untouched default keeps the product name. */}
                    <span className="font-bold text-lg tracking-tight text-foreground whitespace-nowrap truncate max-w-[10rem]"
                      title={brand}>{brand}</span>
                </div>
                <button 
                    onClick={() => setCollapsed(!collapsed)}
                    className="p-1.5 hover:bg-muted rounded-lg transition-colors duration-200 shrink-0"
                >
                    <Menu className="w-5 h-5" />
                </button>
            </div>}

            {isMobile && <div className="p-3">
                {/* The primary action is starting a fresh conversation — chat
                    is where most work begins, including work that later
                    becomes an agent. Guests get their own chat at `/`; the
                    `newChat` flag tells the composer to skip restoring the
                    previous transcript, wherever it lands. */}
                <button
                    onClick={() => {
                        navigate(isGuest ? '/' : '/ai-chat', { state: { newChat: true } });
                    }}
                    className={cn(
                        "flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors duration-150 font-semibold shadow-sm overflow-hidden whitespace-nowrap mx-auto",
                        collapsed ? "w-10 h-10 p-0" : "w-full py-2.5 px-4 gap-2"
                    )}
                    title={collapsed ? "New chat" : undefined}
                >
                    <Plus className="w-5 h-5 shrink-0" />
                    <span className={cn(
                        "transition-all duration-300 overflow-hidden",
                        collapsed ? "w-0 opacity-0 ml-0" : "w-auto opacity-100 ml-2"
                    )}>
                        New chat
                    </span>
                </button>
            </div>}

            <nav className={cn("flex-1 overflow-y-auto p-2 space-y-3", !isMobile && "pt-3")}>
                {navGroups.map((group) => (
                    <div key={group.title}>
                        <h4 className={cn(
                            "px-3 pb-1 text-[11px] font-semibold text-muted-foreground transition-all duration-300",
                            collapsed ? "h-0 opacity-0 overflow-hidden" : "opacity-100"
                        )}>
                            {group.title}
                        </h4>
                        <div className="space-y-0.5">
                            {group.items.map((item) => {
                                // `match` lets one entry own several routes —
                                // Automations covers /agents and the workflow
                                // canvas, so it stays lit inside either.
                                const prefixes = item.match ?? [item.path];
                                const active = prefixes.some((p) => location.pathname.startsWith(p));
                                return (
                                    <Link
                                        key={item.path}
                                        to={item.path}
                                        onClick={item.guestOk ? undefined : guardGuest(item.label)}
                                        className={cn(
                                            "flex items-center rounded transition-colors group relative py-2",
                                            active
                                                ? "bg-accent text-foreground font-semibold"
                                                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                                            collapsed ? "px-0 justify-center gap-0" : "px-3 justify-start gap-3"
                                        )}
                                        title={collapsed ? item.label : undefined}
                                    >
                                        {/* Fluent uses a left accent stripe, not a filled pill. */}
                                        {active && (
                                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-primary rounded-r" />
                                        )}
                                        <item.icon className={cn(
                                            "w-[18px] h-[18px] shrink-0",
                                            active && "text-primary"
                                        )} />
                                        <span className={cn(
                                            "text-sm whitespace-nowrap overflow-hidden transition-all duration-300",
                                            collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
                                        )}>
                                            {item.label}
                                        </span>
                                        {/* Violet dot = the agent is working unattended.
                                            Blue count = things waiting on you. */}
                                        {!collapsed && item.agent && runningCount > 0 && (
                                            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-agent animate-agent-pulse" />
                                        )}
                                        {!collapsed && item.pending && pendingCount > 0 && (
                                            <span className="ml-auto text-[11px] font-semibold px-1.5 rounded bg-primary text-primary-foreground">
                                                {pendingCount}
                                            </span>
                                        )}
                                        {/* Studio: generating count (toby) */}
                                        {!collapsed && item.path === '/imagine' && imaginePending > 0 && (
                                            <span
                                                className="ml-auto flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20"
                                                title={`${imaginePending} generation${imaginePending === 1 ? '' : 's'} in progress`}
                                            >
                                                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                                                {imaginePending}
                                            </span>
                                        )}
                                        {collapsed && item.path === '/imagine' && imaginePending > 0 && (
                                            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary animate-pulse border border-background" />
                                        )}
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </nav>

            {/* Guest call-to-action — unauthenticated visitors */}
            {!isAuthenticated && (
                <div className="p-2 border-t border-border/60 space-y-2">
                    <Link
                        to="/login"
                        className={cn(
                            "flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 font-semibold transition-all",
                            collapsed ? "w-10 h-10 mx-auto" : "w-full py-2.5 px-3 gap-2"
                        )}
                        title={collapsed ? "Log in" : undefined}
                    >
                        <Key className="w-4 h-4 shrink-0" />
                        <span className={cn("text-sm whitespace-nowrap overflow-hidden", collapsed ? "w-0 opacity-0" : "w-auto opacity-100")}>
                            Log in
                        </span>
                    </Link>
                    {!collapsed && (
                        <p className="text-[11px] text-muted-foreground px-2 leading-snug">
                            Log in to create agents, upload files, and use the assistant.
                        </p>
                    )}
                </div>
            )}

            {/* User Section (auth-only) */}
            {!isMobile && (
                <div className="p-2 border-t border-border/60">
                    <button
                        type="button"
                        onClick={() => setCollapsed(!collapsed)}
                        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                        title={collapsed ? "Expand sidebar" : undefined}
                        className={cn(
                            "flex w-full items-center rounded py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                            collapsed ? "justify-center" : "gap-3 px-3"
                        )}
                    >
                        {collapsed ? <PanelLeftOpen className="w-[18px] h-[18px]" /> : <PanelLeftClose className="w-[18px] h-[18px]" />}
                        {!collapsed && <span>Collapse</span>}
                    </button>
                </div>
            )}

            {isMobile && isAuthenticated && <div className="p-2 border-t border-border/60 space-y-1">
                <Link
                    to="/profile"
                    className={cn(
                        "flex items-center rounded-lg transition-all duration-200 group py-1.5",
                        location.pathname === '/profile'
                            ? "bg-muted text-muted-foreground"
                            : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/40",
                        collapsed ? "px-0 justify-center gap-0" : "px-3 justify-start gap-2"
                    )}
                    title={collapsed ? "Profile" : undefined}
                >
                    <User className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className={cn(
                        "text-[11px] font-medium transition-all duration-300 whitespace-nowrap overflow-hidden",
                        collapsed ? "w-0 opacity-0 ml-0" : "w-auto opacity-100 ml-0"
                    )}>
                        Profile
                    </span>
                </Link>
                <Link
                    to="/settings"
                    className={cn(
                        "flex items-center rounded-lg transition-all duration-200 group py-2 overflow-hidden",
                        location.pathname === '/settings' 
                            ? "bg-primary/5 text-primary" 
                            : "hover:bg-muted/60",
                        collapsed ? "px-0 justify-center gap-0" : "px-3 justify-start gap-3"
                    )}
                    title={collapsed ? "Settings" : undefined}
                >
                    <div className="relative w-8 h-8 flex-shrink-0 rounded-full bg-muted border border-border flex items-center justify-center text-muted-foreground font-semibold text-sm">
                        {getInitials()}
                        {unreadCount > 0 && (
                            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center border border-background">
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </span>
                        )}
                    </div>
                    <div className={cn(
                        "flex-1 min-w-0 transition-all duration-300",
                        collapsed ? "w-0 opacity-0 invisible" : "w-auto opacity-100 visible"
                    )}>
                        <p className="text-sm font-bold text-foreground/90 truncate">{user?.name || 'User'}</p>
                        <p className="text-xs text-muted-foreground truncate">{user?.email || ''}</p>
                    </div>
                    {!collapsed && unreadCount > 0 && (
                        <span className="ml-auto text-[11px] font-semibold px-1.5 rounded bg-primary/10 text-primary border border-primary/20 shrink-0">
                            {unreadCount} new
                        </span>
                    )}
                </Link>
            </div>}
        </div>
        </>
    );
};

export default Sidebar;
