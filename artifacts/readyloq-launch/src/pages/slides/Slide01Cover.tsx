const base = import.meta.env.BASE_URL;

export default function Slide01Cover() {
  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{ backgroundColor: '#0C0F1A', fontFamily: "'Inter', sans-serif", color: '#FFFFFF' }}
    >
      {/* Background accent shapes */}
      <div style={{ position: 'absolute', top: '-20vh', right: '-10vw', width: '50vw', height: '50vw', borderRadius: '50%', backgroundColor: '#4F7FFF', opacity: 0.06, filter: 'blur(8vw)' }} />
      <div style={{ position: 'absolute', bottom: '-30vh', left: '-15vw', width: '60vw', height: '60vw', borderRadius: '50%', backgroundColor: '#7C6BF0', opacity: 0.06, filter: 'blur(10vw)' }} />

      {/* Grid overlay */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '4vw 4vw', opacity: 0.5, pointerEvents: 'none' }} />

      {/* Header */}
      <div style={{ position: 'absolute', top: '5vh', left: '5vw', display: 'flex', alignItems: 'center', gap: '1vw', zIndex: 10 }}>
        <div style={{ width: '2vw', height: '2vw', backgroundColor: '#4F7FFF', borderRadius: '0.4vw' }} />
        <span style={{ fontSize: '1.2vw', fontWeight: 700, letterSpacing: '-0.02em' }}>ReadyLoq</span>
      </div>
      <div style={{ position: 'absolute', top: '5vh', right: '5vw', fontSize: '1vw', fontWeight: 400, color: 'rgba(255,255,255,0.5)', zIndex: 10 }}>2026</div>

      {/* Main content — centered */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center' }}>

        {/* Version badge */}
        <div style={{ display: 'inline-flex', alignItems: 'center', padding: '0.6vh 1.2vw', backgroundColor: 'rgba(124,107,240,0.15)', border: '1px solid rgba(124,107,240,0.3)', borderRadius: '2vw', color: '#7C6BF0', fontSize: '1vw', fontWeight: 500, marginBottom: '4vh', letterSpacing: '0.05em' }}>
          Introducing v2.0
        </div>

        {/* Title */}
        <h1 style={{ fontSize: '7vw', fontWeight: 900, margin: '0 0 2vh 0', lineHeight: 1.05, letterSpacing: '-0.04em' }}>ReadyLoq</h1>

        {/* Subtitle */}
        <p style={{ fontSize: '1.8vw', fontWeight: 300, color: 'rgba(255,255,255,0.7)', margin: '0 0 6vh 0', lineHeight: 1.5, maxWidth: '52vw', textWrap: 'balance' }}>
          The property intelligence platform that turns field expertise into permanent institutional knowledge.
        </p>

        {/* Feature pills */}
        <div style={{ display: 'flex', gap: '1.5vw', opacity: 0.85 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5vw', padding: '0.9vh 1.5vw', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '0.4vw', fontSize: '1vw', fontWeight: 500, color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.08)' }}>
            AI-Powered Vision
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5vw', padding: '0.9vh 1.5vw', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '0.4vw', fontSize: '1vw', fontWeight: 500, color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.08)' }}>
            Offline-First
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5vw', padding: '0.9vh 1.5vw', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '0.4vw', fontSize: '1vw', fontWeight: 500, color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.08)' }}>
            Hands-Free Mode
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5vw', padding: '0.9vh 1.5vw', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '0.4vw', fontSize: '1vw', fontWeight: 500, color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.08)' }}>
            Solo + Growth Plans
          </div>
        </div>
      </div>

      {/* Floating UI card — bottom right */}
      <div style={{ position: 'absolute', bottom: '12vh', right: '-3vw', width: '22vw', backgroundColor: '#131726', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1vw', padding: '1.8vw', boxShadow: '0 2vh 4vh rgba(0,0,0,0.5)', transform: 'rotate(-4deg)', opacity: 0.75 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1vw', marginBottom: '1.2vh' }}>
          <div style={{ width: '1.8vw', height: '1.8vw', borderRadius: '50%', backgroundColor: '#4F7FFF' }} />
          <div style={{ height: '0.8vw', width: '9vw', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: '0.2vw' }} />
        </div>
        <div style={{ height: '0.7vw', width: '14vw', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: '0.2vw', marginBottom: '0.8vh' }} />
        <div style={{ height: '0.7vw', width: '11vw', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: '0.2vw' }} />
      </div>

      {/* Footer */}
      <div style={{ position: 'absolute', bottom: '5vh', left: '5vw', fontSize: '0.9vw', fontWeight: 400, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.06em' }}>READYLOQ, INC.</div>
    </div>
  );
}
