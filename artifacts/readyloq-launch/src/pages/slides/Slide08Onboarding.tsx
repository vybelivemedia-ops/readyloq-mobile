export default function Slide08Onboarding() {
  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{ backgroundColor: '#0C0F1A', fontFamily: "'Inter', sans-serif", color: '#FFFFFF' }}
    >
      {/* Background accent shapes */}
      <div style={{ position: 'absolute', top: '-15vh', right: '-5vw', width: '45vw', height: '45vw', borderRadius: '50%', backgroundColor: '#4F7FFF', opacity: 0.05, filter: 'blur(10vw)' }} />
      <div style={{ position: 'absolute', bottom: '-20vh', left: '-10vw', width: '50vw', height: '50vw', borderRadius: '50%', backgroundColor: '#7C6BF0', opacity: 0.05, filter: 'blur(12vw)' }} />
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '4vw 4vw', opacity: 0.5, pointerEvents: 'none' }} />

      {/* Header */}
      <div style={{ position: 'absolute', top: '5vh', left: '5vw', display: 'flex', alignItems: 'center', gap: '1vw', zIndex: 10 }}>
        <div style={{ width: '2vw', height: '2vw', backgroundColor: '#4F7FFF', borderRadius: '0.4vw' }} />
        <span style={{ fontSize: '1.2vw', fontWeight: 700, letterSpacing: '-0.02em' }}>ReadyLoq</span>
      </div>
      <div style={{ position: 'absolute', top: '5vh', right: '5vw', fontSize: '1vw', color: 'rgba(255,255,255,0.5)', zIndex: 10 }}>2026</div>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 10vw' }}>

        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: '5vh' }}>
          <div style={{ display: 'inline-block', padding: '0.5vh 1.2vw', backgroundColor: 'rgba(39,201,63,0.12)', border: '1px solid rgba(39,201,63,0.25)', borderRadius: '2vw', color: '#27C93F', fontSize: '0.9vw', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '2.5vh' }}>
            Getting Started
          </div>
          <h2 style={{ fontSize: '4vw', fontWeight: 800, margin: 0, lineHeight: 1.1, letterSpacing: '-0.03em' }}>
            Up and running in 15 minutes.
          </h2>
        </div>

        {/* Four steps */}
        <div style={{ display: 'flex', gap: '2vw', width: '100%' }}>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '3vh 2vw', backgroundColor: '#131726', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '0.8vw', gap: '1.5vh' }}>
            <div style={{ width: '3.5vw', height: '3.5vw', borderRadius: '50%', backgroundColor: 'rgba(79,127,255,0.15)', border: '1px solid rgba(79,127,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '1.6vw', fontWeight: 800, color: '#4F7FFF' }}>1</span>
            </div>
            <h4 style={{ fontSize: '1.3vw', fontWeight: 700, margin: 0, color: '#FFFFFF' }}>Download the app</h4>
            <p style={{ fontSize: '1.1vw', fontWeight: 300, color: 'rgba(255,255,255,0.6)', margin: 0, lineHeight: 1.4 }}>
              ReadyLoq mobile app on iOS and Android
            </p>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '3vh 2vw', backgroundColor: '#131726', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '0.8vw', gap: '1.5vh' }}>
            <div style={{ width: '3.5vw', height: '3.5vw', borderRadius: '50%', backgroundColor: 'rgba(79,127,255,0.15)', border: '1px solid rgba(79,127,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '1.6vw', fontWeight: 800, color: '#4F7FFF' }}>2</span>
            </div>
            <h4 style={{ fontSize: '1.3vw', fontWeight: 700, margin: 0, color: '#FFFFFF' }}>Import your property list</h4>
            <p style={{ fontSize: '1.1vw', fontWeight: 300, color: 'rgba(255,255,255,0.6)', margin: 0, lineHeight: 1.4 }}>
              CSV upload or manual entry — your choice
            </p>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '3vh 2vw', backgroundColor: '#131726', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '0.8vw', gap: '1.5vh' }}>
            <div style={{ width: '3.5vw', height: '3.5vw', borderRadius: '50%', backgroundColor: 'rgba(79,127,255,0.15)', border: '1px solid rgba(79,127,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '1.6vw', fontWeight: 800, color: '#4F7FFF' }}>3</span>
            </div>
            <h4 style={{ fontSize: '1.3vw', fontWeight: 700, margin: 0, color: '#FFFFFF' }}>Run your first inspection</h4>
            <p style={{ fontSize: '1.1vw', fontWeight: 300, color: 'rgba(255,255,255,0.6)', margin: 0, lineHeight: 1.4 }}>
              AI guides you through every step on-site
            </p>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '3vh 2vw', backgroundColor: '#131726', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '0.8vw', gap: '1.5vh' }}>
            <div style={{ width: '3.5vw', height: '3.5vw', borderRadius: '50%', backgroundColor: 'rgba(79,127,255,0.15)', border: '1px solid rgba(79,127,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '1.6vw', fontWeight: 800, color: '#4F7FFF' }}>4</span>
            </div>
            <h4 style={{ fontSize: '1.3vw', fontWeight: 700, margin: 0, color: '#FFFFFF' }}>Send your first report</h4>
            <p style={{ fontSize: '1.1vw', fontWeight: 300, color: 'rgba(255,255,255,0.6)', margin: 0, lineHeight: 1.4 }}>
              Automated branded PDF to your client
            </p>
          </div>

        </div>

        {/* Growth Team note */}
        <div style={{ marginTop: '3.5vh', padding: '1.5vh 2.5vw', backgroundColor: 'rgba(79,127,255,0.08)', border: '1px solid rgba(79,127,255,0.2)', borderRadius: '0.6vw', textAlign: 'center' }}>
          <p style={{ fontSize: '1.1vw', fontWeight: 400, color: 'rgba(255,255,255,0.7)', margin: 0 }}>
            Dedicated onboarding call included with every Growth Team plan.
          </p>
        </div>

      </div>

      {/* Footer */}
      <div style={{ position: 'absolute', bottom: '5vh', left: '5vw', fontSize: '0.9vw', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.06em' }}>READYLOQ, INC.</div>
      <div style={{ position: 'absolute', bottom: '5vh', right: '5vw', fontSize: '0.9vw', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>08 / 09</div>
    </div>
  );
}
