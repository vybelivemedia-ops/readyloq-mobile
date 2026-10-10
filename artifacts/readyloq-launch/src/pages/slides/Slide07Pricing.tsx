export default function Slide07Pricing() {
  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{ backgroundColor: '#0C0F1A', fontFamily: "'Inter', sans-serif", color: '#FFFFFF' }}
    >
      {/* Background accent shapes */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '60vw', height: '60vw', borderRadius: '50%', backgroundColor: '#4F7FFF', opacity: 0.04, filter: 'blur(16vw)' }} />
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '4vw 4vw', opacity: 0.5, pointerEvents: 'none' }} />

      {/* Header */}
      <div style={{ position: 'absolute', top: '5vh', left: '5vw', display: 'flex', alignItems: 'center', gap: '1vw', zIndex: 10 }}>
        <div style={{ width: '2vw', height: '2vw', backgroundColor: '#4F7FFF', borderRadius: '0.4vw' }} />
        <span style={{ fontSize: '1.2vw', fontWeight: 700, letterSpacing: '-0.02em' }}>ReadyLoq</span>
      </div>
      <div style={{ position: 'absolute', top: '5vh', right: '5vw', fontSize: '1vw', color: 'rgba(255,255,255,0.5)', zIndex: 10 }}>2026</div>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 8vw' }}>

        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: '4.5vh' }}>
          <h2 style={{ fontSize: '4vw', fontWeight: 800, margin: 0, lineHeight: 1.1, letterSpacing: '-0.03em' }}>
            Simple pricing.{' '}
            <span style={{ color: '#4F7FFF' }}>Serious results.</span>
          </h2>
        </div>

        {/* Two pricing cards */}
        <div style={{ display: 'flex', gap: '3vw', width: '100%', marginBottom: '3vh' }}>

          {/* Solo card */}
          <div style={{ flex: 1, backgroundColor: '#131726', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1vw', padding: '3.5vh 2.5vw', display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: '2.5vh' }}>
              <div style={{ fontSize: '1vw', fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1vh' }}>Solo Operator</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4vw' }}>
                <span style={{ fontSize: '4.5vw', fontWeight: 900, color: '#FFFFFF', lineHeight: 1 }}>$69</span>
                <span style={{ fontSize: '1.2vw', fontWeight: 300, color: 'rgba(255,255,255,0.5)' }}>/ month</span>
              </div>
            </div>
            <div style={{ width: '100%', height: '1px', backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: '2.5vh' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.8vh', flex: 1 }}>
              <div style={{ display: 'flex', gap: '0.8vw', alignItems: 'center' }}>
                <svg width="1.2vw" height="1.2vw" viewBox="0 0 24 24" fill="none" stroke="#4F7FFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span style={{ fontSize: '1.15vw', fontWeight: 300, color: 'rgba(255,255,255,0.8)' }}>Full AI inspection</span>
              </div>
              <div style={{ display: 'flex', gap: '0.8vw', alignItems: 'center' }}>
                <svg width="1.2vw" height="1.2vw" viewBox="0 0 24 24" fill="none" stroke="#4F7FFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span style={{ fontSize: '1.15vw', fontWeight: 300, color: 'rgba(255,255,255,0.8)' }}>Offline sync</span>
              </div>
              <div style={{ display: 'flex', gap: '0.8vw', alignItems: 'center' }}>
                <svg width="1.2vw" height="1.2vw" viewBox="0 0 24 24" fill="none" stroke="#4F7FFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span style={{ fontSize: '1.15vw', fontWeight: 300, color: 'rgba(255,255,255,0.8)' }}>Property records</span>
              </div>
            </div>
            <div style={{ marginTop: '2.5vh', fontSize: '1.05vw', fontWeight: 300, color: 'rgba(255,255,255,0.45)' }}>
              Ideal for owner-operators and 1–3 tech teams
            </div>
          </div>

          {/* Growth Team card */}
          <div style={{ flex: 1, backgroundColor: '#0F1929', border: '1px solid rgba(79,127,255,0.4)', borderRadius: '1vw', padding: '3.5vh 2.5vw', display: 'flex', flexDirection: 'column', boxShadow: '0 0 3vw rgba(79,127,255,0.1)' }}>
            <div style={{ display: 'inline-block', padding: '0.4vh 0.8vw', backgroundColor: '#4F7FFF', borderRadius: '0.4vw', fontSize: '0.8vw', fontWeight: 700, color: '#FFFFFF', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '2vh', alignSelf: 'flex-start' }}>
              Most Popular
            </div>
            <div style={{ marginBottom: '2.5vh' }}>
              <div style={{ fontSize: '1vw', fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1vh' }}>Growth Team</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4vw' }}>
                <span style={{ fontSize: '4.5vw', fontWeight: 900, color: '#4F7FFF', lineHeight: 1 }}>$129</span>
                <span style={{ fontSize: '1.2vw', fontWeight: 300, color: 'rgba(255,255,255,0.5)' }}>/ month base + $39 / seat</span>
              </div>
            </div>
            <div style={{ width: '100%', height: '1px', backgroundColor: 'rgba(79,127,255,0.2)', marginBottom: '2.5vh' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.8vh', flex: 1 }}>
              <div style={{ display: 'flex', gap: '0.8vw', alignItems: 'center' }}>
                <svg width="1.2vw" height="1.2vw" viewBox="0 0 24 24" fill="none" stroke="#4F7FFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span style={{ fontSize: '1.15vw', fontWeight: 300, color: 'rgba(255,255,255,0.8)' }}>Owner, Manager, Sales Lead, Tech roles</span>
              </div>
              <div style={{ display: 'flex', gap: '0.8vw', alignItems: 'center' }}>
                <svg width="1.2vw" height="1.2vw" viewBox="0 0 24 24" fill="none" stroke="#4F7FFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span style={{ fontSize: '1.15vw', fontWeight: 300, color: 'rgba(255,255,255,0.8)' }}>Pipeline tracking + hot-zone mapping</span>
              </div>
              <div style={{ display: 'flex', gap: '0.8vw', alignItems: 'center' }}>
                <svg width="1.2vw" height="1.2vw" viewBox="0 0 24 24" fill="none" stroke="#4F7FFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span style={{ fontSize: '1.15vw', fontWeight: 300, color: 'rgba(255,255,255,0.8)' }}>Broadcast alerts to your team</span>
              </div>
            </div>
            <div style={{ marginTop: '2.5vh', fontSize: '1.05vw', fontWeight: 300, color: 'rgba(255,255,255,0.45)' }}>
              Multi-operator platform for growing teams
            </div>
          </div>

        </div>

        {/* Trial note */}
        <p style={{ fontSize: '1.1vw', fontWeight: 300, color: 'rgba(255,255,255,0.45)', textAlign: 'center', margin: 0 }}>
          Both plans include a 14-day free trial. No credit card required.
        </p>

      </div>

      {/* Footer */}
      <div style={{ position: 'absolute', bottom: '5vh', left: '5vw', fontSize: '0.9vw', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.06em' }}>READYLOQ, INC.</div>
      <div style={{ position: 'absolute', bottom: '5vh', right: '5vw', fontSize: '0.9vw', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>07 / 09</div>
    </div>
  );
}
