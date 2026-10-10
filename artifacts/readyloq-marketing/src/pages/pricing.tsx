import { Link } from "wouter";
import { motion } from "framer-motion";
import { Seo } from "@/components/seo";
import { CtaSection } from "@/components/cta-section";
import { FaieAssistant } from "@/components/faie-assistant";
import { Button } from "@/components/ui/button";

const TIERS = [
  {
    id: "solo",
    name: "Solo",
    technicians: "1 technician",
    price: "$99",
    period: "/mo",
    cta: { label: "Request Demo", href: "/demo" },
  },
  {
    id: "micro",
    name: "Micro",
    technicians: "2–5 technicians",
    price: "$299",
    period: "/mo",
    cta: { label: "Request Demo", href: "/demo" },
  },
  {
    id: "small",
    name: "Small",
    technicians: "6–15 technicians",
    price: "$699",
    period: "/mo",
    cta: { label: "Request Demo", href: "/demo" },
  },
  {
    id: "growth",
    name: "Growth",
    technicians: "16–35 technicians",
    price: "$1,299",
    period: "/mo",
    cta: { label: "Request Demo", href: "/demo" },
  },
  {
    id: "professional",
    name: "Professional",
    technicians: "36–75 technicians",
    price: "$2,499",
    period: "/mo",
    cta: { label: "Request Demo", href: "/demo" },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    technicians: "76–150 technicians",
    price: "$4,500",
    period: "/mo",
    cta: { label: "Contact Sales", href: "/contact" },
  },
  {
    id: "enterprise-plus",
    name: "Enterprise+",
    technicians: "150+ technicians",
    price: "Custom",
    period: "",
    cta: { label: "Contact Sales", href: "/contact" },
  },
];

export default function Pricing() {
  return (
    <>
      <Seo
        title="Pricing | ReadyLoq"
        description="Simple, transparent pricing for pest control operations of every size — from solo operators to growth teams to multi-location enterprises."
      />

      <section className="py-24 bg-slate-950 text-white">
        <div className="container mx-auto px-4 md:px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/20 text-primary border border-primary/30 text-sm font-mono mb-6">
              Pricing
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
              Simple pricing that scales with your team.
            </h1>
            <p className="text-lg text-slate-300 max-w-2xl mx-auto">
              Choose the plan that matches the size of your technician team today, then move up as your operation
              grows.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-24 bg-white">
        <div className="container mx-auto px-4 md:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-4xl mx-auto mb-14 overflow-hidden rounded-2xl border border-primary/30 bg-primary/5"
          >
            <div className="grid gap-6 p-7 md:grid-cols-[1fr_auto] md:items-center md:p-9">
              <div>
                <span className="inline-flex rounded-full bg-primary px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary-foreground">
                  90-Day Pilot
                </span>
                <h2 className="mt-4 text-2xl font-bold text-slate-900 md:text-3xl">
                  Prove the value before moving to a full plan.
                </h2>
                <p className="mt-2 max-w-2xl text-slate-600">
                  Start with a 90-day pilot at $500 per month. After the pilot, continue on the standard plan that
                  matches your technician count.
                </p>
              </div>
              <div className="md:text-right">
                <div className="flex items-baseline gap-1 md:justify-end">
                  <span className="text-4xl font-bold text-slate-900">$500</span>
                  <span className="text-slate-500">/mo</span>
                </div>
                <p className="mt-1 text-sm font-medium text-primary">for 90 days</p>
                <Link href="/demo" className="mt-5 block">
                  <Button size="lg" className="w-full md:w-auto">
                    Start a Pilot
                  </Button>
                </Link>
              </div>
            </div>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 max-w-7xl mx-auto items-stretch">
            {TIERS.map((tier, i) => (
              <motion.div
                key={tier.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="flex flex-col rounded-2xl border border-slate-200 bg-white p-7 shadow-sm transition-shadow hover:shadow-lg"
              >
                <h3 className="text-xl font-bold text-slate-900 mb-1">{tier.name}</h3>
                <p className="text-sm font-medium text-primary mb-6">{tier.technicians}</p>
                <div className="mb-1 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-slate-900">{tier.price}</span>
                  <span className="text-slate-500">{tier.period}</span>
                </div>

                <Link href={tier.cta.href} className="mt-8">
                  <Button
                    size="lg"
                    variant={tier.id === "enterprise-plus" ? "default" : "outline"}
                    className="w-full"
                  >
                    {tier.cta.label}
                  </Button>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* FAIE Assistant — pricing questions */}
      <section className="py-24 bg-slate-50 border-y border-slate-200">
        <div className="container mx-auto px-4 md:px-6 max-w-2xl">
          <div className="text-center mb-10">
            <h2 className="text-sm font-mono text-primary font-bold uppercase tracking-wider mb-3">
              Still Deciding?
            </h2>
            <h3 className="text-3xl font-bold text-slate-900">Ask FAIE which plan fits your team.</h3>
            <p className="text-slate-600 mt-3">
              FAIE knows every ReadyLoq feature and pricing tier — ask which plan matches your technician count or
              how the platform handles security and compliance.
            </p>
          </div>
          <FaieAssistant />
        </div>
      </section>

      <CtaSection />
    </>
  );
}
