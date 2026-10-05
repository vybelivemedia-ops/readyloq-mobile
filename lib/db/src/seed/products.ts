/**
 * Chemical product seed data — ReadyLoq
 *
 * Seeds 8 common pest-control products with fully-populated label rules.
 * Values are derived from publicly available product labels. This function is
 * idempotent: it skips any product whose EPA registration number already exists
 * in the database, so it can be called at API server startup safely.
 *
 * Product coverage:
 *  1. Contrac Blox           — rodenticide, restricted-use
 *  2. Termidor SC            — termiticide, restricted-use
 *  3. Demand CS              — general insecticide, restricted-use
 *  4. Phantom SC             — crack-and-crevice, restricted-use
 *  5. Talstar P Granules     — broadcast granular, general-use
 *  6. Gentrol IGR Concentrate — IGR / stored-product, general-use
 *  7. Zenprox EC             — mosquito/fly adulticide, restricted-use
 *  8. Temprid FX             — residual bed bug/cockroach, general-use
 */

import { db } from "../index";
import { productsTable, productLabelRulesTable } from "../schema/products";
import { eq } from "drizzle-orm";

interface SeedProduct {
  name: string;
  epaRegistrationNumber: string;
  productType: "restricted-use" | "general-use";
  activeIngredients: string;
  signalWord: "DANGER" | "WARNING" | "CAUTION" | "NONE";
  manufacturerName: string;
  labelRules: {
    approvedPestTypes: string[];
    approvedSiteClassifications: string[];
    requiredEquipmentTypes: string[];
    nozzleSpec: string | null;
    pressurePsi: string | null;
    dropletSize: string | null;
    maxRateOzPer1000Sqft: number | null;
    maxRateOzPerGallon: number | null;
    mixingSteps: string[];
    maxTempF: number | null;
    phytotoxicityNotes: string | null;
    reEntryIntervalHours: number | null;
    /** Minimum whole days before this product may legally be reapplied to the
     *  same site, per label. Null when the label sets no such minimum (e.g.
     *  a continuously-maintained bait station). Approximate, illustrative
     *  values consistent with typical labels for each product class. */
    retreatmentIntervalDays: number | null;
  };
}

const SEED_PRODUCTS: SeedProduct[] = [
  {
    name: "Contrac Blox",
    epaRegistrationNumber: "12455-76",
    productType: "restricted-use",
    activeIngredients: "Bromadiolone 0.005%",
    signalWord: "CAUTION",
    manufacturerName: "Bell Laboratories",
    labelRules: {
      approvedPestTypes: ["Rodents"],
      approvedSiteClassifications: [
        "residential_interior",
        "residential_exterior",
        "commercial_interior",
        "commercial_exterior",
        "structural_void",
      ],
      requiredEquipmentTypes: ["tamper_resistant_bait_station"],
      nozzleSpec: null,
      pressurePsi: null,
      dropletSize: null,
      maxRateOzPer1000Sqft: null, // bait-placement product — rate is per station, not area
      maxRateOzPerGallon: null,
      mixingSteps: [
        "Place one 2 oz block per tamper-resistant bait station.",
        "Position stations along rodent runways, burrow openings, and harborage areas.",
        "Space stations every 15–30 ft for mice, every 30–50 ft for rats.",
        "Wear nitrile gloves when handling bait blocks.",
        "Do not place bait where children, pets, or non-target animals may contact it.",
        "Inspect stations every 15 days and replenish bait until activity ceases.",
      ],
      maxTempF: 110,
      phytotoxicityNotes: null,
      reEntryIntervalHours: 0,
      retreatmentIntervalDays: null, // continuously-maintained bait station, not a discrete retreat cycle
    },
  },
  {
    name: "Termidor SC",
    epaRegistrationNumber: "279-9143",
    productType: "restricted-use",
    activeIngredients: "Fipronil 9.1%",
    signalWord: "WARNING",
    manufacturerName: "BASF Corporation",
    labelRules: {
      approvedPestTypes: ["Termites", "Ants"],
      approvedSiteClassifications: [
        "residential_exterior",
        "commercial_exterior",
        "structural_void",
        "perimeter",
      ],
      requiredEquipmentTypes: ["power_sprayer", "soil_injection_rod"],
      nozzleSpec: "Soil injection rod (12-inch spacing) or flat-fan tip for perimeter spray",
      pressurePsi: "150 psi (injection) / 25–40 psi (surface spray)",
      dropletSize: "Coarse (surface) / N/A (soil injection)",
      maxRateOzPer1000Sqft: 4.0,
      maxRateOzPerGallon: 0.8,
      mixingSteps: [
        "Fill tank half-full with water.",
        "Measure Termidor SC at 0.8 fl oz per gallon for a 0.06% finished solution.",
        "Add product to tank with agitation running.",
        "Fill remainder with water and agitate for 2 minutes.",
        "Apply 4 gallons of finished solution per 10 linear feet of foundation (per side).",
        "Rod-inject at 12-inch horizontal intervals to a depth of 6 inches.",
        "Wear chemical-resistant gloves, eye protection, and long sleeves during mixing and application.",
      ],
      maxTempF: 95,
      phytotoxicityNotes:
        "Avoid contact with ornamental plants, turf, and water bodies. Product is for soil applications only; overspray onto foliage can cause phytotoxic symptoms.",
      reEntryIntervalHours: 12,
      retreatmentIntervalDays: 365, // long-residual soil termiticide — typical annual service cadence
    },
  },
  {
    name: "Demand CS",
    epaRegistrationNumber: "100-1066",
    productType: "restricted-use",
    activeIngredients: "Lambda-cyhalothrin 9.7%",
    signalWord: "WARNING",
    manufacturerName: "Syngenta",
    labelRules: {
      approvedPestTypes: [
        "Cockroaches",
        "Ants",
        "Spiders",
        "Bed Bugs",
        "Flies",
      ],
      approvedSiteClassifications: [
        "residential_interior",
        "residential_exterior",
        "commercial_interior",
        "commercial_exterior",
        "perimeter",
      ],
      requiredEquipmentTypes: ["compressed_air_sprayer"],
      nozzleSpec: "8002 flat-fan or low-pressure fan nozzle",
      pressurePsi: "40–60 psi",
      dropletSize: "Fine to medium",
      maxRateOzPer1000Sqft: 0.8,
      maxRateOzPerGallon: 0.8,
      mixingSteps: [
        "Fill sprayer tank halfway with water.",
        "Measure Demand CS at 0.2–0.8 fl oz per gallon depending on pest pressure.",
        "Add product to tank; mix by swirling or agitation.",
        "Fill remainder of tank with water.",
        "Agitate before and during application to maintain uniform suspension.",
        "Apply 1 gallon of finished solution per 1,000 sq ft as a coarse, low-pressure spray.",
      ],
      maxTempF: 95,
      phytotoxicityNotes:
        "May cause spotting or marginal leaf burn on sensitive ornamental plants. Avoid direct application to flowers, new growth, and foliage of houseplants.",
      reEntryIntervalHours: 12,
      retreatmentIntervalDays: 30, // general residual insecticide — monthly service cadence
    },
  },
  {
    name: "Phantom SC",
    epaRegistrationNumber: "241-392",
    productType: "restricted-use",
    activeIngredients: "Chlorfenapyr 21.45%",
    signalWord: "CAUTION",
    manufacturerName: "BASF Corporation",
    labelRules: {
      approvedPestTypes: ["Cockroaches", "Bed Bugs", "Ants"],
      approvedSiteClassifications: [
        "residential_interior",
        "commercial_interior",
        "food_handling_area",
        "structural_void",
      ],
      requiredEquipmentTypes: [
        "compressed_air_sprayer",
        "crack_crevice_tip",
      ],
      nozzleSpec: "Pin-stream or crack-and-crevice injection tip; do not use fan nozzle for indoor spot treatments",
      pressurePsi: "20–40 psi",
      dropletSize: "Coarse (crack-and-crevice stream)",
      maxRateOzPer1000Sqft: 0.25,
      maxRateOzPerGallon: 0.5,
      mixingSteps: [
        "Measure 0.5 fl oz of Phantom SC per gallon of water.",
        "Fill sprayer with half the required water.",
        "Add product and swirl gently.",
        "Fill to final volume with water.",
        "Apply ONLY as a spot treatment or crack-and-crevice treatment.",
        "Do not apply as a broadcast spray to food-contact surfaces. Cover or remove food and utensils before application in food-handling areas.",
      ],
      maxTempF: 100,
      phytotoxicityNotes: null,
      reEntryIntervalHours: 4,
      retreatmentIntervalDays: 30, // crack-and-crevice residual — monthly service cadence
    },
  },
  {
    name: "Talstar P Granules",
    epaRegistrationNumber: "279-9538",
    productType: "general-use",
    activeIngredients: "Bifenthrin 0.2%",
    signalWord: "CAUTION",
    manufacturerName: "FMC Corporation",
    labelRules: {
      approvedPestTypes: ["Ants", "Cockroaches", "Spiders", "Flies"],
      approvedSiteClassifications: [
        "residential_exterior",
        "commercial_exterior",
        "turf_lawn",
        "perimeter",
      ],
      requiredEquipmentTypes: ["granular_spreader"],
      nozzleSpec: null,
      pressurePsi: null,
      dropletSize: null,
      maxRateOzPer1000Sqft: 32.0, // 2 lb per 1,000 sq ft = 32 oz
      maxRateOzPerGallon: null,
      mixingSteps: [
        "Calibrate granular spreader per manufacturer specifications before use.",
        "Set spreader to deliver 1–2 lb of product per 1,000 sq ft.",
        "Apply granules uniformly to the target area.",
        "Irrigate with 0.25 inch of water immediately after application to activate product.",
        "Do not apply when rain is expected within 24 hours.",
        "Keep children and pets off treated area until irrigation water has dried.",
      ],
      maxTempF: 90,
      phytotoxicityNotes:
        "May temporarily yellow cool-season grasses at the high label rate. Irrigate immediately after application to minimize phytotoxic risk.",
      reEntryIntervalHours: 12,
      retreatmentIntervalDays: 30, // broadcast granular perimeter treatment — monthly service cadence
    },
  },
  {
    name: "Gentrol IGR Concentrate",
    epaRegistrationNumber: "2724-351",
    productType: "general-use",
    activeIngredients: "Hydroprene 9.0%",
    signalWord: "CAUTION",
    manufacturerName: "Wellmark International",
    labelRules: {
      approvedPestTypes: ["Stored Product Pests", "Cockroaches"],
      approvedSiteClassifications: [
        "food_handling_area",
        "commercial_interior",
        "residential_interior",
      ],
      requiredEquipmentTypes: ["compressed_air_sprayer"],
      nozzleSpec: "Flat-fan or flood nozzle for surface application",
      pressurePsi: "20–40 psi",
      dropletSize: "Medium",
      maxRateOzPer1000Sqft: 1.0,
      maxRateOzPerGallon: 1.0,
      mixingSteps: [
        "Measure 1 fl oz of Gentrol per gallon of water for general surface application.",
        "Fill sprayer halfway with water; add product.",
        "Fill to final volume and agitate gently.",
        "Apply 1 gallon of finished solution per 1,000 sq ft as a light surface spray.",
        "In food-handling areas, apply to cracks, crevices, and under equipment only. Do not apply to food-contact surfaces.",
        "Allow treated surfaces to dry completely before allowing re-entry.",
      ],
      maxTempF: 100,
      phytotoxicityNotes: null,
      reEntryIntervalHours: 2,
      retreatmentIntervalDays: 90, // IGR — long efficacy window before retreatment is needed
    },
  },
  {
    name: "Zenprox EC",
    epaRegistrationNumber: "53883-216",
    productType: "restricted-use",
    activeIngredients: "Etofenprox 23.2%",
    signalWord: "WARNING",
    manufacturerName: "Wellmark International",
    labelRules: {
      approvedPestTypes: ["Flies", "Spiders"],
      approvedSiteClassifications: [
        "residential_exterior",
        "commercial_exterior",
        "turf_lawn",
      ],
      requiredEquipmentTypes: ["ulv_sprayer", "thermal_fogger"],
      nozzleSpec: "Rotary atomizer (ULV) or thermal fogger nozzle; calibrate to deliver VMD 15–25 microns",
      pressurePsi: "N/A (ULV/fogger — volume-metered delivery)",
      dropletSize: "Ultra-fine (VMD 15–25 µm)",
      maxRateOzPer1000Sqft: 1.0,
      maxRateOzPerGallon: 1.0,
      mixingSteps: [
        "Determine total treatment area and calculate product quantity needed.",
        "Add Zenprox EC to equipment tank at label rate (0.5–1.0 fl oz per 1,000 sq ft).",
        "Calibrate ULV or fogger equipment to deliver labeled droplet size (VMD 15–25 µm).",
        "Apply during calm conditions (wind speed < 5 mph) to prevent drift.",
        "Do not apply immediately before or during rain.",
        "Wear chemical-resistant gloves, eye protection, long sleeves, and a NIOSH-approved respirator.",
      ],
      maxTempF: 85,
      phytotoxicityNotes:
        "Do not apply directly to ornamental plants, water features, or aquatic areas. Maintain a minimum 25-foot buffer from ponds, streams, and wetlands.",
      reEntryIntervalHours: 4,
      retreatmentIntervalDays: 14, // short-residual ULV/fogger adulticide — biweekly service cadence
    },
  },
  {
    name: "Temprid FX",
    epaRegistrationNumber: "3125-516",
    productType: "general-use",
    activeIngredients: "Imidacloprid 21.0%, Beta-cyfluthrin 10.5%",
    signalWord: "WARNING",
    manufacturerName: "Bayer Environmental Science",
    labelRules: {
      approvedPestTypes: ["Cockroaches", "Bed Bugs", "Ants", "Spiders"],
      approvedSiteClassifications: [
        "residential_interior",
        "residential_exterior",
        "commercial_interior",
        "commercial_exterior",
      ],
      requiredEquipmentTypes: ["compressed_air_sprayer"],
      nozzleSpec: "Fan or coarse-droplet nozzle for crack-and-crevice or broadcast",
      pressurePsi: "30–50 psi",
      dropletSize: "Medium to coarse",
      maxRateOzPer1000Sqft: 0.27,
      maxRateOzPerGallon: 0.27,
      mixingSteps: [
        "Fill sprayer half-full with clean water.",
        "Measure 0.27 fl oz (8 mL) of Temprid FX per liter of finished spray.",
        "Add product to tank with agitation.",
        "Fill to desired final volume and mix thoroughly.",
        "Apply as crack-and-crevice, spot, or broadcast treatment at 1 gallon per 1,000 sq ft.",
        "Wear chemical-resistant gloves and eye protection during mixing and application.",
      ],
      maxTempF: 95,
      phytotoxicityNotes:
        "Avoid application to ornamental plants in bloom; product contains a neonicotinoid — potential bee toxicity risk in flowering areas.",
      reEntryIntervalHours: 12,
      retreatmentIntervalDays: 14, // residual bed bug/cockroach treatment — biweekly service cadence
    },
  },
];

/**
 * Idempotent product seed. Inserts any product whose EPA registration number
 * is not yet in the database. Safe to call at API server startup — it is a
 * no-op when the data already exists.
 */
export async function ensureProductsSeed(): Promise<void> {
  for (const seed of SEED_PRODUCTS) {
    // Skip if this EPA number is already present.
    const [existing] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(eq(productsTable.epaRegistrationNumber, seed.epaRegistrationNumber))
      .limit(1);

    if (existing) continue;

    const [product] = await db
      .insert(productsTable)
      .values({
        name: seed.name,
        epaRegistrationNumber: seed.epaRegistrationNumber,
        productType: seed.productType,
        activeIngredients: seed.activeIngredients,
        signalWord: seed.signalWord,
        manufacturerName: seed.manufacturerName,
        isActive: true,
      })
      .returning();

    if (!product) continue;

    await db.insert(productLabelRulesTable).values({
      productId: product.id,
      ...seed.labelRules,
    });
  }
}
