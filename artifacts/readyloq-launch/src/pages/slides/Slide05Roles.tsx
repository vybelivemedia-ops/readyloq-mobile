export default function Slide05Roles() {
  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{ backgroundColor: '#0C0F1A', fontFamily: "'Inter', sans-serif", color: '#FFFFFF' }}
    >
      {/* Background accent shapes */}
      <div style={{ position: 'absolute', top: '-10vh', left: '0vw', width: '50vw', height: '50vw', borderRadius: '50%', backgroundColor: '#4F7FFF', opacity: 0.05, filter: 'blur(12vw)' }} />
      <div style={{ position: 'absolute', bottom: '-10vh', right: '0vw', width: '50vw', height: '50vw', borderRadius: '50%', backgroundColor: '#7C6BF0', opacity: 0.05, filter: 'blur(12vw)' }} />
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '4vw 4vw', opacity: 0.5, pointerEvents: 'none' }} />

      {/* Header */}
      <div style={{ position: 'absolute', top: '5vh', left: '5vw', display: 'flex', alignItems: 'center', gap: '1vw', zIndex: 10 }}>
        <div style={{ width: '2vw', height: '2vw', backgroundColor: '#4F7FFF', borderRadius: '0.4vw' }} />
        <span style={{ fontSize: '1.2vw', fontWeight: 700, letterSpacing: '-0.02em' }}>ReadyLoq</span>
      </div>
      <div style={{ position: 'absolute', top: '5vh', right: '5vw', fontSize: '1vw', color: 'rgba(255,255,255,0.5)', zIndex: 10 }}>2026</div>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 6vw' }}>

        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: '5vh' }}>
          <h2 style={{ fontSize: '4vw', fontWeight: 800, margin: 0, lineHeight: 1.1, letterSpacing: '-0.03em' }}>
            Built for two roles.{' '}
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>One platform.</span>
          </h2>
        </div>

        {/* Two columns */}
        <div style={{ display: 'flex', gap: '3vw', width: '100%' }}>

          {/* Technicians column */}
          <div style={{ flex: 1, backgroundColor: '#131726', border: '1px solid rgba(79,127,255,0.25)', borderRadius: '1vw', padding: '3vh 2.5vw', boxShadow: '0 0 0 1px rgba(79,127,255,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1vw', marginBottom: '3vh' }}>
              <div style={{ width: '2.8vw', height: '2.8vw', backgroundColor: '#4F7FFF', borderRadius: '0.5vw', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: '1.2vw', height: '1.4vw', backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: '0.2vw' }} />
              </div>
              <h3 style={{ fontSize: '2vw', fontWeight: 700, margin: 0, color: '#4F7FFF' }}>Technicians</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2.2vh' }}>
              <div style={{ display: 'flex', gap: '1vw', alignItems: 'flex-start' }}>
                <div style={{ marginTop: '0.4vh', width: '0.5vw', height: '0.5vw', borderRadius: '50%', backgroundColor: '#4F7FFF', flexShrink: 0 }} />
                <p style={{ fontSize: '1.2vw', fontWeight: 300, color: 'rgba(255,255,255,0.75)', margin: 0, lineHeight: 1.4 }}>
                  Clear access notes, gate codes, and bait station locations on every stop
                </p>
              </div>
              <div style={{ display: 'flex', gap: '1vw', alignItems: 'flex-start' }}>
                <div style={{ marginTop: '0.4vh', width: '0.5vw', height: '0.5vw', borderRadius: '50%', backgroundColor: '#4F7FFF', flexShrink: 0 }} />
                <p style={{ fontSize: '1.2vw', fontWeight: 300, color: 'rgba(255,255,255,0.75)', margin: 0, lineHeight: 1.4 }}>
                  Historical photos of past infestations — no guessing what worked before
                </p>
              </div>
              <div style={{ display: 'flex', gap: '1vw', alignItems: 'flex-start' }}>
                <div style={{ marginTop: '0.4vh', width: '0.5vw', height: '0.5vw', borderRadius: '50%', backgroundColor: '#4F7FFF', flexShrink: 0 }} />
                <p style={{ fontSize: '1.2vw', fontWeight: 300, color: 'rgba(255,255,255,0.75)', margin: 0, lineHeight: 1.4 }}>
                  Voice and AI assistance so documentation doesn't slow the job down
                </p>
              </div>
            </div>
          </div>

          {/* Management column */}
          <div style={{ flex: 1, backgroundColor: '#131726', border: '1px solid rgba(124,107,240,0.25)', borderRadius: '1vw', padding: '3vh 2.5vw', boxShadow: '0 0 0 1px rgba(124,107,240,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1vw', marginBottom: '3vh' }}>
              <div style={{ width: '2.8vw', height: '2.8vw', backgroundColor: '#7C6BF0', borderRadius: '0.5vw', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: '1.6vw', height: '1.2vw', backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: '0.2vw' }} />
              </div>
              <h3 style={{ fontSize: '2vw', fontWeight: 700, margin: 0, color: '#7C6BF0' }}>Management</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2.2vh' }}>
              <div style={{ display: 'flex', gap: '1vw', alignItems: 'flex-start' }}>
                <div style={{ marginTop: '0.4vh', width: '0.5vw', height: '0.5vw', borderRadius: '50%', backgroundColor: '#7C6BF0', flexShrink: 0 }} />
                <p style={{ fontSize: '1.2vw', fontWeight: 300, color: 'rgba(255,255,255,0.75)', margin: 0, lineHeight: 1.4 }}>
                  Callback intelligence and root-cause analysis by property
                </p>
              </div>
              <div style={{ display: 'flex', gap: '1vw', alignItems: 'flex-start' }}>
                <div style={{ marginTop: '0.4vh', width: '0.5vw', height: '0.5vw', borderRadius: '50%', backgroundColor: '#7C6BF0', flexShrink: 0 }} />
                <p style={{ fontSize: '1.2vw', fontWeight: 300, color: 'rgba(255,255,255,0.75)', margin: 0, lineHeight: 1.4 }}>
                  Onboard new techs in hours, not weeks
                </p>
              </div>
              <div style={{ display: 'flex', gap: '1vw', alignItems: 'flex-start' }}>
                <div style={{ marginTop: '0.4vh', width: '0.5vw', height: '0.5vw', borderRadius: '50%', backgroundColor: '#7C6BF0', flexShrink: 0 }} />
                <p style={{ fontSize: '1.2vw', fontWeight: 300, color: 'rgba(255,255,255,0.75)', margin: 0, lineHeight: 1.4 }}>
                  Automated proof-of-service reports for commercial accounts
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Footer */}
      <div style={{ position: 'absolute', bottom: '5vh', left: '5vw', fontSize: '0.9vw', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.06em' }}>READYLOQ, INC.</div>
      <div style={{ position: 'absolute', bottom: '5vh', right: '5vw', fontSize: '0.9vw', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>05 / 09</div>
    </div>
  );
}
