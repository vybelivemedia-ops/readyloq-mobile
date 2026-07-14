import { Link } from "wouter";
import { VLogo } from "@/components/VLogo";
import { Download } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-background border-t border-purple-500/10 pt-16 pb-8">
      <div className="max-w-7xl mx-auto px-6">
        {/* Main footer row */}
        <div className="flex flex-col md:flex-row justify-between items-center md:items-start gap-8 mb-12">
          <div className="flex flex-col items-center md:items-start gap-4">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="transition-all duration-300 group-hover:drop-shadow-[0_0_10px_rgba(168,85,247,0.8)]">
                <VLogo size={24} />
              </div>
              <span className="font-display font-black text-xl tracking-tighter text-white">
                VYBE<span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-fuchsia-400">LIVE</span>
              </span>
            </Link>
            <p className="text-muted-foreground text-sm max-w-xs text-center md:text-left">
              The POV Creator Platform. Stream from your perspective using phones, Meta AI Glasses, GoPro, and more.
            </p>
            <p className="text-xs text-purple-500/60 font-mono tracking-widest uppercase">
              getvybe.live
            </p>
          </div>

          <div className="flex flex-col items-center md:items-end gap-4">
            <div className="flex flex-wrap justify-center gap-6">
              <Link href="/" className="text-sm text-muted-foreground hover:text-white transition-colors">Home</Link>
              <Link href="/roadmap" className="text-sm text-muted-foreground hover:text-white transition-colors">Roadmap</Link>
              <Link href="/about" className="text-sm text-muted-foreground hover:text-white transition-colors">About</Link>
              <Link href="/contact" className="text-sm text-muted-foreground hover:text-white transition-colors">Contact</Link>
              <Link href="/privacy" className="text-sm text-muted-foreground hover:text-white transition-colors">Privacy</Link>
              <Link href="/terms" className="text-sm text-muted-foreground hover:text-white transition-colors">Terms</Link>
              <Link href="/delete-account" className="text-sm text-muted-foreground hover:text-white transition-colors">Delete Account</Link>
            </div>
          </div>
        </div>

        {/* Brand assets row */}
        <div className="border-t border-purple-500/8 pt-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">Brand Assets</span>
            <a
              href="/brand/vybe-v-logo.svg"
              download="vybe-v-logo.svg"
              className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors font-medium"
            >
              <Download size={13} />
              V Logo (SVG)
            </a>
            <a
              href="/brand/vybe-v-logo-on-black.svg"
              download="vybe-v-logo-on-black.svg"
              className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors font-medium"
            >
              <Download size={13} />
              V Logo on Black (SVG)
            </a>
            <a
              href="/images/vybe-app-icon.png"
              download="vybe-app-icon.png"
              className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors font-medium"
            >
              <Download size={13} />
              App Icon (PNG)
            </a>
          </div>
          <div className="text-xs text-muted-foreground text-center">
            © 2026 VYBE LIVE MEDIA LLC · All rights reserved
          </div>
        </div>
      </div>
    </footer>
  );
}
