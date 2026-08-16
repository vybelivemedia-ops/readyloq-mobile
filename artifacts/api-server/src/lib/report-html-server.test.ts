import { describe, it, expect } from "vitest";
import { fmtIn, fmtArea } from "./report-html-server.js";

describe("fmtIn", () => {
  it("formats a normal inch value", () => {
    expect(fmtIn(1.5)).toBe("1.50 in");
  });

  it("formats zero", () => {
    expect(fmtIn(0)).toBe("0.00 in");
  });

  it("returns null for null", () => {
    expect(fmtIn(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(fmtIn(undefined)).toBeNull();
  });

  it("returns null for Infinity — produced by near-zero reference box division", () => {
    expect(fmtIn(Infinity)).toBeNull();
  });

  it("returns null for -Infinity", () => {
    expect(fmtIn(-Infinity)).toBeNull();
  });

  it("returns null for NaN — produced by 0/0 reference box computation", () => {
    expect(fmtIn(NaN)).toBeNull();
  });
});

describe("fmtArea", () => {
  it("formats small areas in sq in", () => {
    expect(fmtArea(12)).toBe("12.0 sq in");
  });

  it("formats large areas (≥ 144) in sq ft", () => {
    expect(fmtArea(144)).toBe("1.00 sq ft");
    expect(fmtArea(288)).toBe("2.00 sq ft");
  });

  it("returns null for null", () => {
    expect(fmtArea(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(fmtArea(undefined)).toBeNull();
  });

  it("returns null for Infinity — produced by near-zero reference box division", () => {
    expect(fmtArea(Infinity)).toBeNull();
  });

  it("returns null for -Infinity", () => {
    expect(fmtArea(-Infinity)).toBeNull();
  });

  it("returns null for NaN", () => {
    expect(fmtArea(NaN)).toBeNull();
  });
});
