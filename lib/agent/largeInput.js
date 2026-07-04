// lib/agent/largeInput.js — Observation-layer divide-and-conquer for huge inputs.
//
// When the user's current message is very large (e.g. a pasted document), split it
// into chunks, extract the feature-relevant content from each in parallel, then merge
// and replace the raw message. Keeps the main call within the token budget without
// losing intent. Framework-neutral: model calls go through the engine port.

const { LARGE_MSG_THRESHOLD, DC_CHUNK_SIZE } = require('./config');
const { extractUserText, lastUserMessage, replaceLastMessageText } = require('./messages');

function splitAtParagraphs(text, chunkSize) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= chunkSize) { chunks.push(remaining); break; }
    let cut = chunkSize;
    const paraIdx = remaining.lastIndexOf('\n\n', chunkSize);
    if (paraIdx > chunkSize * 0.5) cut = paraIdx + 2;
    else {
      const lineIdx = remaining.lastIndexOf('\n', chunkSize);
      if (lineIdx > chunkSize * 0.5) cut = lineIdx + 1;
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  return chunks;
}

const DEFAULT_EXTRACTION_SYSTEM =
  'Extract only the content relevant to building this: questions/items to include, topics, ' +
  'audience, tone, constraints, requirements. Be concise.';

// Returns a possibly-rewritten messages array. Never throws — on any failure the
// original messages pass through unchanged.
async function applyDivideAndConquer({ engine, messages, extractionSystem = DEFAULT_EXTRACTION_SYSTEM }) {
  const rawText = extractUserText(lastUserMessage(messages));
  if (!rawText || rawText.length <= LARGE_MSG_THRESHOLD) return messages;
  try {
    const chunks = splitAtParagraphs(rawText, DC_CHUNK_SIZE);
    const extractions = await Promise.all(
      chunks.map((chunk) =>
        engine.complete({ role: 'extract', system: extractionSystem, prompt: chunk, maxOutputTokens: 300 })
          .then((r) => r.text)
          .catch(() => chunk.slice(0, 500))
      )
    );
    const merged = extractions.filter(Boolean).join('\n\n');
    console.log(`[agent] D&C ${rawText.length}c → ${merged.length}c (${chunks.length} chunks)`);
    return replaceLastMessageText(messages, merged);
  } catch (_) {
    return messages; // silent fallback — original message passes through unchanged
  }
}

module.exports = { splitAtParagraphs, applyDivideAndConquer };
