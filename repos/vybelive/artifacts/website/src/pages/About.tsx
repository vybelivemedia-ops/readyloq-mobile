import { useTitle } from "@/hooks/use-title";
import { Link } from "wouter";

export default function About() {
  useTitle("About");

  return (
    <div className="pt-32 pb-24 min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6">
        <h1 className="text-5xl font-display font-black mb-8 text-white">About VYBE LIVE</h1>
        
        <div className="prose prose-invert prose-lg max-w-none text-muted-foreground">
          <p className="text-2xl leading-relaxed text-white font-light">
            VYBE LIVE was created to simplify livestreaming and help creators reach audiences across multiple platforms without managing multiple apps.
          </p>
          
          <p className="mt-8">
            The creator economy is fragmented. Audiences are scattered across YouTube, Twitch, TikTok, Instagram, and Kick. Choosing where to stream means choosing which part of your audience to ignore. We don't think you should have to choose.
          </p>
          
          <p>
            We built VYBE LIVE for the car meets, the underground street performances, the late-night gym sessions, and the creators who move fast. It's unapologetic, mobile-first, and designed to put control back in your hands.
          </p>
          
          <div className="mt-12 p-8 bg-card border border-border rounded-2xl">
            <h3 className="text-2xl font-bold text-white mb-4 mt-0">Our Mission</h3>
            <p className="mb-0">
              To build the ultimate bridge between creators and their entire community, eliminating technical friction and maximizing reach with a single tap.
            </p>
          </div>

          <div className="mt-8 p-8 bg-card border border-border rounded-2xl">
            <h3 className="text-2xl font-bold text-white mb-4 mt-0">What We Are</h3>
            <p className="mb-4">
              VYBE LIVE is a livestreaming platform that allows creators to broadcast to multiple social platforms simultaneously — YouTube, Twitch, Facebook, Instagram, and more — from a single mobile app.
            </p>
            <p className="mb-6">
              Revenue is generated through subscriptions, platform services, and optional creator tipping.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
              {[
                {
                  title: "Subscriptions",
                  body: "Free, Pro ($29/mo), and Enterprise ($99/mo) plans unlock multistreaming, AI clips, and advanced analytics.",
                },
                {
                  title: "Platform Services",
                  body: "Streaming infrastructure, RTMP ingest, Agora Cloud Push, and AI clip generation are bundled into paid tiers.",
                },
                {
                  title: "Creator Tipping",
                  body: "Viewers can send optional tips directly to creators during or after a live stream. Creators keep the majority of tips received.",
                },
              ].map((item) => (
                <div key={item.title} className="bg-background/60 border border-border/60 rounded-xl p-4">
                  <p className="text-sm font-semibold text-white mb-1">{item.title}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed m-0">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
