const base = import.meta.env.BASE_URL;

export default function Slide01Cover() {
  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{ backgroundColor: '#0F2040' }}
    >
      {/* Hero background image */}
      <img
        src={`${base}cover-hero.jpg`}
        crossOrigin="anonymous"
        alt=""
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover', objectPosition: 'center',
          opacity: 0.22,
        }}
      />

      {/* Directional gradient — left stays solid navy */}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(105deg, rgba(15,32,64,0.97) 38%, rgba(15,32,64,0.65) 75%, rgba(15,32,64,0.45) 100%)',
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

      {/* Main content */}
      <div
        style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          justifyContent: 'center',
          paddingLeft: '8.5vw', paddingRight: '18vw',
        }}
      >
        {/* Brand + date row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.8vw', marginBottom: '3.5vh' }}>
          <span
            className="font-display"
            style={{
              fontSize: '1.35vw', fontWeight: 700,
              letterSpacing: '0.22em', color: '#E84424',
              textTransform: 'uppercase',
            }}
          >
            ReadyLoq
          </span>
          <div style={{ width: '3vw', height: '1px', backgroundColor: 'rgba(232,68,36,0.35)' }} />
          <span
            className="font-body"
            style={{
              fontSize: '1.15vw', color: 'rgba(255,255,255,0.38)',
              letterSpacing: '0.13em', textTransform: 'uppercase',
            }}
          >
            Strategic Plan · 2026
          </span>
        </div>

        {/* Headline */}
        <h1
          className="font-display"
          style={{
            fontSize: '7.2vw', fontWeight: 800,
            color: '#FFFFFF',
            lineHeight: 1.0,
            letterSpacing: '-0.025em',
            marginBottom: '3vh',
          }}
        >
          The $100M
          <br />
          Growth Plan
        </h1>

        {/* Orange rule */}
        <div style={{ width: '6vw', height: '2px', backgroundColor: '#E84424', marginBottom: '3.5vh' }} />

        {/* Four pillars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1vh' }}>
          <p className="font-body" style={{ fontSize: '1.75vw', color: 'rgba(255,255,255,0.65)', lineHeight: 1.3 }}>
            Outcome-driven product positioning
          </p>
          <p className="font-body" style={{ fontSize: '1.75vw', color: 'rgba(255,255,255,0.65)', lineHeight: 1.3 }}>
            Enterprise pricing architecture
          </p>
          <p className="font-body" style={{ fontSize: '1.75vw', color: 'rgba(255,255,255,0.65)', lineHeight: 1.3 }}>
            Proprietary AI data moat
          </p>
          <p className="font-body" style={{ fontSize: '1.75vw', color: 'rgba(255,255,255,0.65)', lineHeight: 1.3 }}>
            Field-service market expansion
          </p>
        </div>
      </div>

      {/* Bottom metadata bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 0, left: 0, right: 0,
          height: '8vh',
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: '8.5vw', paddingRight: '8.5vw',
          borderTop: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <span className="font-body" style={{ fontSize: '1.25vw', color: 'rgba(255,255,255,0.28)' }}>
          Pest Control · Field Intelligence · AI Vision
        </span>
        <span className="font-body" style={{ fontSize: '1.25vw', color: 'rgba(255,255,255,0.28)' }}>
          Confidential
        </span>
      </div>
    </div>
  );
}
