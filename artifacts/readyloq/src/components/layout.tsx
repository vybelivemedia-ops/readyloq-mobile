import { Link, useLocation } from "wouter";
import {
  Home,
  ClipboardList,
  Camera,
  FileText,
  GraduationCap,
  Settings,
  Menu,
  Scan,
  Crosshair,
  Building2,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";
import { useClerk, useUser } from "@clerk/react";
import { useCurrentUser } from "@/hooks/use-current-user";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const baseNavItems = [
  { href: "/", label: "Scout", icon: Home },
  { href: "/inspections", label: "Stops", icon: ClipboardList },
  { href: "/properties", label: "Sites", icon: Building2 },
  { href: "/analysis", label: "Evidence", icon: Camera },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/training", label: "Learn", icon: GraduationCap },
];

const commandNavItem = { href: "/command", label: "Command", icon: Crosshair };
const settingsNavItem = { href: "/settings", label: "Settings", icon: Settings };

const mobileNavItems = [
  { href: "/", label: "Scout", icon: Home },
  { href: "/inspections", label: "Stops", icon: ClipboardList },
  { href: "/properties", label: "Sites", icon: Building2 },
  { href: "/analysis", label: "Evidence", icon: Camera },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/training", label: "Learn", icon: GraduationCap },
];

function isActive(location: string, href: string) {
  if (href === "/") return location === "/";
  return location.startsWith(href);
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { data: currentUser } = useCurrentUser();
  const { user } = useUser();
  const { signOut } = useClerk();
  const isManager = currentUser?.role === "manager";

  const navItems = [
    ...baseNavItems,
    ...(isManager ? [commandNavItem] : []),
    settingsNavItem,
  ];

  const displayName = user?.fullName || user?.emailAddresses?.[0]?.emailAddress || "User";
  const initials = displayName[0]?.toUpperCase() ?? "U";
  const roleLabel = currentUser?.role === "manager" ? "Manager" : "Technician";

  const NavLinks = ({ onClick }: { onClick?: () => void }) => (
    <>
      {navItems.map((item) => {
        const active = isActive(location, item.href);
        return (
          <Link key={item.href} href={item.href}>
            <Button
              variant="ghost"
              className={`w-full justify-start gap-3 mb-0.5 h-10 rounded-xl transition-all ${
                active
                  ? "bg-primary/15 text-primary hover:bg-primary/20 font-semibold"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              }`}
              onClick={onClick}
            >
              <item.icon className={`h-4 w-4 ${active ? "text-primary" : ""}`} />
              {item.label}
            </Button>
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="flex flex-col md:flex-row bg-background text-foreground" style={{ height: '100dvh' }}>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-border/60 bg-card/50 backdrop-blur-sm">
        <div className="p-5 pb-3">
          <div className="flex items-center gap-2.5 font-bold text-lg tracking-tight">
            <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
              <Scan className="h-4 w-4 text-primary" />
            </div>
            <span className="text-foreground">Ready<span className="text-primary">Loq</span></span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 pl-9">Inspection Copilot</p>
        </div>
        <ScrollArea className="flex-1 px-3 py-2">
          <NavLinks />
        </ScrollArea>
        <div className="p-3 border-t border-border/40 space-y-2">
          <div className="flex items-center gap-2.5 px-1">
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <span className="text-[11px] font-bold text-primary">{initials}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{displayName}</p>
              <p className="text-[10px] text-muted-foreground">{roleLabel}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground h-8 px-2 rounded-lg"
            onClick={() => signOut({ redirectUrl: basePath || "/" })}
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="text-xs">Sign out</span>
          </Button>
        </div>
      </aside>

      {/* Mobile Header */}
      <header
        className="md:hidden shrink-0 flex items-end justify-between border-b border-border/60 bg-card/90 backdrop-blur-md px-4 pb-3 sticky top-0 z-10"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))' }}
      >
        <div className="flex items-center gap-2 font-bold text-base">
          <div className="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center">
            <Scan className="h-3.5 w-3.5 text-primary" />
          </div>
          <span>Ready<span className="text-primary">Loq</span></span>
        </div>
        <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-64 p-0 bg-card border-l border-border/60">
            <div className="p-5 border-b border-border/60">
              <div className="flex items-center gap-2 font-bold text-lg">
                <Scan className="h-5 w-5 text-primary" />
                <span>Ready<span className="text-primary">Loq</span></span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Inspection Copilot</p>
            </div>
            <ScrollArea className="h-[calc(100dvh-160px)] px-3 py-3">
              <NavLinks onClick={() => setIsMobileMenuOpen(false)} />
            </ScrollArea>
            <div className="p-3 border-t border-border/40 space-y-2 mx-3 mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <span className="text-[11px] font-bold text-primary">{initials}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{displayName}</p>
                  <p className="text-[10px] text-muted-foreground">{roleLabel}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 text-muted-foreground h-8 px-2 rounded-lg"
                onClick={() => { setIsMobileMenuOpen(false); signOut({ redirectUrl: basePath || "/" }); }}
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="text-xs">Sign out</span>
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </header>

      {/* Main Content */}
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden md:overflow-y-auto">
        <div
          className="flex-1 overflow-y-auto"
          style={{ paddingBottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="p-4 md:p-7 max-w-5xl mx-auto w-full md:pb-7">
            {children}
          </div>
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border/60 bg-card/95 backdrop-blur-md flex items-start justify-around px-1 pt-2 z-20"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}
      >
        {mobileNavItems.map((item) => {
          const active = isActive(location, item.href);
          const isScout = item.href === "/";
          return (
            <Link key={item.href} href={item.href} className="flex-1 flex justify-center">
              <div className={`flex flex-col items-center justify-start w-full gap-1 py-0.5 transition-all ${
                active ? "text-primary" : "text-muted-foreground"
              }`}>
                {isScout && active ? (
                  <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
                    <item.icon className="h-4 w-4 text-primary" />
                  </div>
                ) : (
                  <item.icon className="h-5 w-5" />
                )}
                <span className="text-[9px] font-medium leading-none">{item.label}</span>
              </div>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
