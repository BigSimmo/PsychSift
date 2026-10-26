import type { PatientDetailProblem } from "@/lib/work-text/patient-detail-check";

/**
 * A bare first and last name ("Sarah Jones lithium level 1.4") and a street address
 * ("8 Smith St") in a Clinical question, which Work's check reads past because it looks for a
 * title, a patient word or an age beside the name. The Clinical question check holds both back
 * before anything is sent to the answer service (owner decision, 25 Oct 2026).
 *
 * A name is recognised by its first word: a given name from the list below, followed by a
 * surname in the same case ("Sarah Jones", "sarah jones", "SARAH JONES"). Leading with given
 * names is what keeps ordinary questions safe: a capitalised pair such as "Lithium Toxicity",
 * "Bipolar Disorder" or "Mental Health" starts with no given name, so it is never read as one.
 *
 * The list leaves out given names that are also everyday or clinical words ("Will", "May",
 * "Grace", "Max", "Mark", "Iris", "Christian") or places a question names ("Victoria",
 * "Sydney", "Darwin", "Austin"). tests/clinical-question-patient-check.test.ts checks that none
 * of them is a medicine in the medication lexicon. Eponyms ("Charles Bonnet", "Hans Asperger"),
 * hospitals ("Fiona Stanley", "Sir Charles Gairdner") and place words after a name ("Alma
 * Street", "Marian Centre") are read past.
 *
 * Like the rest of the check it catches some names, not all: a given name it does not list, or
 * a surname alone, still gets through.
 */

const GIVEN_NAMES: ReadonlySet<string> = new Set(
  `
aaron abigail adam ahmed aidan alan albert alexander alexandra alexis alice alison allan allison amanda amelia
amy andrea andrew angela angus anna annabelle anne annette annie anthony archie ashley ava barbara belinda
benjamin bethany beverley bianca bradley brendan brenda brett brian bridget brittany bronwyn bruce caitlin
callum cameron carla carl carmen caroline cassandra catherine charles charlie charlotte chloe christina
christine christopher claire clare colin connor craig cynthia daniel danielle darren david deborah debbie
denise dennis derek diana diane dimitri donald donna douglas dylan edward eleanor elena eli elijah elizabeth
ella ellen elliot emily emma eric erin ethan eva evelyn felicity fiona frances gabriel gabrielle gary gemma
geoffrey george georgina gerald gillian glenn gordon graham gregory hamish hannah harold harriet harrison
hayley heidi helen henry hugh hugo ian imogen isaac isabella isabelle isla jacob jacqueline james jamie jane
janet janice jared jarrod jason jeffrey jennifer jenny jeremy jesse jessica jillian joanna joanne joel john
jonathan joseph josephine joshua judith julia julian julie justin karen katherine kathleen kathryn katie
keith kelly kenneth kevin kieran kirsty kristen kristy kyle lachlan laura lauren lawrence leah
leanne liam linda lindsay lisa logan lorraine louise lucas lucinda lucy luke lydia madeleine madison
malcolm margaret maria marian marie marion martin matilda matthew maureen megan melanie melissa michael
michelle mitchell mohammed monica muhammad nadia naomi natalie natasha nathan neil nicholas nicola nicole
nigel noah oliver olivia oscar owen pamela patricia patrick paul paula pauline peter philip phillip
philippa phoebe priya rachel rebecca rhys richard robert roberta rodney rosemary russell ruth ryan sally
samantha samuel sarah scott sean shane shannon sharon shaun sheila simon simone sophia sophie stephanie
stephen steven stuart susan tamara tanya teresa theresa thomas timothy toby todd tracey tracy trevor
troy valerie vanessa vincent warren wayne wendy william xavier yvonne zachary zoe
mary jack ben sam kate alex chris tom tim dan jake josh beth jess liz tess rosie millie levi ezra theo leo
jayden jaxon tahlia talia shania kayla mikayla jordan tyson brodie cody riley harley kobe zac zach hayden
mick steve dave mike pete ken jon
minh thanh duc huy linh hai trang tuan khanh phuong quang thuy hoa
bao lin wei ming jing yan hui xin jun lei hao xiao ying lili mei ling jian zhen qing
arjun rahul rohan raj ravi vikram sanjay ajay amit anil sunil deepak suresh ramesh rajesh mahesh ganesh
kiran priyanka anjali deepika kavya neha pooja sneha divya lakshmi meera nisha sunita anita rekha shreya ananya
aditi aditya arun vijay harpreet gurpreet manpreet jaspreet simran navneet aarav ishaan vivek nikhil
omar ali mohammad muhammed mohamad hassan hussein ibrahim yusuf youssef khalid karim tariq bilal hamza mustafa mahmoud ahmad amir ayesha
aisha fatima fatma mariam maryam zainab layla leila noor nour yasmin samira amina hiba rania salma khadija
kwame kofi abena chidi chinedu chukwuemeka emeka ngozi adaeze amara tunde femi yemi amadou mamadou fatou
aminata abdi fatuma hodan deng achol garang mohamed mohamud
aroha rangi tane wiremu hemi manaia nikau sione mele tevita malia
siobhan niamh aoife ciaran declan jarrah kirra bindi marlee jedda kalinda kaya tanika
giulia giuseppe giovanni marco luca matteo alessandro francesca chiara lorenzo sofia joao pedro carlos
juan jose luis miguel javier diego lucia ines nikolai ivan sergei olga natalia katarina anastasia marek
dmitri piotr tomasz agnieszka katarzyna stefan andreas klaus ingrid astrid lars sven erik nils elif mehmet emre
hiroshi yuki haruto sakura kenji takeshi akira hana jin hyun
`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Surnames common in Australia that anchor a name from the other side: a surname-first name
 * ("Nguyen Thi Lan", "Chen Wei"), or a given name the list above does not hold ("Wei Chen" is
 * caught either way, "Xiaoling Chen" only by this). Surnames that are also eponyms, everyday words
 * or a test name ("Wilson", "Williams", "Turner", "Brown", "Young", "Hamilton", "Bell", "Park",
 * "Li") are left out, so "Wilson disease" and "Young Mania Rating Scale" pass.
 */
const SURNAMES: ReadonlySet<string> = new Set(
  `
nguyen tran pham huynh hoang phan bui ngo duong vu vo dang
chen wang zhang liu yang huang zhao zhou xu zhu guo luo gao liang zheng xie cao deng
singh kaur patel sharma kumar gupta khan ahmed hussain rahman siddiqui
okafor obi diallo mensah haddad nasser khoury
kim lee choi kang cho yoon tanaka sato suzuki takahashi watanabe yamamoto nakamura kobayashi
smith jones taylor thompson anderson walker thomas jackson harris robinson clarke ryan kelly murphy
campbell stewart mitchell roberts johnson evans edwards davis
garcia rodriguez martinez lopez hernandez gonzalez silva santos ferreira costa rossi russo bianchi romano
ivanov petrov kowalski nowak muller schmidt fischer weber yilmaz
`
    .split(/\s+/)
    .filter(Boolean),
);

/** Exported for the lexicon test only: the surnames that anchor a bare name. */
export const BARE_NAME_SURNAMES: readonly string[] = [...SURNAMES];

/** Exported for the lexicon test only: the given names a bare name must start with. */
export const BARE_NAME_GIVEN_NAMES: readonly string[] = [...GIVEN_NAMES];

/**
 * Eponyms written after a person's given name ("Hans Asperger"), taken from the owner's list
 * plus a few more read in psychiatry. A surname here is never read as a patient's.
 */
const EPONYM_SURNAMES: ReadonlySet<string> = new Set([
  "asperger",
  "tourette",
  "korsakoff",
  "korsakov",
  "wernicke",
  "capgras",
  "munchausen",
  "munchhausen",
  "lewy",
  "huntington",
  "parkinson",
  "alzheimer",
  "cotard",
  "clerambault",
  "ekbom",
  "bonnet",
  "fregoli",
  "ganser",
  "kluver",
  "bucy",
  "kraepelin",
  "bleuler",
  "freud",
  "jung",
  "maudsley",
  "magenis",
  "cade",
]);

/**
 * Named people, hospitals and services whose surname is too common to read past on its own,
 * so the whole pair is listed. Matched without regard to case.
 */
const KNOWN_PAIRS: readonly string[] = [
  "aaron beck",
  "albert ellis",
  "carl rogers",
  "john bowlby",
  "donald winnicott",
  "melanie klein",
  "fiona stanley",
  "fiona wood",
  "peter maccallum",
  "john hunter",
  "john curtin",
  "charles darwin",
  "thomas embling",
  "graham farmer",
  "john cade",
  "mary jane",
  "sally anne",
  "lee silverman",
  "miller fisher",
  "kurt schneider",
  "marsha linehan",
];

/** Words that name a place, a service or a tool rather than finish a person's name ("Alma Street", "Marian Centre"). */
const NOT_A_SURNAME: ReadonlySet<string> = new Set([
  "hospital",
  "hospitals",
  "health",
  "clinic",
  "centre",
  "center",
  "house",
  "institute",
  "unit",
  "ward",
  "service",
  "services",
  "foundation",
  "university",
  "college",
  "campus",
  "school",
  "memorial",
  "medical",
  "street",
  "road",
  "avenue",
  "drive",
  "lane",
  "terrace",
  "parade",
  "highway",
  "park",
  "springs",
  "river",
  "valley",
  "beach",
  "bay",
  "island",
  "guideline",
  "guidelines",
  "protocol",
  "scale",
  "criteria",
  "syndrome",
  "disease",
  "disorder",
  "test",
  "model",
  "method",
  "therapy",
  "rule",
  "score",
  "questionnaire",
  "inventory",
  "index",
  "prescribing",
  "society",
  "association",
  "council",
  "trust",
  "network",
  "program",
  "programme",
  "city",
  "freeway",
  "quay",
]);

/** Words that follow a given name in a sentence and are never a surname ("for sarah with ...", "john and"). */
const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "with",
  "without",
  "on",
  "in",
  "at",
  "to",
  "of",
  "for",
  "from",
  "about",
  "after",
  "before",
  "who",
  "is",
  "was",
  "has",
  "had",
  "have",
  "taking",
  "having",
  "receiving",
  "presenting",
  "re",
  "please",
  // "Bradley et al." cites a paper.
  "et",
]);

/**
 * A title or place word before a name, which makes the name a place ("St George", "Sir Charles
 * Gairdner", "King Edward", "Princess Margaret", "Lake Joondalup"). The pair is read past.
 */
const PLACE_PREFIX =
  /(?<![\p{L}\p{N}'’-])(?:St|Saint|Sir|Dame|Lady|King|Queen|Prince|Princess|Royal|Mount|Mt|Port|Lake|Cape|Fort)\.?\s+\p{L}+/giu;

/** A word and the word after it, overlapping, so every adjacent pair is read. */
const WORD_PAIR = /(?<![\p{L}'’-])(\p{L}+)(?=\s+(\p{L}[\p{L}'’-]*))/gu;

type WordCase = "capitalised" | "lower" | "upper" | "other";

/** "sarah", "SARAH", "Sarah" (and "McDonald", "O'Brien"), or anything else ("iPhone"). */
function caseOf(word: string): WordCase {
  if (word === word.toLowerCase()) return "lower";
  if (word === word.toUpperCase()) return "upper";
  return /^\p{Lu}/u.test(word) ? "capitalised" : "other";
}

/** Folded for comparison: lower case, accents removed ("Münchhausen" is "munchhausen"). */
function fold(word: string): string {
  return word.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** True when the word could finish a name beside a given name or a listed surname. */
function couldBeNamePart(word: string): boolean {
  const folded = fold(word);
  return (
    folded.length >= 2 && !EPONYM_SURNAMES.has(folded) && !NOT_A_SURNAME.has(folded) && !FUNCTION_WORDS.has(folded)
  );
}

/** Both words in the same case: "Sarah Jones", "sarah jones", or in capitals when both are words, not short capitals such as "ECT". */
function sameNameCase(first: string, second: string): boolean {
  const firstCase = caseOf(first);
  if (firstCase !== caseOf(second)) return false;
  if (firstCase === "capitalised" || firstCase === "lower") return true;
  return firstCase === "upper" && first.length >= 4 && second.length >= 3;
}

function readsAsName(first: string, second: string): boolean {
  const secondWord = second.replace(/['’]s$/u, "");
  if (!sameNameCase(first, secondWord)) return false;
  const firstFolded = fold(first);
  const secondFolded = fold(secondWord);
  // A given name and then a surname ("Sarah Jones"), or a listed surname on either side ("Nguyen Thi", "Xiaoling Chen").
  if (GIVEN_NAMES.has(firstFolded) && couldBeNamePart(secondWord)) return true;
  if (SURNAMES.has(firstFolded) && couldBeNamePart(secondWord)) return true;
  if (SURNAMES.has(secondFolded) && couldBeNamePart(first) && !SENTENCE_WORDS.has(firstFolded)) return true;
  return false;
}

/**
 * Words that start a question or sit before a name without being part of it ("Can Sarah", "Ask
 * Jane", "Plain Jane"). A surname then a given name ("Testpatient Jane") is read only when the
 * first word is not one of these.
 */
const SENTENCE_WORDS: ReadonlySet<string> = new Set(
  `
can could should would will does did do is are was were what when where which why how give start stop tell ask
call see dear hi hello hey thanks thank ok okay plain calamity if then so also just only does
`
    .split(/\s+/)
    .filter(Boolean),
);

/** A surname then a given name, both capitalised: "Testpatient Jane clozapine", "Hartley Jane". */
function readsAsReversedName(first: string, second: string): boolean {
  if (caseOf(first) !== "capitalised" || caseOf(second) !== "capitalised") return false;
  if (!GIVEN_NAMES.has(fold(second))) return false;
  const firstFolded = fold(first);
  return (
    first.length >= 3 && couldBeNamePart(first) && !SENTENCE_WORDS.has(firstFolded) && !GIVEN_NAMES.has(firstFolded)
  );
}

/** A capitalised given name in a shape that holds only a person: "Jane T.", "Jane (Testpatient)", "Jane's lithium". */
const GIVEN_NAME_SHAPE =
  /(?<![\p{L}'’-])(\p{Lu}\p{Ll}+)(?:\s+\p{Lu}\.(?=\s|$|[,;:)])|\s*\(\s*\p{Lu}[\p{L}'’-]+\s*\)|['’]s(?!\s+wort)(?![\p{L}]))/gu;

/** A senior title that holds a person's name ("Prof Testpatient", "Sr Okafor"), unless the name is an eponym. */
const SENIOR_TITLE = /(?<![\p{L}'’-])(?:Prof|Professor|Sr)\.?\s+(\p{Lu}[\p{L}'’-]+)/gu;

/** A title and one letter typed in lower case ("mrs t on lithium"); a millisecond reading ("480 ms a") is not one. */
const TITLE_AND_LETTER = /(?<!\d\s*)\b(?:[Mm][Rr][Ss]?|[Mm][Xx]|[Mm]iss|ms|Ms)\.?\s+\p{L}(?=$|[\s,.;:)])/u;

function hasBareName(text: string): boolean {
  let read = text.replace(PLACE_PREFIX, " ");
  for (const pair of KNOWN_PAIRS) read = read.replace(new RegExp(`\\b${pair.replace(" ", "\\s+")}\\b`, "giu"), " ");
  for (const match of read.matchAll(WORD_PAIR)) {
    if (readsAsName(match[1]!, match[2]!) || readsAsReversedName(match[1]!, match[2]!)) return true;
  }
  for (const match of read.matchAll(GIVEN_NAME_SHAPE)) {
    if (GIVEN_NAMES.has(fold(match[1]!))) return true;
  }
  for (const match of read.matchAll(SENIOR_TITLE)) {
    if (couldBeNamePart(match[1]!.replace(/['’]s$/u, ""))) return true;
  }
  return TITLE_AND_LETTER.test(read);
}

/** Amounts and times that come between a number and a capitalised word ("4 Hours", "300 Mg"); never a street name. */
const NOT_A_STREET_WORD = new Set([
  "mg",
  "mcg",
  "ml",
  "mmol",
  "units",
  "iu",
  "hours",
  "hour",
  "hourly",
  "hrs",
  "days",
  "day",
  "weeks",
  "week",
  "months",
  "month",
  "years",
  "year",
  "minutes",
  "mins",
  "times",
  "doses",
  "dose",
  "tablets",
  "tabs",
  "capsules",
  "sessions",
]);

/**
 * A street number, one to three capitalised street-name words and a street type ("8 Smith St",
 * "12/4 Ocean View Drive"). The types that are also everyday words ("Way", "Close", "Place",
 * "Court") are left out. "St John's wort" is not a street.
 */
const STREET_CAPITALISED = new RegExp(
  "(?<![\\p{L}\\d.])\\d{1,5}[A-Za-z]?(?:\\/\\d{1,5}[A-Za-z]?)?,?\\s+((?:\\p{Lu}[\\p{L}'’-]+\\s+){1,3})" +
    "(?:St|Street|Rd|Road|Ave|Avenue|Drive|Lane|Grove|Cres|Crescent|Tce|Terrace|Pde|Parade|Blvd|Boulevard|Hwy|Highway)\\b\\.?(?!\\s+John)",
  "gu",
);

/** The same, typed in lower case, for the street types that are never anything else. */
const STREET_LOWER = new RegExp(
  "(?<![\\p{L}\\d.])\\d{1,5}[a-z]?(?:\\/\\d{1,5}[a-z]?)?,?\\s+((?:[a-z][a-z'’-]+\\s+){1,3})" +
    "(?:street|road|avenue|crescent|terrace|parade|boulevard|highway)\\b",
  "gu",
);

function hasStreetAddress(text: string): boolean {
  for (const pattern of [STREET_CAPITALISED, STREET_LOWER]) {
    for (const match of text.matchAll(pattern)) {
      const words = match[1]!.trim().split(/\s+/);
      if (!words.some((word) => NOT_A_STREET_WORD.has(fold(word)) || FUNCTION_WORDS.has(fold(word)))) return true;
    }
  }
  return false;
}

const BODY = "This can't hold patient details. This check catches some details, not all.";

/** A bare first and last name or a street address in the question; null when there is neither. */
export function bareNameOrAddressProblem(text: string): PatientDetailProblem | null {
  if (hasStreetAddress(text)) return { title: "This looks like an address", body: BODY, suggestion: null };
  if (hasBareName(text)) return { title: "This looks like a name", body: BODY, suggestion: null };
  return null;
}
