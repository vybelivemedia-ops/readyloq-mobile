/**
 * Curated, static field-reference content for the Knowledge Center.
 *
 * This is real, hand-authored pest-control reference material (IPM-aligned) —
 * not generated, mocked, or fetched from a demo API. It gives technicians
 * accurate identification, treatment, exclusion, and inspection guidance they
 * can use in the field.
 */

export interface PestGuide {
  name: string;
  icon: string;
  signs: string[];
  lookFor: string;
  confusedWith: string;
}

export const PEST_GUIDES: PestGuide[] = [
  {
    name: "Rodents (mice & rats)",
    icon: "🐀",
    signs: [
      "Dark, tapered droppings (mouse ~3–6mm; rat ~12–18mm)",
      "Gnaw marks on wood, wiring, and food packaging",
      "Greasy rub marks along walls and pipe runs",
      "Shredded nesting material in voids and storage",
    ],
    lookFor:
      "Active runways with fresh droppings, urine staining under UV, and gnaw damage near entry points along the foundation and roofline.",
    confusedWith:
      "Bat or bird droppings (which crumble to powder) and squirrel activity in attics (larger, daytime-active).",
  },
  {
    name: "Cockroaches",
    icon: "🪳",
    signs: [
      "Pepper-like droppings in cabinet corners and hinges",
      "Egg cases (oothecae) glued in tight harborage",
      "Musty, oily odor in heavy infestations",
      "Live insects scattering when lights turn on",
    ],
    lookFor:
      "Warm, humid harborage near plumbing, motor housings, and behind appliances. German roaches stay indoors; American roaches favor drains and sewers.",
    confusedWith:
      "Beetles (hard wing covers, no long antennae) and crickets (jumping, chirping).",
  },
  {
    name: "Termites (subterranean)",
    icon: "🪵",
    signs: [
      "Pencil-width mud tubes on foundation walls",
      "Hollow-sounding or blistered wood",
      "Discarded wings near windows after a swarm",
      "Frass is absent — subterraneans pack galleries with soil",
    ],
    lookFor:
      "Mud shelter tubes bridging soil to wood, moisture-damaged sill plates, and swarmers in spring near light sources.",
    confusedWith:
      "Flying ants (pinched waist, bent antennae, unequal wings) versus termite swarmers (straight body, straight antennae, equal wings).",
  },
  {
    name: "Carpenter ants",
    icon: "🐜",
    signs: [
      "Coarse sawdust-like frass with insect parts",
      "Smooth, clean galleries (not soil-packed)",
      "Faint rustling in wall voids at night",
      "Large workers (6–13mm) trailing to moisture",
    ],
    lookFor:
      "Galleries in water-damaged wood, trails to a parent colony outdoors, and frass kick-out below nest openings.",
    confusedWith:
      "Termites (carpenter ants leave clean galleries and frass; termites pack galleries with mud and leave none).",
  },
  {
    name: "Stored-product & pantry pests",
    icon: "🌾",
    signs: [
      "Webbing or clumping in flour, grain, and dry goods",
      "Small beetles or moths near pantry shelving",
      "Larvae crawling up walls to pupate",
    ],
    lookFor:
      "Infested source packages, spillage in shelf cracks, and adult flight near stored food. Trace to the oldest or open product.",
    confusedWith:
      "Occasional invaders that wandered in but are not breeding in stored food.",
  },
];

export interface TreatmentTopic {
  title: string;
  points: string[];
}

export const TREATMENT_BEST_PRACTICES: TreatmentTopic[] = [
  {
    title: "Integrated Pest Management (IPM) first",
    points: [
      "Identify the species and confirm the infestation before any treatment.",
      "Correct conducive conditions (moisture, harborage, food access) so treatment lasts.",
      "Use the least-hazardous effective method, escalating only as needed.",
      "Document, treat, then monitor to verify the result.",
    ],
  },
  {
    title: "Targeted application, not broadcast spraying",
    points: [
      "Place baits and dusts in cracks, voids, and harborage — where pests live.",
      "Avoid spraying open surfaces where products break down and miss the target.",
      "Rotate active ingredients to slow resistance.",
      "Always follow the product label — the label is the law.",
    ],
  },
  {
    title: "Rodent control",
    points: [
      "Pair trapping/baiting with exclusion and sanitation, never bait alone.",
      "Anchor tamper-resistant bait stations along active runways.",
      "Set snap traps perpendicular to walls with the trigger toward the wall.",
      "Remove food and water sources to drive uptake of control measures.",
    ],
  },
  {
    title: "Documentation & callbacks",
    points: [
      "Photograph evidence and treatment placement for the service record.",
      "Note product, rate, and target site for compliance.",
      "Schedule follow-up to confirm reduction and catch reinfestation early.",
    ],
  },
];

export interface ConduciveCondition {
  title: string;
  description: string;
  why: string;
}

export const STRUCTURAL_DEFICIENCIES: ConduciveCondition[] = [
  {
    title: "Excess moisture",
    description:
      "Leaking plumbing, poor drainage, condensation, or high crawlspace humidity.",
    why: "Moisture attracts termites, carpenter ants, cockroaches, and rodents and accelerates wood decay.",
  },
  {
    title: "Wood-to-soil contact",
    description:
      "Deck posts, siding, or framing in direct contact with soil or mulch.",
    why: "Gives subterranean termites and carpenter ants a hidden bridge directly into the structure.",
  },
  {
    title: "Gaps & unsealed penetrations",
    description:
      "Open utility penetrations, worn door sweeps, and foundation cracks.",
    why: "A mouse fits through a gap the size of a dime; roaches and ants need far less.",
  },
  {
    title: "Clutter & harborage",
    description:
      "Cardboard storage, dense vegetation against the structure, and debris.",
    why: "Provides nesting harborage and shields pests from inspection and treatment.",
  },
  {
    title: "Poor sanitation",
    description:
      "Accessible food waste, grease buildup, and standing water.",
    why: "Sustains pest populations and undermines otherwise correct treatment.",
  },
];

export interface ExclusionTechnique {
  title: string;
  description: string;
}

export const EXCLUSION_TECHNIQUES: ExclusionTechnique[] = [
  {
    title: "Seal entry points",
    description:
      "Close gaps with rodent-proof materials — copper mesh, hardware cloth, or sealant — around pipes, vents, and utility lines.",
  },
  {
    title: "Door sweeps & weatherstripping",
    description:
      "Install tight sweeps on exterior and garage doors; a gap under a door is a highway for rodents and insects.",
  },
  {
    title: "Screen vents & weep holes",
    description:
      "Cover attic, foundation, and dryer vents with corrosion-resistant screen while preserving airflow.",
  },
  {
    title: "Trim vegetation",
    description:
      "Keep branches, shrubs, and mulch back from the structure to remove bridges and harborage.",
  },
  {
    title: "Manage moisture",
    description:
      "Redirect downspouts, fix leaks, and ventilate crawlspaces to remove the water that draws pests in.",
  },
];

export interface ChecklistArea {
  area: string;
  items: string[];
}

export const INSPECTION_CHECKLISTS: ChecklistArea[] = [
  {
    area: "Exterior & perimeter",
    items: [
      "Foundation cracks, gaps, and unsealed penetrations",
      "Roofline, soffits, and vent screens",
      "Wood-to-soil contact and mulch against siding",
      "Drainage, downspouts, and standing water",
      "Vegetation contacting the structure",
    ],
  },
  {
    area: "Kitchen & food areas",
    items: [
      "Under and behind appliances (warm motor harborage)",
      "Cabinet corners, hinges, and voids",
      "Plumbing penetrations under sinks",
      "Pantry goods for stored-product pests",
      "Trash handling and grease buildup",
    ],
  },
  {
    area: "Basement, crawlspace & attic",
    items: [
      "Sill plates and joists for mud tubes or galleries",
      "Moisture, condensation, and humidity levels",
      "Insulation disturbance and nesting material",
      "Droppings, rub marks, and runways",
      "Stored clutter providing harborage",
    ],
  },
  {
    area: "Interior living spaces",
    items: [
      "Baseboards, wall voids, and electrical outlets",
      "Window sills for discarded swarmer wings",
      "Gnaw marks on wiring and woodwork",
      "Entry points around doors and windows",
    ],
  },
];
