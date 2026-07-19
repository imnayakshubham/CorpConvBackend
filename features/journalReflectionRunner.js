// features/journalReflectionRunner.js — runs the AI reflection engine and persists the result
// onto a journal entry. Safe to fire-and-forget: any failure (e.g. AI provider not configured)
// is swallowed so the journal save/read path is never affected.

const engine = require('../lib/agent/engine');
const { reflectJournal } = require('./reflectJournal');
const { CompanionJournal } = require('../models/companionModel');

function stripHtml(s) {
    return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function runJournalReflection(entryId, userId, htmlBody) {
    try {
        const text = stripHtml(htmlBody);
        if (text.length < 20) return; // skip trivial entries — not worth an AI call
        const { emotions, themes, insight } = await reflectJournal(engine, text);
        await CompanionJournal.updateOne(
            { _id: entryId, user: userId, access: true },
            { $set: { emotions, themes, reflection: insight, reflectedAt: new Date() } },
        );
    } catch (e) {
        console.warn('[companion] journal reflection failed:', e.message);
    }
}

module.exports = { runJournalReflection };
