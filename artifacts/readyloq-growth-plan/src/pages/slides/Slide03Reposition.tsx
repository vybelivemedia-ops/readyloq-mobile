export default function Slide03Reposition() {
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
          The Repositioning
        </p>

        {/* Headline */}
        <h2
          className="font-display"
          style={{ fontSize: '3.6vw', fontWeight: 800, color: '#0F2040', lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: '5vh' }}
        >
          From knowledge utility to profit engine
        </h2>

        {/* Two-column before/after */}
        <div style={{ display: 'flex', gap: '0', flex: 1 }}>

          {/* BEFORE column */}
          <div
            style={{
              flex: 1,
              backgroundColor: '#E8EEF5',
              borderRadius: '10px 0 0 10px',
              padding: '4vh 3.5vw',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1vw', marginBottom: '3.5vh' }}>
              <div style={{ width: '2.5vw', height: '2.5vw', borderRadius: '50%', backgroundColor: 'rgba(15,32,64,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="font-display" style={{ fontSize: '1.3vw', fontWeight: 700, color: '#5A6D8A' }}>—</span>
              </div>
              <span className="font-display" style={{ fontSize: '1.5vw', fontWeight: 700, color: '#5A6D8A', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Before</span>
            </div>

            <p className="font-display" style={{ fontSize: '2.1vw', fontWeight: 700, color: '#5A6D8A', lineHeight: 1.25, marginBottom: '3.5vh' }}>
              "Don't lose knowledge when technicians leave."
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2.2vh' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.2vw' }}>
                <div style={{ width: '0.6vh', height: '0.6vh', borderRadius: '50%', backgroundColor: '#5A6D8A', marginTop: '1.1vh', flexShrink: 0 }} />
                <p className="font-body" style={{ fontSize: '1.6vw', color: '#5A6D8A', lineHeight: 1.4 }}>Reactive, knowledge-preservation utility</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.2vw' }}>
                <div style={{ width: '0.6vh', height: '0.6vh', borderRadius: '50%', backgroundColor: '#5A6D8A', marginTop: '1.1vh', flexShrink: 0 }} />
                <p className="font-body" style={{ fontSize: '1.6vw', color: '#5A6D8A', lineHeight: 1.4 }}>Cost-center perception — "another subscription"</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.2vw' }}>
                <div style={{ width: '0.6vh', height: '0.6vh', borderRadius: '50%', backgroundColor: '#5A6D8A', marginTop: '1.1vh', flexShrink: 0 }} />
                <p className="font-body" style={{ fontSize: '1.6vw', color: '#5A6D8A', lineHeight: 1.4 }}>Feature-led sales conversations</p>
              </div>
            </div>
          </div>

          {/* Divider arrow */}
          <div
            style={{
              width: '6vw',
              backgroundColor: '#0F2040',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="3vw" height="3vw" viewBox="0 0 40 40" fill="none">
              <path d="M8 20 L28 20 M20 10 L30 20 L20 30" stroke="#E84424" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* AFTER column */}
          <div
            style={{
              flex: 1,
              backgroundColor: '#FFFFFF',
              borderRadius: '0 10px 10px 0',
              padding: '4vh 3.5vw',
              display: 'flex',
              flexDirection: 'column',
              border: '1px solid rgba(15,32,64,0.08)',
              borderLeft: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1vw', marginBottom: '3.5vh' }}>
              <div style={{ width: '2.5vw', height: '2.5vw', borderRadius: '50%', backgroundColor: '#E84424', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="font-display" style={{ fontSize: '1.3vw', fontWeight: 700, color: '#FFFFFF' }}>+</span>
              </div>
              <span className="font-display" style={{ fontSize: '1.5vw', fontWeight: 700, color: '#E84424', letterSpacing: '0.12em', textTransform: 'uppercase' }}>After</span>
            </div>

            <p className="font-display" style={{ fontSize: '2.1vw', fontWeight: 700, color: '#0F2040', lineHeight: 1.25, marginBottom: '3.5vh' }}>
              "The profit engine that guarantees reduced callbacks and high-margin exclusion discovery."
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2.2vh' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.2vw' }}>
                <div style={{ width: '0.6vh', height: '0.6vh', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '1.1vh', flexShrink: 0 }} />
                <p className="font-body" style={{ fontSize: '1.6vw', color: '#0F2040', lineHeight: 1.4 }}>Proactive, outcome-driving revenue multiplier</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.2vw' }}>
                <div style={{ width: '0.6vh', height: '0.6vh', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '1.1vh', flexShrink: 0 }} />
                <p className="font-body" style={{ fontSize: '1.6vw', color: '#0F2040', lineHeight: 1.4 }}>Revenue-center — delivers 70–80× ROI annually</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.2vw' }}>
                <div style={{ width: '0.6vh', height: '0.6vh', borderRadius: '50%', backgroundColor: '#E84424', marginTop: '1.1vh', flexShrink: 0 }} />
                <p className="font-body" style={{ fontSize: '1.6vw', color: '#0F2040', lineHeight: 1.4 }}>Dollar-value conversations that close faster</p>
              </div>
            </div>
          </div>

        </div>

        {/* Bottom spacing */}
        <div style={{ height: '6vh' }} />

      </div>
    </div>
  );
}
