import { Link, useLocation } from "wouter";
import {
  Home,
  ClipboardList,
  BrainCircuit,
  Image as ImageIcon,
  FileText,
  GraduationCap,
  BarChart3,
  Settings,
  Menu,
  Scan,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";

const navItems = [
  { href: "/", label: "Scout", icon: Home },
  { href: "/inspections", label: "Inspections", icon: ClipboardList },
  { href: "/analysis", label: "Analysis", icon: BrainCircuit },
  { href: "/dataset", label: "Dataset", icon: ImageIcon },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/training", label: "Learn", icon: GraduationCap },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

const mobileNavItems = [
  { href: "/", label: "Scout", icon: Home },
  { href: "/inspections", label: "Inspections", icon: ClipboardList },
  { href: "/analysis", label: "Analysis", icon: BrainCircuit },
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
    <div className="flex min-h-screen flex-col md:flex-row bg-background text-foreground">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-56 flex-col border-r border-border/60 bg-card/50 backdrop-blur-sm">
        <div className="p-5 pb-3">
          <div className="flex items-center gap-2.5 font-bold text-lg tracking-tight">
            <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
              <Scan className="h-4 w-4 text-primary" />
            </div>
            <span className="text-foreground">Ready<span className="text-primary">Loq</span></span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 pl-9">AI Inspection Copilot</p>
        </div>
        <ScrollArea className="flex-1 px-3 py-2">
          <NavLinks />
        </ScrollArea>
        <div className="p-4 border-t border-border/40">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] text-muted-foreground">AI Active — Field OS v1.0</span>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="md:hidden flex h-12 items-center justify-between border-b border-border/60 bg-card/80 backdrop-blur-sm px-4 sticky top-0 z-10">
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
              <p className="text-xs text-muted-foreground mt-0.5">AI Inspection Copilot</p>
            </div>
            <ScrollArea className="h-[calc(100vh-80px)] px-3 py-3">
              <NavLinks onClick={() => setIsMobileMenuOpen(false)} />
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-0 pb-16 md:pb-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-7 max-w-5xl mx-auto w-full">
            {children}
          </div>
        </div>
      </main>

      {/* Mobile Bottom Nav — 5 items */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 border-t border-border/60 bg-card/95 backdrop-blur-md flex items-center justify-around px-1 z-20">
        {mobileNavItems.map((item) => {
          const active = isActive(location, item.href);
          const isScout = item.href === "/";
          return (
            <Link key={item.href} href={item.href} className="flex-1 flex justify-center">
              <div className={`flex flex-col items-center justify-center w-full h-full py-1 gap-1 rounded-xl transition-all ${
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
