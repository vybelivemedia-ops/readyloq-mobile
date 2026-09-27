import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Lock,
  ClipboardList,
  Boxes,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  RotateCcw,
} from "lucide-react";

// ─── Quiz content ───────────────────────────────────────────────────────────
//
// Each question scores 0-2 points per answer. Max total = 6, scaled to a
// 100-point "security score" for the result screen.

interface AuditOption {
  label: string;
  points: 0 | 1 | 2;
}

interface AuditQuestion {
  icon: React.ReactNode;
  eyebrow: string;
  question: string;
  options: AuditOption[];
  /** What ReadyLoq actually does for this category — shown in the result breakdown. */
  readyloqAnswer: string;
}

const QUESTIONS: AuditQuestion[] = [
  {
    icon: <ClipboardList size={22} />,
    eyebrow: "Audit Trails & Access Control",
    question:
      "Does your current software provide immutable audit trails for every chemical transfer and management action, with role-based access control (RBAC) so technicians can't alter management data?",
    options: [
      { label: "Yes, every action is logged and access-controlled", points: 2 },
      { label: "Some logging, but roles aren't well enforced", points: 1 },
      { label: "No / Not sure", points: 0 },
    ],
    readyloqAnswer:
      "Every chemical transfer, override, and management action writes to an append-only record. Access follows a strict role hierarchy — technician < sales < manager < owner — enforced on every API call, not just hidden in the UI.",
  },
  {
    icon: <Boxes size={22} />,
    eyebrow: "Inventory & Chemical Custody",
    question:
      "When a technician's truck stock doesn't match your warehouse records, can you trace the exact transaction that caused it — or does someone just re-count and guess?",
    options: [
      { label: "Every transfer is logged and traceable to the source", points: 2 },
      { label: "We can usually figure it out with some digging", points: 1 },
      { label: "We just re-count and move on", points: 0 },
    ],
    readyloqAnswer:
      "Every ounce of product moving between warehouse and truck posts to a transaction ledger. Discrepancies are reconciled automatically and flagged — not discovered three weeks later during a compliance audit.",
  },
  {
    icon: <Lock size={22} />,
    eyebrow: "Data Isolation & Security",
    question:
      "If your software serves multiple client companies or locations, can you guarantee one location's staff can never see another's records, with data encrypted end-to-end?",
    options: [
      { label: "Yes — strict isolation and encryption everywhere", points: 2 },
      { label: "Mostly, but I couldn't prove it under audit", points: 1 },
      { label: "No / Not sure", points: 0 },
    ],
    readyloqAnswer:
      "Every record is scoped to a company at the database layer — no cross-tenant query can ever return another company's data — and all traffic is encrypted in transit. The architecture is built around SOC 2-aligned controls from day one.",
  },
];

const MAX_SCORE = QUESTIONS.reduce((sum, q) => sum + Math.max(...q.options.map((o) => o.points)), 0);

type Tier = {
  label: string;
  tone: "red" | "yellow" | "green";
  icon: React.ReactNode;
  summary: string;
};

function getTier(scorePct: number): Tier {
  if (scorePct < 40) {
    return {
      label: "High Risk — Audit Gap",
      tone: "red",
      icon: <ShieldX size={28} />,
      summary:
        "Your current setup likely can't withstand a real compliance audit or a data-loss incident. Chemical custody and access control are probably tracked informally, if at all.",
    };
  }
  if (scorePct < 75) {
    return {
      label: "Moderate Risk — Partial Controls",
      tone: "yellow",
      icon: <ShieldAlert size={28} />,
      summary:
        "You have some controls in place, but gaps in traceability or access enforcement mean you'd struggle to prove compliance on demand.",
    };
  }
  return {
    label: "Strong Foundation",
    tone: "green",
    icon: <ShieldCheck size={28} />,
    summary:
      "You're ahead of most operations in this industry. Even so, most legacy platforms can't produce a real-time, tamper-evident audit trail on demand — see how ReadyLoq closes that last gap.",
  };
}

const toneClasses: Record<Tier["tone"], string> = {
  red: "bg-destructive/10 text-destructive border-destructive/30",
  yellow: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  green: "bg-primary/10 text-primary border-primary/30",
};

export function SecurityAuditWidget() {
  const [step, setStep] = useState(0); // 0..QUESTIONS.length-1 = questions, QUESTIONS.length = results
  const [answers, setAnswers] = useState<(number | null)[]>(QUESTIONS.map(() => null));

  const isResults = step >= QUESTIONS.length;
  const totalPoints = answers.reduce<number>((sum, a) => sum + (a ?? 0), 0);
  const scorePct = Math.round((totalPoints / MAX_SCORE) * 100);
  const tier = getTier(scorePct);

  function selectAnswer(points: number) {
    setAnswers((prev) => {
      const next = [...prev];
      next[step] = points;
      return next;
    });
  }

  function goNext() {
    setStep((s) => Math.min(s + 1, QUESTIONS.length));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  function restart() {
    setAnswers(QUESTIONS.map(() => null));
    setStep(0);
  }

  const currentAnswer = isResults ? null : answers[step];

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white border border-slate-200 rounded-3xl shadow-xl overflow-hidden">
        {!isResults && (
          <div className="px-6 md:px-10 pt-8">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-primary">
                Step {step + 1} of {QUESTIONS.length}
              </span>
              <span className="text-xs font-mono text-slate-400">Security Self-Audit</span>
            </div>
            <Progress value={((step + 1) / QUESTIONS.length) * 100} />
          </div>
        )}

        <div className="p-6 md:p-10">
          <AnimatePresence mode="wait">
            {!isResults ? (
              <motion.div
                key={`question-${step}`}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    {QUESTIONS[step].icon}
                  </div>
                  <h4 className="text-sm font-mono font-bold uppercase tracking-wider text-slate-500">
                    {QUESTIONS[step].eyebrow}
                  </h4>
                </div>
                <p className="text-xl md:text-2xl font-bold text-slate-900 mb-8 leading-snug">
                  {QUESTIONS[step].question}
                </p>

                <div className="space-y-3 mb-10" role="radiogroup" aria-label={QUESTIONS[step].eyebrow}>
                  {QUESTIONS[step].options.map((opt, i) => {
                    const selected = currentAnswer === opt.points;
                    return (
                      <button
                        key={i}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => selectAnswer(opt.points)}
                        data-testid={`audit-option-${step}-${i}`}
                        className={`w-full flex items-center gap-4 text-left px-5 py-4 rounded-xl border-2 transition-colors ${
                          selected
                            ? "border-primary bg-primary/5"
                            : "border-slate-200 hover:border-slate-300 bg-white"
                        }`}
                      >
                        <span
                          className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            selected ? "border-primary" : "border-slate-300"
                          }`}
                        >
                          {selected && <span className="w-2.5 h-2.5 rounded-full bg-primary" />}
                        </span>
                        <span className={`font-medium ${selected ? "text-slate-900" : "text-slate-600"}`}>
                          {opt.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between">
                  <Button
                    variant="ghost"
                    onClick={goBack}
                    disabled={step === 0}
                    data-testid="button-audit-back"
                    className="text-slate-500"
                  >
                    <ArrowLeft size={16} /> Back
                  </Button>
                  <Button
                    onClick={goNext}
                    disabled={currentAnswer === null}
                    data-testid="button-audit-next"
                  >
                    {step === QUESTIONS.length - 1 ? "See My Score" : "Next Step"} <ArrowRight size={16} />
                  </Button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <div className="text-center mb-10">
                  <div
                    className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-sm font-bold mb-6 ${toneClasses[tier.tone]}`}
                  >
                    {tier.icon}
                    {tier.label}
                  </div>
                  <div className="text-6xl font-bold text-slate-900 mb-2" data-testid="text-audit-score">
                    {scorePct}
                    <span className="text-2xl text-slate-400">/100</span>
                  </div>
                  <p className="text-slate-600 max-w-xl mx-auto">{tier.summary}</p>
                </div>

                <div className="space-y-4 mb-10">
                  {QUESTIONS.map((q, i) => {
                    const points = answers[i] ?? 0;
                    const maxPts = Math.max(...q.options.map((o) => o.points));
                    const gap = points < maxPts;
                    return (
                      <div key={i} className="bg-slate-50 border border-slate-100 rounded-2xl p-5">
                        <div className="flex items-start gap-3 mb-3">
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              gap ? "bg-amber-500/10 text-amber-600" : "bg-primary/10 text-primary"
                            }`}
                          >
                            {gap ? <ShieldAlert size={16} /> : <CheckCircle2 size={16} />}
                          </div>
                          <div>
                            <p className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500 mb-1">
                              {q.eyebrow}
                            </p>
                            <p className="text-sm text-slate-500">
                              {gap ? "Gap identified in your current setup." : "Solid answer — here's how ReadyLoq goes further:"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3 pl-11">
                          <ShieldCheck size={16} className="text-primary flex-shrink-0 mt-0.5" />
                          <p className="text-sm text-slate-700">
                            <span className="font-semibold text-slate-900">ReadyLoq: </span>
                            {q.readyloqAnswer}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <Link href="/demo">
                    <Button size="lg" className="w-full sm:w-auto px-8" data-testid="button-audit-cta-demo">
                      Get Your Full Security Deep-Dive <ArrowRight size={16} />
                    </Button>
                  </Link>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={restart}
                    data-testid="button-audit-restart"
                    className="w-full sm:w-auto"
                  >
                    <RotateCcw size={16} /> Retake Audit
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
