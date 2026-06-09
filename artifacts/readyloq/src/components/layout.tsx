import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  ClipboardList, 
  BrainCircuit, 
  Image as ImageIcon, 
  FileText, 
  GraduationCap, 
  BarChart3, 
  Settings,
  Menu
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inspections", label: "Inspections", icon: ClipboardList },
  { href: "/analysis", label: "Analysis", icon: BrainCircuit },
  { href: "/dataset", label: "Dataset", icon: ImageIcon },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/training", label: "Training", icon: GraduationCap },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const NavLinks = ({ onClick }: { onClick?: () => void }) => (
    <>
      {navItems.map((item) => (
        <Link key={item.href} href={item.href}>
          <Button
            variant={location === item.href || (location.startsWith(item.href) && item.href !== "/") ? "secondary" : "ghost"}
            className={`w-full justify-start gap-3 mb-1 ${
              location === item.href || (location.startsWith(item.href) && item.href !== "/") 
                ? "bg-primary/10 text-primary hover:bg-primary/20" 
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            }`}
            onClick={onClick}
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </Button>
        </Link>
      ))}
    </>
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-background text-foreground">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r border-border bg-card">
        <div className="p-6">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tight text-primary">
            <BrainCircuit className="h-6 w-6" />
            ReadyLoq
          </div>
        </div>
        <ScrollArea className="flex-1 px-4 py-2">
          <NavLinks />
        </ScrollArea>
        <div className="p-4 border-t border-border">
          <div className="text-xs text-muted-foreground text-center">ReadyLoq Field OS v1.0</div>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="md:hidden flex h-14 items-center justify-between border-b border-border bg-card px-4 sticky top-0 z-10">
        <div className="flex items-center gap-2 font-bold text-lg text-primary">
          <BrainCircuit className="h-5 w-5" />
          ReadyLoq
        </div>
        <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden text-muted-foreground">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[250px] p-0 bg-card border-r-border">
            <div className="p-6 border-b border-border">
              <div className="flex items-center gap-2 font-bold text-xl text-primary">
                <BrainCircuit className="h-6 w-6" />
                ReadyLoq
              </div>
            </div>
            <ScrollArea className="h-[calc(100vh-80px)] px-4 py-4">
              <NavLinks onClick={() => setIsMobileMenuOpen(false)} />
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-0 pb-16 md:pb-0">
        <div className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 border-t border-border bg-card flex items-center justify-around px-2 z-10">
        {navItems.slice(0, 4).map((item) => (
          <Link key={item.href} href={item.href} className="flex-1 flex justify-center">
            <div className={`flex flex-col items-center justify-center w-full h-full py-1 gap-1 rounded-md transition-colors ${
              location === item.href || (location.startsWith(item.href) && item.href !== "/") 
                ? "text-primary" 
                : "text-muted-foreground hover:bg-muted/30"
            }`}>
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium leading-none">{item.label}</span>
            </div>
          </Link>
        ))}
        <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
          <SheetTrigger asChild>
            <div className="flex-1 flex justify-center cursor-pointer">
              <div className="flex flex-col items-center justify-center w-full h-full py-1 gap-1 rounded-md transition-colors text-muted-foreground hover:bg-muted/30">
                <Menu className="h-5 w-5" />
                <span className="text-[10px] font-medium leading-none">More</span>
              </div>
            </div>
          </SheetTrigger>
        </Sheet>
      </nav>
    </div>
  );
}
