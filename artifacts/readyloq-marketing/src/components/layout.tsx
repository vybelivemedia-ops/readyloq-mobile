import { Link, useLocation } from "wouter";
import { asset } from "@/config";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export function Layout({ children }: { children: React.ReactNode }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [location] = useLocation();

  const links = [
    { href: "/features", label: "Features" },
    { href: "/#updates", label: "Updates" },
    { href: "/solutions", label: "Solutions" },
    { href: "/pricing", label: "Pricing" },
    { href: "/contact", label: "Contact" },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col font-sans bg-background text-foreground selection:bg-primary/20">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src={asset("logo.png")} alt="ReadyLoq Logo" className="h-8 w-auto" />
            <span className="font-bold text-xl tracking-tight hidden sm:inline-block">ReadyLoq</span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`transition-colors hover:text-primary ${
                  location === link.href ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-4">
            <Link href="/dashboard" className="text-xs font-mono font-medium text-muted-foreground/40 hover:text-primary transition-colors" title="Platform Admin">
              ⬡ Admin
            </Link>
            <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
              Log in
            </Link>
            <Link href="/demo">
              <Button>Request Demo</Button>
            </Link>
          </div>

          {/* Mobile Menu Toggle */}
          <button
            className="md:hidden p-2 text-foreground"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </header>

      {/* Mobile Nav */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed inset-x-0 top-16 z-40 bg-background border-b border-border/40 shadow-lg md:hidden"
          >
            <nav className="flex flex-col p-4 gap-4">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-lg font-medium px-4 py-2 rounded-md ${
                    location === link.href ? "bg-primary/10 text-primary" : "text-foreground"
                  }`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
              <div className="h-px bg-border my-2" />
              <Link
                href="/login"
                className="text-lg font-medium px-4 py-2 text-foreground"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Log in
              </Link>
              <Link href="/demo" onClick={() => setIsMobileMenuOpen(false)}>
                <Button className="w-full mt-2" size="lg">Request Demo</Button>
              </Link>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 flex flex-col">{children}</main>

      <footer className="bg-slate-950 text-slate-300 py-12 md:py-16 border-t border-slate-800">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-12">
            <div className="md:col-span-1">
              <Link href="/" className="flex items-center gap-2 mb-4">
                <img src={asset("logo.png")} alt="ReadyLoq Logo" className="h-8 w-auto brightness-0 invert" />
                <span className="font-bold text-xl tracking-tight text-white">ReadyLoq</span>
              </Link>
              <p className="text-sm text-slate-400 mt-4 leading-relaxed">
                The property intelligence & operational knowledge platform for modern pest control companies.
              </p>
            </div>
            
            <div>
              <h3 className="font-mono text-sm font-bold text-white mb-4 uppercase tracking-wider">Product</h3>
              <ul className="space-y-3 text-sm">
                <li><Link href="/features" className="hover:text-primary transition-colors">Features</Link></li>
                <li><Link href="/solutions" className="hover:text-primary transition-colors">Solutions</Link></li>
                <li><Link href="/pricing" className="hover:text-primary transition-colors">Pricing</Link></li>
                <li><Link href="/demo" className="hover:text-primary transition-colors">Request Demo</Link></li>
                <li><Link href="/login" className="hover:text-primary transition-colors">Log in</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="font-mono text-sm font-bold text-white mb-4 uppercase tracking-wider">Company</h3>
              <ul className="space-y-3 text-sm">
                <li><Link href="/contact" className="hover:text-primary transition-colors">Contact</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="font-mono text-sm font-bold text-white mb-4 uppercase tracking-wider">Legal</h3>
              <ul className="space-y-3 text-sm">
                <li><Link href="/privacy" className="hover:text-primary transition-colors">Privacy Policy</Link></li>
                <li><Link href="/terms" className="hover:text-primary transition-colors">Terms of Service</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-12 pt-8 border-t border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500">
            <p>© {new Date().getFullYear()} ReadyLoq. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
