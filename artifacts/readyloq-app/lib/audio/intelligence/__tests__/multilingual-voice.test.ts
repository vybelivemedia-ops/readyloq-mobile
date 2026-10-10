import { describe, expect, it, vi } from "vitest";
import { SpeechIntentEngine } from "../SpeechIntentEngine";
import { InspectionCommandParser } from "../InspectionCommandParser";
import { normalizeMultilingualVoice } from "../MultilingualNormalizer";
import { VOICE_LANGUAGES } from "../MultilingualVocabulary";
import { AudioSessionManager } from "../../AudioSessionManager";
import type { SpeechProvider } from "../../providers/SpeechProvider";
import type { SpeechTranscriptionResult } from "../../types/audio.types";

const engine = new SpeechIntentEngine();
const examples = [
  ["English", "Take a photo of ants in the kitchen"],
  ["Spanish", "Toma una foto de hormigas en la cocina"],
  ["French", "Prends une photo des fourmis dans la cuisine"],
  ["Portuguese", "Tire uma foto das formigas na cozinha"],
  ["German", "Mach ein Foto von Ameisen in der Küche"],
  ["Italian", "Scatta una foto delle formiche in cucina"],
  ["Russian", "Сделай фото муравьев на кухне"],
  ["Arabic", "التقط صورة النمل في المطبخ"],
  ["Hindi", "रसोई में चींटियों की फोटो लो"],
  ["Mandarin", "拍一张照片，厨房有蚂蚁"],
  ["Japanese", "台所のアリの写真を撮って"],
  ["Korean", "주방 개미 사진을 찍어주세요"],
];

describe("automatic multilingual inspection intent (no selected language)", () => {
  it.each(examples)("%s photo, pest and room commands", (_language, text) => {
    const event = engine.parse(text, 0.85);
    expect(event.capturePhoto).toBe(true);
    expect(event.pest).toBe("Ants");
    expect(event.room).toBe("Kitchen");
    expect(event.rawText).toBe(text);
  });

  it("has a regression example for every advertised language", () => {
    expect(examples.map(([language]) => language)).toEqual([...VOICE_LANGUAGES]);
  });

  it.each([
    "Toma una photo de ants en la cocina",
    "Take una foto de hormigas in the kitchen",
    "Saca a picture aquí, hay ants",
    "Prends une photo of ants dans la cuisine",
    "写真を撮って of ants in la cocina",
    "التقط صورة of ants in the kitchen",
  ])("recognizes mixed-language photo utterance: %s", (text) => {
    const event = engine.parse(text, 0.85);
    expect(event.capturePhoto).toBe(true);
    expect(event.pest).toBe("Ants");
    expect(event.rawText).toBe(text);
  });

  it.each([
    "Apliqué Alpine WSG en la cocina con ants",
    "J'ai appliqué Alpine WSG dans la cuisine",
    "Apliquei Alpine WSG na cozinha",
    "Alpine WSG in der Küche ausgebracht",
    "Alpine WSG を台所に散布",
  ])("preserves brand vocabulary and application action: %s", (text) => {
    const event = engine.parse(text, 0.85);
    expect(event.action).toBe("applied");
    expect(event.product).toBe("Alpine WSG");
    expect(event.room).toBe("Kitchen");
    expect(event.capturePhoto).toBe(false);
  });

  it.each([
    "No tomes una foto de hormigas",
    "Ne prends pas de photo des fourmis",
    "Não tire uma foto das formigas",
    "Non scattare una foto",
    "Kein Foto von Ameisen",
    "Не делай фото",
    "لا تلتقط صورة",
    "फोटो मत लो",
    "不要拍照",
    "写真を撮らないで",
    "사진 찍지 마",
    "No take a photo de ants",
  ])("does not fire a declined photo request: %s", (text) => {
    expect(engine.parse(text, 0.85).capturePhoto).toBe(false);
  });

  it.each([
    ["Notas: Hay hormigas, but no new activity; toma una foto mañana.", "Hay hormigas, but no new activity; toma una foto mañana."],
    ["Remarques: Des fourmis dans la Cuisine.", "Des fourmis dans la Cuisine."],
    ["Notizen: Ameisen in der Küche.", "Ameisen in der Küche."],
    ["ملاحظات: النمل في المطبخ", "النمل في المطبخ"],
    ["नोट: रसोई में चींटियाँ हैं", "रसोई में चींटियाँ हैं"],
    ["备注：厨房有蚂蚁，明天拍照", "厨房有蚂蚁，明天拍照"],
    ["メモ：台所のアリ", "台所のアリ"],
    ["메모: 주방 개미 사진", "주방 개미 사진"],
  ])("preserves original dictated notes without executing their contents: %s", (text, value) => {
    expect(engine.parse(text, 0.85)).toMatchObject({
      rawText: text, targetField: "notes", fieldValue: value, capturePhoto: false,
    });
    expect(engine.parse(text, 0.85).pest).toBeUndefined();
  });

  it("preserves names and addresses rather than translating or lowercasing them", () => {
    expect(engine.parse("Nombre del cliente: María Foto López", 0.85)).toMatchObject({
      targetField: "clientName", fieldValue: "María Foto López", capturePhoto: false,
    });
    expect(engine.parse("Adresse du site: 23 Rue des Fourmis, Paris", 0.85)).toMatchObject({
      targetField: "siteAddress", fieldValue: "23 Rue des Fourmis, Paris", capturePhoto: false,
    });
  });

  it("does not replace Latin vocabulary inside larger words or corrupt Hindi vowel marks", () => {
    expect(normalizeMultilingualVoice("microformigas").text).toBe("microformigas");
    expect(normalizeMultilingualVoice("चींटियों").text).toBe("ants");
    expect(normalizeMultilingualVoice("делай").text).toBe("делай");
    expect(engine.parse("inspected Contrac Blox in kitchen", 0.85).product).toBe("Contrac Blox");
  });

  it("retains existing Spanish pest aliases and confidence", () => {
    // Retain the existing scanner's priority, not a new taxonomy rule.
    expect(engine.parse("moscas", 0.61)).toMatchObject({
      pest: new InspectionCommandParser().parse("drain flies", 0.61).pest, confidence: 0.61,
    });
    expect(engine.parse("cucarachas", 0.85).pest).toBe("German Cockroaches");
  });

  it("suppresses duplicate photo callbacks across languages in one session", async () => {
    let listener!: (result: SpeechTranscriptionResult) => void;
    const provider: SpeechProvider = {
      initialize: async () => {}, start: async () => {}, cancel: async () => {},
      stop: async () => {},
      onTranscription: (callback) => { listener = callback; }, getConfidence: () => 0.85,
    };
    const manager = new AudioSessionManager(provider);
    const photo = vi.fn();
    await manager.startSession(({ event, contextOnly }) => {
      if (!contextOnly && event.capturePhoto) photo();
    }, {});
    listener({ text: "Toma una photo de ants", confidence: 0.85, isFinal: true });
    listener({ text: "take a photo of ants", confidence: 0.85, isFinal: true });
    await manager.stopSession();
    expect(photo).toHaveBeenCalledTimes(1);
  });
});
