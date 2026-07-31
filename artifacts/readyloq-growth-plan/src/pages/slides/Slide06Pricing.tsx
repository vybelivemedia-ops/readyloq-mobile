export default function Slide06Pricing() {
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
          Pricing Architecture
        </p>

        {/* Headline */}
        <h2
          className="font-display"
          style={{ fontSize: '3.6vw', fontWeight: 800, color: '#0F2040', lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: '4vh' }}
        >
          Priced to reflect real financial return
        </h2>

        {/* Table header */}
        <div style={{ display: 'flex', gap: '0', marginBottom: '1.5vh', paddingLeft: '0.5vw' }}>
          <div style={{ flex: 2 }}>
            <p className="font-body" style={{ fontSize: '1.15vw', color: '#5A6D8A', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Plan</p>
          </div>
          <div style={{ flex: 1.2 }}>
            <p className="font-body" style={{ fontSize: '1.15vw', color: '#5A6D8A', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Pricing</p>
          </div>
          <div style={{ flex: 3 }}>
            <p className="font-body" style={{ fontSize: '1.15vw', color: '#5A6D8A', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Included</p>
          </div>
          <div style={{ flex: 1 }}>
            <p className="font-body" style={{ fontSize: '1.15vw', color: '#5A6D8A', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', textAlign: 'right' }}>Status</p>
          </div>
        </div>

        {/* Section: Current */}
        <p className="font-body" style={{ fontSize: '1.15vw', color: '#5A6D8A', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '1.2vh', paddingLeft: '0.5vw', borderLeft: '3px solid #E84424', paddingLeft: '1vw' }}>Current</p>

        {/* Solo Operator row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0', backgroundColor: '#FFFFFF', borderRadius: '8px', padding: '2.2vh 1.5vw', marginBottom: '0.8vh', border: '1px solid rgba(15,32,64,0.07)' }}>
          <div style={{ flex: 2 }}>
            <p className="font-display" style={{ fontSize: '1.6vw', fontWeight: 700, color: '#0F2040' }}>Solo Operator</p>
            <p className="font-body" style={{ fontSize: '1.2vw', color: '#5A6D8A' }}>Single seat</p>
          </div>
          <div style={{ flex: 1.2 }}>
            <p className="font-display" style={{ fontSize: '1.7vw', fontWeight: 800, color: '#0F2040' }}>$69<span style={{ fontSize: '1.2vw', fontWeight: 500, color: '#5A6D8A' }}>/mo</span></p>
            <p className="font-body" style={{ fontSize: '1.2vw', color: '#5A6D8A' }}>$690/yr</p>
          </div>
          <div style={{ flex: 3 }}>
            <p className="font-body" style={{ fontSize: '1.35vw', color: '#5A6D8A' }}>FAIE Vision AI · Offline sync · Reporting · Single-operator dashboard</p>
          </div>
          <div style={{ flex: 1, textAlign: 'right' }}>
            <span style={{ backgroundColor: 'rgba(16,185,129,0.12)', color: '#059669', padding: '0.4vh 1vw', borderRadius: '20px', fontSize: '1.2vw', fontWeight: 600 }}>Live</span>
          </div>
        </div>

        {/* Growth Team row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0', backgroundColor: '#FFFFFF', borderRadius: '8px', padding: '2.2vh 1.5vw', marginBottom: '2.5vh', border: '1px solid rgba(15,32,64,0.07)' }}>
          <div style={{ flex: 2 }}>
            <p className="font-display" style={{ fontSize: '1.6vw', fontWeight: 700, color: '#0F2040' }}>Growth Team</p>
            <p className="font-body" style={{ fontSize: '1.2vw', color: '#5A6D8A' }}>Multi-operator</p>
          </div>
          <div style={{ flex: 1.2 }}>
            <p className="font-display" style={{ fontSize: '1.7vw', fontWeight: 800, color: '#0F2040' }}>$129<span style={{ fontSize: '1.2vw', fontWeight: 500, color: '#5A6D8A' }}>/mo base</span></p>
            <p className="font-body" style={{ fontSize: '1.2vw', color: '#5A6D8A' }}>+ $39/seat · $1,290/yr</p>
          </div>
          <div style={{ flex: 3 }}>
            <p className="font-body" style={{ fontSize: '1.35vw', color: '#5A6D8A' }}>All Solo features · Owner/Manager/Sales/Tech roles · Pipeline · Hot-zone mapping</p>
          </div>
          <div style={{ flex: 1, textAlign: 'right' }}>
            <span style={{ backgroundColor: 'rgba(16,185,129,0.12)', color: '#059669', padding: '0.4vh 1vw', borderRadius: '20px', fontSize: '1.2vw', fontWeight: 600 }}>Live</span>
          </div>
        </div>

        {/* Section: Roadmap */}
        <p className="font-body" style={{ fontSize: '1.15vw', color: '#5A6D8A', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '1.2vh', borderLeft: '3px solid rgba(15,32,64,0.25)', paddingLeft: '1vw' }}>Roadmap — Next 18 Months</p>

        {/* Professional row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0', backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: '8px', padding: '2.2vh 1.5vw', marginBottom: '0.8vh', border: '1px dashed rgba(15,32,64,0.15)' }}>
          <div style={{ flex: 2 }}>
            <p className="font-display" style={{ fontSize: '1.6vw', fontWeight: 700, color: '#0F2040' }}>Professional</p>
            <p className="font-body" style={{ fontSize: '1.2vw', color: '#5A6D8A' }}>Branch-level</p>
          </div>
          <div style={{ flex: 1.2 }}>
            <p className="font-display" style={{ fontSize: '1.7vw', fontWeight: 800, color: '#0F2040' }}>$399<span style={{ fontSize: '1.2vw', fontWeight: 500, color: '#5A6D8A' }}>/mo</span></p>
          </div>
          <div style={{ flex: 3 }}>
            <p className="font-body" style={{ fontSize: '1.35vw', color: '#5A6D8A' }}>All Growth features · Branch management · API access · White-label reports</p>
          </div>
          <div style={{ flex: 1, textAlign: 'right' }}>
            <span style={{ backgroundColor: 'rgba(90,109,138,0.1)', color: '#5A6D8A', padding: '0.4vh 1vw', borderRadius: '20px', fontSize: '1.2vw', fontWeight: 600 }}>Planned</span>
          </div>
        </div>

        {/* Enterprise row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0', backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: '8px', padding: '2.2vh 1.5vw', marginBottom: '0', border: '1px dashed rgba(15,32,64,0.15)' }}>
          <div style={{ flex: 2 }}>
            <p className="font-display" style={{ fontSize: '1.6vw', fontWeight: 700, color: '#0F2040' }}>Enterprise</p>
            <p className="font-body" style={{ fontSize: '1.2vw', color: '#5A6D8A' }}>Multi-branch</p>
          </div>
          <div style={{ flex: 1.2 }}>
            <p className="font-display" style={{ fontSize: '1.7vw', fontWeight: 800, color: '#0F2040' }}>Custom</p>
          </div>
          <div style={{ flex: 3 }}>
            <p className="font-body" style={{ fontSize: '1.35vw', color: '#5A6D8A' }}>Dedicated AI model training · SSO · SLA · Multi-branch analytics · Custom integrations</p>
          </div>
          <div style={{ flex: 1, textAlign: 'right' }}>
            <span style={{ backgroundColor: 'rgba(90,109,138,0.1)', color: '#5A6D8A', padding: '0.4vh 1vw', borderRadius: '20px', fontSize: '1.2vw', fontWeight: 600 }}>Planned</span>
          </div>
        </div>

        <div style={{ height: '5vh' }} />

      </div>
    </div>
  );
}
