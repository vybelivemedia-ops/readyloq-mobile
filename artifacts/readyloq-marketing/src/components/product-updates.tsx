import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Check,
  Clock3,
  GraduationCap,
  Sparkles,
} from "lucide-react";

const activeFeatures = [
  "Local inspection evidence capture with deferred synchronization",
  "AI-assisted finding and summary drafts for review",
  "Property memory and prior-visit context",
  "Inspection reports with review and approval workflows",
  "Recorded inspection activity and inventory transactions",
];

const plannedFeatures = [
  "Expanded camera and wearable integrations",
  "Further operations and route insights",
  "Additional scheduling and inventory integrations",
  "Learning workflows to support field guidance",
];

export function ProductUpdates() {
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
            A clear view of implemented capabilities, ongoing validation, and
            product direction. Core workflows have automated regression coverage;
            that is not the same as end-to-end verification on every device.
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
                  Implemented capabilities
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
            <p className="mt-6 text-sm leading-relaxed text-slate-500">
              AI processing and synchronization depend on service availability
              and connectivity. Reports and AI suggestions require review.
            </p>
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
                  In validation
                  </p>
                  <h3 className="text-2xl font-bold">AI-assisted. Technician-reviewed.</h3>
                </div>
              </div>

              <p className="leading-relaxed text-slate-300">
                Voice Capture and multilingual commands are implemented and
                undergoing physical-device validation. Android transcription
                currently requires connectivity.
              </p>
              <p className="mt-4 leading-relaxed text-slate-300">
                Meta glasses capture is implemented but still in end-to-end
                physical-hardware validation. It is not a verified replacement
                for phone-camera capture.
              </p>
              <div className="mt-6 border-t border-white/10 pt-5 text-sm text-slate-400">
                <span className="font-semibold text-slate-200">
                  Being validated:
                </span>{" "}
                photo-analysis quality, spoken-command delivery, and wearable
                capture reliability in real inspections. No calibrated FAIE
                accuracy score is published here.
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}