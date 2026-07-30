// Shared JSON-Schema fragments for the survey tools.
//
// optionItem and fieldUpdates are single shared objects on purpose — several tools reference
// the SAME object so the schema converter can $ref-collapse them. Do not turn these into
// factories; that changes what the model sees.

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

module.exports = { FIELD_TYPES, FIELD_TYPE_HINTS, optionItem, fieldUpdates };
