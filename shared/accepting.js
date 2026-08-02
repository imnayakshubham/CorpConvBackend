// Whether a shareable doc is currently open for responses.
//
// Works for anything with a `status` and a `response_settings` block. `start_date` is
// supported even though Litmus has no UI for it, so the next feature that wants one does
// not write a third copy of this.

function computeAccepting(doc, count) {
    if (doc.status !== 'published' || doc.access === false) {
        return { accepting_responses: false, closed_reason: 'unavailable' };
    }

    const rs = doc.response_settings || {};
    const now = new Date();

    if (rs.start_date && new Date(rs.start_date) > now) {
        return { accepting_responses: false, closed_reason: 'not_started' };
    }
    if (rs.closes_at && new Date(rs.closes_at) < now) {
        return { accepting_responses: false, closed_reason: 'ended' };
    }

    const received = count ?? doc.submission_count ?? 0;
    if (rs.max_responses && received >= rs.max_responses) {
        return { accepting_responses: false, closed_reason: 'full' };
    }

    return { accepting_responses: true, closed_reason: null };
}

module.exports = { computeAccepting };
