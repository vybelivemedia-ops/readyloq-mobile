const base = import.meta.env.BASE_URL;

export default function Slide02Problem() {
  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{ backgroundColor: '#0C0F1A', fontFamily: "'Inter', sans-serif", color: '#FFFFFF' }}
    >
      {/* Background accent shapes */}
      <div style={{ position: 'absolute', top: '-20vh', right: '-10vw', width: '50vw', height: '50vw', borderRadius: '50%', backgroundColor: '#4F7FFF', opacity: 0.05, filter: 'blur(8vw)' }} />
      <div style={{ position: 'absolute', bottom: '-30vh', left: '-15vw', width: '60vw', height: '60vw', borderRadius: '50%', backgroundColor: '#7C6BF0', opacity: 0.05, filter: 'blur(10vw)' }} />
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '4vw 4vw', opacity: 0.5, pointerEvents: 'none' }} />

      {/* Header */}
      <div style={{ position: 'absolute', top: '5vh', left: '5vw', display: 'flex', alignItems: 'center', gap: '1vw', zIndex: 10 }}>
        <div style={{ width: '2vw', height: '2vw', backgroundColor: '#4F7FFF', borderRadius: '0.4vw' }} />
        <span style={{ fontSize: '1.2vw', fontWeight: 700, letterSpacing: '-0.02em' }}>ReadyLoq</span>
      </div>
      <div style={{ position: 'absolute', top: '5vh', right: '5vw', fontSize: '1vw', color: 'rgba(255,255,255,0.5)', zIndex: 10 }}>2026</div>

      {/* Two-column layout */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', width: '90vw', margin: '0 auto', height: '100%', alignItems: 'center', gap: '5vw', paddingLeft: '5vw' }}>

        {/* Left: text */}
        <div style={{ flex: '1', display: 'flex', flexDirection: 'column', gap: '2.5vh' }}>
          <div style={{ display: 'inline-block', padding: '0.5vh 1vw', backgroundColor: 'rgba(79,127,255,0.15)', border: '1px solid rgba(79,127,255,0.3)', borderRadius: '2vw', color: '#4F7FFF', fontSize: '0.9vw', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', alignSelf: 'flex-start' }}>
            The Problem
          </div>
          <h2 style={{ fontSize: '3.4vw', fontWeight: 800, margin: 0, lineHeight: 1.15, letterSpacing: '-0.03em', textWrap: 'balance' }}>
            Your operation is running on fragile memory.
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.8vh', marginTop: '1vh' }}>
            <div style={{ display: 'flex', gap: '1vw', alignItems: 'flex-start' }}>
              <div style={{ marginTop: '0.4vh', width: '1.2vw', height: '1.2vw', borderRadius: '50%', backgroundColor: 'rgba(79,127,255,0.2)', border: '1px solid rgba(79,127,255,0.4)', flexShrink: 0 }} />
              <p style={{ fontSize: '1.25vw', fontWeight: 300, color: 'rgba(255,255,255,0.75)', margin: 0, lineHeight: 1.4 }}>
                Senior tech leaves — their entire route knowledge walks out the door
              </p>
            </div>
            <div style={{ display: 'flex', gap: '1vw', alignItems: 'flex-start' }}>
              <div style={{ marginTop: '0.4vh', width: '1.2vw', height: '1.2vw', borderRadius: '50%', backgroundColor: 'rgba(79,127,255,0.2)', border: '1px solid rgba(79,127,255,0.4)', flexShrink: 0 }} />
              <p style={{ fontSize: '1.25vw', fontWeight: 300, color: 'rgba(255,255,255,0.75)', margin: 0, lineHeight: 1.4 }}>
                Relief techs fly blind: missed stations, wrong gate codes, annoyed customers
              </p>
            </div>
            <div style={{ display: 'flex', gap: '1vw', alignItems: 'flex-start' }}>
              <div style={{ marginTop: '0.4vh', width: '1.2vw', height: '1.2vw', borderRadius: '50%', backgroundColor: 'rgba(79,127,255,0.2)', border: '1px solid rgba(79,127,255,0.4)', flexShrink: 0 }} />
              <p style={{ fontSize: '1.25vw', fontWeight: 300, color: 'rgba(255,255,255,0.75)', margin: 0, lineHeight: 1.4 }}>
                Every callback costs your company $350+ and erodes client trust
              </p>
            </div>
            <div style={{ display: 'flex', gap: '1vw', alignItems: 'flex-start' }}>
              <div style={{ marginTop: '0.4vh', width: '1.2vw', height: '1.2vw', borderRadius: '50%', backgroundColor: 'rgba(79,127,255,0.2)', border: '1px solid rgba(79,127,255,0.4)', flexShrink: 0 }} />
              <p style={{ fontSize: '1.25vw', fontWeight: 300, color: 'rgba(255,255,255,0.75)', margin: 0, lineHeight: 1.4 }}>
                30,000+ pest control companies face this same hidden risk every day
              </p>
            </div>
          </div>
        </div>

        {/* Right: image */}
        <div style={{ flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '70vh' }}>
          <div style={{ width: '100%', height: '100%', borderRadius: '1vw', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 2vh 5vh rgba(0,0,0,0.6)' }}>
            <img
              src={`${base}slide-problem.jpg`}
              crossOrigin="anonymous"
              alt="Stressed manager vs confident technician"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ position: 'absolute', bottom: '5vh', left: '5vw', fontSize: '0.9vw', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.06em' }}>READYLOQ, INC.</div>
      <div style={{ position: 'absolute', bottom: '5vh', right: '5vw', fontSize: '0.9vw', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>02 / 09</div>
    </div>
  );
}
