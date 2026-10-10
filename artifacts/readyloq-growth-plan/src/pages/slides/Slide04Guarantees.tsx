export default function Slide04Guarantees() {
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
          Core Value Proposition
        </p>

        {/* Headline */}
        <h2
          className="font-display"
          style={{ fontSize: '3.6vw', fontWeight: 800, color: '#0F2040', lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: '5vh' }}
        >
          Three guarantees operators can price
        </h2>

        {/* Three columns */}
        <div style={{ display: 'flex', gap: '2vw', flex: 1 }}>

          {/* Guarantee 01 */}
          <div style={{ flex: 1, backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '4vh 2.8vw', display: 'flex', flexDirection: 'column', border: '1px solid rgba(15,32,64,0.08)' }}>
            <p className="font-display" style={{ fontSize: '3.5vw', fontWeight: 800, color: '#E84424', lineHeight: 1, marginBottom: '2vh', opacity: 0.25 }}>01</p>
            <p className="font-display" style={{ fontSize: '2vw', fontWeight: 700, color: '#0F2040', lineHeight: 1.2, marginBottom: '2.5vh' }}>Callback Elimination</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.8vh', marginBottom: '3vh' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1vw' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '0.9vh', flexShrink: 0 }} />
                <p className="font-body" style={{ fontSize: '1.5vw', color: '#5A6D8A', lineHeight: 1.4 }}>FAIE Vision AI catches what techs miss in the field</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1vw' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '0.9vh', flexShrink: 0 }} />
                <p className="font-body" style={{ fontSize: '1.5vw', color: '#5A6D8A', lineHeight: 1.4 }}>Industry average: 1 callback per 8 jobs</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1vw' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '0.9vh', flexShrink: 0 }} />
                <p className="font-body" style={{ fontSize: '1.5vw', color: '#5A6D8A', lineHeight: 1.4 }}>ReadyLoq target: sub-1-per-40</p>
              </div>
            </div>

            <div style={{ marginTop: 'auto', paddingTop: '2vh', borderTop: '1px solid rgba(15,32,64,0.08)' }}>
              <p className="font-display" style={{ fontSize: '2.2vw', fontWeight: 800, color: '#0F2040' }}>5× reduction</p>
              <p className="font-body" style={{ fontSize: '1.3vw', color: '#5A6D8A' }}>in revisit frequency</p>
            </div>
          </div>

          {/* Guarantee 02 */}
          <div style={{ flex: 1, backgroundColor: '#0F2040', borderRadius: '10px', padding: '4vh 2.8vw', display: 'flex', flexDirection: 'column' }}>
            <p className="font-display" style={{ fontSize: '3.5vw', fontWeight: 800, color: '#E84424', lineHeight: 1, marginBottom: '2vh', opacity: 0.3 }}>02</p>
            <p className="font-display" style={{ fontSize: '2vw', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.2, marginBottom: '2.5vh' }}>Sub-Minute Reports</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.8vh', marginBottom: '3vh' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1vw' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '0.9vh', flexShrink: 0 }} />
                <p className="font-body" style={{ fontSize: '1.5vw', color: 'rgba(255,255,255,0.65)', lineHeight: 1.4 }}>Inspection-to-customer-report in under 60 seconds</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1vw' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '0.9vh', flexShrink: 0 }} />
                <p className="font-body" style={{ fontSize: '1.5vw', color: 'rgba(255,255,255,0.65)', lineHeight: 1.4 }}>Manual reports: 20–40 min each, every job</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1vw' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '0.9vh', flexShrink: 0 }} />
                <p className="font-body" style={{ fontSize: '1.5vw', color: 'rgba(255,255,255,0.65)', lineHeight: 1.4 }}>Commercial clients demand written documentation</p>
              </div>
            </div>

            <div style={{ marginTop: 'auto', paddingTop: '2vh', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <p className="font-display" style={{ fontSize: '2.2vw', fontWeight: 800, color: '#E84424' }}>440 hrs/year</p>
              <p className="font-body" style={{ fontSize: '1.3vw', color: 'rgba(255,255,255,0.5)' }}>recaptured per solo operator</p>
            </div>
          </div>

          {/* Guarantee 03 */}
          <div style={{ flex: 1, backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '4vh 2.8vw', display: 'flex', flexDirection: 'column', border: '1px solid rgba(15,32,64,0.08)' }}>
            <p className="font-display" style={{ fontSize: '3.5vw', fontWeight: 800, color: '#E84424', lineHeight: 1, marginBottom: '2vh', opacity: 0.25 }}>03</p>
            <p className="font-display" style={{ fontSize: '2vw', fontWeight: 700, color: '#0F2040', lineHeight: 1.2, marginBottom: '2.5vh' }}>20-Min Manager Review</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.8vh', marginBottom: '3vh' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1vw' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '0.9vh', flexShrink: 0 }} />
                <p className="font-body" style={{ fontSize: '1.5vw', color: '#5A6D8A', lineHeight: 1.4 }}>AI surfaces only exception cases for review</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1vw' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '0.9vh', flexShrink: 0 }} />
                <p className="font-body" style={{ fontSize: '1.5vw', color: '#5A6D8A', lineHeight: 1.4 }}>One manager scales from 4 to 20+ technicians</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1vw' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '0.9vh', flexShrink: 0 }} />
                <p className="font-body" style={{ fontSize: '1.5vw', color: '#5A6D8A', lineHeight: 1.4 }}>Quality standards enforced without per-job oversight</p>
              </div>
            </div>

            <div style={{ marginTop: 'auto', paddingTop: '2vh', borderTop: '1px solid rgba(15,32,64,0.08)' }}>
              <p className="font-display" style={{ fontSize: '2.2vw', fontWeight: 800, color: '#0F2040' }}>5× throughput</p>
              <p className="font-body" style={{ fontSize: '1.3vw', color: '#5A6D8A' }}>per manager, no extra headcount</p>
            </div>
          </div>

        </div>

        <div style={{ height: '6vh' }} />

      </div>
    </div>
  );
}
