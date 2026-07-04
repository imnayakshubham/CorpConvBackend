// lib/agent/webSearch.js — Perplexity-style web search for any feature.
//
// Pipeline: rewrite the query (fan-out) → discover URLs (search engine) → crawl pages →
// chunk → rank passages by relevance → return the top passages + their sources. The
// model then writes a cited reply from the passages. Uses only already-installed deps
// (axios, cheerio, duck-duck-scrape) and the engine port — no embeddings, no new deps.

const axios = require('axios');
const cheerio = require('cheerio');
const engine = require('./engine');
const { splitAtParagraphs } = require('./largeInput');

const CRAWL_TIMEOUT_MS = 6000;
const MAX_URLS = 5;
const MAX_PASSAGES = 6;
const PASSAGE_CHARS = 1200;

// Expand the user query into a few focused search queries (the fan-out).
async function rewriteQueries(query) {
  try {
    const { text } = await engine.complete({
      role: 'fast',
      system: 'Rewrite the request into 2-3 focused web-search queries, one per line. No numbering, no prose.',
      prompt: query,
      maxOutputTokens: 120,
    });
    const lines = text.split('\n').map(l => l.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean);
    return Array.from(new Set([query, ...lines])).slice(0, 3);
  } catch {
    return [query];
  }
}

// Run the queries through the search engine, dedupe by hostname+path, keep the top URLs.
async function discover(queries) {
  const { search } = require('duck-duck-scrape');
  const perQuery = await Promise.all(
    queries.map(q => search(q, { safeSearch: 0 }).then(d => d.results || []).catch(() => []))
  );
  const seen = new Set();
  const out = [];
  for (const results of perQuery) {
    for (const r of results) {
      if (!r?.url) continue;
      let key;
      try { const u = new URL(r.url); key = u.hostname + u.pathname; } catch { key = r.url; }
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ url: r.url, title: r.title, snippet: r.description });
      if (out.length >= MAX_URLS) return out;
    }
  }
  return out;
}

function extractText(html) {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, noscript, svg, iframe').remove();
  const text = $('article').text() || $('main').text() || $('body').text();
  return text.replace(/\s+/g, ' ').trim();
}

// Fetch each page in parallel; on any failure fall back to the search snippet.
async function crawl(sources) {
  return Promise.all(sources.map(async (s) => {
    try {
      const res = await axios.get(s.url, {
        timeout: CRAWL_TIMEOUT_MS,
        maxContentLength: 2_000_000,
        responseType: 'text',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HushworkBot/1.0)' },
      });
      return { ...s, text: extractText(String(res.data)) || s.snippet || '' };
    } catch {
      return { ...s, text: s.snippet || '' };
    }
  }));
}

const tokenize = (s) => (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length > 2);

// Rank passages by query term-overlap, length-normalized. Behind a clear signature so a
// semantic/embeddings ranker can replace it later without touching callers.
function rank(query, passages) {
  const qTerms = new Set(tokenize(query));
  if (!qTerms.size) return passages.slice(0, MAX_PASSAGES);
  return passages
    .map((p) => {
      const terms = tokenize(p.text);
      const hits = terms.reduce((n, t) => n + (qTerms.has(t) ? 1 : 0), 0);
      return { ...p, score: hits / Math.sqrt(terms.length + 1) };
    })
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PASSAGES);
}

// Run the full pipeline. Returns { answerContext, sources } for the model + UI.
async function runWebSearch({ query }) {
  try {
    const found = await discover(await rewriteQueries(query));
    if (!found.length) return { query, answerContext: '', sources: [], no_results: true };

    const crawled = await crawl(found);
    const passages = [];
    crawled.forEach((page, idx) => {
      if (!page.text) return;
      for (const chunk of splitAtParagraphs(page.text, PASSAGE_CHARS)) {
        passages.push({ text: chunk.trim(), pageIndex: idx });
      }
    });

    const top = rank(query, passages);
    const usedPages = [...new Set(top.map(p => p.pageIndex))];
    const sources = usedPages.map(i => ({ title: crawled[i].title, url: crawled[i].url }));
    const answerContext = top.map((p, i) => `[${i + 1}] ${p.text}`).join('\n\n');
    return { query, answerContext, sources, no_results: top.length === 0 };
  } catch {
    return { query, answerContext: '', sources: [], error: 'Search temporarily unavailable.' };
  }
}

module.exports = { runWebSearch, rewriteQueries, discover, crawl, rank };
