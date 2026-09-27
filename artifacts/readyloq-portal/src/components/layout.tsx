import { type ReactNode, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useReviewQueueCount } from '@/hooks/use-review-queue-count';
import { Link, useLocation } from 'wouter';
import {
  LayoutDashboard,
  ClipboardCheck,
  FileText,
  Users,
  DollarSign,
  Building2,
  BarChart3,
  CalendarDays,
  LogOut,
  Loader2,
  Menu,
  KeyRound,
  Home,
  Wifi,
  Brain,
  Plug,
  Activity
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { useClerk } from '@clerk/clerk-react';

export function Layout({ children }: { children: ReactNode }) {
  const { me, isLoaded, isSignedIn } = useAuth();
  const [location] = useLocation();
  const { signOut } = useClerk();
  const reviewQueueCount = useReviewQueueCount();

  // Theme sync
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-foreground" data-testid="layout-loading">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isSignedIn || !me) {
    return <>{children}</>;
  }

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['owner', 'manager'] },
    { href: '/inspections', label: 'Inspections', icon: ClipboardCheck, roles: ['owner', 'manager', 'sales', 'technician'] },
    { href: '/reports', label: 'Reports', icon: FileText, roles: ['owner', 'manager', 'sales'] },
    { href: '/opportunities', label: 'Opportunities', icon: DollarSign, roles: ['owner', 'sales'] },
    { href: '/properties', label: 'Properties', icon: Building2, roles: ['owner', 'manager', 'technician'] },
    { href: '/schedule', label: 'Schedule', icon: CalendarDays, roles: ['owner', 'manager', 'sales'] },
    { href: '/team', label: 'Team', icon: Users, roles: ['owner', 'manager'] },
    { href: '/analytics', label: 'Analytics', icon: BarChart3, roles: ['owner', 'manager'] },
    { href: '/client-access', label: 'Client Access', icon: KeyRound, roles: ['owner', 'manager'] },
    { href: '/ai-review', label: 'AI Review', icon: Brain, roles: ['owner', 'manager'], badge: reviewQueueCount },
    { href: '/ble-health', label: 'BLE Health', icon: Wifi, roles: ['owner', 'manager'] },
    { href: '/integrations', label: 'Integrations', icon: Plug, roles: ['owner'] },
    // Property managers see a single scoped view only.
    { href: '/client', label: 'My Reports', icon: Home, roles: ['property_manager'] },
  ].filter(item => item.roles.includes(me.effectiveRole));

  const NavLinks = ({ onClick }: { onClick?: () => void }) => (
    <nav className="space-y-0.5">
      {navItems.map((item) => {
        const isActive = location === item.href || location.startsWith(`${item.href}/`);
        const badge = ('badge' in item ? item.badge : 0) ?? 0;
        return (
          <Link key={item.href} href={item.href} onClick={onClick}>
            <div
              data-testid={`nav-link-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all cursor-pointer group ${
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
              }`}
            >
              <item.icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`} />
              <span className="flex-1 text-sm">{item.label}</span>
              {badge > 0 && (
                <span className={`ml-auto shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full text-[11px] font-bold leading-5 text-center tabular-nums ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-primary/20 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors'
                }`}>
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </div>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background selection:bg-primary/30">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-primary rounded shadow-lg shadow-primary/20 flex items-center justify-center">
             <Activity className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-semibold tracking-wide text-foreground">ReadyLoq</span>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="relative text-foreground hover:bg-white/5" data-testid="button-mobile-menu">
              <Menu className="w-5 h-5" />
              {reviewQueueCount > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary ring-2 ring-background" aria-label={`${reviewQueueCount} pending AI reviews`} />
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[280px] bg-card border-r border-border p-0 flex flex-col">
            <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
            <div className="p-5 border-b border-border/50">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 bg-primary rounded shadow-lg shadow-primary/20 flex items-center justify-center">
                  <Activity className="w-4 h-4 text-primary-foreground" />
                </div>
                <span className="font-semibold tracking-wide text-foreground">ReadyLoq</span>
              </div>
            </div>
            <div className="flex-1 p-3 overflow-y-auto">
              <div className="mb-2 px-3 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Menu</div>
              <NavLinks />
            </div>
            <div className="p-4 border-t border-border/50 bg-background/50">
              <div className="mb-4 px-1">
                <div className="text-sm font-medium text-foreground truncate" data-testid="text-company-name-mobile">{me.company?.name}</div>
                <div className="text-xs text-muted-foreground capitalize mt-0.5" data-testid="text-user-role-mobile">{me.effectiveRole}</div>
              </div>
              <Button variant="outline" className="w-full justify-start gap-2 border-border/50 hover:bg-white/5" onClick={() => signOut()} data-testid="button-sign-out-mobile">
                <LogOut className="w-4 h-4" />
                Sign out
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border bg-card/30 sticky top-0 h-[100dvh]">
        <div className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary rounded-lg shadow-lg shadow-primary/20 flex items-center justify-center relative overflow-hidden">
               <div className="absolute inset-0 bg-gradient-to-tr from-black/20 to-transparent" />
               <Activity className="w-5 h-5 text-primary-foreground relative z-10" />
            </div>
            <span className="font-bold text-lg tracking-wide text-foreground">ReadyLoq</span>
          </div>
        </div>

        <div className="flex-1 px-3 pb-4 overflow-y-auto hide-scrollbar">
          <div className="mb-2 px-3 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Menu</div>
          <NavLinks />
        </div>

        <div className="p-4 border-t border-border/50 bg-black/20">
          <div className="mb-4 px-2">
            <div className="text-sm font-medium text-foreground truncate" title={me.company?.name} data-testid="text-company-name">{me.company?.name}</div>
            <div className="flex items-center gap-1.5 mt-1">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <div className="text-xs text-muted-foreground capitalize" data-testid="text-user-role">{me.effectiveRole}</div>
            </div>
          </div>
          <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground hover:bg-white/5" onClick={() => signOut()} data-testid="button-sign-out">
            <LogOut className="w-4 h-4" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-background/50 relative">
        <div className="absolute top-0 left-0 right-0 h-64 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
        <div className="relative z-10">
          {children}
        </div>
      </main>
    </div>
  );
}
