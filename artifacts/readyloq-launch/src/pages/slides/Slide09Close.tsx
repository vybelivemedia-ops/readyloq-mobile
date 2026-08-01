export default function Slide09Close() {
  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{ backgroundColor: '#0C0F1A', fontFamily: "'Inter', sans-serif", color: '#FFFFFF' }}
    >
      {/* Background accent shapes — stronger for close slide */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '70vw', height: '70vw', borderRadius: '50%', backgroundColor: '#4F7FFF', opacity: 0.06, filter: 'blur(18vw)' }} />
      <div style={{ position: 'absolute', bottom: '-20vh', right: '-10vw', width: '45vw', height: '45vw', borderRadius: '50%', backgroundColor: '#7C6BF0', opacity: 0.08, filter: 'blur(10vw)' }} />
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '4vw 4vw', opacity: 0.5, pointerEvents: 'none' }} />

      {/* Header */}
      <div style={{ position: 'absolute', top: '5vh', left: '5vw', display: 'flex', alignItems: 'center', gap: '1vw', zIndex: 10 }}>
        <div style={{ width: '2vw', height: '2vw', backgroundColor: '#4F7FFF', borderRadius: '0.4vw' }} />
        <span style={{ fontSize: '1.2vw', fontWeight: 700, letterSpacing: '-0.02em' }}>ReadyLoq</span>
      </div>
      <div style={{ position: 'absolute', top: '5vh', right: '5vw', fontSize: '1vw', color: 'rgba(255,255,255,0.5)', zIndex: 10 }}>2026</div>

      {/* Center card */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ maxWidth: '58vw', textAlign: 'center', padding: '5vh 5vw', backgroundColor: 'rgba(19,23,38,0.7)', backdropFilter: 'blur(2vw)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1.5vw', boxShadow: '0 4vh 8vh rgba(0,0,0,0.5)' }}>

          {/* Icon */}
          <div style={{ width: '4vw', height: '4vw', backgroundColor: '#4F7FFF', borderRadius: '1vw', margin: '0 auto 3vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="2vw" height="2vw" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <h2 style={{ fontSize: '4vw', fontWeight: 900, margin: '0 0 2.5vh', lineHeight: 1.1, letterSpacing: '-0.03em', textWrap: 'balance' }}>
            Stop losing knowledge.
            <br />
            Start building it.
          </h2>

          <p style={{ fontSize: '1.3vw', fontWeight: 300, color: 'rgba(255,255,255,0.65)', margin: '0 0 4vh', lineHeight: 1.6, maxWidth: '44vw', textWrap: 'pretty' }}>
            Every day without ReadyLoq is another day your company's most valuable asset — its operational intelligence — lives only in your technicians' heads.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2vh', alignItems: 'center' }}>
            <p style={{ fontSize: '1.2vw', fontWeight: 400, color: 'rgba(255,255,255,0.8)', margin: 0 }}>
              Start free at <span style={{ color: '#4F7FFF', fontWeight: 600 }}>readyloq.com</span>
            </p>
            <p style={{ fontSize: '1.2vw', fontWeight: 400, color: 'rgba(255,255,255,0.8)', margin: 0 }}>
              Request a live demo for your team
            </p>
            <p style={{ fontSize: '1.2vw', fontWeight: 400, color: 'rgba(255,255,255,0.8)', margin: 0 }}>
              Questions? <span style={{ color: '#7C6BF0', fontWeight: 500 }}>hello@readyloq.com</span>
            </p>
          </div>

        </div>
      </div>

      {/* Footer */}
      <div style={{ position: 'absolute', bottom: '5vh', left: '5vw', fontSize: '0.9vw', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.06em' }}>READYLOQ, INC.</div>
      <div style={{ position: 'absolute', bottom: '5vh', right: '5vw', fontSize: '0.9vw', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>09 / 09</div>
    </div>
  );
}
