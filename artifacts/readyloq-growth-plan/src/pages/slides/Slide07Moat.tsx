export default function Slide07Moat() {
  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{ backgroundColor: '#0A1A35' }}
    >
      {/* Subtle grid texture */}
      <div
        style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'radial-gradient(circle at 70% 50%, rgba(232,68,36,0.06) 0%, transparent 60%), linear-gradient(135deg, rgba(15,32,64,0) 0%, rgba(232,68,36,0.04) 100%)',
        }}
      />

      <div style={{ position: 'relative', height: '100%', display: 'flex', paddingTop: '9vh', paddingLeft: '8vw', paddingRight: '8vw', gap: '7vw' }}>

        {/* Left column — text */}
        <div style={{ flex: '0 0 44%', display: 'flex', flexDirection: 'column', paddingBottom: '8vh' }}>

          <p className="font-body" style={{ fontSize: '1.2vw', color: '#E84424', fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '2vh' }}>
            The Data Moat
          </p>

          <h2
            className="font-display"
            style={{ fontSize: '3.5vw', fontWeight: 800, color: '#FFFFFF', lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: '4vh' }}
          >
            Why no competitor catches us
          </h2>

          <p className="font-body" style={{ fontSize: '1.6vw', color: 'rgba(255,255,255,0.6)', lineHeight: 1.55, marginBottom: '4vh' }}>
            Every inspection creates five proprietary training signals that no competitor can replicate without years of field deployment.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '2vh' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.2vw' }}>
              <div style={{ width: '0.5vw', height: '0.5vw', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '1vh', flexShrink: 0 }} />
              <p className="font-body" style={{ fontSize: '1.45vw', color: 'rgba(255,255,255,0.65)', lineHeight: 1.4 }}>Geo-tagged pest evidence photos with species + severity labels</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.2vw' }}>
              <div style={{ width: '0.5vw', height: '0.5vw', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '1vh', flexShrink: 0 }} />
              <p className="font-body" style={{ fontSize: '1.45vw', color: 'rgba(255,255,255,0.65)', lineHeight: 1.4 }}>Treatment outcomes tied to initial condition classification</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.2vw' }}>
              <div style={{ width: '0.5vw', height: '0.5vw', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '1vh', flexShrink: 0 }} />
              <p className="font-body" style={{ fontSize: '1.45vw', color: 'rgba(255,255,255,0.65)', lineHeight: 1.4 }}>Seasonal exclusion patterns by property type and region</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.2vw' }}>
              <div style={{ width: '0.5vw', height: '0.5vw', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '1vh', flexShrink: 0 }} />
              <p className="font-body" style={{ fontSize: '1.45vw', color: 'rgba(255,255,255,0.65)', lineHeight: 1.4 }}>
                Built-in AI dimension estimation — scale references in field photos annotate real linear footage, training exclusion pricing accuracy no competitor can replicate
              </p>
            </div>
          </div>

          <div style={{ marginTop: 'auto', paddingTop: '3vh', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <p className="font-body" style={{ fontSize: '1.35vw', color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
              Competitors building generic vision models start from zero.
              <br />
              ReadyLoq's model improves with every job run on the platform.
            </p>
          </div>
        </div>

        {/* Right column — flywheel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative', paddingBottom: '8vh' }}>

          <div style={{ position: 'relative', paddingLeft: '3vw' }}>

            {/* Vertical connecting line */}
            <div style={{ position: 'absolute', left: '0.95vw', top: '2.5vh', bottom: '2.5vh', width: '2px', backgroundColor: 'rgba(232,68,36,0.3)', borderRadius: '2px' }} />

            {/* Return arrow at bottom */}
            <div style={{ position: 'absolute', left: '-0.5vw', bottom: '2.5vh' }}>
              <svg width="3.5vw" height="3.5vw" viewBox="0 0 50 50" fill="none" style={{ display: 'block' }}>
                <path d="M 14 5 Q 2 5 2 25 Q 2 48 14 48 L 38 48" stroke="rgba(232,68,36,0.4)" strokeWidth="2" fill="none" strokeLinecap="round" />
                <path d="M 30 40 L 38 48 L 30 56" stroke="rgba(232,68,36,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </div>

            {/* Steps */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3.2vh' }}>

              {/* Step 1 */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.8vw' }}>
                <div style={{ width: '2vh', height: '2vh', borderRadius: '50%', backgroundColor: '#E84424', flexShrink: 0, marginTop: '0.5vh', zIndex: 1 }} />
                <div>
                  <p className="font-display" style={{ fontSize: '1.65vw', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.2, marginBottom: '0.4vh' }}>More Inspections Run</p>
                  <p className="font-body" style={{ fontSize: '1.3vw', color: 'rgba(255,255,255,0.45)', lineHeight: 1.3 }}>Operators run every job through ReadyLoq</p>
                </div>
              </div>

              {/* Step 2 */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.8vw' }}>
                <div style={{ width: '2vh', height: '2vh', borderRadius: '50%', backgroundColor: '#E84424', flexShrink: 0, marginTop: '0.5vh', zIndex: 1 }} />
                <div>
                  <p className="font-display" style={{ fontSize: '1.65vw', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.2, marginBottom: '0.4vh' }}>Proprietary Training Data Captured</p>
                  <p className="font-body" style={{ fontSize: '1.3vw', color: 'rgba(255,255,255,0.45)', lineHeight: 1.3 }}>Unique pest-evidence dataset grows with every job</p>
                </div>
              </div>

              {/* Step 3 */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.8vw' }}>
                <div style={{ width: '2vh', height: '2vh', borderRadius: '50%', backgroundColor: '#E84424', flexShrink: 0, marginTop: '0.5vh', zIndex: 1 }} />
                <div>
                  <p className="font-display" style={{ fontSize: '1.65vw', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.2, marginBottom: '0.4vh' }}>AI Vision Models Retrained</p>
                  <p className="font-body" style={{ fontSize: '1.3vw', color: 'rgba(255,255,255,0.45)', lineHeight: 1.3 }}>Species detection accuracy compounds over time</p>
                </div>
              </div>

              {/* Step 4 */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.8vw' }}>
                <div style={{ width: '2vh', height: '2vh', borderRadius: '50%', backgroundColor: '#E84424', flexShrink: 0, marginTop: '0.5vh', zIndex: 1 }} />
                <div>
                  <p className="font-display" style={{ fontSize: '1.65vw', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.2, marginBottom: '0.4vh' }}>Better Field Outcomes</p>
                  <p className="font-body" style={{ fontSize: '1.3vw', color: 'rgba(255,255,255,0.45)', lineHeight: 1.3 }}>Fewer callbacks, higher exclusion revenue per job</p>
                </div>
              </div>

              {/* Step 5 */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.8vw' }}>
                <div style={{ width: '2vh', height: '2vh', borderRadius: '50%', backgroundColor: '#E84424', flexShrink: 0, marginTop: '0.5vh', zIndex: 1 }} />
                <div>
                  <p className="font-display" style={{ fontSize: '1.65vw', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.2, marginBottom: '0.4vh' }}>More Operators Join</p>
                  <p className="font-body" style={{ fontSize: '1.3vw', color: 'rgba(255,255,255,0.45)', lineHeight: 1.3 }}>Word spreads; dataset advantage grows further</p>
                </div>
              </div>

            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
