const FLUSH_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 3000;
const MAX_PENDING_TAGS = 50;
const TAG_PATTERN = /^[a-z]+(:(?!undefined$|null$)[A-Za-z0-9_.-]{1,128})?$/;

let pendingTags = new Set();
let flushTimer = null;
let droppedTags = 0;

const isEnabled = () => Boolean(process.env.REVALIDATE_SECRET && process.env.FRONTEND_URL);

const flush = async () => {
    flushTimer = null;
    const tags = [...pendingTags];
    pendingTags = new Set();
    if (droppedTags > 0) {
        console.warn(`Frontend revalidate: tag limit reached, dropped ${droppedTags} tag(s).`);
        droppedTags = 0;
    }
    if (tags.length === 0) return;

    try {
        const res = await fetch(new URL("/api/revalidate", process.env.FRONTEND_URL), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.REVALIDATE_SECRET}`,
            },
            body: JSON.stringify({ tags }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) console.error(`Frontend revalidate failed with status code: ${res.status}`);
    } catch (error) {
        console.error(`Frontend revalidate error: ${error.message}`);
    }
};

const revalidateFrontend = (...tags) => {
    if (!isEnabled()) return;

    for (const tag of tags.flat()) {
        if (typeof tag !== "string" || !TAG_PATTERN.test(tag)) continue;
        if (pendingTags.size < MAX_PENDING_TAGS || pendingTags.has(tag)) pendingTags.add(tag);
        else droppedTags++;
    }
    if (pendingTags.size > 0 && !flushTimer) {
        flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
        flushTimer.unref();
    }
};

const revalidateOnSuccess = (getTags) => (req, res, next) => {
    res.on("finish", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return;
        try {
            revalidateFrontend(typeof getTags === "function" ? getTags(req) : getTags);
        } catch (error) {
            console.error(`Frontend revalidate tag error: ${error.message}`);
        }
    });
    next();
};

module.exports = { revalidateFrontend, revalidateOnSuccess };
