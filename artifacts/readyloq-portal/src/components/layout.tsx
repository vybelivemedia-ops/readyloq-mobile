import { type ReactNode, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useReviewQueueCount } from '@/hooks/use-review-queue-count';
import { Link, useLocation } from 'wouter';
import { LayoutDashboard, ClipboardCheck, FileText, Users, DollarSign, Building2, BarChart3, CalendarDays, LogOut, Loader2, Menu, KeyRound, Home, Wifi, Brain, Plug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
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
      <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
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
    { href: '/schedule', label: 'Schedule', icon: CalendarDays, roles: ['owner', 'manager'] },
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
    <nav className="space-y-1">
      {navItems.map((item) => {
        const isActive = location === item.href || location.startsWith(`${item.href}/`);
        const badge = ('badge' in item ? item.badge : 0) ?? 0;
        return (
          <Link key={item.href} href={item.href} onClick={onClick}>
            <div
              className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${
                isActive 
                  ? 'bg-primary text-primary-foreground font-medium' 
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              <span className="flex-1 truncate">{item.label}</span>
              {badge > 0 && (
                <span className={`ml-auto shrink-0 min-w-[1.25rem] h-5 px-1 rounded-full text-[11px] font-semibold leading-5 text-center tabular-nums ${
                  isActive
                    ? 'bg-primary-foreground/20 text-primary-foreground'
                    : 'bg-primary text-primary-foreground'
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
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-primary rounded-sm" />
          <span className="font-semibold tracking-tight text-foreground">ReadyLoq</span>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-foreground">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 bg-card border-r border-border p-0 flex flex-col">
            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-primary rounded-sm" />
                <span className="font-semibold tracking-tight text-foreground">ReadyLoq</span>
              </div>
            </div>
            <div className="flex-1 p-4 overflow-y-auto">
              <NavLinks />
            </div>
            <div className="p-4 border-t border-border">
              <div className="mb-4">
                <div className="text-sm font-medium text-foreground">{me.company?.name}</div>
                <div className="text-xs text-muted-foreground capitalize">{me.effectiveRole}</div>
              </div>
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => signOut()}>
                <LogOut className="w-4 h-4" />
                Sign out
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border bg-card sticky top-0 h-[100dvh]">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-sm flex items-center justify-center">
              <ClipboardCheck className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg tracking-tight text-foreground">ReadyLoq</span>
          </div>
        </div>
        <div className="flex-1 p-4 overflow-y-auto">
          <NavLinks />
        </div>
        <div className="p-4 border-t border-border">
          <div className="mb-4 px-3">
            <div className="text-sm font-medium text-foreground truncate">{me.company?.name}</div>
            <div className="text-xs text-muted-foreground capitalize">{me.effectiveRole}</div>
          </div>
          <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground" onClick={() => signOut()}>
            <LogOut className="w-4 h-4" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-background">
        {children}
      </main>
    </div>
  );
}
