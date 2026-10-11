export declare const FindingSchema: import("zod").ZodObject<{
    id: import("zod").ZodNumber;
    category: import("zod").ZodString;
    description: import("zod").ZodString;
    confidence: import("zod").ZodNumber;
    severity: import("zod").ZodString;
    location: import("zod").ZodNullable<import("zod").ZodString>;
    imageUrl: import("zod").ZodNullable<import("zod").ZodString>;
    treatment: import("zod").ZodNullable<import("zod").ZodString>;
    exclusionOpportunity: import("zod").ZodNullable<import("zod").ZodBoolean>;
    evidenceQuality: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodUnion<[import("zod").ZodLiteral<"excellent">, import("zod").ZodLiteral<"good">, import("zod").ZodLiteral<"fair">, import("zod").ZodLiteral<null>]>>>;
    possiblePest: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
    species: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
    lifeStage: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
    conduciveCondition: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
    harborage: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
    moisture: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
    structuralIssue: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
    zone: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
    confidenceLabel: import("zod").ZodOptional<import("zod").ZodEnum<["identified", "possible", "unidentified"]>>;
    reviewStatus: import("zod").ZodOptional<import("zod").ZodEnum<["pending", "accepted", "corrected", "dismissed"]>>;
    technicianSpecies: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
    technicianCorrectionNotes: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
} & {
    measurementEstimate: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodObject<{
        linearFt: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodNumber>>;
        gapWidthIn: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodNumber>>;
        heightFt: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodNumber>>;
        confidence: import("zod").ZodNumber;
        source: import("zod").ZodEnum<["ai_vision_estimate"]>;
    }, "strict", import("zod").ZodTypeAny, {
        confidence: number;
        source: "ai_vision_estimate";
        linearFt?: number | null | undefined;
        gapWidthIn?: number | null | undefined;
        heightFt?: number | null | undefined;
    }, {
        confidence: number;
        source: "ai_vision_estimate";
        linearFt?: number | null | undefined;
        gapWidthIn?: number | null | undefined;
        heightFt?: number | null | undefined;
    }>>>;
    candidates: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
        species: import("zod").ZodString;
        confidence: import("zod").ZodNumber;
    }, "strict", import("zod").ZodTypeAny, {
        confidence: number;
        species: string;
    }, {
        confidence: number;
        species: string;
    }>, "many">>;
}, "strict", import("zod").ZodTypeAny, {
    imageUrl: string | null;
    id: number;
    category: string;
    description: string;
    confidence: number;
    severity: string;
    location: string | null;
    treatment: string | null;
    exclusionOpportunity: boolean | null;
    evidenceQuality?: "excellent" | "good" | "fair" | null | undefined;
    possiblePest?: string | null | undefined;
    species?: string | null | undefined;
    lifeStage?: string | null | undefined;
    conduciveCondition?: string | null | undefined;
    harborage?: string | null | undefined;
    moisture?: string | null | undefined;
    structuralIssue?: string | null | undefined;
    measurementEstimate?: {
        confidence: number;
        source: "ai_vision_estimate";
        linearFt?: number | null | undefined;
        gapWidthIn?: number | null | undefined;
        heightFt?: number | null | undefined;
    } | null | undefined;
    zone?: string | null | undefined;
    candidates?: {
        confidence: number;
        species: string;
    }[] | undefined;
    confidenceLabel?: "identified" | "possible" | "unidentified" | undefined;
    reviewStatus?: "pending" | "accepted" | "corrected" | "dismissed" | undefined;
    technicianSpecies?: string | null | undefined;
    technicianCorrectionNotes?: string | null | undefined;
}, {
    imageUrl: string | null;
    id: number;
    category: string;
    description: string;
    confidence: number;
    severity: string;
    location: string | null;
    treatment: string | null;
    exclusionOpportunity: boolean | null;
    evidenceQuality?: "excellent" | "good" | "fair" | null | undefined;
    possiblePest?: string | null | undefined;
    species?: string | null | undefined;
    lifeStage?: string | null | undefined;
    conduciveCondition?: string | null | undefined;
    harborage?: string | null | undefined;
    moisture?: string | null | undefined;
    structuralIssue?: string | null | undefined;
    measurementEstimate?: {
        confidence: number;
        source: "ai_vision_estimate";
        linearFt?: number | null | undefined;
        gapWidthIn?: number | null | undefined;
        heightFt?: number | null | undefined;
    } | null | undefined;
    zone?: string | null | undefined;
    candidates?: {
        confidence: number;
        species: string;
    }[] | undefined;
    confidenceLabel?: "identified" | "possible" | "unidentified" | undefined;
    reviewStatus?: "pending" | "accepted" | "corrected" | "dismissed" | undefined;
    technicianSpecies?: string | null | undefined;
    technicianCorrectionNotes?: string | null | undefined;
}>;
//# sourceMappingURL=finding.d.ts.map