import { useCallback, useEffect, useState } from "react";
import { useTitle } from "@/hooks/use-title";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Eye,
  Sparkles,
  Share2,
  LayoutDashboard,
  Glasses,
  Radio,
} from "lucide-react";
import { ProgressBanner } from "@/components/ProgressBanner";
import { MetaGlassesSection } from "@/components/MetaGlassesSection";
import { LaunchAnimation } from "@/components/LaunchAnimation";
import { VLogo } from "@/components/VLogo";

function openWaitlist() {
  window.dispatchEvent(new CustomEvent("open-waitlist"));
}

const STREAKS = [
  { top: "18%", delay: 0, duration: 4.5, width: "35%" },
  { top: "42%", delay: 2.2, duration: 3.8, width: "55%" },
  { top: "65%", delay: 1.1, duration: 5.2, width: "28%" },
  { top: "78%", delay: 3.5, duration: 4.0, width: "40%" },
];

function LightStreak({
  top,
  delay,
  duration,
  width,
}: {
  top: string;
  delay: number;
  duration: number;
  width: string;
}) {
  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{
        top,
        left: 0,
        height: "1px",
        width,
        background:
          "linear-gradient(90deg, transparent, rgba(168,85,247,0.5), rgba(217,70,239,0.3), transparent)",
      }}
      animate={{ x: ["-100%", "500%"] }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        repeatDelay: 5,
        ease: "linear",
      }}
    />
  );
}

const FEATURES = [
  {
    icon: Eye,
    title: "POV Streaming",
    desc: "Stream directly from your perspective using phones, Meta AI Glasses, GoPro cameras, and RTMP devices.",
    gradient: "from-violet-500/10 to-purple-500/5",
    border: "border-violet-500/15",
    iconBg: "bg-violet-500/10 border-violet-400/20 text-violet-300",
  },
  {
    icon: Sparkles,
    title: "AI Clip Generation",
    desc: "Automatically transform livestreams into short-form content ready for every platform.",
    gradient: "from-fuchsia-500/10 to-purple-500/5",
    border: "border-fuchsia-500/15",
    iconBg: "bg-fuchsia-500/10 border-fuchsia-400/20 text-fuchsia-300",
  },
  {
    icon: Share2,
    title: "Multi-Platform Distribution",
    desc: "Manage content and broadcast workflows to YouTube, Twitch, Kick, TikTok, and more from one dashboard.",
    gradient: "from-purple-500/10 to-violet-500/5",
    border: "border-purple-500/15",
    iconBg: "bg-purple-500/10 border-purple-400/20 text-purple-300",
  },
  {
    icon: LayoutDashboard,
    title: "Creator Dashboard",
    desc: "Track streams, clips, growth, and engagement across every platform in a single unified view.",
    gradient: "from-violet-500/10 to-fuchsia-500/5",
    border: "border-violet-500/15",
    iconBg: "bg-violet-500/10 border-violet-400/20 text-violet-300",
  },
  {
    icon: Glasses,
    title: "Wearable Streaming",
    desc: "Connect next-generation wearable devices for hands-free content creation from any environment.",
    gradient: "from-purple-500/10 to-fuchsia-500/5",
    border: "border-purple-500/15",
    iconBg: "bg-purple-500/10 border-purple-400/20 text-purple-300",
  },
];

export default function Home() {
  useTitle("The POV Creator Platform");

  const [animDone, setAnimDone] = useState(() => {
    try {
      return sessionStorage.getItem("vybe-intro-done") === "1";
    } catch {
      return false;
    }
  });

  const handleAnimDone = useCallback(() => {
    try {
      sessionStorage.setItem("vybe-intro-done", "1");
    } catch {}
    setAnimDone(true);
  }, []);

  useEffect(() => {
    if (animDone) {
      document.body.style.overflow = "";
    } else {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [animDone]);

  return (
    <>
      {!animDone && <LaunchAnimation onComplete={handleAnimDone} />}

      <div className="flex flex-col min-h-screen pt-20">
        {/* ── HERO ───────────────────────────────────────────────────────── */}
        <section className="relative min-h-[96vh] flex items-center justify-center overflow-hidden border-b border-purple-500/10">
          {/* Grid background */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `
                repeating-linear-gradient(0deg, transparent, transparent 60px, rgba(139,92,246,0.04) 60px, rgba(139,92,246,0.04) 61px),
                repeating-linear-gradient(90deg, transparent, transparent 60px, rgba(139,92,246,0.04) 60px, rgba(139,92,246,0.04) 61px)
              `,
            }}
          />

          {/* Ambient orbs */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/4 w-[700px] h-[700px] rounded-full bg-purple-700/12 blur-[140px]" />
            <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-fuchsia-700/8 blur-[120px]" />
          </div>

          {/* Light streaks */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {STREAKS.map((s, i) => (
              <LightStreak key={i} {...s} />
            ))}
          </div>

          {/* Content */}
          <div className="relative z-10 max-w-7xl mx-auto px-6 flex flex-col items-center text-center">
            {/* V Logo hero mark */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="mb-8"
            >
              <VLogo size={60} glow pulse className="mx-auto" />
            </motion.div>

            {/* Platform badge */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-500/10 border border-purple-400/30 text-purple-300 text-xs font-bold uppercase tracking-widest mb-8 backdrop-blur-sm"
            >
              <Radio size={12} className="animate-pulse" />
              The POV Creator Platform
            </motion.div>

            {/* Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15 }}
              className="font-hero font-black uppercase leading-[0.9] tracking-tight text-white max-w-5xl"
              style={{ fontSize: "clamp(3.5rem, 10vw, 8rem)" }}
            >
              Stream Life{" "}
              <span className="text-gradient-brand">From Your</span>{" "}
              <span className="text-white">Eyes</span>
            </motion.h1>

            {/* Subheadline */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.25 }}
              className="mt-8 text-lg md:text-xl text-muted-foreground max-w-2xl leading-relaxed"
            >
              Go live from your phone, Meta AI Glasses, GoPro, or RTMP source.
              Create AI-powered clips and broadcast everywhere from one platform.
            </motion.p>

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.35 }}
              className="mt-10 flex flex-col sm:flex-row items-center gap-4 justify-center w-full"
            >
              <Button
                size="lg"
                onClick={openWaitlist}
                className="h-14 px-10 rounded-full bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white font-bold text-lg w-full sm:w-auto shadow-[0_0_40px_rgba(168,85,247,0.5)] hover:shadow-[0_0_60px_rgba(168,85,247,0.7)] transition-shadow"
              >
                Join Beta
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={openWaitlist}
                className="h-14 px-10 rounded-full font-bold text-lg w-full sm:w-auto border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10 hover:border-purple-400/50 text-white backdrop-blur-sm transition-all"
              >
                Become a Creator
              </Button>
            </motion.div>

            {/* Device badges */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="mt-12 flex flex-wrap items-center justify-center gap-3"
            >
              {["Phone Camera", "Meta AI Glasses", "GoPro", "RTMP Source"].map(
                (d) => (
                  <span
                    key={d}
                    className="px-3 py-1 rounded-full bg-white/4 border border-white/8 text-white/50 text-xs font-medium"
                  >
                    {d}
                  </span>
                )
              )}
            </motion.div>
          </div>
        </section>

        {/* ── PLATFORM POSITIONING ────────────────────────────────────────── */}
        <section className="py-28 bg-background relative z-10 border-b border-purple-500/8">
          <div className="max-w-4xl mx-auto px-6 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <p className="text-xs font-bold text-purple-400 uppercase tracking-widest mb-6">
                Why VYBE LIVE
              </p>
              <h2 className="font-hero text-4xl md:text-6xl font-black uppercase text-white leading-[0.95] mb-8">
                One platform.{" "}
                <span className="text-gradient-brand">Every perspective.</span>
              </h2>
              <p className="text-xl md:text-2xl text-muted-foreground leading-relaxed font-light max-w-3xl mx-auto">
                VYBE LIVE connects next-generation wearable devices, mobile
                cameras, and RTMP hardware into a single creator-first
                platform — with AI clips, multi-platform distribution, and a
                unified dashboard built in.
              </p>
            </motion.div>
          </div>
        </section>

        {/* ── FEATURES ────────────────────────────────────────────────────── */}
        <section className="py-24 bg-background relative overflow-hidden border-b border-purple-500/8">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `
                repeating-linear-gradient(0deg, transparent, transparent 80px, rgba(139,92,246,0.025) 80px, rgba(139,92,246,0.025) 81px),
                repeating-linear-gradient(90deg, transparent, transparent 80px, rgba(139,92,246,0.025) 80px, rgba(139,92,246,0.025) 81px)
              `,
            }}
          />

          <div className="relative z-10 max-w-7xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <p className="text-xs font-bold text-purple-400 uppercase tracking-widest mb-4">
                Platform Capabilities
              </p>
              <h2 className="font-hero text-4xl md:text-5xl font-black uppercase text-white leading-tight">
                Built for the creator.{" "}
                <span className="text-gradient-brand">Built for the future.</span>
              </h2>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {FEATURES.map((feature, i) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className={`group relative rounded-2xl border ${feature.border} glass-panel p-7 overflow-hidden transition-all duration-300 hover:border-purple-400/40 hover:shadow-[0_0_40px_rgba(168,85,247,0.08)]`}
                >
                  {/* Hover gradient fill */}
                  <div
                    className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none`}
                  />

                  {/* Animated border glow on hover */}
                  <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                    style={{ boxShadow: "inset 0 0 30px rgba(168,85,247,0.06)" }}
                  />

                  <div className="relative">
                    <div
                      className={`w-12 h-12 rounded-xl border flex items-center justify-center mb-5 transition-all duration-300 group-hover:scale-110 ${feature.iconBg}`}
                    >
                      <feature.icon size={22} />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">
                      {feature.title}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {feature.desc}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── META AI GLASSES ─────────────────────────────────────────────── */}
        <MetaGlassesSection />

        {/* ── PROGRESS / ROADMAP ──────────────────────────────────────────── */}
        <ProgressBanner />

        {/* ── PRICING ─────────────────────────────────────────────────────── */}
        <section className="py-32 bg-background border-y border-purple-500/10">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center mb-16">
              <p className="text-xs font-bold text-purple-400 uppercase tracking-widest mb-4">
                Simple Pricing
              </p>
              <h2 className="font-hero text-4xl md:text-5xl font-black uppercase text-white">
                Start free. Scale when{" "}
                <span className="text-gradient-brand">you're ready.</span>
              </h2>
              <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
                Every plan includes core streaming. Upgrade to unlock multistreaming, AI clips, and advanced analytics.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Free */}
              <div className="glass-panel rounded-3xl border border-purple-500/10 p-8 flex flex-col">
                <h3 className="text-2xl font-bold mb-2">Free</h3>
                <div className="text-4xl font-display font-black mb-8">
                  $0
                  <span className="text-lg text-muted-foreground font-sans font-normal">
                    /mo
                  </span>
                </div>
                <ul className="space-y-4 mb-8 flex-1 text-muted-foreground">
                  {[
                    "1 Platform Output",
                    "Standard Quality",
                    "VYBE Watermark",
                  ].map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-500 flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  onClick={openWaitlist}
                  className="w-full rounded-full h-12 border-purple-500/20 hover:border-purple-400/40"
                >
                  Get Started
                </Button>
              </div>

              {/* Pro */}
              <div className="relative rounded-3xl border border-primary p-8 flex flex-col shadow-[0_0_40px_rgba(168,85,247,0.2)] transform md:-translate-y-4"
                style={{ background: "rgba(88,28,135,0.12)" }}
              >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white px-5 py-1 rounded-full text-xs font-black uppercase tracking-wider">
                  Most Popular
                </div>
                <h3 className="text-2xl font-bold mb-2 text-gradient-brand">
                  Pro
                </h3>
                <div className="text-4xl font-display font-black mb-8">
                  $29
                  <span className="text-lg text-muted-foreground font-sans font-normal">
                    /mo
                  </span>
                </div>
                <ul className="space-y-4 mb-8 flex-1 text-muted-foreground">
                  {[
                    "3 Platform Outputs",
                    "1080p Quality",
                    "No Watermark",
                    "AI Clip Generation",
                    "Basic Analytics",
                  ].map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  onClick={openWaitlist}
                  className="w-full rounded-full h-12 bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white font-bold shadow-[0_0_20px_rgba(168,85,247,0.4)]"
                >
                  Join Beta
                </Button>
              </div>

              {/* Enterprise */}
              <div className="glass-panel rounded-3xl border border-purple-500/10 p-8 flex flex-col">
                <h3 className="text-2xl font-bold mb-2">Enterprise</h3>
                <div className="text-4xl font-display font-black mb-8">
                  $99
                  <span className="text-lg text-muted-foreground font-sans font-normal">
                    /mo
                  </span>
                </div>
                <ul className="space-y-4 mb-8 flex-1 text-muted-foreground">
                  {[
                    "Unlimited Platforms",
                    "4K Quality",
                    "Advanced Analytics",
                    "Wearable Device Support",
                    "Priority Support",
                  ].map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-500 flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  asChild
                  className="w-full rounded-full h-12 border-purple-500/20 hover:border-purple-400/40"
                >
                  <Link href="/contact">Contact Sales</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* ── FINAL CTA ───────────────────────────────────────────────────── */}
        <section
          id="beta"
          className="py-32 relative overflow-hidden border-t border-purple-500/10"
          style={{ background: "linear-gradient(to bottom, hsl(270 20% 3%), hsl(270 30% 5%))" }}
        >
          {/* Neon orb backdrop */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-purple-700/15 blur-[120px]" />
          </div>

          <div className="relative z-10 max-w-2xl mx-auto px-6 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <div className="flex justify-center mb-8">
                <VLogo size={52} glow pulse />
              </div>
              <h2 className="font-hero text-5xl md:text-7xl font-black uppercase text-white leading-[0.9] mb-6">
                Stream life{" "}
                <span className="text-gradient-brand">your way.</span>
              </h2>
              <p className="text-xl text-muted-foreground mb-10 max-w-md mx-auto leading-relaxed">
                Join the exclusive creator beta. Be first to stream POV content
                from Meta AI Glasses, GoPro, and beyond.
              </p>
              <Button
                size="lg"
                onClick={openWaitlist}
                className="h-14 px-12 rounded-full bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white font-bold text-lg shadow-[0_0_60px_rgba(168,85,247,0.5)] hover:shadow-[0_0_80px_rgba(168,85,247,0.7)] transition-all"
              >
                Join Beta Waitlist
              </Button>
              <p className="text-xs text-muted-foreground mt-5 tracking-wider uppercase">
                Free to join · No credit card required
              </p>
            </motion.div>
          </div>
        </section>
      </div>
    </>
  );
}
