export default function Slide03Solution() {
  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{ backgroundColor: '#0C0F1A', fontFamily: "'Inter', sans-serif", color: '#FFFFFF' }}
    >
      {/* Background accent shapes */}
      <div style={{ position: 'absolute', top: '10vh', left: '20vw', width: '40vw', height: '40vw', borderRadius: '50%', backgroundColor: '#7C6BF0', opacity: 0.07, filter: 'blur(12vw)' }} />
      <div style={{ position: 'absolute', bottom: '5vh', right: '5vw', width: '35vw', height: '35vw', borderRadius: '50%', backgroundColor: '#4F7FFF', opacity: 0.05, filter: 'blur(10vw)' }} />
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '4vw 4vw', opacity: 0.5, pointerEvents: 'none' }} />

      {/* Header */}
      <div style={{ position: 'absolute', top: '5vh', left: '5vw', display: 'flex', alignItems: 'center', gap: '1vw', zIndex: 10 }}>
        <div style={{ width: '2vw', height: '2vw', backgroundColor: '#4F7FFF', borderRadius: '0.4vw' }} />
        <span style={{ fontSize: '1.2vw', fontWeight: 700, letterSpacing: '-0.02em' }}>ReadyLoq</span>
      </div>
      <div style={{ position: 'absolute', top: '5vh', right: '5vw', fontSize: '1vw', color: 'rgba(255,255,255,0.5)', zIndex: 10 }}>2026</div>

      {/* Two-column layout */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', width: '90vw', margin: '0 auto', height: '100%', alignItems: 'center', gap: '6vw', paddingLeft: '5vw' }}>

        {/* Left: text */}
        <div style={{ flex: '1.1', display: 'flex', flexDirection: 'column', gap: '2.5vh' }}>
          <div style={{ display: 'inline-block', padding: '0.5vh 1vw', backgroundColor: 'rgba(124,107,240,0.15)', border: '1px solid rgba(124,107,240,0.3)', borderRadius: '2vw', color: '#7C6BF0', fontSize: '0.9vw', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', alignSelf: 'flex-start' }}>
            The Solution
          </div>
          <h2 style={{ fontSize: '3.2vw', fontWeight: 800, margin: 0, lineHeight: 1.15, letterSpacing: '-0.03em', textWrap: 'balance' }}>
            Don't let your best technicians walk away with your data.
          </h2>
          <p style={{ fontSize: '1.3vw', fontWeight: 300, color: 'rgba(255,255,255,0.7)', margin: 0, lineHeight: 1.6, maxWidth: '36vw' }}>
            ReadyLoq captures property knowledge, standardizes communication, and turns technician expertise into institutional memory that stays with the company — not the employee.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.8vh', marginTop: '1vh' }}>
            <div style={{ display: 'flex', gap: '1vw', alignItems: 'flex-start' }}>
              <div style={{ marginTop: '0.5vh', flexShrink: 0 }}>
                <svg width="1.4vw" height="1.4vw" viewBox="0 0 24 24" fill="none" stroke="#7C6BF0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p style={{ fontSize: '1.2vw', fontWeight: 400, color: 'rgba(255,255,255,0.8)', margin: 0, lineHeight: 1.4 }}>
                Living property records every tech can access on day one
              </p>
            </div>
            <div style={{ display: 'flex', gap: '1vw', alignItems: 'flex-start' }}>
              <div style={{ marginTop: '0.5vh', flexShrink: 0 }}>
                <svg width="1.4vw" height="1.4vw" viewBox="0 0 24 24" fill="none" stroke="#7C6BF0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p style={{ fontSize: '1.2vw', fontWeight: 400, color: 'rgba(255,255,255,0.8)', margin: 0, lineHeight: 1.4 }}>
                Offline-capable mobile app built for the field, not the office
              </p>
            </div>
            <div style={{ display: 'flex', gap: '1vw', alignItems: 'flex-start' }}>
              <div style={{ marginTop: '0.5vh', flexShrink: 0 }}>
                <svg width="1.4vw" height="1.4vw" viewBox="0 0 24 24" fill="none" stroke="#7C6BF0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p style={{ fontSize: '1.2vw', fontWeight: 400, color: 'rgba(255,255,255,0.8)', margin: 0, lineHeight: 1.4 }}>
                AI-powered inspection that documents findings automatically
              </p>
            </div>
          </div>
        </div>

        {/* Right: UI mockup card */}
        <div style={{ flex: '0.9', height: '68vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '100%', height: '100%', backgroundColor: '#131726', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1vw', boxShadow: '0 2vh 5vh rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Mock browser chrome */}
            <div style={{ padding: '1.2vw 1.5vw', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '0.5vw' }}>
              <div style={{ width: '0.7vw', height: '0.7vw', borderRadius: '50%', backgroundColor: '#FF5F56' }} />
              <div style={{ width: '0.7vw', height: '0.7vw', borderRadius: '50%', backgroundColor: '#FFBD2E' }} />
              <div style={{ width: '0.7vw', height: '0.7vw', borderRadius: '50%', backgroundColor: '#27C93F' }} />
            </div>
            {/* Mock content */}
            <div style={{ padding: '2vw', flex: 1, display: 'flex', flexDirection: 'column', gap: '1.8vh' }}>
              <div style={{ height: '1.6vw', width: '45%', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: '0.3vw' }} />
              <div style={{ display: 'flex', gap: '1vw' }}>
                <div style={{ flex: 1, height: '9vh', backgroundColor: 'rgba(79,127,255,0.1)', border: '1px solid rgba(79,127,255,0.2)', borderRadius: '0.5vw', padding: '1vw', display: 'flex', alignItems: 'center', gap: '0.8vw' }}>
                  <div style={{ width: '1.8vw', height: '1.8vw', backgroundColor: '#4F7FFF', borderRadius: '0.3vw', flexShrink: 0 }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.6vh' }}>
                    <div style={{ height: '0.7vw', width: '65%', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: '0.2vw' }} />
                    <div style={{ height: '0.5vw', width: '40%', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '0.2vw' }} />
                  </div>
                </div>
                <div style={{ flex: 1, height: '9vh', backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '0.5vw', padding: '1vw', display: 'flex', alignItems: 'center', gap: '0.8vw' }}>
                  <div style={{ width: '1.8vw', height: '1.8vw', backgroundColor: 'rgba(124,107,240,0.3)', borderRadius: '0.3vw', flexShrink: 0 }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.6vh' }}>
                    <div style={{ height: '0.7vw', width: '55%', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: '0.2vw' }} />
                    <div style={{ height: '0.5vw', width: '35%', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '0.2vw' }} />
                  </div>
                </div>
              </div>
              <div style={{ height: '18vh', width: '100%', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: '0.5vw', border: '1px dashed rgba(255,255,255,0.08)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1vh' }}>
                <div style={{ height: '0.7vw', width: '100%', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '0.2vw' }} />
                <div style={{ height: '0.7vw', width: '80%', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '0.2vw' }} />
                <div style={{ height: '0.7vw', width: '90%', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '0.2vw' }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ position: 'absolute', bottom: '5vh', left: '5vw', fontSize: '0.9vw', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.06em' }}>READYLOQ, INC.</div>
      <div style={{ position: 'absolute', bottom: '5vh', right: '5vw', fontSize: '0.9vw', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>03 / 09</div>
    </div>
  );
}
