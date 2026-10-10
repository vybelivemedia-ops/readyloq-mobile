/**
 * Domain terms, not a general translator. Match every language in one pass:
 * code-switching must not be constrained by a single selected language.
 * Brand names and the existing canonical inspection dictionary stay unchanged.
 */
export const VOICE_LANGUAGES = [
  "English", "Spanish", "French", "Portuguese", "German", "Italian",
  "Russian", "Arabic", "Hindi", "Mandarin", "Japanese", "Korean",
] as const;

export const PHOTO_PHRASES = [
  "toma una foto", "tome una foto", "tomar una foto", "saca una foto", "sacar una foto",
  "haz una foto", "toma una fotografía", "captura una imagen",
  "prends une photo", "prenez une photo", "prendre une photo", "fais une photo",
  "tire uma foto", "tira uma foto", "tirar uma foto", "tire uma fotografia",
  "mach ein foto", "mache ein foto", "mach ein bild", "fotografiere",
  "fai una foto", "scatta una foto", "scattare una foto",
  "сделай фото", "сделайте фото", "сделать фото", "сфотографируй",
  "التقط صورة", "التقط صوره", "خذ صورة", "خذ صوره", "صور هذا",
  "फोटो लो", "फ़ोटो लो", "फोटो ले लो", "तस्वीर लो", "एक फोटो खींचो",
  "拍照", "拍张照片", "拍一张照片", "拍个照片", "照相",
  "写真を撮って", "写真を撮る", "写真を撮影", "撮影して",
  "사진 찍어", "사진을 찍어", "사진 찍어줘", "사진을 찍어주세요", "사진 촬영",
  // Common code-switched imperatives. Existing English/Spanish photo nouns
  // remain handled by the unchanged low-level parser.
  "take una foto", "toma a photo", "saca a picture", "take une photo",
];

export const DOMAIN_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["photo", "photographie|fotografía|fotografías|фото|фотографию|صورة|صوره|फोटो|फ़ोटो|तस्वीर|照片|相片|写真|사진"],
  ["ants", "fourmi|fourmis|formiga|formigas|ameise|ameisen|formica|formiche|муравей|муравьи|муравьев|муравьёв|نمل|النمل|चींटी|चींटियाँ|चींटियां|चींटियों|蚂蚁|螞蟻|アリ|蟻|개미"],
  ["bed bugs", "punaise de lit|punaises de lit|percevejo de cama|percevejos de cama|bettwanze|bettwanzen|cimice da letto|cimici da letto|клоп|клопы|клопов|بق الفراش|खटमल|खटमलों|臭虫|臭蟲|トコジラミ|빈대"],
  ["rodents", "rongeur|rongeurs|souris|roedor|roedores|rato|ratos|nager|nagetiere|mäuse|ratten|roditore|roditori|topi|грызуны|грызунов|мыши|мышей|крысы|القوارض|قوارض|فئران|الفئران|चूहा|चूहे|चूहों|老鼠|啮齿动物|齧齒動物|ネズミ|ねずみ|쥐|설치류"],
  ["cockroaches", "cafard|cafards|blatte|blattes|barata|baratas|kakerlake|kakerlaken|schaben|scarafaggio|scarafaggi|таракан|тараканы|тараканов|صراصير|الصراصير|صرصور|तिलचट्टा|तिलचट्टे|तिलचट्टों|蟑螂|ゴキブリ|바퀴벌레"],
  ["flies", "mouche|mouches|fliegen|mosche|мухи|мух|ذباب|الذباب|मक्खी|मक्खियाँ|मक्खियों|苍蝇|蒼蠅|ハエ|파리"],
  ["mosquitoes", "moustique|moustiques|mücken|zanzara|zanzare|комары|комаров|بعوض|البعوض|मच्छर|मच्छरों|蚊子|蚊虫|蚊蟲|蚊|모기"],
  ["fleas", "puce|puces|pulgas|flöhe|pulci|блохи|блох|براغيث|البراغيث|पिस्सू|跳蚤|ノミ|벼룩"],
  ["wasps", "guêpe|guêpes|vespas|wespen|vespe|осы|ос|دبابير|الدبابير|ततैया|ततैये|黄蜂|黃蜂|スズメバチ|말벌"],
  ["droppings", "excrementos|excréments|fezes|kot|escrementi|помет|помёт|فضلات|मल|粪便|糞便|フン|배설물"],
  ["live activity", "actividad viva|activité vivante|atividade ativa|lebende aktivität|attività viva|живая активность|نشاط حي|जीवित गतिविधि|活体活动|活體活動|生体活動|살아있는 활동"],
  ["kitchen", "cocina|cuisine|cozinha|küche|cucina|кухня|кухне|مطبخ|المطبخ|रसोई|厨房|廚房|キッチン|台所|주방|부엌"],
  ["basement", "sótano|sous-sol|porão|keller|seminterrato|подвал|подвале|قبو|القبو|तहखाना|地下室|지하실"],
  ["storage room", "almacén|salle de stockage|depósito|lagerraum|magazzino|склад|складе|مخزن|المخزن|भंडार कक्ष|储藏室|儲藏室|倉庫|창고"],
  ["restroom", "baño|toilettes|banheiro|toilette|bagno|туалет|حمام|الحمام|शौचालय|卫生间|衛生間|トイレ|화장실"],
  ["applied", "apliqué|aplique|aplicado|appliqué|appliquée|appliquer|apliquei|sprühte|ausgebracht|applicato|нанес|нанёс|нанесла|наносил|طبقت|رششت|लगाया|छिड़का|喷洒|噴灑|散布|살포"],
  ["placed", "coloqué|coloque|colocado|placé|placée|coloquei|platziert|aufgestellt|posizionato|разместил|установил|وضعت|رखा|放置|設置|설치"],
  ["treated", "traté|trate|traité|traitée|tratei|behandelt|trattato|обработал|عالجت|उपचार किया|处理|處理|処理|처리"],
  ["inspected", "inspeccioné|inspeccione|inspecté|vérifié|inspecionei|geprüft|inspiziert|ispezionato|осмотрел|проверил|فحصت|निरीक्षण किया|检查|檢查|点検|점검"],
  ["sealed", "sellé|selle|scellé|scellée|selei|abgedichtet|sigillato|заделал|герметизировал|أغلقت|सील किया|密封|封鎖|밀봉"],
  ["low", "baja|bajo|faible|baixa|baixo|gering|bassa|basso|низкая|منخفضة|कम|低|낮음"],
  ["high severity", "alta severidad|gravité élevée|alta gravidade|hoher befall|gravità alta|высокая тяжесть|شدة عالية|गंभीर|严重|嚴重|重度|심각"],
  ["here", "aquí|ici|aqui|hier|qui|здесь|هنا|यहाँ|यहां|这里|這裡|ここ|여기"],
  ["bait station", "estación de cebo|estacion de cebo|poste d'appât|estação de isca|köderstation|stazione esca|приманочная станция|محطة طعم|चारा स्टेशन|诱饵站|誘餌站|ベイトステーション|미끼통"],
];

export const FIELD_ALIASES = {
  notes: "notes|note|notas|anota|noter|remarques|anotações|notizen|annotazioni|заметка|заметки|ملاحظات|ملاحظة|नोट|टिप्पणी|备注|備註|メモ|메모",
  clientName: "client name is|client name|nombre del cliente es|nombre del cliente|nom du client|nome do cliente|kundenname|nome del cliente|имя клиента|اسم العميل|ग्राहक का नाम|客户姓名|客戶姓名|顧客名|고객 이름",
  siteAddress: "site address is|site address|dirección del sitio|direccion del sitio|adresse du site|endereço do local|standortadresse|indirizzo del sito|адрес объекта|عنوان الموقع|साइट का पता|现场地址|現場地址|現場住所|현장 주소",
} as const;
