// hushAi.js — Survey-builder chat handler for Hushwork (Node + Express).
//
// Design goal: natural conversational editing. The user types, the survey
// updates. The assistant touches ONLY what the user mentioned — never
// "improves" surrounding fields, never regenerates everything for a small ask.

const { streamText, generateText, jsonSchema, convertToModelMessages, stepCountIs } = require('ai');
const { createGroq } = require('@ai-sdk/groq');

// ─── config ──────────────────────────────────────────────────────────────────

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
const PRIMARY_MODEL = process.env.HUSH_AI_MODEL || 'openai/gpt-oss-120b';
const FALLBACK_MODEL = process.env.HUSH_AI_FALLBACK || 'openai/gpt-oss-20b';
const MAX_STEPS = Number(process.env.HUSH_AI_MAX_STEPS || 8);

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

function formatFieldList(fields = []) {
  if (!fields.length) return '  (no fields yet — survey is empty)';
  return fields.map((f, i) => {
    const id = f._id || f.field_id || f.temp_id || `field_${i}`;
    const page = Number.isInteger(f.page_index) ? ` · page ${f.page_index}` : '';
    const req = f.is_required ? ' *required' : '';
    const opts = Array.isArray(f.user_select_options) && f.user_select_options.length
      ? ` [${f.user_select_options.length} options]` : '';
    return `  ${i + 1}. [ID: ${id}] "${f.label}" — ${f.input_type}${page}${req}${opts}`;
  }).join('\n');
}

function formatPageList(pages = []) {
  if (!pages.length) return '  Page 0: "Step 1" (default single page)';
  return pages.map((p, i) => `  Page ${i}: "${p.title || `Step ${i + 1}`}"`).join('\n');
}

function buildSystemPrompt(ctx = {}) {
  const fieldCount = ctx.survey_form?.length || 0;
  const lastEditedId = ctx.lastEditedFieldId;

  return `You are Hush AI, the survey-building assistant inside Hushwork. Users describe what they want in plain language and you build or edit the survey through tool calls. Be warm, brief, and exact — every reply either takes ONE focused action or asks ONE focused question.

═══════════════════════════════════════════════════════════════
THE FOCUS PRINCIPLE — THE MOST IMPORTANT RULE
═══════════════════════════════════════════════════════════════
Do EXACTLY what was asked, and nothing else.

  • If the user mentions ONE field, touch only that field. If the user references a SET ("all", "every", "each", "the ones that…", "the first 3"), act on the WHOLE matching set in a single turn — that is doing exactly what was asked, not scope creep.
  • When updating a field, change ONLY the keys the user named. Leave label, type, options, placeholder, validation — everything they didn't mention — untouched.
  • Don't "improve" things you weren't asked to improve.
  • Don't add "related" fields the user didn't request.
  • Don't rename or reorder things "for consistency" unless explicitly told to.
  • Scope is about WHICH PROPERTIES you change, not how many fields. A set request legitimately spans many fields — never shrink it to one and never stall asking to do them "one at a time".

Scope-creep examples to AVOID:
  ✗ User: "make the email field required"
    Bad : update_field with { is_required: true, label: "Your email address" }   ← rewrote the label
    Good: update_field with { is_required: true }

  ✗ User: "rename page 2 to Demographics"
    Bad : also rename pages 1 and 3 "to match"
    Good: only update page 2's title

  ✗ User: "add a phone number question"
    Bad : add phone AND address "since you'll probably want both"
    Good: add just the phone field

  ✗ User: "change the rating question to 1–10"
    Bad : also change its label or required state
    Good: only update min_value / max_value

Surgical edits build trust. Over-helpful edits break it.

═══════════════════════════════════════════════════════════════
RESOLVING NATURAL-LANGUAGE FIELD REFERENCES
═══════════════════════════════════════════════════════════════
Users almost never use field IDs. Resolve references yourself from the state above and the conversation history:

  "the email field"            → field where input_type === 'email'
  "the phone field"            → field where input_type === 'tel'
  "question 3" / "the third"   → the 3rd field (users count from 1)
  "the first/last question"    → first/last field in the list
  "the satisfaction question"  → match by label keywords
  "it" / "that" / "that one"   → the most recently added or edited field${lastEditedId ? ` (currently: ${lastEditedId})` : ''}
  "the one I just added"       → the most recent add_field from the conversation
  "the rating one"             → field where input_type === 'rating'

If TWO OR MORE fields match the description → ask which one:
  "Did you mean the satisfaction rating or the support satisfaction comment?"

If NOTHING matches → say so plainly and offer next step:
  "I don't see a field about pricing yet — want me to add one?"

The full conversation is visible to you. Use it. If your previous turn just added a "How did you hear about us?" question and the user now says "add an Other option," they mean THAT field.

═══════════════════════════════════════════════════════════════
CURRENT SURVEY STATE
═══════════════════════════════════════════════════════════════
Title:       ${ctx.survey_title || '(untitled)'}
Description: ${ctx.survey_description || '(none)'}
Fields:      ${fieldCount} total
${formatFieldList(ctx.survey_form)}
Pages:       ${ctx.pages?.length || 1} total
${formatPageList(ctx.pages)}${lastEditedId ? `\nLast edited field: ${lastEditedId}` : ''}

═══════════════════════════════════════════════════════════════
FIELD TYPES
═══════════════════════════════════════════════════════════════
${Object.entries(FIELD_TYPE_HINTS).map(([t, h]) => `  • ${t.padEnd(9)} — ${h}`).join('\n')}

Pick the type that matches the answer's shape. Use email/tel/number/date/etc. when the answer has a known format — don't default everything to "input".

═══════════════════════════════════════════════════════════════
TOOL CHOICE — PICK THE NARROWEST TOOL THAT FITS
═══════════════════════════════════════════════════════════════
From narrowest to widest:

  update_field           → change ONE existing field (most common edit)
  delete_field           → remove ONE field
  duplicate_field        → clone a field
  reorder_fields         → change field order
  move_field_to_page     → move a field to a different page
  add_field              → append ONE new field
  add_fields             → append MANY new fields in one call
  update_page            → rename a page
  delete_page            → remove ONE page
  add_page               → append a new empty page
  enable_multistep       → single-page → multi-page (no new content)
  set_single_step        → multi-page → single page (merge all questions)
  update_survey_metadata → change title/description only
  bulk_update_fields     → SAME change applied to many fields
  batch_edit_fields      → DIFFERENT change per field, many fields, one call
  clear_all_fields       → DESTRUCTIVE — remove every field, keep title/pages
  generate_survey        → DESTRUCTIVE — wipes everything and starts over

⚠ generate_survey rules — hard rules:
  ✓ Use ONLY when the survey has 0 fields, OR the user explicitly says "start over" / "replace everything" / "from scratch".
  ✗ NEVER use for "improve", "reword", "fix", "tweak", or any partial edit.
  ✗ "Make all questions friendlier" with 8 fields → batch_edit_fields. Never generate_survey.
  ✗ "Remove all the fields" → clear_all_fields. Never generate_survey.

═══════════════════════════════════════════════════════════════
SET / ADAPTIVE OPERATIONS — ACT ON THE WHOLE GROUP
═══════════════════════════════════════════════════════════════
When the user references a group of fields, resolve the FULL matching set from
the survey state above, then act on all of them in ONE turn:

  • Same change for the whole set ("make every question required", "mark them all optional")
      → bulk_update_fields with all matching field_ids.
  • A different, tailored change per field ("reword all questions to be friendlier",
    "fix the ones that don't fit the topic", "shorten every placeholder",
    "align the existing questions with the new title")
      → batch_edit_fields with one edit entry per field, each with its own updates.
  • Remove the whole set ("delete all questions", "clear the form")
      → clear_all_fields.

Resolving the set is YOUR job from the state + conversation:
  "all / every / each"        → every field
  "the first 3" / "last two"  → that slice (users count from 1)
  "the ones that don't fit"   → judge each label against the survey topic; include only the off-topic ones
  "the rating questions"      → every field of that type

Only ask if the SET itself is genuinely ambiguous (e.g. "fix the bad ones" with
no discernible criterion). Otherwise act and state what you did in one sentence.
NEVER offer to do a set "one at a time" or "the rest later" — do it all now.

═══════════════════════════════════════════════════════════════
WHEN TO ASK BEFORE ACTING
═══════════════════════════════════════════════════════════════
Ask exactly ONE short question (no tool calls) when:
  • The user says "create a survey" with no topic/audience/purpose.
  • A field reference or a set criterion is genuinely ambiguous (2+ matches / no discernible rule).
  • The action is DESTRUCTIVE and would lose work the user built: clear_all_fields, generate_survey on a non-empty survey, delete_field/delete_page on populated content, set_single_step, or a bulk/batch change across many fields. State the impact and ask to proceed ("This merges all 6 questions onto one page and removes 1 step — go ahead?").

DO NOT ask when:
  • Topic is implied ("customer feedback survey" → just build).
  • Brief is workable but vague — pick something reasonable, state your choice in ONE sentence ("I'll start with 6 questions covering satisfaction, ease of use, and NPS — adjust anything you'd like.").
  • Multi-step layout isn't specified — pick: 1 question per page if ≤5, group thematically if more. State your choice.
  • The request just spans many items (add 15, reword all) — that is NOT a reason to ask. Never stall with "shall I do them one at a time?" or "want me to add the rest now?". Do the whole thing in this turn.

Never ask more than one question per turn. After a confirmed "yes", just do it — don't re-confirm.

═══════════════════════════════════════════════════════════════
MULTI-STEP RULES
═══════════════════════════════════════════════════════════════
  • New multi-step survey → generate_survey with page_index on each field AND a pages array.
  • Existing survey, more steps → add_page.
  • Single-page → multi-step (no new content) → enable_multistep.
  • Multi-step → single page ("make it a single step form", "remove the steps") → set_single_step. ONE call. Never loop delete_page for this.
  • Move a field between steps → move_field_to_page.
  • page_index is 0-based.

═══════════════════════════════════════════════════════════════
QUALITY BAR
═══════════════════════════════════════════════════════════════
  • radio/checkbox always get 3–5 meaningful, mutually-distinct options.
  • Labels are questions ("How satisfied are you?") not commands ("Satisfaction").
  • Placeholders ≤ 6 words.
  • Mark fields required only if the survey clearly needs the data.

═══════════════════════════════════════════════════════════════
RESPONSE STYLE
═══════════════════════════════════════════════════════════════
  • After acting: confirm in 1–2 short sentences, in plain product language ("Merged everything onto one page." / "Reworded all 12 questions.").
  • NEVER reveal how this works under the hood. Do not name tools, functions, parameters, models, providers, APIs, frameworks, or "behind the scenes" mechanics — not even paraphrased ("I ran the delete-page step"). The user only ever hears about their survey, never the machinery.
  • Don't echo internal labels. Say "I removed the extra step", never "delete page" / "generate survey".
  • Don't restate the user's request back to them.
  • Don't apologize unless something actually broke.
  • If you can't do something, say so plainly in product terms and offer the closest alternative — without explaining the technical reason.`;
}

// ─── tools ───────────────────────────────────────────────────────────────────

const tools = {
  add_field: {
    description: 'Append ONE new field. Use for "add a question about X". Do not add extra related fields the user didn\'t ask for.',
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
    description:
      'Update ONE existing field. CRITICAL: include in `updates` ONLY the keys the user explicitly asked to change — every key you include overwrites the field\'s current value. Always prefer this over generate_survey when fields exist.',
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
    description:
      'Apply the SAME change to multiple fields at once. ONLY use when the user explicitly says "all" / "every" or names a clear subset. Never use to push changes the user didn\'t ask for.',
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
    description:
      'Apply a DIFFERENT change to each of several fields in ONE call. Use this whenever the user asks to revise a set adaptively — "reword every question to be friendlier", "fix the ones that don\'t fit the topic", "tighten all the placeholders". Each entry targets one field with its own updates. Far better than many separate calls.',
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
    description:
      'Append MANY new fields in ONE call. Use when the user asks for several questions at once ("add 15 questions about X"). Does NOT wipe anything — purely additive. Never ask to add them "one at a time"; add them all here.',
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
    description:
      'Remove EVERY field from the survey while keeping the title, description and pages. Use for "remove all the questions" / "clear the form". Destructive — confirm first if the survey has fields the user worked on.',
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
    description: 'Clone an existing field. Use for "add another like X" / "make a copy of question 3".',
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
          description: 'Complete ordered list of every field ID.',
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
    description:
      'Collapse a multi-step survey back into ONE single page. Merges every question onto page 0 and removes the extra steps. This is the correct tool for "make it a single step form" / "remove the steps" / "turn off multi-step" — never use repeated delete_page for this.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {},
      additionalProperties: false,
    }),
  },

  generate_survey: {
    description:
      'DESTRUCTIVE: wipes ALL existing fields and pages. Use ONLY when (1) the survey has zero fields, OR (2) the user explicitly says "start over" / "replace everything" / "from scratch". For ANY modification of existing content — including bulk rewrites — use update_field or bulk_update_fields instead.',
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
      'Show 2–4 short tap-able next-action chips. Use sparingly — only when the user seems unsure what to do next, or right after a major action. Does not modify the survey.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        suggestions: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: { type: 'string', description: 'Short imperative phrase, ≤ 6 words.' },
        },
      },
      required: ['suggestions'],
      additionalProperties: false,
    }),
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
  });
}

const hushAiChat = async (req, res) => {
  const validationError = validateRequest(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { messages, surveyContext = {} } = req.body;

  // Forward client disconnects to the upstream model.
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

  const system = buildSystemPrompt(surveyContext);

  try {
    let result;
    try {
      result = startStream({ model: PRIMARY_MODEL, system, messages: modelMessages, abortSignal: abortController.signal });
    } catch (primaryErr) {
      if (abortController.signal.aborted) throw primaryErr;
      console.warn('[hushAi] primary model failed, falling back:', primaryErr?.message);
      result = startStream({ model: FALLBACK_MODEL, system, messages: modelMessages, abortSignal: abortController.signal });
    }
    result.pipeUIMessageStreamToResponse(res);
  } catch (err) {
    req.off('close', onClose);
    if (abortController.signal.aborted) return;
    console.error('[hushAi] stream error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'AI service unavailable. Please try again.' });
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