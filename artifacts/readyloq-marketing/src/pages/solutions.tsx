import { Seo } from "@/components/seo";
import { CtaSection } from "@/components/cta-section";
import { motion } from "framer-motion";
import { Briefcase, Settings, GraduationCap, Building2 } from "lucide-react";

export default function Solutions() {
  const roles = [
    {
      id: "owners",
      icon: <Building2 className="text-primary" size={40} />,
      title: "For Business Owners",
      problem: "Your company's value is tied up in the heads of a few key employees.",
      solution: "ReadyLoq turns ephemeral employee knowledge into a permanent, quantifiable business asset. When you own the data about the properties you service, you own the relationship, reducing churn and increasing the enterprise value of your company."
    },
    {
      id: "operations",
      icon: <Settings className="text-primary" size={40} />,
      title: "For Operations Managers",
      problem: "Callbacks are eating into margins, and route handoffs are chaotic.",
      solution: "Standardize how information is collected and shared. ReadyLoq provides the visibility needed to understand why callbacks happen and equips relief technicians with the context to handle any route effectively on day one."
    },
    {
      id: "branch",
      icon: <Briefcase className="text-primary" size={40} />,
      title: "For Branch Managers",
      problem: "Commercial clients are demanding more proof of service and better reporting.",
      solution: "Automate the creation of professional, branded reports that justify your contracts. Keep commercial clients informed with hard data on conducive conditions and resolved issues, rather than just a signature on a slip."
    },
    {
      id: "training",
      icon: <GraduationCap className="text-primary" size={40} />,
      title: "For Training Managers",
      problem: "New hires take months to get up to speed on route specifics.",
      solution: "Use real property histories as training tools. New technicians can review past issues, equipment layouts, and access notes before they even arrive, significantly reducing the ride-along time required."
    }
  ];

  return (
    <>
      <Seo 
        title="Solutions by Role | ReadyLoq" 
        description="See how ReadyLoq solves specific challenges for pest control owners, operations managers, and training teams."
      />
      
      <section className="pt-24 pb-16 bg-slate-950 text-white">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-6">Solutions for the whole team.</h1>
            <p className="text-xl text-slate-300">
              Field service is a team sport. ReadyLoq aligns everyone around a single source of truth.
            </p>
          </div>
        </div>
      </section>

      <section className="py-24 bg-white">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {roles.map((role, i) => (
              <motion.div
                key={role.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="bg-slate-50 p-8 rounded-2xl border border-slate-200"
              >
                <div className="mb-6">{role.icon}</div>
                <h3 className="text-2xl font-bold mb-4 text-slate-900">{role.title}</h3>
                
                <div className="mb-6">
                  <h4 className="text-sm font-mono font-bold text-slate-500 uppercase tracking-wider mb-2">The Challenge</h4>
                  <p className="text-slate-700">{role.problem}</p>
                </div>
                
                <div>
                  <h4 className="text-sm font-mono font-bold text-primary uppercase tracking-wider mb-2">How ReadyLoq Helps</h4>
                  <p className="text-slate-700 leading-relaxed">{role.solution}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <CtaSection />
    </>
  );
}
