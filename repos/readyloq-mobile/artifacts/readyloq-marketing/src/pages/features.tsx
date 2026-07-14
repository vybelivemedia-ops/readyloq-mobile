import { Seo } from "@/components/seo";
import { CtaSection } from "@/components/cta-section";
import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { asset } from "@/config";

export default function Features() {
  return (
    <>
      <Seo 
        title="Features | ReadyLoq" 
        description="Explore the features of ReadyLoq's property intelligence platform: knowledge retention, reporting, and operational visibility."
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

          </div>
        </div>
      </section>

      <CtaSection />
    </>
  );
}
