export default function Slide10Close() {
  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{ backgroundColor: '#0A1A35' }}
    >
      {/* Background gradient */}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at 30% 60%, rgba(232,68,36,0.08) 0%, transparent 55%), radial-gradient(ellipse at 80% 30%, rgba(15,40,80,0.8) 0%, transparent 60%)',
        }}
      />

      {/* Diagonal accent shape */}
      <div
        style={{
          position: 'absolute',
          right: '-5vw', top: '0', bottom: '0',
          width: '45vw',
          background: 'linear-gradient(135deg, rgba(15,32,64,0.0) 0%, rgba(15,32,64,0.15) 100%)',
          borderLeft: '1px solid rgba(255,255,255,0.04)',
          transform: 'skewX(-6deg)',
        }}
      />

      {/* Left accent bar */}
      <div
        style={{
          position: 'absolute',
          left: '5.6vw', top: '14vh', bottom: '14vh',
          width: '0.22vw',
          backgroundColor: '#E84424',
          borderRadius: '2px',
        }}
      />

      {/* Content */}
      <div
        style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          justifyContent: 'center',
          paddingLeft: '8.5vw', paddingRight: '20vw',
        }}
      >
        {/* Label */}
        <p className="font-body" style={{ fontSize: '1.2vw', color: '#E84424', fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '3.5vh' }}>
          The Window Is Now
        </p>

        {/* Main statement */}
        <h2
          className="font-display"
          style={{ fontSize: '4.5vw', fontWeight: 800, color: '#FFFFFF', lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: '4vh' }}
        >
          ReadyLoq is the only platform built from the ground up on live inspection data.
        </h2>

        {/* Secondary line */}
        <p className="font-display" style={{ fontSize: '2.5vw', fontWeight: 600, color: 'rgba(255,255,255,0.55)', lineHeight: 1.3, marginBottom: '5vh' }}>
          The moat deepens every day the platform runs.
        </p>

        {/* Orange rule */}
        <div style={{ width: '5vw', height: '2px', backgroundColor: '#E84424', marginBottom: '4.5vh' }} />

        {/* Three competitive facts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.8vh' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.5vw' }}>
            <div style={{ width: '0.5vw', height: '0.5vw', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '1vh', flexShrink: 0 }} />
            <p className="font-body" style={{ fontSize: '1.6vw', color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>National chains are accelerating internal software investment</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.5vw' }}>
            <div style={{ width: '0.5vw', height: '0.5vw', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '1vh', flexShrink: 0 }} />
            <p className="font-body" style={{ fontSize: '1.6vw', color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>Generic field-service platforms are moving toward pest control verticals</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.5vw' }}>
            <div style={{ width: '0.5vw', height: '0.5vw', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '1vh', flexShrink: 0 }} />
            <p className="font-body" style={{ fontSize: '1.6vw', color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>The operator who adopts today locks in AI model advantage that compounds for years</p>
          </div>
        </div>

        {/* Bold close line */}
        <div style={{ marginTop: '5vh', paddingTop: '4vh', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="font-display" style={{ fontSize: '2.8vw', fontWeight: 800, color: '#E84424', lineHeight: 1.1 }}>
            Let's build it.
          </p>
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 0, left: 0, right: 0,
          height: '8vh',
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: '8.5vw', paddingRight: '8.5vw',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <span className="font-body" style={{ fontSize: '1.25vw', color: 'rgba(255,255,255,0.25)' }}>ReadyLoq · Strategic Plan · 2026</span>
        <span className="font-body" style={{ fontSize: '1.25vw', color: 'rgba(255,255,255,0.25)' }}>Confidential</span>
      </div>
    </div>
  );
}
