import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Check,
  Clock3,
  GraduationCap,
  Sparkles,
} from "lucide-react";

const activeFeatures = [
  "Offline-first mobile inspections",
  "AI-assisted findings and summaries",
  "Property memory and prior-visit context",
  "Professional client-ready reporting",
  "Voice-guided field workflows",
];

const plannedFeatures = [
  "Richer camera and wearable support",
  "Deeper operations and route insights",
  "More connected scheduling and inventory workflows",
  "Learning loops that improve field guidance",
];

export function ProductUpdates() {
  const confidenceLevel = 76;

  return (
    <section
      id="updates"
      className="relative overflow-hidden border-y border-slate-200 bg-slate-50 py-24"
    >
      <div className="absolute -right-24 top-16 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute -left-24 bottom-0 h-72 w-72 rounded-full bg-secondary/10 blur-3xl" />

      <div className="container relative z-10 mx-auto px-4 md:px-6">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55 }}
          className="mx-auto mb-14 max-w-3xl text-center"
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-white px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider text-primary shadow-sm">
            <Sparkles size={14} />
            Product updates
          </div>
          <h2 className="mb-5 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
            Built in the open. Focused on the field.
          </h2>
          <p className="text-lg leading-relaxed text-slate-600">
            A clear view of what teams can use today and where ReadyLoq is
            headed next. We share the product direction without exposing
            private customer or implementation details.
          </p>
        </motion.div>

        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_1fr_1.08fr]">
          <motion.div
            initial={{ opacity: 0, x: -18 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55 }}
            className="rounded-2xl border border-emerald-200 bg-white p-7 shadow-sm"
          >
            <div className="mb-7 flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-emerald-600">
                  Available now
                </p>
                <h3 className="text-2xl font-bold text-slate-900">
                  In the product
                </h3>
              </div>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <Check size={22} strokeWidth={2.5} />
              </div>
            </div>
            <ul className="space-y-4">
              {activeFeatures.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-slate-700">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <Check size={13} strokeWidth={3} />
                  </span>
                  <span className="leading-snug">{feature}</span>
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, delay: 0.08 }}
            className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"
          >
            <div className="mb-7 flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-secondary">
                  Planned
                </p>
                <h3 className="text-2xl font-bold text-slate-900">
                  On the way
                </h3>
              </div>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                <Clock3 size={21} />
              </div>
            </div>
            <ul className="space-y-4">
              {plannedFeatures.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-slate-700">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-secondary" />
                  <span className="leading-snug">{feature}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex items-center gap-2 border-t border-slate-100 pt-5 text-sm font-semibold text-slate-500">
              <span>Prioritized with field teams</span>
              <ArrowUpRight size={15} className="text-secondary" />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 18 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, delay: 0.16 }}
            className="relative overflow-hidden rounded-2xl bg-slate-950 p-7 text-white shadow-xl"
          >
            <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/20 blur-2xl" />
            <div className="relative">
              <div className="mb-8 flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <GraduationCap size={24} />
                </div>
                <div>
                  <p className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-primary">
                  FAIE confidence
                  </p>
                  <h3 className="text-2xl font-bold">Confidence is building</h3>
                </div>
              </div>

              <div
                className="mb-3 flex items-end justify-between"
                aria-label={`FAIE confidence level: ${confidenceLevel}%`}
              >
                <span className="text-sm text-slate-400">
                  Current confidence level
                </span>
                <span className="text-4xl font-bold tracking-tight text-white">
                  {confidenceLevel}%
                </span>
              </div>
              <div
                className="h-3 overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={confidenceLevel}
                aria-label="FAIE confidence level"
              >
                <motion.div
                  initial={{ width: 0 }}
                  whileInView={{ width: `${confidenceLevel}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 1, delay: 0.25, ease: "easeOut" }}
                  className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
                />
              </div>

              <p className="mt-6 leading-relaxed text-slate-300">
                FAIE’s confidence is growing as she connects photos, voice,
                and field context to useful next steps for technicians.
              </p>
              <div className="mt-6 border-t border-white/10 pt-5 text-sm text-slate-400">
                <span className="font-semibold text-slate-200">
                  Building toward:
                </span>{" "}
                dependable confidence across everyday inspections.
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}