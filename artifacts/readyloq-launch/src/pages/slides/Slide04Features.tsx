export default function Slide04Features() {
  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{ backgroundColor: '#0C0F1A', fontFamily: "'Inter', sans-serif", color: '#FFFFFF' }}
    >
      {/* Background accent shapes */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '55vw', height: '55vw', borderRadius: '50%', backgroundColor: '#4F7FFF', opacity: 0.04, filter: 'blur(15vw)' }} />
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '4vw 4vw', opacity: 0.5, pointerEvents: 'none' }} />

      {/* Header */}
      <div style={{ position: 'absolute', top: '5vh', left: '5vw', display: 'flex', alignItems: 'center', gap: '1vw', zIndex: 10 }}>
        <div style={{ width: '2vw', height: '2vw', backgroundColor: '#4F7FFF', borderRadius: '0.4vw' }} />
        <span style={{ fontSize: '1.2vw', fontWeight: 700, letterSpacing: '-0.02em' }}>ReadyLoq</span>
      </div>
      <div style={{ position: 'absolute', top: '5vh', right: '5vw', fontSize: '1vw', color: 'rgba(255,255,255,0.5)', zIndex: 10 }}>2026</div>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 8vw' }}>

        {/* Title block */}
        <div style={{ textAlign: 'center', marginBottom: '5vh' }}>
          <div style={{ display: 'inline-block', padding: '0.5vh 1vw', backgroundColor: 'rgba(79,127,255,0.15)', border: '1px solid rgba(79,127,255,0.3)', borderRadius: '2vw', color: '#4F7FFF', fontSize: '0.9vw', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '2vh' }}>
            Platform Features
          </div>
          <h2 style={{ fontSize: '3.8vw', fontWeight: 800, margin: 0, lineHeight: 1.1, letterSpacing: '-0.03em' }}>
            Everything a tech needs.{' '}
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>Nothing they don't.</span>
          </h2>
        </div>

        {/* Five feature rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.6vh', width: '100%' }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: '2vw', padding: '1.8vh 2vw', backgroundColor: '#131726', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '0.7vw' }}>
            <div style={{ width: '3vw', height: '3vw', backgroundColor: 'rgba(79,127,255,0.15)', borderRadius: '0.5vw', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <div style={{ width: '1.4vw', height: '1.4vw', backgroundColor: '#4F7FFF', borderRadius: '0.2vw' }} />
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '1.3vw', fontWeight: 700, color: '#FFFFFF' }}>Property Intelligence Records</span>
              <span style={{ fontSize: '1.2vw', fontWeight: 300, color: 'rgba(255,255,255,0.55)', marginLeft: '1vw' }}>— access codes, bait station maps, historical pest activity</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '2vw', padding: '1.8vh 2vw', backgroundColor: '#131726', border: '1px solid rgba(79,127,255,0.2)', borderRadius: '0.7vw', boxShadow: '0 0 0 1px rgba(79,127,255,0.1)' }}>
            <div style={{ width: '3vw', height: '3vw', backgroundColor: 'rgba(79,127,255,0.2)', borderRadius: '0.5vw', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <div style={{ width: '1.4vw', height: '1.4vw', backgroundColor: '#4F7FFF', borderRadius: '50%' }} />
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '1.3vw', fontWeight: 700, color: '#4F7FFF' }}>FAIE Vision AI</span>
              <span style={{ fontSize: '1.2vw', fontWeight: 300, color: 'rgba(255,255,255,0.55)', marginLeft: '1vw' }}>— real-time inspection guidance via camera, zero manual input</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '2vw', padding: '1.8vh 2vw', backgroundColor: '#131726', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '0.7vw' }}>
            <div style={{ width: '3vw', height: '3vw', backgroundColor: 'rgba(124,107,240,0.15)', borderRadius: '0.5vw', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <div style={{ width: '1.4vw', height: '1.4vw', backgroundColor: '#7C6BF0', borderRadius: '50%' }} />
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '1.3vw', fontWeight: 700, color: '#FFFFFF' }}>Hands-Free Mode</span>
              <span style={{ fontSize: '1.2vw', fontWeight: 300, color: 'rgba(255,255,255,0.55)', marginLeft: '1vw' }}>— Ray-Ban Meta glasses for full-hands inspection capture</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '2vw', padding: '1.8vh 2vw', backgroundColor: '#131726', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '0.7vw' }}>
            <div style={{ width: '3vw', height: '3vw', backgroundColor: 'rgba(39,201,63,0.12)', borderRadius: '0.5vw', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <div style={{ width: '1.4vw', height: '1.4vw', backgroundColor: '#27C93F', borderRadius: '50%' }} />
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '1.3vw', fontWeight: 700, color: '#FFFFFF' }}>Offline Sync</span>
              <span style={{ fontSize: '1.2vw', fontWeight: 300, color: 'rgba(255,255,255,0.55)', marginLeft: '1vw' }}>— works in basements, crawlspaces, anywhere with no signal</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '2vw', padding: '1.8vh 2vw', backgroundColor: '#131726', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '0.7vw' }}>
            <div style={{ width: '3vw', height: '3vw', backgroundColor: 'rgba(79,127,255,0.12)', borderRadius: '0.5vw', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <div style={{ width: '1.4vw', height: '0.2vw', backgroundColor: '#4F7FFF', borderRadius: '0.1vw' }} />
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '1.3vw', fontWeight: 700, color: '#FFFFFF' }}>White-Labeled Reports</span>
              <span style={{ fontSize: '1.2vw', fontWeight: 300, color: 'rgba(255,255,255,0.55)', marginLeft: '1vw' }}>— auto-generated PDFs sent to commercial clients post-service</span>
            </div>
          </div>

        </div>
      </div>

      {/* Footer */}
      <div style={{ position: 'absolute', bottom: '5vh', left: '5vw', fontSize: '0.9vw', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.06em' }}>READYLOQ, INC.</div>
      <div style={{ position: 'absolute', bottom: '5vh', right: '5vw', fontSize: '0.9vw', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>04 / 09</div>
    </div>
  );
}
