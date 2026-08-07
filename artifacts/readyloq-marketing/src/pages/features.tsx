import { Seo } from "@/components/seo";
import { CtaSection } from "@/components/cta-section";
import { motion } from "framer-motion";
import { CheckCircle2, Ruler } from "lucide-react";
import { asset } from "@/config";

export default function Features() {
  return (
    <>
      <Seo 
        title="Features | ReadyLoq" 
        description="Explore ReadyLoq's features: AI-powered FAIE vision estimation, property intelligence records, white-labeled reporting, and operational visibility for field service teams."
      />
      
      <section className="pt-24 pb-16 bg-slate-50 border-b border-slate-200">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-6 text-slate-900">Built for the realities of field service.</h1>
            <p className="text-xl text-slate-600">
              ReadyLoq doesn't try to replace your technicians. It gives them the context they need to be effective, while securing that knowledge for your business.
            </p>
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="container mx-auto px-4 md:px-6">
          <div className="space-y-32">
            
            {/* Feature 1 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className="order-2 md:order-1"
              >
                <div className="bg-slate-100 rounded-2xl aspect-video flex items-center justify-center border border-slate-200 shadow-inner overflow-hidden">
                  <img src={asset("product-mockup.png")} alt="Property Intelligence Interface" className="w-full h-full object-cover" />
                </div>
              </motion.div>
              <div className="order-1 md:order-2">
                <h2 className="text-sm font-mono text-primary font-bold uppercase tracking-wider mb-3">Core Platform</h2>
                <h3 className="text-3xl font-bold mb-6 text-slate-900">Property Intelligence Records</h3>
                <p className="text-lg text-slate-600 mb-6">
                  Build a living database of every property you service. When a tech arrives on site, they have instant access to everything they need to know.
                </p>
                <ul className="space-y-4">
                  {[
                    "Access protocols, gate codes, and key locations",
                    "Equipment and bait station mapping",
                    "Historical pest activity and treatment logs",
                    "Conducive conditions monitoring"
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <CheckCircle2 className="text-primary mt-1" size={20} />
                      <span className="text-slate-700">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
              <div>
                <h2 className="text-sm font-mono text-primary font-bold uppercase tracking-wider mb-3">Client Experience</h2>
                <h3 className="text-3xl font-bold mb-6 text-slate-900">White-Labeled Reporting</h3>
                <p className="text-lg text-slate-600 mb-6">
                  Commercial clients demand proof of value. ReadyLoq automatically generates beautiful, professional reports using the data your techs are already collecting.
                </p>
                <ul className="space-y-4">
                  {[
                    "Custom branding with your logo and colors",
                    "Automated PDF generation post-service",
                    "Trend analysis over time for commercial accounts",
                    "Clear documentation of resolved conducive conditions"
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <CheckCircle2 className="text-primary mt-1" size={20} />
                      <span className="text-slate-700">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
              >
                <div className="bg-slate-100 rounded-2xl aspect-video flex items-center justify-center border border-slate-200 shadow-inner overflow-hidden">
                  <div className="w-full h-full bg-slate-900 p-8 text-white flex flex-col justify-center">
                    <div className="w-16 h-16 bg-primary rounded mb-6" />
                    <div className="h-4 bg-slate-800 rounded w-1/3 mb-4" />
                    <div className="h-4 bg-slate-800 rounded w-1/2 mb-8" />
                    <div className="grid grid-cols-3 gap-4">
                      <div className="h-24 bg-slate-800 rounded" />
                      <div className="h-24 bg-slate-800 rounded" />
                      <div className="h-24 bg-slate-800 rounded" />
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Feature 3 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className="order-2 md:order-1"
              >
                <div className="bg-slate-100 rounded-2xl aspect-video flex items-center justify-center border border-slate-200 shadow-inner overflow-hidden relative">
                   <img src={asset("hero-bg.png")} className="w-full h-full object-cover" alt="Analytics" />
                </div>
              </motion.div>
              <div className="order-1 md:order-2">
                <h2 className="text-sm font-mono text-primary font-bold uppercase tracking-wider mb-3">Operations</h2>
                <h3 className="text-3xl font-bold mb-6 text-slate-900">Management Visibility</h3>
                <p className="text-lg text-slate-600 mb-6">
                  Stop managing by anecdote. See exactly where your operational risks are and which properties are driving the most callbacks.
                </p>
                <ul className="space-y-4">
                  {[
                    "Callback intelligence and root cause analysis",
                    "High-risk property identification",
                    "Technician performance metrics",
                    "Standardized data collection across all branches"
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <CheckCircle2 className="text-primary mt-1" size={20} />
                      <span className="text-slate-700">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Feature 4 — FAIE AI Vision Estimation */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
              <div>
                <h2 className="text-sm font-mono text-primary font-bold uppercase tracking-wider mb-3">AI Estimation</h2>
                <h3 className="text-3xl font-bold mb-6 text-slate-900">FAIE AI Vision Estimation</h3>
                <p className="text-lg text-slate-600 mb-6">
                  Snap a photo of any structural defect and FAIE handles the measuring for you. The AI detects natural scale references already present in the scene — door frames, tile grids, brick courses — and derives accurate linear footage without any external tools.
                </p>
                <ul className="space-y-4">
                  {[
                    "Instant footage estimate from a single photo",
                    "Automatic scale reference detection — no tape measure needed",
                    "On-the-spot exclusion quote generated in the field",
                    "Technician can review and correct before it hits the report"
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <CheckCircle2 className="text-primary mt-1" size={20} />
                      <span className="text-slate-700">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
              >
                <div className="bg-slate-900 rounded-2xl aspect-video flex flex-col items-center justify-center border border-slate-700 shadow-inner overflow-hidden p-8 gap-6">
                  {/* Simulated camera viewfinder */}
                  <div className="relative w-full flex-1 rounded-xl border-2 border-primary/60 bg-slate-800 flex items-center justify-center overflow-hidden">
                    {/* Corner brackets */}
                    <span className="absolute top-2 left-2 w-5 h-5 border-t-2 border-l-2 border-primary rounded-tl" />
                    <span className="absolute top-2 right-2 w-5 h-5 border-t-2 border-r-2 border-primary rounded-tr" />
                    <span className="absolute bottom-2 left-2 w-5 h-5 border-b-2 border-l-2 border-primary rounded-bl" />
                    <span className="absolute bottom-2 right-2 w-5 h-5 border-b-2 border-r-2 border-primary rounded-br" />
                    {/* Ruler icon */}
                    <div className="flex flex-col items-center gap-2 opacity-70">
                      <Ruler className="text-primary" size={40} />
                      <span className="text-xs text-primary font-mono tracking-widest uppercase">Measuring…</span>
                    </div>
                    {/* Simulated measurement overlay */}
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-primary/90 text-white text-xs font-mono px-3 py-1 rounded-full whitespace-nowrap">
                      14.3 linear ft detected
                    </div>
                  </div>
                  {/* Quote chip */}
                  <div className="w-full bg-slate-800 rounded-xl px-5 py-3 flex items-center justify-between border border-slate-700">
                    <span className="text-slate-400 text-sm">Exclusion estimate</span>
                    <span className="text-white font-bold font-mono">$1,287</span>
                  </div>
                </div>
              </motion.div>
            </div>

          </div>
        </div>
      </section>

      <CtaSection />
    </>
  );
}
