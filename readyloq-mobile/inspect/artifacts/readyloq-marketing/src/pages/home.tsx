import { Seo } from "@/components/seo";
import { CtaSection } from "@/components/cta-section";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Shield, Brain, Users, LineChart, FileText, Smartphone } from "lucide-react";
import { asset } from "@/config";

export default function Home() {
  return (
    <>
      <Seo 
        title="ReadyLoq | Property Intelligence for Pest Control" 
        description="ReadyLoq is the property intelligence & operational knowledge platform that captures technician expertise and turns it into institutional knowledge."
      />
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          "name": "ReadyLoq",
          "applicationCategory": "BusinessApplication",
          "operatingSystem": "Web, Mobile",
          "description": "Property intelligence and operational knowledge platform for pest control.",
          "offers": {
            "@type": "Offer",
            "price": "0",
            "priceCurrency": "USD"
          }
        })}
      </script>

      {/* Hero Section */}
      <section className="relative pt-20 pb-32 md:pt-32 md:pb-48 overflow-hidden bg-slate-950 text-white">
        <div className="absolute inset-0">
          <img src={asset("hero-bg.png")} alt="" className="w-full h-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/50 via-slate-950/80 to-slate-950" />
        </div>
        
        <div className="container mx-auto px-4 md:px-6 relative z-10">
          <div className="max-w-4xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/20 text-primary border border-primary/30 text-sm font-mono mb-8">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                The System of Record for Field Operations
              </div>
              <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 leading-tight">
                Don't let your best technicians <span className="text-primary">walk away with your data.</span>
              </h1>
              <p className="text-xl text-slate-300 mb-10 max-w-2xl mx-auto leading-relaxed">
                ReadyLoq captures property knowledge, standardizes communication, and turns field expertise into permanent institutional memory.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href="/demo">
                  <Button size="lg" className="w-full sm:w-auto text-lg px-8 py-6 h-auto">
                    Request Demo
                  </Button>
                </Link>
                <Link href="/solutions">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg px-8 py-6 h-auto bg-slate-900/50 border-slate-700 text-white hover:bg-slate-800">
                    See Solutions
                  </Button>
                </Link>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <section className="py-24 bg-white">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <h2 className="text-sm font-mono text-primary font-bold uppercase tracking-wider mb-3">The Problem</h2>
              <h3 className="text-3xl md:text-4xl font-bold mb-6 text-slate-900">Your operation is running on fragile memory.</h3>
              <div className="space-y-6 text-lg text-slate-600">
                <p>
                  When a senior technician leaves, or goes on vacation, or calls in sick—what happens to their route? The nuances of accessing the property, the history of tricky infestations, the location of hidden bait stations—it's all stored in their head.
                </p>
                <p>
                  When relief techs step in, they're flying blind. This leads to missed stations, annoyed customers, and expensive callbacks.
                </p>
                <p className="font-semibold text-slate-900">
                  You aren't just losing an employee; you're losing the operational intelligence that keeps your clients happy.
                </p>
              </div>
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="relative"
            >
              <div className="absolute inset-0 bg-primary/5 rounded-3xl transform rotate-3" />
              <div className="bg-slate-50 border border-slate-200 rounded-3xl p-8 relative shadow-lg">
                <div className="space-y-4">
                  {[
                    "Tech 1 called out. Who knows the gate code for the Johnson property?",
                    "Where are the bait stations at the Westside complex?",
                    "Customer called back—said we missed the crawlspace again.",
                    "New tech spent 30 minutes just trying to find the exterior traps."
                  ].map((quote, i) => (
                    <div key={i} className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex items-start gap-4">
                      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 text-slate-400">
                        <Users size={16} />
                      </div>
                      <p className="text-slate-700 italic">"{quote}"</p>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Solution / Product Preview */}
      <section className="py-24 bg-slate-50 border-y border-slate-200">
        <div className="container mx-auto px-4 md:px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-sm font-mono text-primary font-bold uppercase tracking-wider mb-3">The Solution</h2>
            <h3 className="text-3xl md:text-4xl font-bold mb-6 text-slate-900">Institutional Knowledge, Standardized.</h3>
            <p className="text-lg text-slate-600">
              ReadyLoq provides a structured, mobile-first interface for technicians to log site conditions, access requirements, and historical data, making every property completely transparent to anyone on your team.
            </p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="rounded-xl overflow-hidden shadow-2xl border border-slate-200"
          >
            <img src={asset("product-mockup.png")} alt="ReadyLoq Property Intelligence Dashboard" className="w-full h-auto" />
          </motion.div>
        </div>
      </section>

      {/* Core Features */}
      <section className="py-24 bg-white">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: <Brain className="text-primary" size={32} />,
                title: "Knowledge Retention",
                desc: "Capture implicit technician knowledge into explicit property records that survive staff turnover."
              },
              {
                icon: <Shield className="text-primary" size={32} />,
                title: "Callback Reduction",
                desc: "Equip every technician with the historical context needed to solve the problem the first time."
              },
              {
                icon: <FileText className="text-primary" size={32} />,
                title: "White-Labeled Reporting",
                desc: "Generate professional, branded reports that prove your value to commercial clients."
              },
              {
                icon: <LineChart className="text-primary" size={32} />,
                title: "Management Visibility",
                desc: "See exactly what's happening in the field with dashboard analytics on property risk and tech performance."
              },
              {
                icon: <Smartphone className="text-primary" size={32} />,
                title: "Technician Support",
                desc: "A fast, offline-capable mobile app that helps techs do their job better, not just micromanage them."
              },
              {
                icon: <Users className="text-primary" size={32} />,
                title: "Standardized Communication",
                desc: "Ensure handoffs between technicians are seamless with structured notes and media."
              }
            ].map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="bg-slate-50 p-8 rounded-2xl border border-slate-100 hover:border-primary/20 transition-colors"
              >
                <div className="mb-6 bg-white w-16 h-16 rounded-xl flex items-center justify-center shadow-sm border border-slate-100">
                  {feature.icon}
                </div>
                <h4 className="text-xl font-bold mb-3 text-slate-900">{feature.title}</h4>
                <p className="text-slate-600 leading-relaxed">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Split */}
      <section className="py-24 bg-slate-950 text-white overflow-hidden">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <h3 className="text-3xl font-bold mb-8">For Technicians</h3>
              <ul className="space-y-6">
                {[
                  "No more guessing game when taking over a new route.",
                  "Clear access notes, gate codes, and key locations.",
                  "Historical photos of equipment and past infestations.",
                  "Mobile-first interface that doesn't slow them down."
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-4">
                    <div className="mt-1 w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    </div>
                    <span className="text-lg text-slate-300">{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <h3 className="text-3xl font-bold mb-8">For Management</h3>
              <ul className="space-y-6">
                {[
                  "Protect your company's most valuable asset: property data.",
                  "Reduce expensive callbacks through better information sharing.",
                  "Onboard new technicians faster with existing route intelligence.",
                  "Provide proof of service to commercial clients automatically."
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-4">
                    <div className="mt-1 w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    </div>
                    <span className="text-lg text-slate-300">{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        </div>
      </section>

      <CtaSection />
    </>
  );
}
