import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { GeminiDemoAssessment } from '@/lib/gemini-demo';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((t, i) => <li key={i}>{t}</li>)}
    </ul>
  );
}

export function AssessmentView({ result }: { result: GeminiDemoAssessment }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('unavailable');
      await navigator.clipboard.writeText(result.reportReadyFinding);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2500);
    } catch {
      setCopyState('error');
    }
  }

  return (
    <div className="space-y-3" data-testid="gemini-assessment">
      <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
        AI-assisted draft. A qualified technician must review it. It is not approved and not a definitive finding.
      </div>
      <Section title="Visible clues">
        <List items={result.observations.map((o, i) => `[${i}] ${o}`)} empty="No visible evidence was identified in this photo." />
      </Section>
      <Section title="Possible findings (hypotheses)">
        {result.hypotheses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hypothesis could be supported by this photo.</p>
        ) : (
          <ul className="space-y-3">
            {result.hypotheses.map((h, i) => (
              <li key={i} className="text-sm">
                <p className="font-medium">{h.finding}</p>
                <p className="text-muted-foreground">
                  Supporting clues: {h.evidenceIndices.length ? h.evidenceIndices.map((n) => `[${n}]`).join(' ') : 'none cited'}
                </p>
                <p className="text-muted-foreground">Uncertainty: {h.uncertainty}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Confidence (qualitative, not calibrated)">
        <p className="text-sm"><span className="font-semibold capitalize">{result.confidence.level}</span>. {result.confidence.explanation}</p>
      </Section>
      <Section title="Cannot determine from this photo">
        <List items={result.cannotDetermine} empty="No limitations were listed. Treat this as incomplete anyway." />
      </Section>
      <Section title="Next inspection checks">
        <List items={result.nextChecks} empty="No further checks were suggested." />
      </Section>
      <Section title="Report-ready draft (requires technician review)">
        <p className="whitespace-pre-wrap text-sm">{result.reportReadyFinding}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" variant="outline" onClick={copy} data-testid="button-copy-draft">
            {copyState === 'copied' ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
            {copyState === 'copied' ? 'Copied' : 'Copy draft'}
          </Button>
          <span role="status" className="text-xs text-muted-foreground">
            {copyState === 'error' && 'Could not access the clipboard. Select the text above and copy it manually.'}
          </span>
        </div>
      </Section>
      <p className="text-xs text-muted-foreground">Model: {result.model}. Demo only. Nothing is saved to inspection records or sync.</p>
    </div>
  );
}
