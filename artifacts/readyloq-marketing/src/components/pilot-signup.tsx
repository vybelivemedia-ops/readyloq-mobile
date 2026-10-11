import { useRef, useState } from "react";
import { submitLead } from "@/lib/api";
import "./pilot-signup.css";

export function PilotSignup() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      await submitLead({ type: "contact", name: "Pilot signup", email: email.trim(), source: "readyloq-pilot" });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <section className="pilot-signup" aria-labelledby="pilot-h">
      <div className="pilot-signup__in">
        <h1 id="pilot-h">Yesterday's inspections, owner-ready by morning.</h1>
        <p>A tech finishes the job, the photos never land, and you eat the re-service and an hour chasing him for it.</p>
        <p>Built by a route supervisor who runs home, apartment, restaurant and commercial inspections himself every day.</p>
        <div aria-live="polite" data-testid="status-pilot">
          {done ? (
            <p className="pilot-signup__ok">Got it. Details are coming to your inbox.</p>
          ) : (
            <form onSubmit={onSubmit}>
              <label htmlFor="pilot-email">Where should the pilot details go?</label>
              <div className="pilot-signup__row">
                <input id="pilot-email" type="email" required autoComplete="email" value={email}
                  onChange={(e) => setEmail(e.target.value)} aria-describedby={error ? "pilot-err" : undefined}
                  data-testid="input-pilot-email" />
                <button type="submit" disabled={pending} data-testid="button-pilot-submit">Email me the pilot details</button>
              </div>
              {error && <p id="pilot-err" role="alert" className="pilot-signup__err">{error}</p>}
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
