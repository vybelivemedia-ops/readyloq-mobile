export default function Slide05ROI() {
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
          The Dollar Math
        </p>

        {/* Headline */}
        <h2
          className="font-display"
          style={{ fontSize: '3.6vw', fontWeight: 800, color: '#0F2040', lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: '4.5vh' }}
        >
          The software pays for itself in week one
        </h2>

        {/* Two columns */}
        <div style={{ display: 'flex', gap: '2.5vw', flex: 1 }}>

          {/* Solo Operator */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2vh' }}>
            <div style={{ backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '3vh 2.5vw', border: '1px solid rgba(15,32,64,0.08)' }}>
              <p className="font-display" style={{ fontSize: '1.5vw', fontWeight: 700, color: '#0F2040', marginBottom: '0.5vh' }}>Solo Operator</p>
              <p className="font-body" style={{ fontSize: '1.2vw', color: '#5A6D8A' }}>6 jobs/day · 220 working days</p>
            </div>

            <div style={{ backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '2.5vh 2.5vw', border: '1px solid rgba(15,32,64,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p className="font-body" style={{ fontSize: '1.35vw', color: '#5A6D8A', marginBottom: '0.3vh' }}>165 callbacks eliminated</p>
                <p className="font-body" style={{ fontSize: '1.2vw', color: 'rgba(90,109,138,0.6)' }}>@ $200 avg direct cost</p>
              </div>
              <p className="font-display" style={{ fontSize: '2.4vw', fontWeight: 800, color: '#0F2040' }}>$33K</p>
            </div>

            <div style={{ backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '2.5vh 2.5vw', border: '1px solid rgba(15,32,64,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p className="font-body" style={{ fontSize: '1.35vw', color: '#5A6D8A', marginBottom: '0.3vh' }}>440 hours recaptured</p>
                <p className="font-body" style={{ fontSize: '1.2vw', color: 'rgba(90,109,138,0.6)' }}>from automated reporting</p>
              </div>
              <p className="font-display" style={{ fontSize: '2.4vw', fontWeight: 800, color: '#0F2040' }}>$22K</p>
            </div>

            <div style={{ backgroundColor: '#0F2040', borderRadius: '10px', padding: '3vh 2.5vw', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p className="font-body" style={{ fontSize: '1.35vw', color: 'rgba(255,255,255,0.6)', marginBottom: '0.3vh' }}>Total annual value delivered</p>
                <p className="font-body" style={{ fontSize: '1.3vw', color: 'rgba(255,255,255,0.4)' }}>ReadyLoq Solo cost: $690/yr</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p className="font-display" style={{ fontSize: '2.8vw', fontWeight: 800, color: '#E84424' }}>$55K+</p>
                <p className="font-display" style={{ fontSize: '1.8vw', fontWeight: 700, color: 'rgba(255,255,255,0.5)' }}>80× ROI</p>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: '1px', backgroundColor: 'rgba(15,32,64,0.1)', alignSelf: 'stretch' }} />

          {/* Growth Team */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2vh' }}>
            <div style={{ backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '3vh 2.5vw', border: '1px solid rgba(15,32,64,0.08)' }}>
              <p className="font-display" style={{ fontSize: '1.5vw', fontWeight: 700, color: '#0F2040', marginBottom: '0.5vh' }}>Growth Team</p>
              <p className="font-body" style={{ fontSize: '1.2vw', color: '#5A6D8A' }}>5 technicians · multi-operator roles</p>
            </div>

            <div style={{ backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '2.5vh 2.5vw', border: '1px solid rgba(15,32,64,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p className="font-body" style={{ fontSize: '1.35vw', color: '#5A6D8A', marginBottom: '0.3vh' }}>Callback savings across team</p>
                <p className="font-body" style={{ fontSize: '1.2vw', color: 'rgba(90,109,138,0.6)' }}>825 revisits eliminated</p>
              </div>
              <p className="font-display" style={{ fontSize: '2.4vw', fontWeight: 800, color: '#0F2040' }}>$165K</p>
            </div>

            <div style={{ backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '2.5vh 2.5vw', border: '1px solid rgba(15,32,64,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p className="font-body" style={{ fontSize: '1.35vw', color: '#5A6D8A', marginBottom: '0.3vh' }}>Reporting hours recovered</p>
                <p className="font-body" style={{ fontSize: '1.2vw', color: 'rgba(90,109,138,0.6)' }}>plus pipeline + hot-zone ops</p>
              </div>
              <p className="font-display" style={{ fontSize: '2.4vw', fontWeight: 800, color: '#0F2040' }}>$110K</p>
            </div>

            <div style={{ backgroundColor: '#E84424', borderRadius: '10px', padding: '3vh 2.5vw', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p className="font-body" style={{ fontSize: '1.35vw', color: 'rgba(255,255,255,0.75)', marginBottom: '0.3vh' }}>Total annual value delivered</p>
                <p className="font-body" style={{ fontSize: '1.3vw', color: 'rgba(255,255,255,0.55)' }}>ReadyLoq Growth cost: ~$3,900/yr</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p className="font-display" style={{ fontSize: '2.8vw', fontWeight: 800, color: '#FFFFFF' }}>$275K+</p>
                <p className="font-display" style={{ fontSize: '1.8vw', fontWeight: 700, color: 'rgba(255,255,255,0.65)' }}>70× ROI</p>
              </div>
            </div>
          </div>

        </div>

        <div style={{ height: '6vh' }} />

      </div>
    </div>
  );
}
