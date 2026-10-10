export default function Slide02Market() {
  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{ backgroundColor: '#F4F7FC' }}
    >
      {/* Top accent rule */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '0.5vh', backgroundColor: '#E84424' }} />

      <div style={{ paddingTop: '9vh', paddingLeft: '8vw', paddingRight: '8vw', paddingBottom: '6vh', height: '100%', display: 'flex', flexDirection: 'column' }}>

        {/* Slide label */}
        <p className="font-body" style={{ fontSize: '1.2vw', color: '#E84424', fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '1.5vh' }}>
          Market Opportunity
        </p>

        {/* Headline */}
        <h2
          className="font-display"
          style={{ fontSize: '3.8vw', fontWeight: 800, color: '#0F2040', lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: '5vh' }}
        >
          Massive market. Minimal software penetration.
        </h2>

        {/* 4 stat cards */}
        <div style={{ display: 'flex', gap: '2vw', flex: 1, marginBottom: '3vh' }}>

          {/* Stat 1 */}
          <div style={{ flex: 1, backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '3.5vh 2.5vw', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', border: '1px solid rgba(15,32,64,0.08)' }}>
            <div>
              <p className="font-display" style={{ fontSize: '5.5vw', fontWeight: 800, color: '#E84424', lineHeight: 1.0, letterSpacing: '-0.03em' }}>$26B</p>
              <p className="font-display" style={{ fontSize: '1.5vw', fontWeight: 700, color: '#0F2040', marginTop: '1vh' }}>US pest control market</p>
            </div>
            <p className="font-body" style={{ fontSize: '1.4vw', color: '#5A6D8A', marginTop: '1.5vh', lineHeight: 1.4 }}>Growing 6% annually, driven by commercial accounts</p>
          </div>

          {/* Stat 2 */}
          <div style={{ flex: 1, backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '3.5vh 2.5vw', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', border: '1px solid rgba(15,32,64,0.08)' }}>
            <div>
              <p className="font-display" style={{ fontSize: '5.5vw', fontWeight: 800, color: '#E84424', lineHeight: 1.0, letterSpacing: '-0.03em' }}>30K+</p>
              <p className="font-display" style={{ fontSize: '1.5vw', fontWeight: 700, color: '#0F2040', marginTop: '1vh' }}>Operators in the US</p>
            </div>
            <p className="font-body" style={{ fontSize: '1.4vw', color: '#5A6D8A', marginTop: '1.5vh', lineHeight: 1.4 }}>Mostly 3–12 technician shops running on clipboards</p>
          </div>

          {/* Stat 3 */}
          <div style={{ flex: 1, backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '3.5vh 2.5vw', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', border: '1px solid rgba(15,32,64,0.08)' }}>
            <div>
              <p className="font-display" style={{ fontSize: '5.5vw', fontWeight: 800, color: '#E84424', lineHeight: 1.0, letterSpacing: '-0.03em' }}>&lt;12%</p>
              <p className="font-display" style={{ fontSize: '1.5vw', fontWeight: 700, color: '#0F2040', marginTop: '1vh' }}>Use purpose-built software</p>
            </div>
            <p className="font-body" style={{ fontSize: '1.4vw', color: '#5A6D8A', marginTop: '1.5vh', lineHeight: 1.4 }}>Generic tools built for landscaping, not pest intelligence</p>
          </div>

          {/* Stat 4 */}
          <div style={{ flex: 1, backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '3.5vh 2.5vw', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', border: '1px solid rgba(15,32,64,0.08)' }}>
            <div>
              <p className="font-display" style={{ fontSize: '5.5vw', fontWeight: 800, color: '#E84424', lineHeight: 1.0, letterSpacing: '-0.03em' }}>$350</p>
              <p className="font-display" style={{ fontSize: '1.5vw', fontWeight: 700, color: '#0F2040', marginTop: '1vh' }}>Cost per callback</p>
            </div>
            <p className="font-body" style={{ fontSize: '1.4vw', color: '#5A6D8A', marginTop: '1.5vh', lineHeight: 1.4 }}>Direct labor, fuel, and missed new-job opportunity</p>
          </div>

        </div>

        {/* Bottom callout strip */}
        <div
          style={{
            backgroundColor: '#0F2040',
            borderRadius: '8px',
            padding: '2.2vh 2.5vw',
            display: 'flex',
            alignItems: 'center',
            gap: '2vw',
          }}
        >
          <div style={{ width: '3px', height: '4vh', backgroundColor: '#E84424', borderRadius: '2px', flexShrink: 0 }} />
          <p className="font-display" style={{ fontSize: '1.7vw', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.3 }}>
            Enterprise field-service SaaS is the fastest-growing segment in the SMB software stack.
            <span className="font-body" style={{ fontWeight: 400, color: 'rgba(255,255,255,0.55)', marginLeft: '1vw' }}>
              The window for category ownership is open now.
            </span>
          </p>
        </div>

      </div>
    </div>
  );
}
