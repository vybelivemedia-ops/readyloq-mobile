import { type ReactNode, useEffect } from 'react';
import { useClientAuth } from '@/hooks/use-client-auth';
import { Link, useLocation } from 'wouter';
import { Building2, LogOut, Loader2, Menu, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

export function ClientLayout({ children }: { children: ReactNode }) {
  const { me, isLoaded, isSignedIn, signOut } = useClientAuth();
  const [location] = useLocation();

  useEffect(() => {
    document.documentElement.classList.remove('dark');
  }, []);

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-[100dvh] bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isSignedIn || !me) {
    return <>{children}</>;
  }

  const navItems = [
    { href: '/', label: 'My Buildings', icon: Building2 },
  ];

  const NavLinks = ({ onClick }: { onClick?: () => void }) => (
    <nav className="space-y-1.5 mt-2">
      {navItems.map((item) => {
        const isActive =
          location === item.href ||
          (item.href !== '/' && location.startsWith(`${item.href}/`));
        return (
          <Link key={item.href} href={item.href} onClick={onClick}>
            <div
              data-testid={`link-client-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg transition-all duration-200 cursor-pointer ${
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              }`}
            >
              <item.icon className={`w-4 h-4 ${isActive ? 'text-primary' : 'opacity-70'}`} />
              <span className="text-sm">{item.label}</span>
            </div>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background selection:bg-primary/20">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-sidebar shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-primary rounded-md flex items-center justify-center shadow-sm">
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold tracking-tight text-foreground" style={{ fontFamily: 'var(--font-display)' }}>ReadyLoq</span>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              data-testid="button-client-mobile-menu"
            >
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 bg-sidebar p-0 flex flex-col">
            <div className="p-5 border-b border-border/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center shadow-sm">
                  <ShieldCheck className="w-4.5 h-4.5 text-white" />
                </div>
                <span className="font-semibold text-lg tracking-tight text-foreground" style={{ fontFamily: 'var(--font-display)' }}>ReadyLoq</span>
              </div>
              {me.company && (
                <p className="text-xs font-medium text-muted-foreground mt-3 uppercase tracking-wider">{me.company.name}</p>
              )}
            </div>
            <div className="flex-1 p-4 overflow-y-auto">
              <NavLinks />
            </div>
            <div className="p-5 border-t border-border/50 bg-sidebar/50">
              <div className="mb-4">
                <div className="text-sm font-medium text-foreground truncate">
                  {me.label ?? me.email ?? 'Property Manager'}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {me.siteAddresses.length} building{me.siteAddresses.length !== 1 ? 's' : ''}
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full justify-start gap-2 shadow-sm"
                onClick={() => signOut()}
                data-testid="button-client-sign-out-mobile"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-[260px] border-r border-border bg-sidebar sticky top-0 h-[100dvh]">
        <div className="p-6 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center shadow-sm shadow-primary/20">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight text-foreground" style={{ fontFamily: 'var(--font-display)' }}>ReadyLoq</span>
          </div>
          {me.company && (
            <p className="text-xs font-medium text-muted-foreground mt-4 ml-1 uppercase tracking-wider">{me.company.name}</p>
          )}
        </div>
        <div className="flex-1 px-4 py-5 overflow-y-auto">
          <p className="px-3.5 text-xs font-medium text-muted-foreground/70 uppercase tracking-wider mb-2">Portal</p>
          <NavLinks />
        </div>
        <div className="p-5 border-t border-border/50 bg-sidebar/30">
          <div className="mb-4 px-1">
            <div className="text-sm font-semibold text-foreground truncate">
              {me.label ?? me.email ?? 'Property Manager'}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {me.siteAddresses.length} building{me.siteAddresses.length !== 1 ? 's' : ''}
            </div>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            onClick={() => signOut()}
            data-testid="button-client-sign-out"
          >
            <LogOut className="w-4 h-4 opacity-70" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-background/50 relative">
        {children}
      </main>
    </div>
  );
}
