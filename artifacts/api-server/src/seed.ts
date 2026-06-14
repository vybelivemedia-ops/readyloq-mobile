import { db } from "@workspace/db";
import {
  inspectionsTable, inspectionMediaTable, analysisResultsTable,
  datasetImagesTable, reportsTable, quizzesTable, trainingScoresTable,
  brandingProfilesTable, READYLOQ_DEFAULT_PROFILE,
} from "@workspace/db";
import { getSeedCompanyId } from "./lib/seed-company";

async function seed() {
  console.log("Seeding database...");

  // All demo data belongs to the reserved seed (legacy) company.
  const companyId = await getSeedCompanyId();
  const withCo = <T extends object>(rows: T[]) => rows.map((r) => ({ ...r, companyId }));

  // Inspections
  const inspections = await db.insert(inspectionsTable).values(withCo([
    {
      siteAddress: "1842 Riverside Dr, Austin, TX 78701",
      clientName: "Riverside Apartments LLC",
      technicianName: "Marcus Chen",
      technicianId: "tech-001",
      status: "completed",
      pestTypes: ["Rodents", "Cockroaches"],
      severity: "high",
      notes: "Significant rodent activity found in kitchen and utility room. Multiple entry points identified.",
      mediaCount: 4,
      findingsCount: 5,
    },
    {
      siteAddress: "920 Oak Street, Dallas, TX 75201",
      clientName: "Oak Park Restaurant",
      technicianName: "Sarah Williams",
      technicianId: "tech-002",
      status: "completed",
      pestTypes: ["Cockroaches", "Flies"],
      severity: "critical",
      notes: "Heavy cockroach infestation in food prep area. Immediate treatment required.",
      mediaCount: 6,
      findingsCount: 8,
    },
    {
      siteAddress: "3310 Lakewood Ave, Houston, TX 77002",
      clientName: "Lakewood Residence",
      technicianName: "Marcus Chen",
      technicianId: "tech-001",
      status: "in-progress",
      pestTypes: ["Termites"],
      severity: "medium",
      notes: "Termite damage found in basement wood framing. Ongoing assessment.",
      mediaCount: 2,
      findingsCount: 3,
    },
    {
      siteAddress: "555 Commerce Blvd, San Antonio, TX 78205",
      clientName: "Commerce Square Office",
      technicianName: "James Rodriguez",
      technicianId: "tech-003",
      status: "pending",
      pestTypes: ["Ants"],
      severity: "low",
      notes: "Initial survey. Ant trails observed near break room.",
      mediaCount: 1,
      findingsCount: 1,
    },
    {
      siteAddress: "700 Maple Lane, Fort Worth, TX 76102",
      clientName: "Maple Ridge HOA",
      technicianName: "Sarah Williams",
      technicianId: "tech-002",
      status: "completed",
      pestTypes: ["Bed Bugs", "Fleas"],
      severity: "high",
      notes: "Bed bug infestation reported by residents in units 4B and 5C.",
      mediaCount: 5,
      findingsCount: 6,
    },
    {
      siteAddress: "2001 Industrial Pkwy, Austin, TX 78741",
      clientName: "AustoTex Warehouse",
      technicianName: "James Rodriguez",
      technicianId: "tech-003",
      status: "completed",
      pestTypes: ["Rodents", "Wildlife"],
      severity: "critical",
      notes: "Large rat colony discovered in warehouse storage area. Emergency treatment deployed.",
      mediaCount: 8,
      findingsCount: 10,
    },
    {
      siteAddress: "88 Pecan Street, Austin, TX 78701",
      clientName: "Pecan Street Bakery",
      technicianName: "Marcus Chen",
      technicianId: "tech-001",
      status: "completed",
      pestTypes: ["Flies", "Ants"],
      severity: "medium",
      notes: "Fruit fly breeding sites found near floor drains.",
      mediaCount: 3,
      findingsCount: 3,
    },
    {
      siteAddress: "1100 University Ave, Austin, TX 78712",
      clientName: "Campus Residence Hall",
      technicianName: "Elena Torres",
      technicianId: "tech-004",
      status: "pending",
      pestTypes: ["Bed Bugs"],
      severity: "high",
      notes: "Multiple room complaints. Assessment in progress.",
      mediaCount: 0,
      findingsCount: 0,
    },
  ])).returning();

  console.log(`Created ${inspections.length} inspections`);

  // Media for first inspection
  await db.insert(inspectionMediaTable).values(withCo([
    { inspectionId: inspections[0].id, mediaType: "photo", url: "https://picsum.photos/seed/pest1/800/600", filename: "entry_point_01.jpg", caption: "Main entry point behind refrigerator" },
    { inspectionId: inspections[0].id, mediaType: "photo", url: "https://picsum.photos/seed/pest2/800/600", filename: "droppings_01.jpg", caption: "Rodent droppings near utility pipe" },
    { inspectionId: inspections[0].id, mediaType: "photo", url: "https://picsum.photos/seed/pest3/800/600", filename: "gnaw_marks.jpg", caption: "Gnaw marks on electrical conduit" },
    { inspectionId: inspections[0].id, mediaType: "voice", url: "", filename: "field_notes.m4a", caption: "Site overview voice note", durationSec: 45 },
  ]));

  // Analysis results
  const findings1 = [
    { id: 1, category: "Rodent Activity", description: "Norway rat entry points identified behind refrigerator unit", confidence: 0.94, severity: "critical", location: "Kitchen area", imageUrl: "https://picsum.photos/seed/pest1/800/600", treatment: "Seal all gaps > 1/4 inch, install exclusion hardware cloth", exclusionOpportunity: true },
    { id: 2, category: "Rodent Activity", description: "Rodent droppings and urine trails on utility pipes", confidence: 0.91, severity: "high", location: "Utility room", imageUrl: "https://picsum.photos/seed/pest2/800/600", treatment: "Deep clean and sanitize affected surfaces, apply rodenticide bait stations", exclusionOpportunity: false },
    { id: 3, category: "Structural Deficiency", description: "Gap around plumbing penetration allowing rodent access", confidence: 0.88, severity: "high", location: "Under sink cabinet", imageUrl: null, treatment: "Fill with steel wool and caulk, apply copper mesh exclusion", exclusionOpportunity: true },
    { id: 4, category: "Sanitation Concern", description: "Food residue accumulation in hard-to-reach cabinet corners", confidence: 0.79, severity: "medium", location: "Kitchen cabinets", imageUrl: null, treatment: "Deep clean with enzyme cleaner, install door sweeps", exclusionOpportunity: false },
    { id: 5, category: "Moisture Condition", description: "Leaking pipe creating harborage moisture for pests", confidence: 0.85, severity: "medium", location: "Bathroom vanity", imageUrl: null, treatment: "Repair leak immediately, dry out area with dehumidifier", exclusionOpportunity: false },
  ];

  const analyses = await db.insert(analysisResultsTable).values(withCo([
    {
      inspectionId: inspections[0].id,
      status: "complete",
      findings: findings1,
      recommendations: [
        "Immediate seal all identified entry points with copper mesh and steel wool",
        "Deploy snap traps and bait stations along active rodent runways",
        "Schedule follow-up inspection in 14 days",
        "Repair leaking pipe under bathroom vanity",
        "Educate residents on proper food storage and sanitation protocols",
      ],
      overallConfidence: 0.87,
      riskLevel: "high",
    },
    {
      inspectionId: inspections[1].id,
      status: "complete",
      findings: [
        { id: 1, category: "Cockroach Infestation", description: "German cockroach egg cases (oothecae) found in multiple harborage sites", confidence: 0.97, severity: "critical", location: "Behind cooking equipment", imageUrl: "https://picsum.photos/seed/bug1/800/600", treatment: "Apply gel bait in harborage sites, IGR spray application", exclusionOpportunity: false },
        { id: 2, category: "Cockroach Infestation", description: "Live cockroaches active during daytime indicating heavy infestation", confidence: 0.95, severity: "critical", location: "Food prep area", imageUrl: null, treatment: "Immediate deep clean required before treatment", exclusionOpportunity: false },
        { id: 3, category: "Sanitation Concern", description: "Grease accumulation under fryers providing food source", confidence: 0.89, severity: "high", location: "Kitchen floor", imageUrl: null, treatment: "Professional degreasing service required", exclusionOpportunity: false },
        { id: 4, category: "Moisture Condition", description: "Standing water under commercial dishwasher", confidence: 0.82, severity: "high", location: "Dishwashing station", imageUrl: null, treatment: "Repair drain, install floor drain cover", exclusionOpportunity: false },
      ],
      recommendations: [
        "Cease food service operations until treatment is complete",
        "Apply Advion gel bait to all harborage sites immediately",
        "Install pheromone monitoring traps throughout kitchen",
        "Mandatory staff sanitation training required",
        "Follow-up inspection in 7 days — critical status",
      ],
      overallConfidence: 0.92,
      riskLevel: "critical",
    },
    {
      inspectionId: inspections[4].id,
      status: "complete",
      findings: [
        { id: 1, category: "Bed Bug Activity", description: "Live bed bugs and cast skins found in mattress seams", confidence: 0.96, severity: "critical", location: "Unit 4B - Bedroom", imageUrl: "https://picsum.photos/seed/bug3/800/600", treatment: "Heat treatment required - minimum 120°F for 3+ hours", exclusionOpportunity: false },
        { id: 2, category: "Bed Bug Activity", description: "Fecal spotting and blood staining on headboard", confidence: 0.93, severity: "high", location: "Unit 4B - Headboard", imageUrl: null, treatment: "Discard infested furniture, treat remaining items with steam", exclusionOpportunity: false },
      ],
      recommendations: [
        "Schedule professional heat treatment within 48 hours",
        "Bag and remove heavily infested furniture",
        "Inspect all adjacent units as preventive measure",
        "Provide residents with preparation instructions for heat treatment",
      ],
      overallConfidence: 0.94,
      riskLevel: "critical",
    },
  ])).returning();

  // Update inspection findingsCount to match
  await db.update(inspectionsTable).set({ findingsCount: analyses[0].findings?.length ?? 0, aiAnalysisId: analyses[0].id }).where(eq(inspectionsTable.id, inspections[0].id));

  console.log(`Created ${analyses.length} analysis results`);

  // Dataset images
  const datasetImages = await db.insert(datasetImagesTable).values(withCo([
    { category: "pest_activity", title: "Norway Rat Entry Point", description: "Classic gnaw marks and rub trails around pipe penetration", imageUrl: "https://picsum.photos/seed/rat1/600/400", thumbnailUrl: "https://picsum.photos/seed/rat1/300/200", pestType: "Rodents", severity: "high", location: "Utility room", tags: ["rodent", "entry-point", "gnaw-mark", "norway-rat"] },
    { category: "pest_activity", title: "German Cockroach Harborage", description: "Egg cases and fecal spotting in kitchen cabinet corner", imageUrl: "https://picsum.photos/seed/roach1/600/400", thumbnailUrl: "https://picsum.photos/seed/roach1/300/200", pestType: "Cockroaches", severity: "critical", location: "Kitchen", tags: ["cockroach", "german", "oothecae", "harborage"] },
    { category: "pest_activity", title: "Bed Bug Cast Skins", description: "Molted exoskeletons and fecal spotting in mattress seam", imageUrl: "https://picsum.photos/seed/bedbug1/600/400", thumbnailUrl: "https://picsum.photos/seed/bedbug1/300/200", pestType: "Bed Bugs", severity: "critical", location: "Bedroom", tags: ["bed-bug", "cast-skin", "fecal-spot", "mattress"] },
    { category: "pest_activity", title: "Termite Mud Tubes", description: "Subterranean termite earthen tubes on foundation wall", imageUrl: "https://picsum.photos/seed/termite1/600/400", thumbnailUrl: "https://picsum.photos/seed/termite1/300/200", pestType: "Termites", severity: "high", location: "Foundation", tags: ["termite", "mud-tube", "subterranean", "foundation"] },
    { category: "pest_activity", title: "Ant Foraging Trail", description: "Pavement ant trail following baseboard into kitchen", imageUrl: "https://picsum.photos/seed/ant1/600/400", thumbnailUrl: "https://picsum.photos/seed/ant1/300/200", pestType: "Ants", severity: "medium", location: "Kitchen baseboard", tags: ["ant", "pavement-ant", "trail", "foraging"] },
    { category: "pest_activity", title: "Flea Infestation Indicator", description: "Flea dirt (fecal matter) identified in carpet fibers", imageUrl: "https://picsum.photos/seed/flea1/600/400", thumbnailUrl: "https://picsum.photos/seed/flea1/300/200", pestType: "Fleas", severity: "medium", location: "Living room carpet", tags: ["flea", "flea-dirt", "carpet", "infestation"] },
    { category: "exclusion", title: "Pipe Penetration Gap", description: "Unsealed gap around water pipe entering foundation", imageUrl: "https://picsum.photos/seed/excl1/600/400", thumbnailUrl: "https://picsum.photos/seed/excl1/300/200", pestType: "Rodents", severity: "high", location: "Foundation", tags: ["exclusion", "pipe-gap", "entry-point", "foundation"] },
    { category: "exclusion", title: "Damaged Door Sweep", description: "Missing door sweep allowing pest entry under exterior door", imageUrl: "https://picsum.photos/seed/excl2/600/400", thumbnailUrl: "https://picsum.photos/seed/excl2/300/200", pestType: "Multiple", severity: "medium", location: "Exterior door", tags: ["exclusion", "door-sweep", "entry-point"] },
    { category: "exclusion", title: "Foundation Crack Entry", description: "Hairline crack in foundation providing rodent entry path", imageUrl: "https://picsum.photos/seed/excl3/600/400", thumbnailUrl: "https://picsum.photos/seed/excl3/300/200", pestType: "Rodents", severity: "high", location: "Foundation wall", tags: ["exclusion", "crack", "foundation", "entry-point"] },
    { category: "sanitation", title: "Grease Trap Buildup", description: "Heavy grease accumulation under commercial cooking equipment", imageUrl: "https://picsum.photos/seed/san1/600/400", thumbnailUrl: "https://picsum.photos/seed/san1/300/200", pestType: "Cockroaches", severity: "high", location: "Commercial kitchen", tags: ["sanitation", "grease", "food-source", "commercial"] },
    { category: "sanitation", title: "Waste Storage Issue", description: "Improperly covered dumpster attracting flying insects", imageUrl: "https://picsum.photos/seed/san2/600/400", thumbnailUrl: "https://picsum.photos/seed/san2/300/200", pestType: "Flies", severity: "medium", location: "Rear of building", tags: ["sanitation", "waste", "dumpster", "flies"] },
    { category: "moisture", title: "Sub-slab Moisture Infiltration", description: "Moisture wicking through concrete slab attracting pests", imageUrl: "https://picsum.photos/seed/moist1/600/400", thumbnailUrl: "https://picsum.photos/seed/moist1/300/200", pestType: "Multiple", severity: "medium", location: "Basement floor", tags: ["moisture", "slab", "harborage", "attractant"] },
    { category: "moisture", title: "Leaking Pipe Damage", description: "Water damage and mold from persistent leak creating pest harborage", imageUrl: "https://picsum.photos/seed/moist2/600/400", thumbnailUrl: "https://picsum.photos/seed/moist2/300/200", pestType: "Cockroaches", severity: "high", location: "Under kitchen sink", tags: ["moisture", "leak", "mold", "harborage"] },
    { category: "structural", title: "Soffit Damage Entry", description: "Deteriorated fascia board providing wildlife entry into attic", imageUrl: "https://picsum.photos/seed/struct1/600/400", thumbnailUrl: "https://picsum.photos/seed/struct1/300/200", pestType: "Wildlife", severity: "high", location: "Roofline/soffit", tags: ["structural", "soffit", "wildlife", "attic-entry"] },
    { category: "structural", title: "Termite Structural Damage", description: "Severe wood damage from termite activity in floor joist", imageUrl: "https://picsum.photos/seed/struct2/600/400", thumbnailUrl: "https://picsum.photos/seed/struct2/300/200", pestType: "Termites", severity: "critical", location: "Floor joist/subfloor", tags: ["structural", "termite", "damage", "floor-joist"] },
    { category: "pest_activity", title: "Mouse Nest in Insulation", description: "Active mouse nest constructed in wall insulation", imageUrl: "https://picsum.photos/seed/mouse1/600/400", thumbnailUrl: "https://picsum.photos/seed/mouse1/300/200", pestType: "Rodents", severity: "high", location: "Wall cavity", tags: ["rodent", "mouse", "nest", "insulation"] },
    { category: "pest_activity", title: "Wasp Nest Under Eave", description: "Large paper wasp nest under building eave", imageUrl: "https://picsum.photos/seed/wasp1/600/400", thumbnailUrl: "https://picsum.photos/seed/wasp1/300/200", pestType: "Wasps", severity: "medium", location: "Exterior eave", tags: ["wasp", "nest", "eave", "stinging-insect"] },
    { category: "pest_activity", title: "Stored Product Pest", description: "Indian meal moth larvae and webbing in grain storage", imageUrl: "https://picsum.photos/seed/moth1/600/400", thumbnailUrl: "https://picsum.photos/seed/moth1/300/200", pestType: "Stored Product Pests", severity: "medium", location: "Pantry storage", tags: ["stored-product", "moth", "larvae", "pantry"] },
  ])).returning();

  console.log(`Created ${datasetImages.length} dataset images`);

  // Reports
  await db.insert(reportsTable).values(withCo([
    {
      inspectionId: inspections[0].id,
      title: "Residential Rodent Assessment — Riverside Dr",
      clientName: "Riverside Apartments LLC",
      siteAddress: "1842 Riverside Dr, Austin, TX 78701",
      status: "complete",
      findings: findings1,
      recommendations: [
        "Seal all identified entry points within 48 hours",
        "Install tamper-resistant bait stations along perimeter",
        "Follow-up inspection scheduled in 14 days",
      ],
      treatmentNotes: "Snap traps deployed at 6 locations. Rodenticide bait stations placed at 4 exterior locations. Follow-up in 14 days to assess reduction.",
      exclusionOpportunities: ["Seal gap behind refrigerator with copper mesh and caulk", "Install pipe escutcheon plates around all plumbing penetrations"],
      technicianName: "Marcus Chen",
      inspectionDate: "2026-05-28",
      severity: "high",
    },
    {
      inspectionId: inspections[1].id,
      title: "Emergency Restaurant Cockroach Treatment Report",
      clientName: "Oak Park Restaurant",
      siteAddress: "920 Oak Street, Dallas, TX 75201",
      status: "complete",
      findings: [
        { id: 1, category: "Cockroach Infestation", description: "Critical infestation in food prep area", confidence: 0.97, severity: "critical", location: "Kitchen", imageUrl: null, treatment: "Gel bait application", exclusionOpportunity: false },
      ],
      recommendations: ["Cease food prep until treatment complete", "Professional degreasing required", "Health department notification recommended"],
      treatmentNotes: "Advion gel bait applied to 24 harborage sites. Gentrol IGR applied. Re-inspection mandatory within 7 days.",
      exclusionOpportunities: [],
      technicianName: "Sarah Williams",
      inspectionDate: "2026-06-01",
      severity: "critical",
    },
  ]));

  console.log("Created reports");

  // Quizzes
  const quizzes = await db.insert(quizzesTable).values(withCo([
    {
      title: "Rodent Identification & Behavior",
      description: "Test your ability to identify Norway rats, roof rats, and house mice from field photos",
      category: "Rodent Management",
      difficulty: "medium",
      questionCount: 5,
      passingScore: 70,
      averageScore: 78.5,
      completedCount: 12,
      questions: [
        { id: 1, imageUrl: "https://picsum.photos/seed/rat1/600/400", question: "What type of rodent evidence is shown in this image?", options: ["Norway rat gnaw marks and rub trails", "Roof rat droppings", "House mouse nest material", "Squirrel chew damage"], correctOption: 0, explanation: "The large, rough gnaw marks and dark grease rub trails are characteristic of Norway rats (Rattus norvegicus)" },
        { id: 2, imageUrl: "https://picsum.photos/seed/rat2/600/400", question: "Norway rats typically nest:", options: ["In attics and upper walls", "Underground in burrows", "Inside wall voids at mid-height", "In trees near buildings"], correctOption: 1, explanation: "Norway rats are burrowing rodents that typically nest in underground burrows along foundation walls" },
        { id: 3, imageUrl: "https://picsum.photos/seed/mouse1/600/400", question: "What is the minimum gap size that allows a house mouse to enter?", options: ["1/4 inch (6mm)", "1/2 inch (12mm)", "3/4 inch (19mm)", "1 inch (25mm)"], correctOption: 0, explanation: "House mice can squeeze through gaps as small as 1/4 inch — approximately the size of a pencil" },
        { id: 4, imageUrl: "https://picsum.photos/seed/rat3/600/400", question: "Which treatment approach is most effective for Norway rat harborage in burrows?", options: ["Interior snap traps only", "Exterior bait stations + exclusion", "Glue boards at entry points", "Ultrasonic repellers"], correctOption: 1, explanation: "Exterior tamper-resistant bait stations combined with proper exclusion provides the most effective long-term control" },
        { id: 5, imageUrl: "https://picsum.photos/seed/rat4/600/400", question: "Rodent rub marks (sebum trails) indicate:", options: ["A recently established infestation", "Heavy, ongoing rodent movement along that pathway", "The presence of juvenile rodents only", "Rodents searching for water sources"], correctOption: 1, explanation: "Rub marks develop from repeated body contact with surfaces along established runways — dark, greasy marks indicate heavy traffic" },
      ],
    },
    {
      title: "Cockroach Species ID & IPM",
      description: "Identify German, American, and Oriental cockroach species and apply correct IPM strategies",
      category: "Cockroach Management",
      difficulty: "hard",
      questionCount: 5,
      passingScore: 75,
      averageScore: 71.2,
      completedCount: 9,
      questions: [
        { id: 1, imageUrl: "https://picsum.photos/seed/roach1/600/400", question: "The egg case shown indicates which cockroach species?", options: ["American cockroach (large, dark case)", "German cockroach (light brown, carried by female)", "Oriental cockroach (dark, rounded)", "Brown-banded cockroach (banded pattern)"], correctOption: 1, explanation: "German cockroach oothecae are light tan/brown and characteristically carried by the female until just before hatching" },
        { id: 2, imageUrl: "https://picsum.photos/seed/roach2/600/400", question: "For German cockroach control, gel bait should be placed:", options: ["In large continuous lines along walls", "In small pea-sized spots in harborage areas", "Only on horizontal surfaces", "Away from food preparation areas"], correctOption: 1, explanation: "Small, discrete bait placements (pea-sized) directly in or near harborage areas maximize consumption and minimize avoidance" },
        { id: 3, imageUrl: "https://picsum.photos/seed/roach3/600/400", question: "What does cockroach fecal spotting that looks like ground black pepper indicate?", options: ["American cockroach — adult specimens", "German cockroach — active harborage site", "Oriental cockroach — moisture issue", "Drugstore beetles — not cockroaches"], correctOption: 1, explanation: "Fine, dark fecal spotting resembling black pepper is characteristic of German cockroach aggregation sites" },
        { id: 4, imageUrl: "https://picsum.photos/seed/roach4/600/400", question: "Insect Growth Regulators (IGRs) work by:", options: ["Killing cockroaches on contact", "Disrupting molting and reproduction cycles", "Repelling cockroaches from treated areas", "Attracting cockroaches to bait matrices"], correctOption: 1, explanation: "IGRs mimic juvenile hormones, preventing cockroaches from reaching reproductive maturity and disrupting population growth" },
        { id: 5, imageUrl: "https://picsum.photos/seed/roach5/600/400", question: "In a restaurant with a heavy cockroach infestation, first priority should be:", options: ["Apply broadcast spray treatment immediately", "Address moisture and sanitation issues before chemical treatment", "Install pheromone traps throughout kitchen", "Schedule follow-up in 30 days"], correctOption: 1, explanation: "Eliminating food, water, and harborage sources is the foundation of effective IPM — chemical treatments alone have poor long-term results without sanitation improvements" },
      ],
    },
    {
      title: "Exclusion Techniques & Entry Point Assessment",
      description: "Identify and correctly remediate common structural entry points for pest access",
      category: "Exclusion Work",
      difficulty: "easy",
      questionCount: 4,
      passingScore: 65,
      averageScore: 85.0,
      completedCount: 15,
      questions: [
        { id: 1, imageUrl: "https://picsum.photos/seed/excl1/600/400", question: "What material should be used to seal the gap shown around this pipe penetration?", options: ["Spray foam only", "Copper mesh packed in + caulk over", "Duct tape", "Silicone caulk alone"], correctOption: 1, explanation: "Copper mesh (or steel wool) packed into the gap and sealed with caulk provides both a physical barrier rodents cannot chew through and weather sealing" },
        { id: 2, imageUrl: "https://picsum.photos/seed/excl2/600/400", question: "A missing door sweep on an exterior door should be replaced with:", options: ["Standard felt weatherstripping", "Heavy-duty metal door sweep with rubber gasket", "Foam tape", "No replacement needed if door fits tightly"], correctOption: 1, explanation: "Heavy-duty metal sweeps with rubber gaskets provide pest exclusion while maintaining proper clearance for door operation" },
        { id: 3, imageUrl: "https://picsum.photos/seed/excl3/600/400", question: "Hardware cloth used for exclusion should be a minimum of:", options: ["1/2 inch (12.7mm) mesh", "1/4 inch (6.35mm) mesh", "1 inch (25.4mm) mesh", "Any mesh size works"], correctOption: 1, explanation: "1/4 inch hardware cloth prevents mouse entry — the standard for rodent exclusion on most openings" },
        { id: 4, imageUrl: "https://picsum.photos/seed/struct1/600/400", question: "Damaged soffit board allowing wildlife entry should be repaired with:", options: ["Temporary patch with spray foam", "Pressure-treated wood + galvanized hardware cloth", "Plastic sheeting", "Stapled chicken wire"], correctOption: 1, explanation: "Pressure-treated wood with galvanized hardware cloth backing provides lasting exclusion that wildlife cannot breach" },
      ],
    },
    {
      title: "Termite Detection & Treatment",
      description: "Identify subterranean and drywood termite evidence and select appropriate treatments",
      category: "Wood-Destroying Organisms",
      difficulty: "hard",
      questionCount: 5,
      passingScore: 75,
      completedCount: 6,
      questions: [
        { id: 1, imageUrl: "https://picsum.photos/seed/termite1/600/400", question: "The mud tubes shown are characteristic of:", options: ["Drywood termites", "Subterranean termites", "Dampwood termites", "Carpenter ants"], correctOption: 1, explanation: "Subterranean termites build earthen mud tubes to protect themselves from desiccation while traveling between soil and wood" },
        { id: 2, imageUrl: "https://picsum.photos/seed/termite2/600/400", question: "Drywood termite frass (fecal pellets) is characterized by:", options: ["Mud-like consistency stuck to wood", "Dry, hexagonal pellets that fall free", "Dark liquid staining on wood", "No visible frass production"], correctOption: 1, explanation: "Drywood termites produce distinctive dry, hexagonal (6-sided) pellets that accumulate in piles below exit holes" },
        { id: 3, imageUrl: "https://picsum.photos/seed/struct2/600/400", question: "When probing suspect wood for termite damage, sound wood vs. termite-damaged wood will:", options: ["Feel exactly the same", "Sound hollow and probe easily when damaged", "Always show visible external damage", "Only differ in color"], correctOption: 1, explanation: "Termite-damaged wood sounds hollow when tapped and a probe will penetrate easily through the galleries — external surfaces may appear intact" },
        { id: 4, imageUrl: "https://picsum.photos/seed/termite3/600/400", question: "Liquid termiticide soil treatment (trenching) creates:", options: ["A repellent barrier termites avoid", "A treated zone termites pass through, taking lethal dose to colony", "A physical barrier underground", "An attractant for termite scouts"], correctOption: 1, explanation: "Non-repellent termiticides like Termidor work through horizontal and vertical transfer — termites unknowingly pass through the treated zone and spread the active ingredient to nestmates" },
        { id: 5, imageUrl: "https://picsum.photos/seed/termite4/600/400", question: "What is the most appropriate initial response when finding active subterranean termites in a structure?", options: ["Apply liquid spot treatment and close the case", "Document thoroughly, assess extent of damage, recommend full liquid + bait program", "Recommend only bait stations — liquid treatments are outdated", "Schedule treatment for 90 days later"], correctOption: 1, explanation: "A comprehensive program combining liquid soil treatment (for immediate protection) and monitoring/baiting stations provides the most complete protection against subterranean termite colonies" },
      ],
    },
  ])).returning();

  console.log(`Created ${quizzes.length} quizzes`);

  // Training scores
  await db.insert(trainingScoresTable).values(withCo([
    { technicianName: "Marcus Chen", technicianId: "tech-001", quizId: quizzes[0].id, quizTitle: quizzes[0].title, score: 92, passed: true },
    { technicianName: "Marcus Chen", technicianId: "tech-001", quizId: quizzes[1].id, quizTitle: quizzes[1].title, score: 80, passed: true },
    { technicianName: "Marcus Chen", technicianId: "tech-001", quizId: quizzes[2].id, quizTitle: quizzes[2].title, score: 100, passed: true },
    { technicianName: "Sarah Williams", technicianId: "tech-002", quizId: quizzes[0].id, quizTitle: quizzes[0].title, score: 84, passed: true },
    { technicianName: "Sarah Williams", technicianId: "tech-002", quizId: quizzes[2].id, quizTitle: quizzes[2].title, score: 75, passed: true },
    { technicianName: "James Rodriguez", technicianId: "tech-003", quizId: quizzes[0].id, quizTitle: quizzes[0].title, score: 76, passed: true },
    { technicianName: "James Rodriguez", technicianId: "tech-003", quizId: quizzes[1].id, quizTitle: quizzes[1].title, score: 60, passed: false },
    { technicianName: "Elena Torres", technicianId: "tech-004", quizId: quizzes[0].id, quizTitle: quizzes[0].title, score: 68, passed: false },
    { technicianName: "Elena Torres", technicianId: "tech-004", quizId: quizzes[2].id, quizTitle: quizzes[2].title, score: 88, passed: true },
    { technicianName: "Marcus Chen", technicianId: "tech-001", quizId: quizzes[3].id, quizTitle: quizzes[3].title, score: 88, passed: true },
    { technicianName: "Sarah Williams", technicianId: "tech-002", quizId: quizzes[1].id, quizTitle: quizzes[1].title, score: 68, passed: false },
  ]));

  // Branding profiles: non-deletable ReadyLoq default (active) + a demo white-label profile
  const existingProfiles = await db.select().from(brandingProfilesTable);
  if (existingProfiles.length === 0) {
    await db.insert(brandingProfilesTable).values(withCo([
      {
        ...READYLOQ_DEFAULT_PROFILE,
        isDefault: true,
        isActive: true,
      },
      {
        name: "Suburban Pest Control",
        isDefault: false,
        isActive: false,
        companyName: "Suburban Pest Control",
        tagline: "Your Neighborhood Pest Experts",
        companyAddress: "1420 Oak Ridge Ave, Springfield, IL 62704",
        companyPhone: "(217) 555-0182",
        companyEmail: "hello@suburbanpest.com",
        companyWebsite: "https://suburbanpest.com",
        licenseNumber: "IL-PCO-44821",
        logoUrl: "suburban-logo.png",
        appIconUrl: "suburban-logo.png",
        primaryColor: "#16a34a",
        secondaryColor: "#14532d",
        accentColor: "#84cc16",
        reportFooterText: "Suburban Pest Control — Confidential Inspection Report",
        supportInfo: "hello@suburbanpest.com · (217) 555-0182",
        signatureDisclaimer:
          "This report certifies that a pest control inspection was conducted by Suburban Pest Control at the property on the stated date. All findings and recommendations represent conditions observed during this inspection.",
        emailSenderName: "Suburban Pest Control",
        emailReplyTo: "hello@suburbanpest.com",
        emailFooter: "Suburban Pest Control · 1420 Oak Ridge Ave, Springfield, IL",
        poweredByVisible: false,
      },
    ]));
  }

  console.log("Seed complete!");
  process.exit(0);
}

// Need eq import
import { eq } from "drizzle-orm";
seed().catch(e => { console.error(e); process.exit(1); });
