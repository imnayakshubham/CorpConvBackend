// hushAi.js — Survey-builder chat handler for Hushwork (Node + Express).
//
// Design goal: natural conversational editing. The user types, the survey
// updates. The assistant touches ONLY what the user mentioned — never
// "improves" surrounding fields, never regenerates everything for a small ask.

const { streamText, generateText, jsonSchema, convertToModelMessages, stepCountIs, createUIMessageStream, pipeUIMessageStreamToResponse } = require('ai');
const { createGroq } = require('@ai-sdk/groq');
const { randomUUID } = require('crypto');

// ─── config ──────────────────────────────────────────────────────────────────

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
const PRIMARY_MODEL = process.env.HUSH_AI_MODEL || 'openai/gpt-oss-120b';
const FALLBACK_MODEL = process.env.HUSH_AI_FALLBACK || 'openai/gpt-oss-20b';
const MAX_STEPS = Number(process.env.HUSH_AI_MAX_STEPS || 8);

// ─── token budget ──────────────────────────────────────────────────────────────
// Groq's free on-demand tier caps requests at 8000 tokens/min. Every request ships
// the system prompt + all tool schemas + conversation history, so we keep the total
// comfortably under that ceiling: shrink the static floor, then window the history
// into whatever budget is left.
const REQUEST_TOKEN_BUDGET = Number(process.env.HUSH_AI_REQUEST_TOKEN_BUDGET || 6500);
// Conservative post-trim estimate of the tool-schema block (all 18 tools). Used to
// size the history budget without serializing the jsonSchema wrappers each request.
const TOOLS_TOKEN_EST = Number(process.env.HUSH_AI_TOOLS_TOKEN_EST || 2800);
const MAX_FIELDS_IN_PROMPT = Number(process.env.HUSH_AI_MAX_FIELDS_IN_PROMPT || 25);
const MIN_HISTORY_TOKENS = 1200; // never starve history below this, even on huge surveys

// ─── chunked-build config ──────────────────────────────────────────────────────
// Generating a big multi-step survey in ONE generate_survey call blows the free-tier
// per-minute cap. Instead we plan once, then generate one page at a time with small
// calls, paced to stay under the ceiling. These bound each piece and the pacer.
const NORMAL_MAX_OUTPUT_TOKENS = Number(process.env.HUSH_AI_MAX_OUTPUT_TOKENS || 2200);
const PLANNER_MAX_OUTPUT_TOKENS = Number(process.env.HUSH_AI_PLANNER_MAX_OUT || 700);
const PAGE_MAX_OUTPUT_TOKENS = Number(process.env.HUSH_AI_PAGE_MAX_OUT || 1600);
const TPM_BUDGET = Number(process.env.HUSH_AI_TPM_BUDGET || 7000); // headroom under Groq's ~8000/min
const MAX_PLAN_PAGES = Number(process.env.HUSH_AI_MAX_PLAN_PAGES || 6);
const MAX_PLAN_QUESTIONS = Number(process.env.HUSH_AI_MAX_PLAN_QUESTIONS || 36);
const MAX_429_RETRIES = 3;

// Lightweight, dependency-free token estimate. Intentionally conservative
// (~3.5 chars/token) so we under-fill rather than overshoot the real limit.
// Swap for a real tokenizer here if exactness is ever needed.
function estimateTokens(value) {
  if (value == null) return 0;
  let s;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch (_) {
    return 0;
  }
  return Math.ceil((s ? s.length : 0) / 3.5);
}

const FIELD_TYPES = [
  'input', 'email', 'tel', 'number', 'textarea', 'address', 'link',
  'date', 'time', 'radio', 'checkbox', 'rating', 'slider',
];

const FIELD_TYPE_HINTS = {
  input: 'Short free-text answer.',
  email: 'Email address with built-in validation.',
  tel: 'Phone number.',
  number: 'Numeric input.',
  textarea: 'Long free-text (multi-line) answer.',
  address: 'Postal address with autocomplete.',
  link: 'URL input with validation.',
  date: 'Date picker.',
  time: 'Time picker.',
  radio: 'Single-choice from 3–5 options.',
  checkbox: 'Multi-select from 3–7 options.',
  rating: '1–5 or 1–10 rating.',
  slider: 'Numeric slider with min/max.',
};

// ─── schema fragments ────────────────────────────────────────────────────────

const optionItem = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'What the respondent sees.' },
    value: { type: 'string', description: 'The stored value (often same as label).' },
  },
  required: ['label', 'value'],
  additionalProperties: false,
};

// Reusable "updates" object. Critical: the model must include ONLY keys the
// user actually mentioned — every key here OVERWRITES the field's current value.
const fieldUpdates = {
  type: 'object',
  description:
    'Properties to change. Include ONLY keys the user explicitly mentioned — every key here overwrites the existing value.',
  properties: {
    label: { type: 'string', description: 'Question label.' },
    placeholder: { type: 'string', description: 'Hint text inside the input.' },
    description: { type: 'string', description: 'Help text shown below the field.' },
    is_required: { type: 'boolean', description: 'Whether answering is required.' },
    user_select_options: { type: 'array', items: optionItem, description: 'Choices for radio/checkbox.' },
    min_length: { type: 'string', description: 'Min character length.' },
    max_length: { type: 'string', description: 'Max character length.' },
    regex_pattern: { type: 'string', description: 'Regex for custom validation.' },
    error_message: { type: 'string', description: 'Custom validation error.' },
    min_value: { type: 'number', description: 'Minimum value (number/slider/rating).' },
    max_value: { type: 'number', description: 'Maximum value (number/slider/rating).' },
  },
  additionalProperties: false,
};

// ─── system prompt ───────────────────────────────────────────────────────────

function formatFieldRow(f, i) {
  const id = f._id || f.field_id || f.temp_id || `field_${i}`;
  const label = typeof f.label === 'string' && f.label.length > 60 ? `${f.label.slice(0, 57)}...` : f.label;
  const page = Number.isInteger(f.page_index) ? ` p${f.page_index}` : '';
  const req = f.is_required ? ' *req' : '';
  const opts = Array.isArray(f.user_select_options) && f.user_select_options.length
    ? ` [${f.user_select_options.length}opt]` : '';
  return `  ${i + 1}. ${id} ${f.input_type}${page}${req}${opts} "${label}"`;
}

function formatFieldList(fields = []) {
  if (!fields.length) return '  (no fields yet — survey is empty)';
  // Large surveys would blow the token budget if every field is spelled out, so
  // cap the listing and tell the model how many are hidden. It can still act on
  // hidden fields by position/type; ambiguous references resolve via a question.
  if (fields.length > MAX_FIELDS_IN_PROMPT) {
    const shown = fields.slice(0, MAX_FIELDS_IN_PROMPT).map(formatFieldRow).join('\n');
    return `${shown}\n  … +${fields.length - MAX_FIELDS_IN_PROMPT} more fields (ask which one if a reference is unclear).`;
  }
  return fields.map(formatFieldRow).join('\n');
}

function formatPageList(pages = []) {
  if (!pages.length) return '  Page 0: "Step 1" (default single page)';
  return pages.map((p, i) => `  Page ${i}: "${p.title || `Step ${i + 1}`}"`).join('\n');
}

function buildSystemPrompt(ctx = {}) {
  const fieldCount = ctx.survey_form?.length || 0;
  const lastEditedId = ctx.lastEditedFieldId;

  return `You are Hush AI, the survey-building assistant inside Hushwork. Users describe what they want in plain language and you build or edit the survey through tool calls. Be warm, brief, and exact — every reply either takes ONE focused action or asks ONE focused question.

## FOCUS PRINCIPLE (most important)
Do EXACTLY what was asked, nothing else.
  • One field mentioned → touch only it. A SET referenced ("all", "every", "each", "the ones that…", "the first 3") → act on the WHOLE matching set in ONE turn (that is the ask, not scope creep).
  • When updating, change ONLY the keys named; leave label, type, options, placeholder, validation untouched.
  • Don't "improve", add "related" fields, or rename/reorder "for consistency" unless told to.
  • Scope is about WHICH PROPERTIES change, not how many fields. Never shrink a set to one; never stall with "one at a time".
  Example: "make the email field required" → update_field { is_required: true } only — NOT also rewriting the label.

## RESOLVING FIELD REFERENCES
Users rarely use IDs. Resolve from the state below + conversation history:
  "the email/phone/rating field" → field of that input_type · "question 3"/"the third"/"first"/"last" → by position (users count from 1) · "the satisfaction question" → match by label keywords · "it"/"that"/"the one I just added" → most recently added/edited field${lastEditedId ? ` (currently: ${lastEditedId})` : ''}.
  2+ fields match → ask which one. Nothing matches → say so and offer to add it. The full conversation is visible — use it for follow-ups like "add an Other option".

## CURRENT SURVEY STATE
Title: ${ctx.survey_title || '(untitled)'}
Description: ${ctx.survey_description || '(none)'}
Fields: ${fieldCount} total
${formatFieldList(ctx.survey_form)}
Pages: ${ctx.pages?.length || 1} total
${formatPageList(ctx.pages)}${lastEditedId ? `\nLast edited field: ${lastEditedId}` : ''}

## FIELD TYPES
${Object.entries(FIELD_TYPE_HINTS).map(([t, h]) => `  • ${t.padEnd(9)} — ${h}`).join('\n')}
Pick the type matching the answer's shape (email/tel/number/date when the format is known) — don't default everything to "input".

## TOOL CHOICE — pick the narrowest tool that fits
update_field (one field) · delete_field · duplicate_field · reorder_fields · move_field_to_page · add_field (one) · add_fields (many) · update_page (rename) · delete_page · add_page · enable_multistep (single→multi, no new content) · set_single_step (multi→single, merge all) · update_survey_metadata (title/description only) · bulk_update_fields (SAME change to many) · batch_edit_fields (DIFFERENT change per field, many, one call) · clear_all_fields (DESTRUCTIVE: remove all fields, keep title/pages) · generate_survey (DESTRUCTIVE: wipe everything, start over).
generate_survey ONLY when the survey has 0 fields OR the user explicitly says "start over"/"replace everything"/"from scratch". NEVER for improve/reword/fix/tweak/partial edits ("make all questions friendlier" → batch_edit_fields; "remove all fields" → clear_all_fields).
web_search — use for ANY request that benefits from real-world or up-to-date knowledge: survey question examples, best practices, industry standards, statistics, definitions, how-to guidance, product/topic research, or any factual question the user asks. Search FIRST, then respond using the results. Do NOT search for pure mutations (add field, rename, reorder, delete) where no external knowledge is needed. Never mention you searched or name any tool to the user — fold findings naturally into your reply.

## SET / ADAPTIVE OPERATIONS — act on the whole group in ONE turn
Resolve the full matching set from the state ("all/every/each" → every field · "first 3"/"last two" → that slice · "the ones that don't fit" → judge each label vs the topic, include only off-topic ones · "the rating questions" → every field of that type), then:
  • Same change for all → bulk_update_fields with every matching field_id.
  • Different change per field ("reword all to be friendlier", "fix the ones that don't fit", "align with the new title") → batch_edit_fields, one entry per field.
  • Remove the whole set → clear_all_fields.
Only ask if the set criterion itself is genuinely ambiguous. Never offer to do a set "one at a time" or "the rest later".

## ASK BEFORE YOU ASSUME — the default for anything underspecified
Never guess at something the user didn't actually specify. If carrying out the request means inventing wording, tone, length, focus, count, options, or which field/set they mean, STOP and ask first — do not call any tool that turn.
ASK (no mutating tool calls) when the request is:
  • Subjective / quality-based: "write a better description", "improve this", "make it nicer/professional/shorter", "polish the questions". You don't know their intended tone/length/emphasis — ask.
  • Missing parameters: topic/audience/purpose for a new survey; how many questions; what options a choice field should have; what a label should say.
  • Ambiguous target or set: a reference matches 2+ fields, or a set criterion has no clear rule.
  • Destructive and loses built work (clear_all_fields, generate_survey on a non-empty survey, delete_field/delete_page on populated content, set_single_step, bulk/batch across many) — state the impact and ask to proceed ("This merges all 6 questions onto one page and removes 1 step — go ahead?").
HOW TO ASK: gather EVERY question you need in ONE message (a short list is fine — "What tone? Roughly how long? Anything specific to emphasize?"). In that SAME turn call suggest_followups with the most likely answers as tappable options, adapted to what you asked (e.g. tone → "Professional", "Friendly", "Playful"). The user can tap one or type their own; then proceed.
ACT DIRECTLY (no question) only when the request is concrete and unambiguous — a specific target AND a specific change, e.g. "make the email field required", "add a phone number question", "delete question 3", "rename page 2 to Demographics". When you do act, you still propose the change for review (see RESPONSE STYLE); you are not applying it yourself.
After the user answers a clear "yes" or picks an option, don't re-ask — proceed.

## MULTI-STEP
New multi-step → generate_survey with page_index per field + a pages array · existing survey, more steps → add_page · single→multi (no new content) → enable_multistep · multi→single ("single step form"/"remove the steps") → set_single_step (ONE call, never loop delete_page) · move a field → move_field_to_page. page_index is 0-based.

## QUALITY BAR
radio/checkbox get 3–5 meaningful distinct options · labels are questions ("How satisfied are you?") not commands · placeholders ≤ 6 words · mark required only when the data is clearly needed.

## RESPONSE STYLE
  • Your changes are PROPOSALS shown to the user for review before they take effect — you never apply anything yourself. Phrase replies as proposals, not done deals: "Here's a draft description for you to review." / "I've drafted a friendlier version of all 12 questions — take a look." NEVER say "Done." / "Updated." / "I've changed…" as if it already happened.
  • Keep it to 1–2 short sentences in plain product language.
  • NEVER reveal how this works under the hood — no tool/function/parameter/model/provider/API/framework names, not even paraphrased, and never mention "review"/"approve" mechanics by name beyond a natural "take a look". The user only hears about their survey.
  • Don't echo internal labels ("I removed the extra step", never "delete page"). Don't restate the request. Don't apologize unless something broke.
  • If you can't do something, say so plainly in product terms and offer the closest alternative, without the technical reason.`;
}

// ─── tools ───────────────────────────────────────────────────────────────────

const tools = {
  add_field: {
    description: 'Append ONE new field. Do not add extra related fields the user did not ask for.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        field_type: { type: 'string', enum: FIELD_TYPES },
        label: { type: 'string' },
        placeholder: { type: 'string' },
        description: { type: 'string' },
        is_required: { type: 'boolean' },
        options: { type: 'array', items: optionItem, description: 'Required for radio/checkbox.' },
        page_index: { type: 'integer', minimum: 0 },
      },
      required: ['field_type', 'label'],
      additionalProperties: false,
    }),
  },

  update_field: {
    description: 'Update ONE existing field. Include in `updates` ONLY the keys the user asked to change (each overwrites the current value). Prefer this over generate_survey when fields exist.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        field_id: { type: 'string', description: 'Exact _id / temp_id from the field list.' },
        updates: fieldUpdates,
      },
      required: ['field_id', 'updates'],
      additionalProperties: false,
    }),
  },

  bulk_update_fields: {
    description: 'Apply the SAME change to multiple fields at once. Use only when the user says "all"/"every" or names a clear subset.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        field_ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
        updates: fieldUpdates,
      },
      required: ['field_ids', 'updates'],
      additionalProperties: false,
    }),
  },

  batch_edit_fields: {
    description: 'Apply a DIFFERENT change per field across several fields in ONE call (one entry per field). Use for adaptive set revisions like "reword every question" or "fix the ones that do not fit".',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              field_id: { type: 'string', description: 'Exact _id / temp_id from the field list.' },
              updates: fieldUpdates,
            },
            required: ['field_id', 'updates'],
            additionalProperties: false,
          },
        },
      },
      required: ['edits'],
      additionalProperties: false,
    }),
  },

  add_fields: {
    description: 'Append MANY new fields in ONE call (purely additive, wipes nothing). Use when several questions are asked for at once; add them all here, never "one at a time".',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          items: {
            type: 'object',
            properties: {
              field_type: { type: 'string', enum: FIELD_TYPES },
              label: { type: 'string' },
              placeholder: { type: 'string' },
              description: { type: 'string' },
              is_required: { type: 'boolean' },
              options: { type: 'array', items: optionItem, description: 'Required for radio/checkbox.' },
              page_index: { type: 'integer', minimum: 0 },
            },
            required: ['field_type', 'label'],
            additionalProperties: false,
          },
        },
      },
      required: ['fields'],
      additionalProperties: false,
    }),
  },

  clear_all_fields: {
    description: 'Remove EVERY field while keeping title, description and pages. Destructive — confirm first if the survey has fields the user worked on.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {},
      additionalProperties: false,
    }),
  },

  delete_field: {
    description: 'Remove ONE field from the survey.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: { field_id: { type: 'string' } },
      required: ['field_id'],
      additionalProperties: false,
    }),
  },

  duplicate_field: {
    description: 'Clone an existing field ("add another like X" / "copy question 3").',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        field_id: { type: 'string' },
        new_label: { type: 'string', description: 'Optional label for the copy. Defaults to "<original> (copy)".' },
      },
      required: ['field_id'],
      additionalProperties: false,
    }),
  },

  reorder_fields: {
    description: 'Reorder fields. Must include EVERY field ID in the desired final order.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        ordered_field_ids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'Complete ordered list of every field ID in the desired order.',
        },
      },
      required: ['ordered_field_ids'],
      additionalProperties: false,
    }),
  },

  move_field_to_page: {
    description: 'Move a field to a different page (multi-step surveys only).',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        field_id: { type: 'string' },
        page_index: { type: 'integer', minimum: 0 },
      },
      required: ['field_id', 'page_index'],
      additionalProperties: false,
    }),
  },

  update_survey_metadata: {
    description: 'Change ONLY the survey title and/or description. Never touches fields or pages.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        survey_title: { type: 'string' },
        survey_description: { type: 'string' },
      },
      additionalProperties: false,
    }),
  },

  add_page: {
    description: 'Append a new empty step to an already-populated multi-step survey. NOT for generating fresh content.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: { title: { type: 'string' } },
      additionalProperties: false,
    }),
  },

  update_page: {
    description: 'Rename one existing page. Does not touch other pages.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        page_index: { type: 'integer', minimum: 0 },
        title: { type: 'string' },
      },
      required: ['page_index', 'title'],
      additionalProperties: false,
    }),
  },

  delete_page: {
    description: 'Remove a page. Fields on it move to the previous page (or stay on page 0 if it was the first).',
    inputSchema: jsonSchema({
      type: 'object',
      properties: { page_index: { type: 'integer', minimum: 0 } },
      required: ['page_index'],
      additionalProperties: false,
    }),
  },

  enable_multistep: {
    description: 'Convert a single-page survey into multi-step by adding an empty 2nd page. Does NOT generate new questions.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {},
      additionalProperties: false,
    }),
  },

  set_single_step: {
    description: 'Collapse a multi-step survey into ONE page (merges all questions onto page 0, removes extra steps). The correct tool for "single step form"/"remove the steps" — never loop delete_page.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {},
      additionalProperties: false,
    }),
  },

  generate_survey: {
    description: 'DESTRUCTIVE: wipes ALL fields and pages. Use ONLY when the survey has zero fields OR the user explicitly says "start over"/"replace everything"/"from scratch". For any edit of existing content (including bulk rewrites) use update_field / batch_edit_fields.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        pages: {
          type: 'array',
          description: 'Page definitions for multi-step. Length must cover the highest page_index used.',
          items: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
            additionalProperties: false,
          },
        },
        fields: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          items: {
            type: 'object',
            properties: {
              field_type: { type: 'string', enum: FIELD_TYPES },
              label: { type: 'string' },
              placeholder: { type: 'string' },
              description: { type: 'string' },
              is_required: { type: 'boolean' },
              options: { type: 'array', items: optionItem },
              page_index: { type: 'integer', minimum: 0 },
            },
            required: ['field_type', 'label'],
            additionalProperties: false,
          },
        },
      },
      required: ['title', 'fields'],
      additionalProperties: false,
    }),
  },

  suggest_followups: {
    description:
      'Offer 2–4 short tap-able options the user can pick with one tap. Adapt them to the moment: (a) when you ask a clarifying question, these are the likely ANSWERS (e.g. tone → "Professional", "Friendly", "Playful"; length → "Short", "Medium", "Detailed"); (b) after a change, they can be next steps. Always pair with a question or a brief lead-in in your text. Does not modify the survey.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        suggestions: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: { type: 'string', description: 'Short tap-able option — an answer to your question or a next action, ≤ 6 words.' },
        },
      },
      required: ['suggestions'],
      additionalProperties: false,
    }),
  },

  web_search: {
    description: 'Search the web for any information the user asks about or that would improve the response — survey best practices, example questions, industry standards, statistics, definitions, current events, how-to guides, product research, or any factual question. Use whenever the user asks something that benefits from real-world or up-to-date information. Search FIRST, then respond. Do NOT search for pure survey mutations (add field, rename, reorder, delete) where no external knowledge is needed.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Concise, specific search query optimised for web results. Include relevant context, e.g. "best NPS survey questions 2024", "how to write employee satisfaction survey", "what is Net Promoter Score".',
        },
        max_results: {
          type: 'integer',
          minimum: 1,
          maximum: 8,
          description: 'Number of results to return. Default 5.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    }),
    execute: async ({ query, max_results = 5 }) => {
      try {
        const { search } = require('duck-duck-scrape');
        const data = await search(query, { safeSearch: 0 });
        const results = (data.results || [])
          .slice(0, max_results)
          .map(r => ({ title: r.title, snippet: r.description, url: r.url }));
        return { query, results, no_results: results.length === 0 };
      } catch (err) {
        return { query, error: 'Search temporarily unavailable.', results: [] };
      }
    },
  },
};

// ─── validation ──────────────────────────────────────────────────────────────

function validateRequest(body) {
  if (!body || typeof body !== 'object') return 'Request body is required.';
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return 'messages must be a non-empty array.';
  }
  if (body.surveyContext != null && typeof body.surveyContext !== 'object') {
    return 'surveyContext must be an object when provided.';
  }
  return null;
}

// ─── history windowing ─────────────────────────────────────────────────────────
// Keep the most recent turns that fit the history budget. UI messages carry their
// tool-call AND tool-result parts inside a single assistant message, so windowing
// whole messages never orphans a tool result. We also drop any leading non-user
// messages so the kept window opens on a user turn.
function trimMessagesToBudget(messages, historyBudget) {
  if (!Array.isArray(messages) || messages.length <= 1) return messages;

  const kept = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateTokens(messages[i]);
    if (kept.length > 0 && used + cost > historyBudget) break;
    kept.unshift(messages[i]);
    used += cost;
  }
  if (kept.length === messages.length) return messages; // everything fit — keep as-is
  // We dropped older messages, so open the window on a user turn.
  while (kept.length > 1 && kept[0]?.role !== 'user') kept.shift();
  return kept;
}

// ─── error mapping ───────────────────────────────────────────────────────────
// Maps a streaming/API error into a clean, product-language message for the client.
// Never names models, providers, or "under the hood" mechanics (see RESPONSE STYLE).
// True for capacity/size errors we want to soft-handle (rate limits AND requests that
// blew the token ceiling or got truncated). Used for both the client message and the
// chunked-build retry loop.
function isRateLimitLike(error) {
  const status = error?.statusCode ?? error?.status;
  return (
    status === 429 || status === 413 ||
    /rate.?limit|too large|tokens per minute|TPM|context.{0,12}length|max(imum)?.{0,12}tokens|request too large|payload too large|reduce the (length|amount)|finish.?reason.{0,10}length/i
      .test(error?.message || '')
  );
}

function toClientErrorMessage(error) {
  if (isRateLimitLike(error)) {
    const retryAfter = Number(error?.responseHeaders?.['retry-after']);
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? ` Please wait about ${Math.max(30, retryAfter)} seconds before retrying.`
      : ' Please wait about 30 seconds before retrying.';
    return `Hush AI is busy right now.${wait}`;
  }
  return 'Something went wrong reaching Hush AI. Please try again.';
}

// ─── handler ─────────────────────────────────────────────────────────────────

function startStream({ model, system, messages, abortSignal }) {
  return streamText({
    model: groq(model),
    system,
    messages,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    abortSignal,
    temperature: 0.3, // low — we want consistent tool selection, not creativity
    maxOutputTokens: NORMAL_MAX_OUTPUT_TOKENS, // cap so a runaway single call can't blow the per-minute ceiling
  });
}

// ─── chunked build: pacing + retry ───────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Rolling 60s token pacer. The free tier caps tokens/min, so before each model call
// we reserve its estimated cost; if the rolling window is already full we wait for the
// oldest entries to age out. After the call we reconcile with the real usage so the
// estimate drift self-corrects. One pacer per request — calls are sequential.
function createTokenPacer(budgetPerMin = TPM_BUDGET) {
  let entries = []; // { ts, tokens }
  const prune = (now) => { entries = entries.filter((e) => now - e.ts < 60000); };
  return {
    async reserve(estTokens) {
      // Bound a single reservation to the budget so we never wait forever.
      const need = Math.min(estTokens, budgetPerMin);
      // Loop because multiple entries may need to expire before `need` fits.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const now = Date.now();
        prune(now);
        const used = entries.reduce((sum, e) => sum + e.tokens, 0);
        if (used + need <= budgetPerMin || entries.length === 0) break;
        const oldest = entries[0];
        const waitMs = Math.max(250, 60000 - (now - oldest.ts));
        await sleep(waitMs);
      }
      const entry = { ts: Date.now(), tokens: need };
      entries.push(entry);
      return entry;
    },
    record(entry, actualTokens) {
      if (entry && Number.isFinite(actualTokens) && actualTokens > 0) entry.tokens = actualTokens;
    },
  };
}

// Reserve budget, run the call, reconcile usage. On a rate-limit/size error honor
// retry-after and retry up to MAX_429_RETRIES; other errors bubble up.
async function callWithRetry(fn, { pacer, estIn, estOut }) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const entry = await pacer.reserve((estIn || 0) + (estOut || 0));
    try {
      const result = await fn();
      pacer.record(entry, result?.usage?.totalTokens);
      return result;
    } catch (err) {
      lastErr = err;
      if (!isRateLimitLike(err) || attempt === MAX_429_RETRIES) throw err;
      const retryAfter = Number(err?.responseHeaders?.['retry-after']);
      const waitSec = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(30, Math.max(1, retryAfter)) : 3;
      console.warn(`[hushAi] chunked build rate-limited, retrying in ${waitSec}s (attempt ${attempt + 1})`);
      await sleep(waitSec * 1000);
    }
  }
  throw lastErr;
}

// ─── chunked build: generation steps ──────────────────────────────────────────────

const PLANNER_SYSTEM =
  'You plan a survey from a single user request. Output ONLY minified JSON, no prose, no markdown, ' +
  'matching: {"title":string,"description":string,"pages":[{"title":string,"brief":string,"questionCount":number}]}. ' +
  `Use at most ${MAX_PLAN_PAGES} pages and ${MAX_PLAN_QUESTIONS} questions total. Each page is one themed section; ` +
  'brief is a short note on what that section covers; questionCount is 2-9. Title and description are warm and concise. ' +
  'Never mention how you work or any tool/technology.';

const PAGE_SYSTEM =
  'You write the questions for ONE section of a survey. Output ONLY a minified JSON array, no prose, no markdown. ' +
  `Each item: {"field_type":one of ${JSON.stringify(FIELD_TYPES)},"label":string,"placeholder"?:string,` +
  '"description"?:string,"is_required"?:boolean,"options"?:[{"label":string,"value":string}]}. ' +
  'radio/checkbox MUST have 3-5 distinct options; other types omit options. Labels are questions, not commands. ' +
  'Pick the field_type matching each answer shape. Do not restate other sections.';

// Pull the first JSON value (object or array) out of a model reply that may include stray prose.
function extractJson(text) {
  if (typeof text !== 'string') return null;
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Plan the survey: one small call, no tool catalogue. Returns a validated, clamped plan.
async function planSurvey({ userMessage, abortSignal, pacer }) {
  const result = await callWithRetry(
    () => generateText({
      model: groq(PRIMARY_MODEL),
      system: PLANNER_SYSTEM,
      prompt: userMessage,
      temperature: 0.4,
      maxOutputTokens: PLANNER_MAX_OUTPUT_TOKENS,
      abortSignal,
    }),
    { pacer, estIn: estimateTokens(PLANNER_SYSTEM) + estimateTokens(userMessage), estOut: PLANNER_MAX_OUTPUT_TOKENS },
  );

  const parsed = extractJson(result.text) || {};
  let pages = Array.isArray(parsed.pages) ? parsed.pages.slice(0, MAX_PLAN_PAGES) : [];
  if (!pages.length) pages = [{ title: 'Questions', brief: '', questionCount: 5 }];

  // Distribute the global question cap so the total never exceeds MAX_PLAN_QUESTIONS.
  let remaining = MAX_PLAN_QUESTIONS;
  pages = pages.map((p, i) => {
    const want = clamp(Math.round(Number(p?.questionCount) || 5), 2, 9);
    const left = pages.length - i;
    const count = clamp(want, 1, Math.max(1, remaining - (left - 1) * 1));
    remaining -= count;
    return {
      title: typeof p?.title === 'string' && p.title.trim() ? p.title.trim() : `Step ${i + 1}`,
      brief: typeof p?.brief === 'string' ? p.brief.trim() : '',
      questionCount: count,
    };
  });

  return {
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : 'Untitled survey',
    description: typeof parsed.description === 'string' ? parsed.description.trim() : '',
    pages,
  };
}

// Coerce one raw field spec into a valid field on the given page.
function coerceField(raw, pageIndex) {
  if (!raw || typeof raw !== 'object') return null;
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  if (!label) return null;
  const field_type = FIELD_TYPES.includes(raw.field_type) ? raw.field_type : 'input';
  const field = { field_type, label, page_index: pageIndex };
  if (typeof raw.placeholder === 'string') field.placeholder = raw.placeholder;
  if (typeof raw.description === 'string') field.description = raw.description;
  if (typeof raw.is_required === 'boolean') field.is_required = raw.is_required;
  if ((field_type === 'radio' || field_type === 'checkbox') && Array.isArray(raw.options)) {
    const options = raw.options
      .filter((o) => o && typeof o.label === 'string' && o.label.trim())
      .map((o) => ({ label: o.label.trim(), value: typeof o.value === 'string' && o.value.trim() ? o.value.trim() : o.label.trim() }));
    if (options.length) field.options = options;
  }
  return field;
}

// Generate the fields for ONE page. Returns a (possibly empty) array of valid fields.
async function generatePageFields({ surveyTitle, page, pageIndex, abortSignal, pacer }) {
  const prompt =
    `Survey: "${surveyTitle}". Section ${pageIndex + 1}: "${page.title}"` +
    `${page.brief ? ` — ${page.brief}` : ''}. Generate ${page.questionCount} questions for this section only.`;
  const result = await callWithRetry(
    () => generateText({
      model: groq(PRIMARY_MODEL),
      system: PAGE_SYSTEM,
      prompt,
      temperature: 0.4,
      maxOutputTokens: PAGE_MAX_OUTPUT_TOKENS,
      abortSignal,
    }),
    { pacer, estIn: estimateTokens(PAGE_SYSTEM) + estimateTokens(prompt), estOut: PAGE_MAX_OUTPUT_TOKENS },
  );

  const arr = extractJson(result.text);
  if (!Array.isArray(arr)) return [];
  return arr.map((f) => coerceField(f, pageIndex)).filter(Boolean);
}

// ─── chunked build: orchestrator ────────────────────────────────────────────────
// Build a large multi-step survey in small, paced pieces and stream them as tool-call
// parts the existing client already understands (generate_survey for page 0, then
// add_fields per later page). Wire-identical to a normal streamText UI-message stream.
function streamChunkedSurvey({ res, userMessage, abortSignal }) {
  const stream = createUIMessageStream({
    onError: (error) => {
      if (!abortSignal.aborted) console.error('[hushAi] chunked build error:', error?.message || error);
      return toClientErrorMessage(error);
    },
    execute: async ({ writer }) => {
      const pacer = createTokenPacer();
      const textId = randomUUID();
      writer.write({ type: 'text-start', id: textId });
      const say = (delta) => writer.write({ type: 'text-delta', id: textId, delta });
      const emitTool = (toolName, input) => {
        const toolCallId = `srv_${randomUUID()}`;
        // tool-input-start must precede tool-input-available; no tool-output part —
        // the client resolves the call itself via addToolOutput (tools have no execute).
        writer.write({ type: 'tool-input-start', toolCallId, toolName });
        writer.write({ type: 'tool-input-available', toolCallId, toolName, input });
      };

      say('Putting together the structure…');
      const plan = await planSurvey({ userMessage, abortSignal, pacer });
      if (abortSignal.aborted) return;

      const page0Fields = await generatePageFields({ surveyTitle: plan.title, page: plan.pages[0], pageIndex: 0, abortSignal, pacer });
      if (abortSignal.aborted) return;
      emitTool('generate_survey', {
        title: plan.title,
        description: plan.description,
        pages: plan.pages.map((p) => ({ title: p.title })),
        fields: page0Fields,
      });
      say(` Started "${plan.title}" with ${plan.pages.length} step${plan.pages.length === 1 ? '' : 's'}.`);

      for (let i = 1; i < plan.pages.length; i++) {
        if (abortSignal.aborted) return;
        say(` Adding section ${i + 1}…`);
        const fields = await generatePageFields({ surveyTitle: plan.title, page: plan.pages[i], pageIndex: i, abortSignal, pacer });
        if (fields.length) emitTool('add_fields', { fields });
      }

      say(' All set — take a look.');
      writer.write({ type: 'text-end', id: textId });
    },
  });

  pipeUIMessageStreamToResponse({ response: res, stream });
}

// Cheap heuristic: route a from-scratch "build me a big multi-step survey" request to the
// chunked orchestrator. Only fires on an EMPTY survey + an explicit build ask that is
// either large (a number >= 10) or multi-step. Edits and small builds keep the fast path.
function extractUserText(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts.filter((p) => p?.type === 'text' && typeof p.text === 'string').map((p) => p.text).join(' ');
}

function wantsLargeBuild(messages, surveyContext) {
  if ((surveyContext?.survey_form?.length || 0) > 0) return false;
  const lastUser = [...messages].reverse().find((m) => m?.role === 'user');
  const text = extractUserText(lastUser).toLowerCase();
  if (!text) return false;
  const buildVerb = /(generate|create|build|make|design|draft|put together)/.test(text) &&
    /(survey|form|questionnaire|quiz|poll)/.test(text);
  if (!buildVerb) return false;
  const bigCount = (text.match(/\d{1,3}/g) || []).map(Number).some((n) => n >= 10);
  const multistep = /(multi[- ]?step|multistep|\bsteps?\b|\bpages?\b|sections?)/.test(text);
  return bigCount || (multistep && text.length > 40);
}

// ─── D&C large-message helpers ────────────────────────────────────────────────
const LARGE_MSG_THRESHOLD = 3500; // ~1000 tokens — trigger D&C above this
const DC_CHUNK_SIZE = 1800;        // ~500 tokens per extraction chunk

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

function replaceLastMessageText(msgs, newText) {
  if (!msgs || !msgs.length) return msgs;
  const last = msgs[msgs.length - 1];
  let updated;
  if (typeof last.content === 'string') {
    updated = { ...last, content: newText };
  } else if (Array.isArray(last.parts)) {
    updated = { ...last, parts: last.parts.map((p) => (p?.type === 'text' ? { ...p, text: newText } : p)) };
  } else {
    updated = { ...last, content: newText };
  }
  return [...msgs.slice(0, -1), updated];
}

const hushAiChat = async (req, res) => {
  const validationError = validateRequest(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  let { messages, surveyContext = {} } = req.body; // `let` — D&C may replace last message

  // Forward client disconnects to the upstream model.
  const abortController = new AbortController();
  const onClose = () => abortController.abort();
  req.on('close', onClose);
  res.on('finish', () => req.off('close', onClose));

  // D&C preprocessing: if the user's current message is very large (e.g. a pasted
  // document), split it into chunks and extract survey-relevant content from each in
  // parallel, then merge and replace the raw message. This keeps the main call within
  // the model's token budget without losing the intent.
  {
    const lastUserMsg = [...messages].reverse().find((m) => m?.role === 'user');
    const rawText = extractUserText(lastUserMsg);
    if (rawText && rawText.length > LARGE_MSG_THRESHOLD) {
      try {
        const chunks = splitAtParagraphs(rawText, DC_CHUNK_SIZE);
        const extractions = await Promise.all(
          chunks.map((chunk) =>
            generateText({
              model: groq(FALLBACK_MODEL),
              system: 'Extract survey-relevant content only: questions to ask, topics, audience, tone, constraints, requirements. Be concise.',
              prompt: chunk,
              maxTokens: 300,
            })
              .then((r) => r.text)
              .catch(() => chunk.slice(0, 500))
          )
        );
        const merged = extractions.filter(Boolean).join('\n\n');
        messages = replaceLastMessageText(messages, merged);
        console.log(`[hushAI] D&C ${rawText.length}c → ${merged.length}c (${chunks.length} chunks)`);
      } catch {
        // silent fallback — original message passes through unchanged
      }
    }
  }

  // Large from-scratch multi-step builds can't fit one generate_survey call under the
  // per-minute token cap, so build them in small paced pieces instead of the single
  // agentic stream. Edits and small builds fall through to the fast path below.
  if (wantsLargeBuild(messages, surveyContext)) {
    const lastUser = [...messages].reverse().find((m) => m?.role === 'user');
    const userMessage = extractUserText(lastUser);
    console.log('[hushAi] chunked build');
    try {
      streamChunkedSurvey({ res, userMessage, abortSignal: abortController.signal });
      return;
    } catch (err) {
      req.off('close', onClose);
      if (abortController.signal.aborted) return;
      console.error('[hushAi] chunked build setup error:', err);
      if (!res.headersSent) return res.status(500).json({ error: toClientErrorMessage(err) });
      try { res.end(); } catch (_) { /* noop */ }
      return;
    }
  }

  // Build the system prompt first so we can size the static floor, then window the
  // conversation into whatever budget remains under the per-request token ceiling.
  const system = buildSystemPrompt(surveyContext);
  const staticFloor = estimateTokens(system) + TOOLS_TOKEN_EST;
  const historyBudget = Math.max(MIN_HISTORY_TOKENS, REQUEST_TOKEN_BUDGET - staticFloor);
  const windowed = trimMessagesToBudget(messages, historyBudget);

  let modelMessages;
  try {
    modelMessages = await convertToModelMessages(windowed);
  } catch (err) {
    req.off('close', onClose);
    return res.status(400).json({ error: 'Invalid messages format.' });
  }
  if (!modelMessages.length) {
    req.off('close', onClose);
    return res.status(400).json({ error: 'No valid messages found.' });
  }

  const estTotal = staticFloor + estimateTokens(windowed);
  console.log(
    `[hushAi] est tokens ~${estTotal} (floor ${staticFloor} + history ${estTotal - staticFloor}); ` +
    `kept ${windowed.length}/${messages.length} messages`,
  );
  if (estTotal > REQUEST_TOKEN_BUDGET) {
    // Floor + a single oversized message already exceeds budget; nothing left to
    // trim. We still attempt — onError below turns any upstream rejection into a
    // clean, user-facing message instead of a dropped connection.
    console.warn(`[hushAi] est tokens ~${estTotal} exceeds budget ${REQUEST_TOKEN_BUDGET}`);
  }

  try {
    const result = startStream({ model: PRIMARY_MODEL, system, messages: modelMessages, abortSignal: abortController.signal });
    // onError maps async stream/API errors (e.g. Groq rate limits) into a clean
    // message sent down the stream, so the socket closes gracefully — no
    // ERR_CONNECTION_CLOSED, and the client can surface it with a retry.
    result.pipeUIMessageStreamToResponse(res, {
      onError: (error) => {
        if (!abortController.signal.aborted) console.error('[hushAi] stream error:', error?.message || error);
        return toClientErrorMessage(error);
      },
    });
  } catch (err) {
    req.off('close', onClose);
    if (abortController.signal.aborted) return;
    console.error('[hushAi] stream setup error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: toClientErrorMessage(err) });
    } else {
      try { res.end(); } catch (_) { /* noop */ }
    }
  }
};

const SUMMARY_SYSTEM =
  'You condense a survey-building chat into a single short recap so the conversation can continue with less history. ' +
  'Write 2–4 plain sentences, third person, covering what the survey now contains and the key decisions made. ' +
  'No preamble, no bullet list, no markdown. Never mention how the assistant works internally — only the survey and the choices.';

const hushAiSummarize = async (req, res) => {
  const validationError = validateRequest(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { messages } = req.body;

  const abortController = new AbortController();
  const onClose = () => abortController.abort();
  req.on('close', onClose);

  let modelMessages;
  try {
    modelMessages = await convertToModelMessages(messages);
  } catch (err) {
    req.off('close', onClose);
    return res.status(400).json({ error: 'Invalid messages format.' });
  }
  if (!modelMessages.length) {
    req.off('close', onClose);
    return res.status(400).json({ error: 'No valid messages found.' });
  }

  const run = (model) =>
    generateText({
      model: groq(model),
      system: SUMMARY_SYSTEM,
      messages: modelMessages,
      abortSignal: abortController.signal,
      temperature: 0.3,
    });

  try {
    let result;
    try {
      result = await run(PRIMARY_MODEL);
    } catch (primaryErr) {
      if (abortController.signal.aborted) throw primaryErr;
      console.warn('[hushAi] summarize primary failed, falling back:', primaryErr?.message);
      result = await run(FALLBACK_MODEL);
    }
    req.off('close', onClose);
    return res.json({ summary: (result.text || '').trim() });
  } catch (err) {
    req.off('close', onClose);
    if (abortController.signal.aborted) return;
    console.error('[hushAi] summarize error:', err);
    return res.status(500).json({ error: 'AI service unavailable. Please try again.' });
  }
};

module.exports = {
  hushAiChat,
  hushAiSummarize,
  // exported for tests / reuse
  buildSystemPrompt,
  validateRequest,
  tools,
  FIELD_TYPES,
  FIELD_TYPE_HINTS,
};