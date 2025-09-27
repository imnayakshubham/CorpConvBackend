// services/similarity.js

function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
}

function norm(a) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * a[i];
    return Math.sqrt(s);
}

function cosine(a, b) {
    if (!a || !b) return null;
    if (a.length !== b.length) return null;
    const denom = norm(a) * norm(b);
    if (denom === 0) return 0;
    return dot(a, b) / denom;
}

/**
 * final score combining similarity, recency, and online boost
 * recencyScore: 0..1 normalized
 * onlineBoost: 0 or small value
 */
function score(similarity, recencyScore = 0, online = false) {
    const onlineBoost = online ? 0.05 : 0;
    return similarity * 0.8 + recencyScore * 0.15;
}

module.exports = { cosine, score };
