/* Search: term cards (text + initial consonants) and page-level full text. */
import { normalizeText, toChoseong, isChoseongOnly } from "./util.js";

const MAX_PAGE_HITS = 300;
const SCORE_EXACT_TERM = 100;
const SCORE_TERM_PREFIX = 60;
const SCORE_TERM_CONTAINS = 40;
const SCORE_ALIAS = 30;
const SCORE_BODY = 10;
const PHRASE_BONUS = 5;

/** Split a query into lowercase tokens. */
export function tokenize(query) {
  const normalized = normalizeText(query);
  return normalized ? normalized.split(" ") : [];
}

/** Score one card against the query; 0 means no match. */
function scoreCard(card, tokens, phrase, choseongQuery) {
  const term = normalizeText(card.term);
  const aliases = (card.aliases || []).map(normalizeText);
  if (choseongQuery) {
    const initials = [term, ...aliases].map(toChoseong);
    const needle = phrase.replace(/\s/g, "");
    if (initials.some((i) => i.startsWith(needle))) return SCORE_TERM_PREFIX;
    return initials.some((i) => i.includes(needle)) ? SCORE_TERM_CONTAINS : 0;
  }
  const body = normalizeText([card.term, ...(card.aliases || []), card.system, card.quote, card.gloss].join(" "));
  if (!tokens.every((t) => body.includes(t))) return 0;
  if (term === phrase) return SCORE_EXACT_TERM;
  if (term.startsWith(phrase)) return SCORE_TERM_PREFIX;
  if (term.includes(phrase)) return SCORE_TERM_CONTAINS;
  if (aliases.some((a) => a.includes(phrase))) return SCORE_ALIAS;
  return SCORE_BODY;
}

/** Return matching cards, best first. */
export function searchCards(cards, query) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const phrase = tokens.join(" ");
  const choseongQuery = isChoseongOnly(query);
  return cards
    .map((card) => ({ card, score: scoreCard(card, tokens, phrase, choseongQuery) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.card.term.localeCompare(b.card.term, "ko"))
    .map((r) => r.card);
}

/** Count non-overlapping occurrences of needle in text. */
function countOccurrences(text, needle) {
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Full-text search over all loaded pages (every token must appear on the page). */
export function searchPages(store, query) {
  const tokens = tokenize(query);
  if (tokens.length === 0 || isChoseongOnly(query)) return { hits: [], total: 0 };
  const phrase = tokens.join(" ");
  const hits = [];
  for (const doc of store.manifest.docs) {
    const pages = store.pages.get(doc.id) || [];
    pages.forEach((page, pageIndex) => {
      if (!tokens.every((t) => page.lower.includes(t))) return;
      let score = tokens.reduce((sum, t) => sum + Math.min(countOccurrences(page.lower, t), 20), 0);
      if (tokens.length > 1 && page.lower.includes(phrase)) score += PHRASE_BONUS;
      hits.push({ doc, pageIndex, page, score });
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return { hits: hits.slice(0, MAX_PAGE_HITS), total: hits.length };
}
