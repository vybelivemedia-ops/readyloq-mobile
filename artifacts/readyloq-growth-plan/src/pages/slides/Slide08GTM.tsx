export default function Slide08GTM() {
  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{ backgroundColor: '#F4F7FC' }}
    >
      {/* Top accent rule */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '0.5vh', backgroundColor: '#E84424' }} />

      <div style={{ paddingTop: '9vh', paddingLeft: '8vw', paddingRight: '8vw', height: '100%', display: 'flex', flexDirection: 'column' }}>

        {/* Slide label */}
        <p className="font-body" style={{ fontSize: '1.2vw', color: '#E84424', fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '1.5vh' }}>
          Go-To-Market
        </p>

        {/* Headline */}
        <h2
          className="font-display"
          style={{ fontSize: '3.6vw', fontWeight: 800, color: '#0F2040', lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: '5vh' }}
        >
          Three channels that compound on each other
        </h2>

        {/* Channel rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2vh', flex: 1 }}>

          {/* Channel 01 */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: '2.5vw', backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '3vh 2.5vw', border: '1px solid rgba(15,32,64,0.07)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '5vw', flexShrink: 0 }}>
              <p className="font-display" style={{ fontSize: '3.2vw', fontWeight: 800, color: 'rgba(232,68,36,0.18)', lineHeight: 1 }}>01</p>
            </div>
            <div style={{ width: '1px', backgroundColor: 'rgba(15,32,64,0.08)' }} />
            <div style={{ flex: 1 }}>
              <p className="font-display" style={{ fontSize: '1.7vw', fontWeight: 700, color: '#0F2040', marginBottom: '0.8vh' }}>Direct — Owner-Operators</p>
              <p className="font-body" style={{ fontSize: '1.4vw', color: '#5A6D8A', lineHeight: 1.5 }}>
                Inbound via SEO around "callback reduction" and "pest inspection reports" ·
                Solo to Growth Team upsell when headcount exceeds 2 technicians
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ backgroundColor: 'rgba(232,68,36,0.08)', borderRadius: '8px', padding: '1vh 1.5vw', textAlign: 'center' }}>
                <p className="font-display" style={{ fontSize: '1.4vw', fontWeight: 700, color: '#E84424' }}>Solo → Growth</p>
                <p className="font-body" style={{ fontSize: '1.1vw', color: '#5A6D8A' }}>natural upsell path</p>
              </div>
            </div>
          </div>

          {/* Channel 02 */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: '2.5vw', backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '3vh 2.5vw', border: '1px solid rgba(15,32,64,0.07)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '5vw', flexShrink: 0 }}>
              <p className="font-display" style={{ fontSize: '3.2vw', fontWeight: 800, color: 'rgba(232,68,36,0.18)', lineHeight: 1 }}>02</p>
            </div>
            <div style={{ width: '1px', backgroundColor: 'rgba(15,32,64,0.08)' }} />
            <div style={{ flex: 1 }}>
              <p className="font-display" style={{ fontSize: '1.7vw', fontWeight: 700, color: '#0F2040', marginBottom: '0.8vh' }}>Channel — Distribution Partners</p>
              <p className="font-body" style={{ fontSize: '1.4vw', color: '#5A6D8A', lineHeight: 1.5 }}>
                Pest control supply distributors as co-sell partners ·
                Equipment manufacturers bundling ReadyLoq with BLE trap sensors and moisture hardware
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ backgroundColor: 'rgba(232,68,36,0.08)', borderRadius: '8px', padding: '1vh 1.5vw', textAlign: 'center' }}>
                <p className="font-display" style={{ fontSize: '1.4vw', fontWeight: 700, color: '#E84424' }}>Hardware bundle</p>
                <p className="font-body" style={{ fontSize: '1.1vw', color: '#5A6D8A' }}>zero incremental CAC</p>
              </div>
            </div>
          </div>

          {/* Channel 03 */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: '2.5vw', backgroundColor: '#0F2040', borderRadius: '10px', padding: '3vh 2.5vw' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '5vw', flexShrink: 0 }}>
              <p className="font-display" style={{ fontSize: '3.2vw', fontWeight: 800, color: 'rgba(232,68,36,0.3)', lineHeight: 1 }}>03</p>
            </div>
            <div style={{ width: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }} />
            <div style={{ flex: 1 }}>
              <p className="font-display" style={{ fontSize: '1.7vw', fontWeight: 700, color: '#FFFFFF', marginBottom: '0.8vh' }}>Enterprise — Multi-Branch Operators</p>
              <p className="font-body" style={{ fontSize: '1.4vw', color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
                Direct sales motion targeting 10+ technician operators and franchise networks ·
                Land Professional tier, expand to Enterprise on multi-year contract
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ backgroundColor: 'rgba(232,68,36,0.15)', borderRadius: '8px', padding: '1vh 1.5vw', textAlign: 'center' }}>
                <p className="font-display" style={{ fontSize: '1.4vw', fontWeight: 700, color: '#E84424' }}>$3,500+/mo</p>
                <p className="font-body" style={{ fontSize: '1.1vw', color: 'rgba(255,255,255,0.4)' }}>avg enterprise ACV</p>
              </div>
            </div>
          </div>

        </div>

        {/* Footer expansion note */}
        <div style={{ height: '4.5vh', display: 'flex', alignItems: 'center' }}>
          <p className="font-body" style={{ fontSize: '1.3vw', color: '#5A6D8A' }}>
            <span style={{ color: '#E84424', fontWeight: 600 }}>Expansion markets (2026+):</span> Lawn care · Building inspections · HVAC field service
          </p>
        </div>

      </div>
    </div>
  );
}
