const base = import.meta.env.BASE_URL;

export default function Slide06Metrics() {
  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{ backgroundColor: '#0C0F1A', fontFamily: "'Inter', sans-serif", color: '#FFFFFF' }}
    >
      {/* Background accent shapes */}
      <div style={{ position: 'absolute', top: '10vh', left: '20vw', width: '40vw', height: '40vw', borderRadius: '50%', backgroundColor: '#7C6BF0', opacity: 0.06, filter: 'blur(12vw)' }} />
      <div style={{ position: 'absolute', bottom: '5vh', right: '5vw', width: '30vw', height: '30vw', borderRadius: '50%', backgroundColor: '#4F7FFF', opacity: 0.05, filter: 'blur(10vw)' }} />
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
        <div style={{ textAlign: 'center', marginBottom: '4vh' }}>
          <h2 style={{ fontSize: '4vw', fontWeight: 800, margin: 0, lineHeight: 1.1, letterSpacing: '-0.03em' }}>The numbers don't lie.</h2>
          <p style={{ fontSize: '1.3vw', fontWeight: 300, color: 'rgba(255,255,255,0.6)', margin: '1.5vh auto 0', maxWidth: '45vw', lineHeight: 1.5 }}>
            ReadyLoq customers see measurable impact within the first month.
          </p>
        </div>

        {/* Four stat cards */}
        <div style={{ display: 'flex', gap: '2vw', width: '100%', marginBottom: '3.5vh' }}>

          <div style={{ flex: 1, padding: '2.5vh 1.8vw', backgroundColor: '#131726', border: '1px solid rgba(79,127,255,0.2)', borderRadius: '0.8vw', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontSize: '4.5vw', fontWeight: 900, color: '#4F7FFF', lineHeight: 1, marginBottom: '1vh' }}>80x</div>
            <div style={{ fontSize: '1vw', fontWeight: 600, color: 'rgba(255,255,255,0.9)', textAlign: 'center', marginBottom: '0.5vh' }}>ROI on Solo Plan</div>
            <div style={{ fontSize: '0.9vw', fontWeight: 300, color: 'rgba(255,255,255,0.45)', textAlign: 'center' }}>year one</div>
          </div>

          <div style={{ flex: 1, padding: '2.5vh 1.8vw', backgroundColor: '#131726', border: '1px solid rgba(124,107,240,0.2)', borderRadius: '0.8vw', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontSize: '4.5vw', fontWeight: 900, color: '#7C6BF0', lineHeight: 1, marginBottom: '1vh' }}>&lt;60s</div>
            <div style={{ fontSize: '1vw', fontWeight: 600, color: 'rgba(255,255,255,0.9)', textAlign: 'center', marginBottom: '0.5vh' }}>AI Inspection Reports</div>
            <div style={{ fontSize: '0.9vw', fontWeight: 300, color: 'rgba(255,255,255,0.45)', textAlign: 'center' }}>vs. 20+ min manually</div>
          </div>

          <div style={{ flex: 1, padding: '2.5vh 1.8vw', backgroundColor: '#131726', border: '1px solid rgba(39,201,63,0.2)', borderRadius: '0.8vw', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontSize: '4.5vw', fontWeight: 900, color: '#27C93F', lineHeight: 1, marginBottom: '1vh' }}>Zero</div>
            <div style={{ fontSize: '1vw', fontWeight: 600, color: 'rgba(255,255,255,0.9)', textAlign: 'center', marginBottom: '0.5vh' }}>Data Loss</div>
            <div style={{ fontSize: '0.9vw', fontWeight: 300, color: 'rgba(255,255,255,0.45)', textAlign: 'center' }}>when a technician leaves</div>
          </div>

          <div style={{ flex: 1, padding: '2.5vh 1.8vw', backgroundColor: '#131726', border: '1px solid rgba(255,189,46,0.2)', borderRadius: '0.8vw', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontSize: '4.5vw', fontWeight: 900, color: '#FFBD2E', lineHeight: 1, marginBottom: '1vh' }}>&lt;12%</div>
            <div style={{ fontSize: '1vw', fontWeight: 600, color: 'rgba(255,255,255,0.9)', textAlign: 'center', marginBottom: '0.5vh' }}>Callback Rate</div>
            <div style={{ fontSize: '0.9vw', fontWeight: 300, color: 'rgba(255,255,255,0.45)', textAlign: 'center' }}>ReadyLoq commercial accounts</div>
          </div>

        </div>

        {/* Bar chart image */}
        <div style={{ width: '65vw', height: '18vh', borderRadius: '0.8vw', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.07)' }}>
          <img
            src={`${base}slide-metrics.jpg`}
            crossOrigin="anonymous"
            alt="Callback rate before and after ReadyLoq"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>

      </div>

      {/* Footer */}
      <div style={{ position: 'absolute', bottom: '5vh', left: '5vw', fontSize: '0.9vw', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.06em' }}>READYLOQ, INC.</div>
      <div style={{ position: 'absolute', bottom: '5vh', right: '5vw', fontSize: '0.9vw', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>06 / 09</div>
    </div>
  );
}
