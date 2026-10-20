/* Shared text helpers: normalization, Korean initial consonants, escaping. */

const HANGUL_FIRST = 0xac00;           // first precomposed Hangul syllable
const HANGUL_LAST = 0xd7a3;            // last precomposed Hangul syllable
const SYLLABLES_PER_CHOSEONG = 588;    // 21 vowels * 28 final consonants
const CHOSEONG_LIST = Array.from("ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ");
const CHOSEONG_ONLY_PATTERN = /^[ㄱ-ㅎ\s]+$/;

/** Lowercase, NFC-normalize and collapse whitespace. */
export function normalizeText(text) {
  return text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Convert Hangul text to its initial consonants (other characters kept). */
export function toChoseong(text) {
  let result = "";
  for (const ch of text.normalize("NFC")) {
    const code = ch.codePointAt(0);
    if (code >= HANGUL_FIRST && code <= HANGUL_LAST) {
      result += CHOSEONG_LIST[Math.floor((code - HANGUL_FIRST) / SYLLABLES_PER_CHOSEONG)];
    } else {
      result += ch;
    }
  }
  return result;
}

/** True when the query consists only of initial consonants such as "ㅅㄱㅈ". */
export function isChoseongOnly(query) {
  return CHOSEONG_ONLY_PATTERN.test(query.trim()) && query.trim().length > 0;
}

/** Escape a string for safe use inside a RegExp. */
export function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a case-insensitive regex that matches any of the tokens (or null). */
export function buildHighlightRegex(tokens) {
  const usable = tokens.filter((t) => t.length > 0);
  if (usable.length === 0) return null;
  return new RegExp(usable.map(escapeRegExp).join("|"), "gi");
}

/** Encode every path segment so Korean file names work in URLs. */
export function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}
