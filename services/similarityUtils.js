const alpha = 0.4, beta = 0.3, gamma = 0.3;

/**
 * Computes the Jaccard similarity between two arrays.
 * @param {Array} setA - First set.
 * @param {Array} setB - Second set.
 * @returns {number} - Jaccard similarity coefficient.
 */
const jaccardSimilarity = (setA, setB) => {
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
};

/**
 * Computes the cosine similarity between two vectors.
 * @param {Array<number>} vecA - First vector.
 * @param {Array<number>} vecB - Second vector.
 * @returns {number} - Cosine similarity.
 */
const cosineSimilarity = (vecA, vecB) => {
    const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
};

/**
 * Computes a similarity score between two users based on hobbies, profession, and embeddings.
 * @param {Object} userA - First user object.
 * @param {Object} userB - Second user object.
 * @param {Array<number>} embedA - Embedding vector for user A.
 * @param {Array<number>} embedB - Embedding vector for user B.
 * @returns {number} - Weighted similarity score.
 */
const computeUserSimilarity = (userA, userB, embedA, embedB) => {
    const hobbySim = jaccardSimilarity(new Set(userA.hobbies || []), new Set(userB.hobbies || []));
    const profSim = userA.profession === userB.profession ? 1 : 0;
    const fieldSim = cosineSimilarity(embedA || [], embedB || []);

    return alpha * hobbySim + beta * profSim + gamma * fieldSim;
};

module.exports = { computeUserSimilarity };
