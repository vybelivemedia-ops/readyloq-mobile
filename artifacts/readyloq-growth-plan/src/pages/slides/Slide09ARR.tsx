export default function Slide09ARR() {
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
          Path to $100M ARR
        </p>

        {/* Headline */}
        <h2
          className="font-display"
          style={{ fontSize: '3.6vw', fontWeight: 800, color: '#0F2040', lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: '5vh' }}
        >
          Three milestones. Five years to market leadership.
        </h2>

        {/* Progress connector bar */}
        <div style={{ position: 'relative', marginBottom: '3vh' }}>
          <div style={{ height: '4px', backgroundColor: 'rgba(15,32,64,0.1)', borderRadius: '2px' }} />
          <div style={{ position: 'absolute', top: 0, left: 0, width: '16.7%', height: '4px', backgroundColor: '#E84424', borderRadius: '2px' }} />
          <div style={{ position: 'absolute', top: '-8px', left: 'calc(16.7% - 10px)', width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#E84424', border: '3px solid #F4F7FC' }} />
          <div style={{ position: 'absolute', top: '-6px', left: 'calc(50% - 8px)', width: '16px', height: '16px', borderRadius: '50%', backgroundColor: 'rgba(15,32,64,0.2)', border: '3px solid #F4F7FC' }} />
          <div style={{ position: 'absolute', top: '-6px', right: '-8px', width: '16px', height: '16px', borderRadius: '50%', backgroundColor: 'rgba(15,32,64,0.2)', border: '3px solid #F4F7FC' }} />
        </div>

        {/* Three milestone columns */}
        <div style={{ display: 'flex', gap: '2vw', flex: 1 }}>

          {/* Milestone 1 */}
          <div style={{ flex: 1, backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '3.5vh 2.5vw', display: 'flex', flexDirection: 'column', border: '2px solid #E84424', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', backgroundColor: '#E84424' }} />
            <p className="font-body" style={{ fontSize: '1.15vw', color: '#E84424', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '1.5vh' }}>Month 12</p>
            <p className="font-display" style={{ fontSize: '4.5vw', fontWeight: 800, color: '#E84424', lineHeight: 1.0, letterSpacing: '-0.02em', marginBottom: '1vh' }}>$1M</p>
            <p className="font-display" style={{ fontSize: '1.6vw', fontWeight: 700, color: '#0F2040', marginBottom: '3vh' }}>ARR</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5vh' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <p className="font-body" style={{ fontSize: '1.35vw', color: '#5A6D8A' }}>Solo seats</p>
                <p className="font-display" style={{ fontSize: '1.35vw', fontWeight: 700, color: '#0F2040' }}>1,200</p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <p className="font-body" style={{ fontSize: '1.35vw', color: '#5A6D8A' }}>Growth accounts</p>
                <p className="font-display" style={{ fontSize: '1.35vw', fontWeight: 700, color: '#0F2040' }}>60</p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <p className="font-body" style={{ fontSize: '1.35vw', color: '#5A6D8A' }}>Primary motion</p>
                <p className="font-display" style={{ fontSize: '1.35vw', fontWeight: 700, color: '#0F2040' }}>Direct inbound</p>
              </div>
            </div>
          </div>

          {/* Milestone 2 */}
          <div style={{ flex: 1, backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '3.5vh 2.5vw', display: 'flex', flexDirection: 'column', border: '1px solid rgba(15,32,64,0.08)' }}>
            <p className="font-body" style={{ fontSize: '1.15vw', color: '#5A6D8A', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '1.5vh' }}>Month 30</p>
            <p className="font-display" style={{ fontSize: '4.5vw', fontWeight: 800, color: '#0F2040', lineHeight: 1.0, letterSpacing: '-0.02em', marginBottom: '1vh' }}>$10M</p>
            <p className="font-display" style={{ fontSize: '1.6vw', fontWeight: 700, color: '#0F2040', marginBottom: '3vh' }}>ARR</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5vh' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <p className="font-body" style={{ fontSize: '1.35vw', color: '#5A6D8A' }}>Solo seats</p>
                <p className="font-display" style={{ fontSize: '1.35vw', fontWeight: 700, color: '#0F2040' }}>4,000</p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <p className="font-body" style={{ fontSize: '1.35vw', color: '#5A6D8A' }}>Growth accounts</p>
                <p className="font-display" style={{ fontSize: '1.35vw', fontWeight: 700, color: '#0F2040' }}>400</p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <p className="font-body" style={{ fontSize: '1.35vw', color: '#5A6D8A' }}>Net revenue retention</p>
                <p className="font-display" style={{ fontSize: '1.35vw', fontWeight: 700, color: '#0F2040' }}>115%+</p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <p className="font-body" style={{ fontSize: '1.35vw', color: '#5A6D8A' }}>Professional accounts</p>
                <p className="font-display" style={{ fontSize: '1.35vw', fontWeight: 700, color: '#0F2040' }}>50</p>
              </div>
            </div>
          </div>

          {/* Milestone 3 */}
          <div style={{ flex: 1, backgroundColor: '#0F2040', borderRadius: '10px', padding: '3.5vh 2.5vw', display: 'flex', flexDirection: 'column' }}>
            <p className="font-body" style={{ fontSize: '1.15vw', color: 'rgba(232,68,36,0.7)', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '1.5vh' }}>Month 60</p>
            <p className="font-display" style={{ fontSize: '4.5vw', fontWeight: 800, color: '#FFFFFF', lineHeight: 1.0, letterSpacing: '-0.02em', marginBottom: '1vh' }}>$100M</p>
            <p className="font-display" style={{ fontSize: '1.6vw', fontWeight: 700, color: '#E84424', marginBottom: '3vh' }}>ARR</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5vh' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <p className="font-body" style={{ fontSize: '1.35vw', color: 'rgba(255,255,255,0.55)' }}>Professional accounts</p>
                <p className="font-display" style={{ fontSize: '1.35vw', fontWeight: 700, color: '#FFFFFF' }}>800+</p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <p className="font-body" style={{ fontSize: '1.35vw', color: 'rgba(255,255,255,0.55)' }}>Enterprise contracts</p>
                <p className="font-display" style={{ fontSize: '1.35vw', fontWeight: 700, color: '#FFFFFF' }}>40+</p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <p className="font-body" style={{ fontSize: '1.35vw', color: 'rgba(255,255,255,0.55)' }}>Adjacent verticals</p>
                <p className="font-display" style={{ fontSize: '1.35vw', fontWeight: 700, color: '#FFFFFF' }}>+30% ARR</p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <p className="font-body" style={{ fontSize: '1.35vw', color: 'rgba(255,255,255,0.55)' }}>Gross margin target</p>
                <p className="font-display" style={{ fontSize: '1.35vw', fontWeight: 700, color: '#E84424' }}>82%</p>
              </div>
            </div>
          </div>

        </div>

        <div style={{ height: '6vh' }} />

      </div>
    </div>
  );
}
