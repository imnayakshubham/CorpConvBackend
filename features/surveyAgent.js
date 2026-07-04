// features/surveyAgent.js — the SURVEY FeaturePlugin for the generic agent harness.
//
// Everything survey-specific lives here: field types, the tool catalogue, the system
// prompt, and the planner/worker/critic prompts+parsers for the multi-agent build
// pipeline. The harness (lib/agent/*) stays domain-agnostic. To add another feature
// (e.g. polls), create a sibling plugin with the same shape — see lib/agent/types.js.

const { extractJson, clamp } = require('../lib/agent/json');
const { extractUserText, lastUserMessage } = require('../lib/agent/messages');
const { runWebSearch } = require('../lib/agent/webSearch');

// ─── domain config ──────────────────────────────────────────────────────────────

const MAX_FIELDS_IN_PROMPT = Number(process.env.HUSH_AI_MAX_FIELDS_IN_PROMPT || 25);
const MAX_PLAN_PAGES = Number(process.env.HUSH_AI_MAX_PLAN_PAGES || 6);
const MAX_PLAN_QUESTIONS = Number(process.env.HUSH_AI_MAX_PLAN_QUESTIONS || 36);

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

// ─── schema fragments (plain JSON Schema — the engine adapter wraps these) ─────────

const optionItem = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'What the respondent sees.' },
    value: { type: 'string', description: 'The stored value (often same as label).' },
  },
  required: ['label', 'value'],
  additionalProperties: false,
};

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

// ─── system prompt ───────────────────────────────────────────────────────────────

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
The Title and Description above ARE the survey's topic. When the user says "based on the topic/description", "use the topic", "build it out", or similar, build from the Title and Description shown here — do NOT ask the user to provide a topic when one already exists.

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

## DRAFT-FIRST — propose a concrete draft instead of asking
Every change you make is shown to the user as a live preview they can refine, apply, or discard — nothing takes effect until they choose. So a best-effort draft is ALWAYS safe and ALWAYS more useful than a clarifying question. Your default is to DRAFT, not to ask. When wording, tone, length, count, or options are underspecified, pick sensible defaults and draft — do NOT stall the user with questions they can answer just by looking at your draft.
DRAFT NOW (make your single best-effort change via the right tool, this same turn) for any additive or non-destructive request, e.g.:
  • Subjective / quality-based: "write a better description", "improve this", "make it nicer/professional/shorter", "polish the questions" → draft the concrete rewrite at a sensible tone/length and let them refine.
  • Add content: "add a few feedback questions", "add a rating", "add a phone question", "all of them / add them all" → draft the fields with sensible labels, types, and options.
  • Reword or adjust a set ("make all questions friendlier", "align them with the new title") → draft the change across the whole matching set in ONE call.
Optionally pair the draft with suggest_followups offering refinement directions ("Friendlier", "Shorter", "Add ratings") — but the followups NEVER replace or delay the draft.
ASK FIRST (no mutating tool that turn) ONLY when one of these is true:
  • Destructive and loses built work: clear_all_fields, generate_survey on a non-empty survey, delete_field/delete_page on populated content, set_single_step, bulk/batch across many — state the impact and ask to proceed ("This merges all 6 questions onto one page and removes 1 step — go ahead?").
  • Genuinely ambiguous target/set: a reference matches 2+ fields with no way to choose, or a set criterion has no clear rule.
  • A brand-new survey with nothing to build from: it is untitled AND empty (no title, no description, no fields) AND the user gave no topic. If a Title or Description already exists, treat THOSE as the topic and draft from them — never ask for a topic that already exists.
After the user answers a clear "yes" or taps an option, don't re-ask — draft it. For a concrete unambiguous edit ("make the email field required", "delete question 3", "rename page 2 to Demographics"), just draft it directly.

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

// ─── tools (plain JSON-schema inputSchema; web_search executes server-side) ─────────

const tools = {
  add_field: {
    description: 'Append ONE new field. Do not add extra related fields the user did not ask for.',
    inputSchema: {
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

  update_field: {
    description: 'Update ONE existing field. Include in `updates` ONLY the keys the user asked to change (each overwrites the current value). Prefer this over generate_survey when fields exist.',
    inputSchema: {
      type: 'object',
      properties: {
        field_id: { type: 'string', description: 'Exact _id / temp_id from the field list.' },
        updates: fieldUpdates,
      },
      required: ['field_id', 'updates'],
      additionalProperties: false,
    },
  },

  bulk_update_fields: {
    description: 'Apply the SAME change to multiple fields at once. Use only when the user says "all"/"every" or names a clear subset.',
    inputSchema: {
      type: 'object',
      properties: {
        field_ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
        updates: fieldUpdates,
      },
      required: ['field_ids', 'updates'],
      additionalProperties: false,
    },
  },

  batch_edit_fields: {
    description: 'Apply a DIFFERENT change per field across several fields in ONE call (one entry per field). Use for adaptive set revisions like "reword every question" or "fix the ones that do not fit".',
    inputSchema: {
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
    },
  },

  add_fields: {
    description: 'Append MANY new fields in ONE call (purely additive, wipes nothing). Use when several questions are asked for at once; add them all here, never "one at a time".',
    inputSchema: {
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
    },
  },

  clear_all_fields: {
    description: 'Remove EVERY field while keeping title, description and pages. Destructive — confirm first if the survey has fields the user worked on.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },

  delete_field: {
    description: 'Remove ONE field from the survey.',
    inputSchema: {
      type: 'object',
      properties: { field_id: { type: 'string' } },
      required: ['field_id'],
      additionalProperties: false,
    },
  },

  duplicate_field: {
    description: 'Clone an existing field ("add another like X" / "copy question 3").',
    inputSchema: {
      type: 'object',
      properties: {
        field_id: { type: 'string' },
        new_label: { type: 'string', description: 'Optional label for the copy. Defaults to "<original> (copy)".' },
      },
      required: ['field_id'],
      additionalProperties: false,
    },
  },

  reorder_fields: {
    description: 'Reorder fields. Must include EVERY field ID in the desired final order.',
    inputSchema: {
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
    },
  },

  move_field_to_page: {
    description: 'Move a field to a different page (multi-step surveys only).',
    inputSchema: {
      type: 'object',
      properties: {
        field_id: { type: 'string' },
        page_index: { type: 'integer', minimum: 0 },
      },
      required: ['field_id', 'page_index'],
      additionalProperties: false,
    },
  },

  update_survey_metadata: {
    description: 'Change ONLY the survey title and/or description. Never touches fields or pages.',
    inputSchema: {
      type: 'object',
      properties: {
        survey_title: { type: 'string' },
        survey_description: { type: 'string' },
      },
      additionalProperties: false,
    },
  },

  add_page: {
    description: 'Append a new empty step to an already-populated multi-step survey. NOT for generating fresh content.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } }, additionalProperties: false },
  },

  update_page: {
    description: 'Rename one existing page. Does not touch other pages.',
    inputSchema: {
      type: 'object',
      properties: {
        page_index: { type: 'integer', minimum: 0 },
        title: { type: 'string' },
      },
      required: ['page_index', 'title'],
      additionalProperties: false,
    },
  },

  delete_page: {
    description: 'Remove a page. Fields on it move to the previous page (or stay on page 0 if it was the first).',
    inputSchema: {
      type: 'object',
      properties: { page_index: { type: 'integer', minimum: 0 } },
      required: ['page_index'],
      additionalProperties: false,
    },
  },

  enable_multistep: {
    description: 'Convert a single-page survey into multi-step by adding an empty 2nd page. Does NOT generate new questions.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },

  set_single_step: {
    description: 'Collapse a multi-step survey into ONE page (merges all questions onto page 0, removes extra steps). The correct tool for "single step form"/"remove the steps" — never loop delete_page.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },

  generate_survey: {
    description: 'DESTRUCTIVE: wipes ALL fields and pages. Use ONLY when the survey has zero fields OR the user explicitly says "start over"/"replace everything"/"from scratch". For any edit of existing content (including bulk rewrites) use update_field / batch_edit_fields.',
    inputSchema: {
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
    },
  },

  suggest_followups: {
    description:
      'Offer 2–4 short tap-able options the user can pick with one tap. Adapt them to the moment: (a) when you ask a clarifying question, these are the likely ANSWERS (e.g. tone → "Professional", "Friendly", "Playful"; length → "Short", "Medium", "Detailed"); (b) after a change, they can be next steps. Always pair with a question or a brief lead-in in your text. Does not modify the survey.',
    inputSchema: {
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
    },
  },

  web_search: {
    description: 'Search the web for anything that benefits from real-world or up-to-date knowledge — survey best practices, example questions, industry standards, statistics, definitions, current events, how-to guides, product research, or any factual question. Search FIRST, then answer using the returned passages and cite naturally. Do NOT search for pure survey mutations (add field, rename, reorder, delete).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Concise, specific search query, e.g. "best NPS survey questions", "how to write employee satisfaction survey", "what is Net Promoter Score".',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    // Runs the full retrieval pipeline (rewrite → discover → crawl → chunk → rank).
    execute: ({ query }) => runWebSearch({ query }),
  },
};

// ─── routing heuristic ──────────────────────────────────────────────────────────

// Route a from-scratch "build me a big multi-step survey" request to the multi-agent
// pipeline. Only fires on an EMPTY survey + an explicit build ask that is either large
// (a number >= 10) or multi-step. Edits and small builds keep the fast loop.
function wantsLargeBuild(messages, ctx) {
  if ((ctx?.survey_form?.length || 0) > 0) return false;
  const text = extractUserText(lastUserMessage(messages)).toLowerCase();
  if (!text) return false;
  const buildVerb = /(generate|create|build|make|design|draft|put together)/.test(text) &&
    /(survey|form|questionnaire|quiz|poll)/.test(text);
  if (!buildVerb) return false;
  const bigCount = (text.match(/\d{1,3}/g) || []).map(Number).some((n) => n >= 10);
  const multistep = /(multi[- ]?step|multistep|\bsteps?\b|\bpages?\b|sections?)/.test(text);
  return bigCount || (multistep && text.length > 40);
}

// ─── multi-agent build: planner / worker / critic ──────────────────────────────────

const PLANNER_SYSTEM =
  'You plan a survey from a single user request. Output ONLY minified JSON, no prose, no markdown, ' +
  'matching: {"title":string,"description":string,"pages":[{"title":string,"brief":string,"questionCount":number}]}. ' +
  `Use at most ${MAX_PLAN_PAGES} pages and ${MAX_PLAN_QUESTIONS} questions total. Each page is one themed section; ` +
  'brief is a short note on what that section covers; questionCount is 2-9. Title and description are warm and concise. ' +
  'If a current survey topic (title/description) is provided, build the plan AROUND that topic and keep or lightly refine its title — ' +
  'never replace it with an unrelated topic. Never mention how you work or any tool/technology.';

const WORKER_SYSTEM =
  'You write the questions for ONE section of a survey. Output ONLY a minified JSON array, no prose, no markdown. ' +
  `Each item: {"field_type":one of ${JSON.stringify(FIELD_TYPES)},"label":string,"placeholder"?:string,` +
  '"description"?:string,"is_required"?:boolean,"options"?:[{"label":string,"value":string}]}. ' +
  'radio/checkbox MUST have 3-5 distinct options; other types omit options. Labels are questions, not commands. ' +
  'Pick the field_type matching each answer shape. Do not restate other sections.';

const CRITIC_SYSTEM =
  'You review ONE section of a survey for quality. Output ONLY minified JSON {"ok":boolean,"issues":string}. ' +
  'Set ok=false ONLY for real problems: questions off-topic for the section, duplicates, malformed choice fields ' +
  '(radio/checkbox without 3-5 distinct options), or labels that are commands not questions. ' +
  'issues = one short sentence of concrete fixes (empty when ok). Be lenient — minor wording is fine.';

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

const planner = {
  system: PLANNER_SYSTEM,
  buildPrompt(userMessage, ctx = {}) {
    const title = typeof ctx.survey_title === 'string' ? ctx.survey_title.trim() : '';
    const desc = typeof ctx.survey_description === 'string' ? ctx.survey_description.trim() : '';
    const preamble = (title || desc)
      ? `Current survey topic — build the plan around THIS, do not invent a different one.\nTitle: ${title || '(untitled)'}\nDescription: ${desc || '(none)'}\n\n`
      : '';
    return `${preamble}User request: ${userMessage}`;
  },
  // Returns the normalized plan: { title, description, sections: [{ title, brief, count }] }.
  parse(text, ctx = {}) {
    const existingTitle = typeof ctx.survey_title === 'string' ? ctx.survey_title.trim() : '';
    const existingDesc = typeof ctx.survey_description === 'string' ? ctx.survey_description.trim() : '';
    const parsed = extractJson(text) || {};
    let pages = Array.isArray(parsed.pages) ? parsed.pages.slice(0, MAX_PLAN_PAGES) : [];
    if (!pages.length) pages = [{ title: 'Questions', brief: '', questionCount: 5 }];

    // Distribute the global question cap so the total never exceeds MAX_PLAN_QUESTIONS.
    let remaining = MAX_PLAN_QUESTIONS;
    const sections = pages.map((p, i) => {
      const want = clamp(Math.round(Number(p?.questionCount) || 5), 2, 9);
      const left = pages.length - i;
      const count = clamp(want, 1, Math.max(1, remaining - (left - 1) * 1));
      remaining -= count;
      return {
        title: typeof p?.title === 'string' && p.title.trim() ? p.title.trim() : `Step ${i + 1}`,
        brief: typeof p?.brief === 'string' ? p.brief.trim() : '',
        count,
      };
    });

    // An existing title/description wins — keep the survey on its real topic.
    const title = existingTitle || (typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : 'Untitled survey');
    const description = existingDesc || (typeof parsed.description === 'string' ? parsed.description.trim() : '');
    return { title, description, sections };
  },
};

const worker = {
  system: WORKER_SYSTEM,
  buildPrompt(plan, section, i, _ctx, critique) {
    const base =
      `Survey: "${plan.title}". Section ${i + 1}: "${section.title}"` +
      `${section.brief ? ` — ${section.brief}` : ''}. Generate ${section.count} questions for this section only.`;
    return critique ? `${base} Revise to address this feedback: ${critique}` : base;
  },
  parse(text, i) {
    const arr = extractJson(text);
    if (!Array.isArray(arr)) return [];
    return arr.map((f) => coerceField(f, i)).filter(Boolean);
  },
};

const critic = {
  system: CRITIC_SYSTEM,
  buildPrompt(plan, section, i, produced) {
    return `Survey: "${plan.title}". Section: "${section.title}"${section.brief ? ` — ${section.brief}` : ''}. ` +
      `Questions (JSON): ${JSON.stringify(produced)}. Review them.`;
  },
  parse(text) {
    const parsed = extractJson(text);
    if (!parsed || typeof parsed !== 'object') return { ok: true };
    return { ok: parsed.ok !== false, issues: typeof parsed.issues === 'string' ? parsed.issues.trim() : '' };
  },
};

// Turn the plan + generated sections into the ordered tool calls the client applies:
// generate_survey (creates title/pages/page-0 fields), then add_fields per later section.
function assemble(plan, producedSections) {
  const pages = plan.sections.map((s) => ({ title: s.title }));
  const toolCalls = [{
    tool: 'generate_survey',
    input: {
      title: plan.title,
      description: plan.description,
      pages,
      fields: producedSections[0] || [],
    },
  }];
  for (let i = 1; i < producedSections.length; i++) {
    const fields = producedSections[i];
    if (Array.isArray(fields) && fields.length) toolCalls.push({ tool: 'add_fields', input: { fields } });
  }
  return toolCalls;
}

const SUMMARY_SYSTEM =
  'You condense a survey-building chat into a single short recap so the conversation can continue with less history. ' +
  'Write 2–4 plain sentences, third person, covering what the survey now contains and the key decisions made. ' +
  'No preamble, no bullet list, no markdown. Never mention how the assistant works internally — only the survey and the choices.';

// ─── the plugin ─────────────────────────────────────────────────────────────────

/** @type {import('../lib/agent/types').FeaturePlugin} */
module.exports = {
  key: 'survey',
  domainNoun: 'survey',
  contextKey: 'surveyContext',
  brandName: 'Hush AI',
  // Tool gated by the "Search web" toggle — omitted from the catalogue when disabled.
  webSearchToolName: 'web_search',
  buildSystemPrompt,
  tools,
  extractionSystem:
    'Extract survey-relevant content only: questions to ask, topics, audience, tone, constraints, requirements. Be concise.',
  wantsLargeBuild,
  planner,
  worker,
  critic,
  assemble,
  summarySystem: SUMMARY_SYSTEM,

  // Exported for back-compat with anything importing these from the controller.
  FIELD_TYPES,
  FIELD_TYPE_HINTS,
};
