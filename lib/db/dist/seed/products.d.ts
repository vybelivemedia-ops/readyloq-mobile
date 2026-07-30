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
/**
 * Idempotent product seed. Inserts any product whose EPA registration number
 * is not yet in the database. Safe to call at API server startup — it is a
 * no-op when the data already exists.
 */
export declare function ensureProductsSeed(): Promise<void>;
//# sourceMappingURL=products.d.ts.map