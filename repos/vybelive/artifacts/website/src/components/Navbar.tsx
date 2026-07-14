import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { VLogo } from "@/components/VLogo";

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [location] = useLocation();

  const links = [
    { href: "/", label: "Home" },
    { href: "/roadmap", label: "Roadmap" },
    { href: "/about", label: "About" },
    { href: "/contact", label: "Contact" },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/85 backdrop-blur-md border-b border-purple-500/10">
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 z-50 relative group">
          <div className="transition-all duration-300 group-hover:drop-shadow-[0_0_10px_rgba(168,85,247,0.8)]">
            <VLogo size={28} glow={false} />
          </div>
          <span className="font-display font-black text-xl tracking-tighter text-white">
            VYBE<span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-fuchsia-400">LIVE</span>
          </span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-8">
          <div className="flex items-center gap-6">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm font-medium transition-colors hover:text-white relative group ${
                  location === link.href ? "text-white" : "text-muted-foreground"
                }`}
              >
                {link.label}
                {location === link.href && (
                  <motion.span
                    layoutId="nav-underline"
                    className="absolute -bottom-1 left-0 right-0 h-px bg-gradient-to-r from-purple-500 to-fuchsia-500"
                  />
                )}
              </Link>
            ))}
          </div>
          <Button
            className="bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white font-bold rounded-full px-6 shadow-[0_0_20px_rgba(168,85,247,0.4)] hover:shadow-[0_0_30px_rgba(168,85,247,0.6)] transition-shadow"
            onClick={() => window.dispatchEvent(new CustomEvent("open-waitlist"))}
          >
            Join Beta
          </Button>
        </div>

        {/* Mobile Toggle */}
        <button
          className="md:hidden z-50 relative p-2 text-white"
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Toggle menu"
        >
          {isOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Mobile Nav */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed inset-0 bg-background z-40 flex flex-col items-center justify-center gap-8"
          >
            <div className="mb-4">
              <VLogo size={56} glow pulse />
            </div>
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className={`text-3xl font-display font-bold transition-colors ${
                  location === link.href
                    ? "text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-fuchsia-400"
                    : "text-white"
                }`}
              >
                {link.label}
              </Link>
            ))}
            <Button
              size="lg"
              className="mt-4 bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white font-bold rounded-full px-8 text-lg shadow-[0_0_30px_rgba(168,85,247,0.5)]"
              onClick={() => {
                setIsOpen(false);
                window.dispatchEvent(new CustomEvent("open-waitlist"));
              }}
            >
              Join Beta
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
