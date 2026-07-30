// Canonical question/field types shared across features (Litmus, Survey, …).
// SINGLE SOURCE OF TRUTH: the Mongoose enum, the Zod enum, and the frontend registry all
// derive from this list. To add a new type later, add it here (and its capability meta +
// a renderer on the frontend) and every consumer picks it up — no per-feature switch edits.

const QUESTION_TYPES = ['text', 'single_choice', 'rating'];

// What each type needs. Extensible: a new type is one more entry.
//  - hasOptions:     needs a list of answer options (single_choice)
//  - hasRatingScale: needs a numeric rating scale (rating)
const QUESTION_TYPE_META = {
    text: { hasOptions: false, hasRatingScale: false },
    single_choice: { hasOptions: true, hasRatingScale: false },
    rating: { hasOptions: false, hasRatingScale: true },
};

module.exports = { QUESTION_TYPES, QUESTION_TYPE_META };
