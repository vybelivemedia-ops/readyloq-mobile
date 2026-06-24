import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Bug,
  ShieldCheck,
  Wrench,
  AlertTriangle,
  ListChecks,
} from "lucide-react";
import { useState } from "react";
import { VOCABULARY, CATEGORY_LABELS, type Category } from "@/lib/voice-intelligence";
import {
  PEST_GUIDES,
  TREATMENT_BEST_PRACTICES,
  STRUCTURAL_DEFICIENCIES,
  EXCLUSION_TECHNIQUES,
  INSPECTION_CHECKLISTS,
} from "@/lib/knowledge";

function Section({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof BookOpen;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {title}
        </h2>
      </div>
      {subtitle && <p className="text-xs text-muted-foreground mb-3">{subtitle}</p>}
      <div className={subtitle ? "space-y-2" : "space-y-2 mt-3"}>{children}</div>
    </div>
  );
}

function Collapsible({
  title,
  meta,
  badge,
  children,
}: {
  title: string;
  meta?: string;
  badge?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {meta && <span className="text-xl shrink-0">{meta}</span>}
          <p className="text-sm font-semibold truncate">{title}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {badge && (
            <span className="text-[10px] text-muted-foreground font-medium">{badge}</span>
          )}
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>
      {open && <div className="border-t border-border/40 px-4 py-3.5">{children}</div>}
    </div>
  );
}

function VocabCategory({ category }: { category: Category }) {
  const [open, setOpen] = useState(false);
  const meta = CATEGORY_LABELS[category];
  const terms = VOCABULARY.filter((t) => t.category === category);

  return (
    <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-xl">{meta.icon}</span>
          <div>
            <p className="text-sm font-semibold">{meta.en}</p>
            <p className="text-[10px] text-muted-foreground">
              {meta.es} · {meta.pt}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-muted-foreground font-medium">
            {terms.length} terms
          </span>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-border/40 divide-y divide-border/30">
          {terms.map((term) => (
            <div key={term.professional} className="px-4 py-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-base">{term.icon}</span>
                <p className="text-sm font-semibold">{term.professional}</p>
              </div>
              <div className="ml-6 space-y-1">
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-semibold">
                  Technicians may say
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {term.casual.en.slice(0, 3).join(", ")}
                </p>
                <div className="flex gap-3 pt-0.5">
                  <span className="text-[10px] text-primary/60">🇪🇸 {term.translations.es}</span>
                  <span className="text-[10px] text-primary/60">🇧🇷 {term.translations.pt}</span>
                </div>
                <p className="text-[10px] text-emerald-400/80 italic">{term.reportPhrase.en}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function KnowledgeCenter() {
  const categories: Category[] = [
    "rodents",
    "cockroaches",
    "termites",
    "carpenter_ants",
    "exclusion",
    "conducive",
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Knowledge Center</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Field reference for pest identification, treatment, exclusion, and inspections
        </p>
      </div>

      {/* Pest Identification Guides */}
      <Section
        icon={Bug}
        title="Pest Identification"
        subtitle="Tap a pest for the signs to look for and what it's commonly confused with."
      >
        {PEST_GUIDES.map((pest) => (
          <Collapsible key={pest.name} title={pest.name} meta={pest.icon}>
            <div className="space-y-3">
              <div>
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-semibold mb-1">
                  Signs
                </p>
                <ul className="space-y-1">
                  {pest.signs.map((s) => (
                    <li key={s} className="text-[12px] text-muted-foreground leading-relaxed flex gap-2">
                      <span className="text-primary/60 shrink-0">•</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-semibold mb-1">
                  Look for
                </p>
                <p className="text-[12px] text-muted-foreground leading-relaxed">{pest.lookFor}</p>
              </div>
              <div>
                <p className="text-[10px] text-amber-400/70 uppercase tracking-wider font-semibold mb-1">
                  Confused with
                </p>
                <p className="text-[12px] text-muted-foreground leading-relaxed">
                  {pest.confusedWith}
                </p>
              </div>
            </div>
          </Collapsible>
        ))}
      </Section>

      {/* Treatment Best Practices */}
      <Section
        icon={Wrench}
        title="Treatment Best Practices"
        subtitle="IPM-aligned guidance for durable, label-compliant results."
      >
        {TREATMENT_BEST_PRACTICES.map((topic) => (
          <Collapsible key={topic.title} title={topic.title}>
            <ul className="space-y-1.5">
              {topic.points.map((p) => (
                <li key={p} className="text-[12px] text-muted-foreground leading-relaxed flex gap-2">
                  <span className="text-primary/60 shrink-0">•</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </Collapsible>
        ))}
      </Section>

      {/* Structural Deficiencies / Conducive Conditions */}
      <Section
        icon={AlertTriangle}
        title="Structural Deficiencies"
        subtitle="Conducive conditions to flag — fixing these makes treatment last."
      >
        {STRUCTURAL_DEFICIENCIES.map((c) => (
          <div key={c.title} className="bg-card border border-border/60 rounded-2xl px-4 py-3.5">
            <p className="text-sm font-semibold mb-1">{c.title}</p>
            <p className="text-[12px] text-muted-foreground leading-relaxed">{c.description}</p>
            <p className="text-[11px] text-amber-400/80 leading-relaxed mt-1.5">
              <span className="font-semibold">Why it matters: </span>
              {c.why}
            </p>
          </div>
        ))}
      </Section>

      {/* Exclusion Techniques */}
      <Section
        icon={ShieldCheck}
        title="Exclusion Techniques"
        subtitle="Keep pests out by removing access — the most durable control."
      >
        {EXCLUSION_TECHNIQUES.map((t) => (
          <div key={t.title} className="bg-card border border-border/60 rounded-2xl px-4 py-3.5">
            <p className="text-sm font-semibold mb-1">{t.title}</p>
            <p className="text-[12px] text-muted-foreground leading-relaxed">{t.description}</p>
          </div>
        ))}
      </Section>

      {/* Inspection Checklists */}
      <Section
        icon={ListChecks}
        title="Inspection Checklists"
        subtitle="Area-by-area prompts so nothing gets missed on a walkthrough."
      >
        {INSPECTION_CHECKLISTS.map((area) => (
          <Collapsible key={area.area} title={area.area} badge={`${area.items.length} checks`}>
            <ul className="space-y-1.5">
              {area.items.map((item) => (
                <li
                  key={item}
                  className="text-[12px] text-muted-foreground leading-relaxed flex gap-2"
                >
                  <span className="text-primary/60 shrink-0">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Collapsible>
        ))}
      </Section>

      {/* Field Vocabulary Reference */}
      <Section
        icon={BookOpen}
        title="Field Vocabulary"
        subtitle="Tap any category for professional terminology, casual field descriptions, and translations in English, Spanish, and Portuguese."
      >
        {categories.map((cat) => (
          <VocabCategory key={cat} category={cat} />
        ))}
      </Section>
    </div>
  );
}
