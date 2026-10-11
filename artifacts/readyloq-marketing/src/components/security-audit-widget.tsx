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
// 100-point answer summary, not a measured security or compliance score.

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
    eyebrow: "Recorded Actions & Access Control",
    question:
      "Does your current software record stock transactions and restrict management actions to authorized roles?",
    options: [
      { label: "We record transactions and regularly review role permissions", points: 2 },
      { label: "Some records or permissions need review", points: 1 },
      { label: "No / Not sure", points: 0 },
    ],
    readyloqAnswer:
      "ReadyLoq records inventory transactions in a protected ledger and uses role-based checks for restricted API actions. This is not a guarantee of immutable records for every management action or complete audit coverage.",
  },
  {
    icon: <Boxes size={22} />,
    eyebrow: "Inventory Transaction Records",
    question:
      "Can your team review recorded warehouse and truck-stock transfers when investigating a discrepancy?",
    options: [
      { label: "We record transfers and review discrepancies", points: 2 },
      { label: "We can usually figure it out with some digging", points: 1 },
      { label: "We just re-count and move on", points: 0 },
    ],
    readyloqAnswer:
      "ReadyLoq tracks recorded stock transfers and adjustments so managers can investigate discrepancies. Record completeness depends on what teams enter; this is not a complete chemical chain-of-custody guarantee or automatic physical-stock reconciliation.",
  },
  {
    icon: <Lock size={22} />,
    eyebrow: "Data Isolation & Security",
    question:
      "Does your team review company-level data access and verify that sensitive information is shared only with authorized users?",
    options: [
      { label: "We review access and test the relevant controls", points: 2 },
      { label: "Some access controls still need verification", points: 1 },
      { label: "No / Not sure", points: 0 },
    ],
    readyloqAnswer:
      "ReadyLoq uses authenticated, tenant-scoped API checks and role permissions for company data. These controls have regression coverage, but do not constitute a security certification or eliminate security risks. Company-level access is not a promise of separate isolation for every location.",
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
      label: "Areas to Review",
      tone: "red",
      icon: <ShieldX size={28} />,
      summary:
        "Your answers suggest areas to discuss with your team. This questionnaire has not tested your software, records, or security controls.",
    };
  }
  if (scorePct < 75) {
    return {
      label: "Some Practices Reported",
      tone: "yellow",
      icon: <ShieldAlert size={28} />,
      summary:
        "You reported some practices in place and others that may need review. Verify them independently before drawing security or compliance conclusions.",
    };
  }
  return {
    label: "More Practices Reported",
    tone: "green",
    icon: <ShieldCheck size={28} />,
    summary:
      "You reported practices across these topics. This does not verify their effectiveness, certify compliance, or establish that your system is secure.",
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
              <span className="text-xs font-mono text-slate-400">Informational Self-Assessment</span>
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
                    {step === QUESTIONS.length - 1 ? "See My Summary" : "Next Step"} <ArrowRight size={16} />
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
                  <p className="text-sm font-semibold text-slate-500 mb-2">Answer summary — not a security rating</p>
                  <div className="text-6xl font-bold text-slate-900 mb-2" data-testid="text-audit-score">
                    {scorePct}
                    <span className="text-2xl text-slate-400">/100</span>
                  </div>
                  <p className="text-slate-600 max-w-xl mx-auto">{tier.summary}</p>
                  <p className="mt-4 text-sm text-slate-500 max-w-xl mx-auto">
                    Calculated only from your three answers. Informational only:
                    not a security audit, compliance certification, or proof of security.
                  </p>
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
                              {gap ? "You reported an area for review." : "You reported practices in this area."}
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
                      Discuss ReadyLoq's Controls <ArrowRight size={16} />
                    </Button>
                  </Link>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={restart}
                    data-testid="button-audit-restart"
                    className="w-full sm:w-auto"
                  >
                    <RotateCcw size={16} /> Retake Self-Assessment
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
