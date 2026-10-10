import { DOMAIN_ALIASES, FIELD_ALIASES, PHOTO_PHRASES } from "./MultilingualVocabulary";
import type { StructuredInspectionEvent } from "../types/intent.types";
import { INSPECTION_DICTIONARY } from "./VocabularyRegistry";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Fold Latin accents only: stripping ALL combining marks corrupts Hindi.
const fold = (text: string) => text.normalize("NFKD")
  .replace(/(\p{Script=Latin})[\u0300-\u036f]+/gu, "$1").normalize("NFC").toLowerCase();
const unspaced = (text: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);
const word = "\\p{L}\\p{N}\\p{M}_";
const replacements = [
  ...PHOTO_PHRASES.map((phrase) => [phrase, "take a photo"] as const),
  ...DOMAIN_ALIASES.flatMap(([canonical, aliases]) => aliases.split("|").map((alias) => [alias, canonical] as const)),
].sort(([a], [b]) => b.length - a.length).map(([alias, canonical]) => ({
  pattern: new RegExp(`${unspaced(alias) ? "()" : `(^|[^${word}])`}${escape(fold(alias)).replace(/\s+/g, "\\s+")}${unspaced(alias) ? "" : `(?=$|[^${word}])`}`, "gu"),
  canonical,
}));

const fields = Object.entries(FIELD_ALIASES).flatMap(([targetField, aliases]) =>
  [...new Set([...aliases.split("|"),
    ...INSPECTION_DICTIONARY.fieldPrefixes[targetField as keyof typeof FIELD_ALIASES],
  ])].map((alias) => ({
    targetField: targetField as NonNullable<StructuredInspectionEvent["targetField"]>,
    pattern: new RegExp(`^\\s*${escape(alias).replace(/\s+/g, "\\s+")}(?:\\s*[:：,،-]\\s*|\\s+${/[\p{Script=Han}\p{Script=Katakana}]/u.test(alias) ? "|\\s*" : ""})`, "iu"),
  })),
).sort((a, b) => b.pattern.source.length - a.pattern.source.length);

// Fail safe for explicitly declined photo requests, including mixed-language
// negatives. Leave other negative findings ("no ants; take a photo") alone.
const declinedPhoto = [
  /\b(?:don't|do not|never)\s+(?:take|capture|snap|shoot|photograph)\b/u,
  /\bno\s+(?:tomes?|toma|saques?|saca|captur[ae]s?|take|photo|foto|picture)\b/u,
  /\b(?:nao|non)\s+(?:tire|tira|tirar|fotografe|scattare|scatta|fare|foto)\b/u,
  /\bne\s+(?:prends|prenez|prend|fais|faites)\s+pas\b/u,
  /\b(?:kein[e]?|nicht)\s+(?:ein\s+)?(?:foto|bild|fotografieren)\b/u,
  /(?:не\s+(?:фотографируй|снимай|делай\s+фото)|لا\s+(?:تلتقط|تصور|تأخذ))/u,
  /(?:फोटो|फ़ोटो|तस्वीर)\s+मत|मत\s+(?:लो|खींचो)/u,
  /不要(?:拍|照)|别拍|別拍|撮らないで|撮影しないで|찍지\s*마/u,
];

/** Pure local interpretation: no fetch, model, or language selector. */
export function normalizeMultilingualVoice(rawText: string): {
  text: string;
  field?: { targetField: NonNullable<StructuredInspectionEvent["targetField"]>; fieldValue: string };
  declinedPhoto: boolean;
} {
  const original = rawText.normalize("NFC").trim();
  for (const entry of fields) {
    const match = original.match(entry.pattern);
    if (match) {
      return { text: "", field: { targetField: entry.targetField, fieldValue: original.slice(match[0].length).trim() }, declinedPhoto: false };
    }
  }
  let text = fold(rawText);
  const declined = declinedPhoto.some((pattern) => pattern.test(text));
  for (const { pattern, canonical } of replacements) {
    text = text.replace(pattern, (_match, boundary: string) => `${boundary} ${canonical} `);
  }
  return { text: text.replace(/\s+/g, " ").trim(), declinedPhoto: declined };
}
