import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { VLogo } from "@/components/VLogo";

// TODO(post-launch deploy): replace with the final App Store / Google Play link
const GET_APP_URL = "/download";

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
    <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md border-b"
      style={{ background: "rgba(3,4,8,0.85)", borderColor: "rgba(59,130,246,0.08)" }}>
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 z-50 relative group">
          <div className="transition-all duration-300 group-hover:drop-shadow-[0_0_12px_rgba(96,165,250,0.8)]">
            <VLogo size={28} glow={false} />
          </div>
          <span className="font-display font-black text-xl tracking-tighter text-white">
            VYBE<span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">LIVE</span>
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
                    className="absolute -bottom-1 left-0 right-0 h-px"
                    style={{ background: "linear-gradient(90deg, #60a5fa, #a855f7)" }}
                  />
                )}
              </Link>
            ))}
          </div>
          <Button
            className="text-white font-bold rounded-full px-6 transition-all"
            style={{
              background: "linear-gradient(135deg, #3b82f6, #7c3aed)",
              boxShadow: "0 0 20px rgba(99,102,241,0.4)",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 35px rgba(99,102,241,0.7)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 20px rgba(99,102,241,0.4)"; }}
            onClick={() => { window.location.href = GET_APP_URL; }}
          >
            Get the App
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
            className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-8"
            style={{ background: "rgba(3,4,8,0.97)", backdropFilter: "blur(20px)" }}
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
                    ? "text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400"
                    : "text-white"
                }`}
              >
                {link.label}
              </Link>
            ))}
            <Button
              size="lg"
              className="mt-4 text-white font-bold rounded-full px-8 text-lg"
              style={{ background: "linear-gradient(135deg, #3b82f6, #7c3aed)", boxShadow: "0 0 40px rgba(99,102,241,0.5)" }}
              onClick={() => {
                setIsOpen(false);
                window.location.href = GET_APP_URL;
              }}
            >
              Get the App
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
