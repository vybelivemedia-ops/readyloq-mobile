import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { Activity, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AssessmentView } from '@/components/gemini-demo/assessment-view';
import { analyzeGeminiPhoto, readPhotoBase64, checkGeminiDemoServer, GEMINI_DEMO_BUILD, GEMINI_DEMO_PARSER, type DemoServerInfo, type GeminiDemoAssessment } from '@/lib/gemini-demo';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type Mime = (typeof TYPES)[number];
const MAX_BYTES = 5 * 1024 * 1024;

export function GeminiDemo() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeminiDemoAssessment | null>(null);
  const [server, setServer] = useState<DemoServerInfo | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const runId = useRef(0);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('dark');
    return () => {
      runId.current++;
      ctrl.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const deadline = window.setTimeout(() => controller.abort(), 10_000);
    checkGeminiDemoServer(controller.signal)
      .then(info => { if (alive) setServer(info); })
      .catch(() => { if (alive) setVersionError("Could not verify the demo server within 10 seconds. Reload the current workspace preview; no analysis has been sent."); })
      .finally(() => window.clearTimeout(deadline));
    return () => { alive = false; controller.abort(); window.clearTimeout(deadline); };
  }, []);

  function cancel() {
    runId.current++;
    ctrl.current?.abort();
    ctrl.current = null;
    setPending(false);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    cancel();
    setResult(null);
    setError(null);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setPreviewUrl(null);
    setFile(null);
    if (!(TYPES as readonly string[]).includes(f.type)) return setError('Use a JPEG, PNG or WebP photo.');
    if (f.size > MAX_BYTES) return setError('That photo is larger than 5 MB. Choose a smaller one.');
    const url = URL.createObjectURL(f);
    urlRef.current = url;
    setPreviewUrl(url);
    setFile(f);
  }

  async function analyze() {
    if (!file || pending || ctrl.current || !server?.ready) return;
    const id = ++runId.current;
    const c = new AbortController();
    ctrl.current = c;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const imageBase64 = await readPhotoBase64(file, c.signal);
      if (id !== runId.current || c.signal.aborted) return;
      const trimmed = notes.trim();
      const out = await analyzeGeminiPhoto(
        { imageBase64, mimeType: file.type as Mime, ...(trimmed ? { notes: trimmed } : {}) },
        c.signal,
      );
      if (id !== runId.current) return;
      setResult(out);
    } catch (err) {
      if (id !== runId.current || c.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Analysis failed. Please try again.');
    } finally {
      if (id === runId.current) {
        setPending(false);
        ctrl.current = null;
      }
    }
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border bg-card/50 px-4 py-3 md:px-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Activity className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold tracking-wide">ReadyLoq</span>
          <span className="hidden text-sm text-muted-foreground sm:inline">Gemini inspection demo</span>
        </div>
        <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-portal">
          <ArrowLeft className="h-4 w-4" /> Back to portal
        </Link>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 md:px-8">
        <div className="max-w-2xl space-y-2">
          <h1 className="text-2xl font-semibold">Gemini inspection demo</h1>
          <p className="text-sm font-medium text-primary">Powered by Gemini 2.5 Flash · sample photos only</p>
          <p className="text-sm text-muted-foreground">
            AI-assisted and requires technician review. Use non-sensitive sample photos only. The photo is sent to Gemini for analysis
            and is not saved by ReadyLoq. This demo never writes to inspection records or sync.
          </p>
          <div className="rounded-md border border-border p-3 text-xs text-muted-foreground" data-testid="demo-version-status">
            <p>Client build: {GEMINI_DEMO_BUILD} · parser {GEMINI_DEMO_PARSER}</p>
            <p>Server build: {server?.build ?? 'checking'} · parser {server?.parser ?? 'checking'}</p>
            <p className="break-all">API origin: {window.location.origin}</p>
            <p role={versionError || (server && !server.ready) ? 'alert' : 'status'}>
              {versionError ?? server?.message ?? 'Checking demo client/server compatibility…'}
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-border bg-card">
              {previewUrl ? (
                <img src={previewUrl} alt="Selected sample inspection photo" className="h-full w-full object-contain" />
              ) : (
                <p className="px-6 text-center text-sm text-muted-foreground">No photo selected. JPEG, PNG or WebP, up to 5 MB.</p>
              )}
            </div>
            <label className="block space-y-1.5 text-sm font-medium">
              Photo
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={onPick}
                data-testid="input-photo"
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground"
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Notes (optional)
              <Textarea value={notes} disabled={pending} maxLength={1500} onChange={(e) => { setNotes(e.target.value); setResult(null); }} placeholder="Context a technician would add" data-testid="input-notes" />
              <span className="block text-right text-xs text-muted-foreground">{notes.length}/1500</span>
            </label>
            <div className="flex gap-3">
              <Button type="button" onClick={analyze} disabled={!file || pending || !server?.ready} data-testid="button-analyze">
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {pending ? 'Analyzing' : error && file ? 'Retry analysis' : 'Analyze photo'}
              </Button>
              {pending && (
                <Button type="button" variant="outline" onClick={cancel} data-testid="button-cancel">Cancel</Button>
              )}
            </div>
          </div>

          <div aria-live="polite">
            {error && (
              <div role="alert" className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
                {error}{file ? ' Your photo is still selected, so you can retry.' : ''}
              </div>
            )}
            {pending && (
              <div className="space-y-3" data-testid="gemini-pending">
                <p className="text-sm text-muted-foreground">Gemini is reviewing the photo. This can take several seconds.</p>
                {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />)}
              </div>
            )}
            {!pending && result && <AssessmentView result={result} />}
            {!pending && !result && !error && (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Results will appear here after you choose a photo and run the analysis.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default GeminiDemo;
