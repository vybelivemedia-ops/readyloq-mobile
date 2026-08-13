import { type ReactNode, useEffect } from 'react';
import { useClientAuth } from '@/hooks/use-client-auth';
import { Link, useLocation } from 'wouter';
import { Building2, FileText, LogOut, Loader2, Menu, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

export function ClientLayout({ children }: { children: ReactNode }) {
  const { me, isLoaded, isSignedIn, signOut } = useClientAuth();
  const [location] = useLocation();

  // Light theme — property managers expect a clean, bright web interface
  useEffect(() => {
    document.documentElement.classList.remove('dark');
  }, []);

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
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
    <nav className="space-y-1">
      {navItems.map((item) => {
        const isActive =
          location === item.href ||
          (item.href !== '/' && location.startsWith(`${item.href}/`));
        return (
          <Link key={item.href} href={item.href} onClick={onClick}>
            <div
              className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${
                isActive
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </div>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-white shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-primary rounded-md flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold tracking-tight text-foreground">ReadyLoq</span>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 bg-white p-0 flex flex-col">
            <div className="p-4 border-b">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-primary rounded-md flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4 text-white" />
                </div>
                <span className="font-semibold text-foreground">ReadyLoq</span>
              </div>
              {me.company && (
                <p className="text-xs text-muted-foreground mt-1">{me.company.name}</p>
              )}
            </div>
            <div className="flex-1 p-4 overflow-y-auto">
              <NavLinks />
            </div>
            <div className="p-4 border-t">
              <div className="mb-3 px-1">
                <div className="text-sm font-medium text-foreground truncate">
                  {me.label ?? me.email ?? 'Property Manager'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {me.siteAddresses.length} building{me.siteAddresses.length !== 1 ? 's' : ''}
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => signOut()}
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border bg-white sticky top-0 h-[100dvh] shadow-sm">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight text-foreground">ReadyLoq</span>
          </div>
          {me.company && (
            <p className="text-xs text-muted-foreground pl-10">{me.company.name}</p>
          )}
        </div>
        <div className="flex-1 p-4 overflow-y-auto">
          <NavLinks />
        </div>
        <div className="p-4 border-t border-border">
          <div className="mb-3 px-3">
            <div className="text-sm font-medium text-foreground truncate">
              {me.label ?? me.email ?? 'Property Manager'}
            </div>
            <div className="text-xs text-muted-foreground">
              {me.siteAddresses.length} building{me.siteAddresses.length !== 1 ? 's' : ''}
            </div>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
            onClick={() => signOut()}
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-background">{children}</main>
    </div>
  );
}
