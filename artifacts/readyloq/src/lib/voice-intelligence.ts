// ─── Pest Control Vocabulary Engine ──────────────────────────────────────────
// Converts casual technician field speech into professional terminology.
// Supports English, Spanish, and Portuguese.

export type SupportedLang = "en" | "es" | "pt";

export interface VocabTerm {
  professional: string;
  category: Category;
  icon: string;
  casual: { en: string[]; es: string[]; pt: string[] };
  translations: { es: string; pt: string };
  reportPhrase: { en: string; es: string; pt: string };
}

export type Category =
  | "rodents"
  | "cockroaches"
  | "termites"
  | "carpenter_ants"
  | "exclusion"
  | "conducive";

export const CATEGORY_LABELS: Record<Category, { en: string; es: string; pt: string; icon: string }> = {
  rodents:        { en: "Rodents",              es: "Roedores",           pt: "Roedores",         icon: "🐭" },
  cockroaches:    { en: "Cockroaches",           es: "Cucarachas",         pt: "Baratas",           icon: "🪳" },
  termites:       { en: "Termites",              es: "Termitas",           pt: "Cupins",            icon: "🪵" },
  carpenter_ants: { en: "Carpenter Ants",        es: "Hormigas Carpinteras", pt: "Formigas Carpinteiras", icon: "🐜" },
  exclusion:      { en: "Exclusion / Entry Points", es: "Puntos de Entrada", pt: "Pontos de Entrada", icon: "🔧" },
  conducive:      { en: "Conducive Conditions",  es: "Condiciones Favorables", pt: "Condições Propícias", icon: "⚠️" },
};

export const VOCABULARY: VocabTerm[] = [
  // ── Rodents ─────────────────────────────────────────────────────────────────
  {
    professional: "Mouse Droppings",
    category: "rodents", icon: "🐭",
    casual: {
      en: ["little black stuff", "black pellets", "small black things", "little pellets", "black droppings", "mouse poop", "mouse dirt", "mouse waste", "rodent droppings", "little black droppings"],
      es: ["pequeñas heces negras", "excremento negro", "excremento de ratón", "heces de ratón", "bolitas negras", "suciedad de ratón"],
      pt: ["fezes de rato", "fezes negras", "cocô de rato", "bolinhas pretas", "dejetos de rato"],
    },
    translations: { es: "Excremento de Ratón", pt: "Fezes de Camundongo" },
    reportPhrase: {
      en: "Mouse droppings observed.",
      es: "Se observaron excrementos de ratón.",
      pt: "Fezes de camundongo observadas.",
    },
  },
  {
    professional: "Rat Droppings",
    category: "rodents", icon: "🐀",
    casual: {
      en: ["large droppings", "big pellets", "large black droppings", "rat poop", "rat waste", "big rat droppings", "large rodent droppings"],
      es: ["heces grandes", "excremento grande", "excremento de rata", "heces de rata"],
      pt: ["fezes de ratazana", "fezes grandes", "cocô de ratazana", "dejetos grandes"],
    },
    translations: { es: "Excremento de Rata", pt: "Fezes de Ratazana" },
    reportPhrase: {
      en: "Rat droppings observed.",
      es: "Se observaron excrementos de rata.",
      pt: "Fezes de ratazana observadas.",
    },
  },
  {
    professional: "Rub Marks",
    category: "rodents", icon: "🐀",
    casual: {
      en: ["grease marks", "dark smears", "dirty marks along wall", "smudge marks", "dark streaks", "oily marks", "rub marks along baseboard"],
      es: ["marcas de grasa", "manchas oscuras", "marcas en la pared", "marcas de roce"],
      pt: ["marcas de gordura", "manchas escuras", "marcas de roçamento", "trilhas de graxa"],
    },
    translations: { es: "Marcas de Roce", pt: "Marcas de Roçamento" },
    reportPhrase: {
      en: "Rodent rub marks observed along runway.",
      es: "Marcas de roce de roedores observadas a lo largo del corredor.",
      pt: "Marcas de roçamento de roedores observadas ao longo da trilha.",
    },
  },
  {
    professional: "Gnaw Marks",
    category: "rodents", icon: "🐭",
    casual: {
      en: ["chewed wood", "bite marks", "chew marks", "gnawed area", "chewed corner", "rodent chewing", "teeth marks"],
      es: ["madera mordida", "marcas de mordida", "área masticada", "marcas de dientes"],
      pt: ["madeira roída", "marcas de mordida", "área roída", "marcas de dentes"],
    },
    translations: { es: "Marcas de Mordida", pt: "Marcas de Roedura" },
    reportPhrase: {
      en: "Active gnaw marks observed.",
      es: "Se observaron marcas de mordida activas.",
      pt: "Marcas de roedura ativas observadas.",
    },
  },
  {
    professional: "Rodent Nesting Material",
    category: "rodents", icon: "🪹",
    casual: {
      en: ["nest", "nesting", "shredded paper", "chewed insulation", "debris nest", "animal nest", "rodent nest", "fluffy material"],
      es: ["nido", "nidificación", "papel triturado", "material de nido", "nido de roedores"],
      pt: ["ninho", "material de nidificação", "papel triturado", "ninho de roedores"],
    },
    translations: { es: "Material de Nido", pt: "Material de Nidificação" },
    reportPhrase: {
      en: "Rodent nesting material observed.",
      es: "Se observó material de nidificación de roedores.",
      pt: "Material de nidificação de roedores observado.",
    },
  },
  // ── Cockroaches ──────────────────────────────────────────────────────────────
  {
    professional: "Cockroach Fecal Spotting",
    category: "cockroaches", icon: "🪳",
    casual: {
      en: ["bug dirt", "roach dirt", "dark spots", "black specks", "brown spots near equipment", "roach smears", "pepper spots", "small dark dots"],
      es: ["suciedad de cucaracha", "manchas de cucaracha", "puntos negros", "excremento de cucaracha"],
      pt: ["fezes de barata", "manchas de barata", "pontos escuros", "dejetos de barata"],
    },
    translations: { es: "Excremento de Cucaracha", pt: "Fezes de Barata" },
    reportPhrase: {
      en: "Cockroach fecal spotting observed.",
      es: "Se observó excremento de cucaracha.",
      pt: "Fezes de barata observadas.",
    },
  },
  {
    professional: "German Roach Activity",
    category: "cockroaches", icon: "🪳",
    casual: {
      en: ["german roaches", "small roaches", "baby roaches", "lots of roaches under sink", "heavy roach activity", "german cockroaches"],
      es: ["cucarachas alemanas", "cucarachas pequeñas", "mucha actividad de cucarachas", "cucarachas bajo el fregadero"],
      pt: ["baratas alemãs", "baratas pequenas", "muita atividade de barata", "baratas embaixo da pia"],
    },
    translations: { es: "Actividad de Cucaracha Alemana", pt: "Atividade de Barata Alemã" },
    reportPhrase: {
      en: "Active German roach population observed.",
      es: "Se observó una población activa de cucarachas alemanas.",
      pt: "População ativa de baratas alemãs observada.",
    },
  },
  {
    professional: "Cockroach Harborage",
    category: "cockroaches", icon: "🪳",
    casual: {
      en: ["roach hiding spot", "roaches behind equipment", "roaches in crack", "harborage", "roach harbor", "roaches under shelf"],
      es: ["escondite de cucarachas", "cucarachas en grieta", "refugio de cucarachas"],
      pt: ["abrigo de baratas", "baratas em fresta", "baratas atrás do equipamento"],
    },
    translations: { es: "Refugio de Cucarachas", pt: "Abrigo de Baratas" },
    reportPhrase: {
      en: "Active cockroach harborage identified.",
      es: "Se identificó un refugio activo de cucarachas.",
      pt: "Abrigo ativo de baratas identificado.",
    },
  },
  {
    professional: "Cockroach Egg Cases (Oothecae)",
    category: "cockroaches", icon: "🪳",
    casual: {
      en: ["egg case", "roach egg", "brown capsule", "roach egg sack", "oothecae"],
      es: ["cápsulas de huevos", "caso de huevo de cucaracha", "ooteca"],
      pt: ["ooteca", "cápsula de ovo de barata", "casulo de ovos de barata"],
    },
    translations: { es: "Ooteca de Cucaracha", pt: "Ooteca de Barata" },
    reportPhrase: {
      en: "Cockroach egg cases (oothecae) observed.",
      es: "Se observaron ootecas de cucarachas.",
      pt: "Ootecas de baratas observadas.",
    },
  },
  // ── Termites ─────────────────────────────────────────────────────────────────
  {
    professional: "Mud Tubes",
    category: "termites", icon: "🪵",
    casual: {
      en: ["mud tunnels", "dirt tubes", "clay tunnels", "termite tunnels", "dirt on wall", "mud on foundation"],
      es: ["túneles de barro", "tubos de arcilla", "tubos de termitas"],
      pt: ["tubos de barro", "túneis de térmita", "barro na parede"],
    },
    translations: { es: "Tubos de Barro (Termitas)", pt: "Tubos de Barro (Cupins)" },
    reportPhrase: {
      en: "Active termite mud tubes observed.",
      es: "Se observaron tubos de barro activos de termitas.",
      pt: "Tubos de barro ativos de cupins observados.",
    },
  },
  {
    professional: "Termite Damaged Wood",
    category: "termites", icon: "🪵",
    casual: {
      en: ["hollow wood", "soft wood", "damaged wood", "wood sounds hollow", "termite damage", "deteriorating wood"],
      es: ["madera hueca", "madera dañada", "madera deteriorada", "daño de termitas"],
      pt: ["madeira oca", "madeira danificada", "madeira deteriorada", "dano de cupins"],
    },
    translations: { es: "Madera Dañada por Termitas", pt: "Madeira Danificada por Cupins" },
    reportPhrase: {
      en: "Wood damage consistent with termite activity observed.",
      es: "Se observó daño en la madera consistente con actividad de termitas.",
      pt: "Dano na madeira consistente com atividade de cupins observado.",
    },
  },
  // ── Carpenter Ants ───────────────────────────────────────────────────────────
  {
    professional: "Carpenter Ant Frass",
    category: "carpenter_ants", icon: "🐜",
    casual: {
      en: ["sawdust", "wood shavings", "ant sawdust", "wood debris", "frass", "carpenter ant debris", "shavings near wood"],
      es: ["aserrín", "virutas de madera", "aserrín de hormigas", "frass de hormiga carpintera"],
      pt: ["serragem", "serragem de formiga", "frass de formiga carpinteira", "detritos de madeira"],
    },
    translations: { es: "Frass de Hormiga Carpintera", pt: "Frass de Formiga Carpinteira" },
    reportPhrase: {
      en: "Carpenter ant frass (sawdust) observed.",
      es: "Se observó frass de hormiga carpintera.",
      pt: "Frass de formiga carpinteira observado.",
    },
  },
  // ── Exclusion ────────────────────────────────────────────────────────────────
  {
    professional: "Utility Penetration",
    category: "exclusion", icon: "🔧",
    casual: {
      en: ["hole around pipe", "gap around pipe", "pipe hole", "open pipe", "pipe penetration", "unsealed pipe", "gap around conduit", "open conduit"],
      es: ["agujero alrededor de tubería", "penetración de tubería", "tubería sin sellar", "abertura en tubería"],
      pt: ["furo ao redor do cano", "penetração de tubulação", "cano sem vedação", "abertura no cano"],
    },
    translations: { es: "Penetración de Servicio", pt: "Penetração de Utilidade" },
    reportPhrase: {
      en: "Unsealed utility penetration observed.",
      es: "Se observó una penetración de servicio sin sellar.",
      pt: "Penetração de utilidade sem vedação observada.",
    },
  },
  {
    professional: "Missing Door Sweep",
    category: "exclusion", icon: "🚪",
    casual: {
      en: ["no door sweep", "missing door sweep", "gap under door", "door gap", "light under door", "bottom of door open"],
      es: ["sin sello de puerta", "falta sello de puerta", "espacio bajo la puerta", "abertura bajo la puerta"],
      pt: ["sem borracha de porta", "falta borracha de porta", "fresta embaixo da porta", "abertura sob a porta"],
    },
    translations: { es: "Sello de Puerta Faltante", pt: "Borracha de Porta Ausente" },
    reportPhrase: {
      en: "Missing door sweep creating entry point.",
      es: "Sello de puerta faltante que crea un punto de entrada.",
      pt: "Borracha de porta ausente criando ponto de entrada.",
    },
  },
  {
    professional: "Structural Gap / Foundation Crack",
    category: "exclusion", icon: "🔧",
    casual: {
      en: ["crack in wall", "hole in wall", "gap in foundation", "crack in foundation", "structural opening", "open gap", "big crack"],
      es: ["grieta en la pared", "agujero en la pared", "grieta en la fundación", "abertura estructural"],
      pt: ["fissura na parede", "buraco na parede", "fissura na fundação", "abertura estrutural"],
    },
    translations: { es: "Grieta Estructural", pt: "Fissura Estrutural" },
    reportPhrase: {
      en: "Structural gap observed — exclusion recommended.",
      es: "Se observó una abertura estructural — se recomienda exclusión.",
      pt: "Abertura estrutural observada — exclusão recomendada.",
    },
  },
  // ── Conducive Conditions ─────────────────────────────────────────────────────
  {
    professional: "Moisture Condition",
    category: "conducive", icon: "💧",
    casual: {
      en: ["water damage", "wet area", "moisture", "damp area", "condensation", "leak", "mold", "mildew", "wet floor", "standing water", "possible moisture issue"],
      es: ["daño por agua", "área húmeda", "humedad", "condensación", "fuga", "piso mojado", "agua estancada"],
      pt: ["dano por água", "área úmida", "umidade", "condensação", "vazamento", "piso molhado", "água parada"],
    },
    translations: { es: "Condición de Humedad", pt: "Condição de Umidade" },
    reportPhrase: {
      en: "Conducive moisture condition observed.",
      es: "Se observó una condición de humedad propicia.",
      pt: "Condição de umidade propícia observada.",
    },
  },
  {
    professional: "Food Debris / Sanitation Issue",
    category: "conducive", icon: "🍽️",
    casual: {
      en: ["food on floor", "dirty area", "garbage", "food debris", "spilled food", "grease buildup", "poor sanitation", "dirty equipment"],
      es: ["comida en el piso", "área sucia", "basura", "restos de comida", "grasa acumulada", "mala sanidad"],
      pt: ["comida no chão", "área suja", "lixo", "restos de comida", "acúmulo de gordura", "má higienização"],
    },
    translations: { es: "Problema de Saneamiento", pt: "Problema de Saneamento" },
    reportPhrase: {
      en: "Food debris / sanitation issue observed.",
      es: "Se observó un problema de saneamiento / restos de comida.",
      pt: "Restos de comida / problema de saneamento observado.",
    },
  },
  {
    professional: "Harborage Condition",
    category: "conducive", icon: "📦",
    casual: {
      en: ["clutter", "lots of boxes", "storage clutter", "junk", "piled up stuff", "cluttered area", "heavy storage"],
      es: ["desorden", "muchas cajas", "almacenamiento desordenado", "cacharros", "área desordenada"],
      pt: ["bagunça", "muitas caixas", "armazenamento desordenado", "área desordenada", "entulho"],
    },
    translations: { es: "Condición de Refugio", pt: "Condição de Abrigo" },
    reportPhrase: {
      en: "Harborage conditions observed — clutter reduction recommended.",
      es: "Se observaron condiciones de refugio — se recomienda reducir el desorden.",
      pt: "Condições de abrigo observadas — redução de desordem recomendada.",
    },
  },
];

// ─── Language Detection ───────────────────────────────────────────────────────

const ES_INDICATORS = ["de", "del", "la", "el", "en", "con", "por", "detrás", "debajo", "encima",
  "cerca", "hay", "está", "tiene", "ratón", "rata", "cucaracha", "hormiga", "termita",
  "excremento", "heces", "tubería", "agujero", "grieta", "humedad"];

const PT_INDICATORS = ["do", "da", "de", "no", "na", "em", "com", "por", "atrás", "embaixo",
  "perto", "rato", "barata", "formiga", "cupim", "fezes", "umidade", "fissura",
  "cano", "abertura", "madeira"];

export function detectLanguage(text: string): SupportedLang {
  const words = text.toLowerCase().split(/\s+/);
  let ptScore = 0, esScore = 0;
  for (const word of words) {
    if (PT_INDICATORS.includes(word)) ptScore++;
    if (ES_INDICATORS.includes(word)) esScore++;
  }
  if (ptScore === 0 && esScore === 0) return "en";
  if (ptScore > esScore) return "pt";
  if (esScore > ptScore) return "es";
  return "es";
}

// ─── Terminology Matching ─────────────────────────────────────────────────────

export interface TermMatch {
  term: VocabTerm;
  score: number;
  detectedLang: SupportedLang;
}

export function matchTerminology(rawText: string): TermMatch | null {
  const text = rawText.toLowerCase().trim();
  const lang = detectLanguage(text);
  let best: { term: VocabTerm; score: number } | null = null;

  for (const term of VOCABULARY) {
    const phrases = term.casual[lang];
    for (const phrase of phrases) {
      const words = phrase.toLowerCase().split(/\s+/);
      const matchCount = words.filter(w => text.includes(w)).length;
      const score = matchCount / words.length;
      if (score > 0.4 && (!best || score > best.score)) {
        best = { term, score };
      }
    }
    // Also check English if not English detected (mixed language)
    if (lang !== "en") {
      for (const phrase of term.casual.en) {
        const words = phrase.toLowerCase().split(/\s+/);
        const matchCount = words.filter(w => text.includes(w)).length;
        const score = matchCount / words.length;
        if (score > 0.4 && (!best || score > best.score)) {
          best = { term, score };
        }
      }
    }
  }

  if (!best) return null;
  return { ...best, detectedLang: lang };
}

// ─── Structured Note Builder ──────────────────────────────────────────────────

export interface StructuredNote {
  originalText: string;
  professionalTerm: string;
  reportPhrase: string;
  category: Category;
  icon: string;
  detectedLang: SupportedLang;
  translation?: string;
}

export function buildStructuredNote(rawText: string, match: TermMatch, reportLang: SupportedLang): StructuredNote {
  return {
    originalText: rawText,
    professionalTerm: match.term.professional,
    reportPhrase: match.term.reportPhrase[reportLang],
    category: match.term.category,
    icon: match.term.icon,
    detectedLang: match.detectedLang,
    translation: match.detectedLang !== "en" ? match.term.translations[match.detectedLang as "es" | "pt"] : undefined,
  };
}

// ─── Language Config ──────────────────────────────────────────────────────────

export const LANG_CONFIG: Record<SupportedLang, { label: string; speechCode: string; flag: string }> = {
  en: { label: "EN", speechCode: "en-US", flag: "🇺🇸" },
  es: { label: "ES", speechCode: "es-MX", flag: "🇪🇸" },
  pt: { label: "PT", speechCode: "pt-BR", flag: "🇧🇷" },
};
