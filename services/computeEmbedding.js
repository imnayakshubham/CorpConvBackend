// embeddingService.js
const logger = require("../utils/logger");

let embeddingModel = null;

// Async init function to be called once (e.g. at app startup)
async function initEmbeddingModel() {
    try {
        const res = await fetch(`${process.env.HF_API_END_POINT}health`);
        const data = await res.json()
        console.log(data)
        // res.ok is false even on 404/500
    } catch (err) {
        console.error(err);
    }
}

// Generate embedding for an array of texts (batch)
async function generateEmbeddings(text) {
    try {
        const res = await fetch(`${process.env.HF_API_END_POINT}embed`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': `Bearer ${process.env.HF_API_KEY}`,
            },
            body: JSON.stringify({ text }),
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => res.statusText);
            throw new Error(`Embedding API error: ${res.status} – ${errText}`);
        }

        const data = await res.json();

        if (!data.embedding) {
            throw new Error('Embedding response missing `embedding` field');
        }

        return data?.embedding;
    } catch (error) {
        console.error('Error generating embeddings:', error);
        throw error; // Re-throw so callers can handle it
    }
}

// Generate embedding for single text (array with a single element)

async function generateSingleEmbedding(user_id, text) {
    if (!user_id) {
        throw new Error('generateSingleEmbedding: user_id is required');
    }

    const embeddings = await generateEmbeddings(text);
    console.log("embeddings====>", embeddings)

    return embeddings;
}

module.exports = {
    initEmbeddingModel,
    generateEmbeddings,
    generateSingleEmbedding,
};
