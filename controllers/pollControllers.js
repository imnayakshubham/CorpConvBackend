const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { Poll, PollVote } = require('../models/pollModel');
const ActivityEvent = require('../models/activityEventModel');
const cache = require('../redisClient/cacheHelper');
const TTL = require('../redisClient/cacheTTL');

const ENV = process.env.APP_ENV || 'DEV';

function pollListCachePattern() {
    return `${ENV}:polls:list:*`;
}

function pollDetailCacheKey(slug) {
    return cache.generateKey('poll', 'slug', slug);
}

async function computeResults(pollId, options, totalVotes) {
    const agg = await PollVote.aggregate([
        { $match: { poll_id: new mongoose.Types.ObjectId(pollId) } },
        { $unwind: '$option_ids' },
        { $group: { _id: '$option_ids', count: { $sum: 1 } } },
    ]);
    return options.map((opt) => {
        const hit = agg.find((a) => a._id.toString() === opt._id.toString());
        const count = hit?.count ?? 0;
        return {
            option_id: opt._id,
            text: opt.text,
            count,
            percentage: totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0,
        };
    });
}

function safePoll(poll) {
    const obj = poll.toObject ? poll.toObject() : { ...poll };
    delete obj.pin_hash;
    return obj;
}

async function lazyAutoClose(polls) {
    const now = new Date();
    const staleIds = polls
        .filter((p) => p.status === 'open' && p.closeAt && new Date(p.closeAt) < now)
        .map((p) => p._id);
    if (staleIds.length > 0) {
        await Poll.updateMany({ _id: { $in: staleIds } }, { status: 'closed' });
        staleIds.forEach((id) => {
            const poll = polls.find((p) => p._id.toString() === id.toString());
            if (poll) poll.status = 'closed';
        });
    }
}

const createPoll = async (req, res) => {
    try {
        const { question, options, allow_multiple_choice, visibility = 'public', closeAt, pin_enabled, pin } = req.body;
        const created_by = req.user._id;

        const workspace_id = visibility === 'workspace' ? (req.activeOrganizationId || null) : null;

        let pin_hash = null;
        if (pin_enabled && pin) {
            pin_hash = await bcrypt.hash(pin, 10);
        }

        const pollOptions = options.map((text) => ({ text }));

        const newPoll = new Poll({
            created_by,
            question,
            options: pollOptions,
            allow_multiple_choice: !!allow_multiple_choice,
            visibility,
            workspace_id,
            closeAt: closeAt ? new Date(closeAt) : null,
            pin_enabled: !!pin_enabled,
            pin_hash,
        });

        await newPoll.save();

        await cache.delByPattern(pollListCachePattern());
        ActivityEvent.create({ userId: req.user._id, eventType: 'poll_created' }).catch(() => {});

        const populated = await Poll.findById(newPoll._id)
            .populate('created_by', 'public_user_name user_public_profile_pic avatar_config')
            .lean();

        delete populated.pin_hash;

        return res.status(201).json({
            status: 'Success',
            data: populated,
            message: 'Poll created successfully',
        });
    } catch (error) {
        console.error('createPoll error:', error);
        return res.status(500).json({ status: 'Failed', data: null, message: 'Something went wrong' });
    }
};

const getPolls = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);
        const cursor = req.query.cursor || null;
        const sortBy = req.query.sortBy || 'newest';
        const filter = req.query.filter || 'all';
        const userId = req.query.userId || null;
        const activeOrganizationId = req.activeOrganizationId || null;

        const shouldCache = !cursor && filter === 'all' && sortBy !== 'closing-soon';
        const cacheKey = shouldCache ? cache.generateKey('polls', 'list', sortBy, filter) : null;

        if (shouldCache) {
            const cached = await cache.get(cacheKey);
            if (cached) {
                return res.status(200).json({ status: 'Success', data: cached, message: 'Polls fetched (cached)' });
            }
        }

        const now = new Date();
        let matchQuery = { access: true };

        if (activeOrganizationId) {
            matchQuery.$or = [
                { visibility: 'public' },
                { visibility: 'workspace', workspace_id: new mongoose.Types.ObjectId(activeOrganizationId) },
            ];
        } else {
            matchQuery.visibility = 'public';
        }

        if (sortBy === 'closing-soon') {
            matchQuery.status = 'open';
            matchQuery.closeAt = { $ne: null, $gt: now };
        }

        if (filter === 'my-polls' && userId) {
            matchQuery.created_by = new mongoose.Types.ObjectId(userId);
        }

        if (cursor) {
            if (sortBy === 'newest') {
                matchQuery.createdAt = { $lt: new Date(cursor) };
            } else if (sortBy === 'activity') {
                const [votes, ts] = cursor.split('_');
                matchQuery.$or = matchQuery.$or
                    ? matchQuery.$or.map((c) => ({ ...c, $or: [{ total_votes: { $lt: parseInt(votes) } }, { total_votes: parseInt(votes), createdAt: { $lt: new Date(ts) } }] }))
                    : [{ total_votes: { $lt: parseInt(votes) } }, { total_votes: parseInt(votes), createdAt: { $lt: new Date(ts) } }];
            } else if (sortBy === 'closing-soon') {
                matchQuery.closeAt = { ...matchQuery.closeAt, $gt: new Date(cursor) };
            }
        }

        const sortStage = sortBy === 'activity'
            ? { total_votes: -1, createdAt: -1 }
            : sortBy === 'closing-soon'
                ? { closeAt: 1 }
                : { createdAt: -1 };

        const pipeline = [
            { $match: matchQuery },
            { $sort: sortStage },
            { $limit: limit + 1 },
            {
                $lookup: {
                    from: 'users',
                    localField: 'created_by',
                    foreignField: '_id',
                    as: 'created_by',
                    pipeline: [{ $project: { public_user_name: 1, user_public_profile_pic: 1, avatar_config: 1 } }],
                },
            },
            { $unwind: { path: '$created_by', preserveNullAndEmptyArrays: true } },
            { $project: { pin_hash: 0 } },
        ];

        const polls = await Poll.aggregate(pipeline);
        await lazyAutoClose(polls);

        const hasMore = polls.length > limit;
        const resultPolls = hasMore ? polls.slice(0, limit) : polls;
        const last = resultPolls[resultPolls.length - 1];
        let nextCursor = null;
        if (hasMore && last) {
            nextCursor = sortBy === 'activity'
                ? `${last.total_votes}_${last.createdAt}`
                : sortBy === 'closing-soon'
                    ? last.closeAt
                    : last.createdAt;
        }

        const responseData = { polls: resultPolls, nextCursor, hasMore };

        if (shouldCache) {
            await cache.set(cacheKey, responseData, TTL.POLLS_LIST);
        }

        return res.status(200).json({ status: 'Success', data: responseData, message: 'Polls fetched successfully' });
    } catch (error) {
        console.error('getPolls error:', error);
        return res.status(500).json({ status: 'Failed', data: null, message: 'Something went wrong' });
    }
};

const getPollBySlug = async (req, res) => {
    try {
        const { slug } = req.params;
        const cacheKey = pollDetailCacheKey(slug);

        const now = new Date();

        let poll = await Poll.findOne({ slug, access: true }).select('+pin_hash').lean();
        if (!poll) {
            return res.status(404).json({ status: 'Failed', data: null, message: 'Poll not found' });
        }

        // Lazy auto-close
        if (poll.status === 'open' && poll.closeAt && new Date(poll.closeAt) < now) {
            await Poll.findByIdAndUpdate(poll._id, { status: 'closed' });
            poll.status = 'closed';
            await cache.del(cacheKey);
        }

        // Logged-in only enforcement
        if (poll.visibility === 'logged_in' && !req.user) {
            return res.status(403).json({ status: 'Failed', data: null, message: 'Login required to view this poll' });
        }

        // Workspace enforcement
        if (poll.visibility === 'workspace') {
            const activeOrg = req.activeOrganizationId;
            if (!activeOrg || activeOrg.toString() !== poll.workspace_id?.toString()) {
                return res.status(403).json({ status: 'Failed', data: null, message: 'Access restricted to workspace members' });
            }
        }

        // Populate creator
        const creator = await require('../models/userModel')
            .findById(poll.created_by)
            .select('public_user_name user_public_profile_pic avatar_config')
            .lean();

        const responseData = {
            ...poll,
            pin_hash: undefined,
            pin_required: poll.pin_enabled,
            created_by: creator || poll.created_by,
        };
        delete responseData.pin_hash;

        let userVote = null;
        let results = null;

        if (req.user) {
            const userId = req.user._id || req.user.id;
            userVote = await PollVote.findOne({ poll_id: poll._id, voter_id: userId }).lean();
            const isCreator = poll.created_by.toString() === userId.toString();

            if (userVote || poll.status === 'closed' || isCreator) {
                results = await computeResults(poll._id, poll.options, poll.total_votes);
            }
        }

        const fullResponse = { poll: responseData, userVote, results };

        // Only cache if not a private context
        if (poll.visibility === 'public') {
            await cache.set(cacheKey, { poll: responseData, userVote: null, results: poll.status === 'closed' ? await computeResults(poll._id, poll.options, poll.total_votes) : null }, TTL.POLL_DETAIL);
        }

        return res.status(200).json({ status: 'Success', data: fullResponse, message: 'Poll fetched successfully' });
    } catch (error) {
        console.error('getPollBySlug error:', error);
        return res.status(500).json({ status: 'Failed', data: null, message: 'Something went wrong' });
    }
};

const castVote = async (req, res) => {
    try {
        const { id } = req.params;
        const { option_ids, pin } = req.body;
        const userId = req.user._id || req.user.id;
        const now = new Date();

        const poll = await Poll.findOne({ _id: id, access: true }).select('+pin_hash');
        if (!poll) {
            return res.status(404).json({ status: 'Failed', data: null, message: 'Poll not found' });
        }

        // Auto-close check
        if (poll.status === 'open' && poll.closeAt && new Date(poll.closeAt) < now) {
            await Poll.findByIdAndUpdate(poll._id, { status: 'closed' });
            poll.status = 'closed';
        }

        if (poll.status === 'closed') {
            return res.status(403).json({ status: 'Failed', data: null, message: 'This poll has closed' });
        }

        // PIN check
        if (poll.pin_enabled) {
            if (!pin) {
                return res.status(401).json({ status: 'Failed', data: null, message: 'PIN required' });
            }
            const pinMatch = await bcrypt.compare(pin, poll.pin_hash || '');
            if (!pinMatch) {
                return res.status(401).json({ status: 'Failed', data: null, message: 'Invalid PIN' });
            }
        }

        const existingVote = await PollVote.findOne({ poll_id: poll._id, voter_id: userId });

        if (existingVote) {
            // Unvote (toggle)
            const voteCount = existingVote.option_ids.length;
            await PollVote.deleteOne({ _id: existingVote._id });
            await Poll.findByIdAndUpdate(poll._id, { $inc: { total_votes: -voteCount } });
            poll.total_votes = Math.max(0, poll.total_votes - voteCount);

            await cache.del(pollDetailCacheKey(poll.slug));
            await cache.delByPattern(pollListCachePattern());

            const results = await computeResults(poll._id, poll.options, poll.total_votes);
            return res.status(200).json({ status: 'Success', data: { voted: false, results, total_votes: poll.total_votes }, message: 'Vote removed' });
        }

        // Validate option_ids
        const validOptionIds = poll.options.map((o) => o._id.toString());
        const invalidOptions = option_ids.filter((oid) => !validOptionIds.includes(oid));
        if (invalidOptions.length > 0) {
            return res.status(400).json({ status: 'Failed', data: null, message: 'Invalid option IDs' });
        }

        if (!poll.allow_multiple_choice && option_ids.length > 1) {
            return res.status(400).json({ status: 'Failed', data: null, message: 'This poll only allows one vote' });
        }

        await PollVote.create({
            poll_id: poll._id,
            voter_id: userId,
            option_ids: option_ids.map((id) => new mongoose.Types.ObjectId(id)),
        });

        await Poll.findByIdAndUpdate(poll._id, { $inc: { total_votes: option_ids.length } });
        poll.total_votes += option_ids.length;

        await cache.del(pollDetailCacheKey(poll.slug));
        await cache.delByPattern(pollListCachePattern());

        ActivityEvent.create({ userId: req.user._id, eventType: 'poll_voted' }).catch(() => {});

        const results = await computeResults(poll._id, poll.options, poll.total_votes);
        return res.status(200).json({ status: 'Success', data: { voted: true, option_ids, results, total_votes: poll.total_votes }, message: 'Vote cast successfully' });
    } catch (error) {
        console.error('castVote error:', error);
        return res.status(500).json({ status: 'Failed', data: null, message: 'Something went wrong' });
    }
};

const updatePollSettings = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id || req.user.id;

        const poll = await Poll.findOne({ _id: id, access: true }).select('+pin_hash');
        if (!poll) {
            return res.status(404).json({ status: 'Failed', data: null, message: 'Poll not found' });
        }

        if (poll.created_by.toString() !== userId.toString()) {
            return res.status(403).json({ status: 'Failed', data: null, message: 'Only the poll creator can update settings' });
        }

        const updates = {};
        const { closeAt, pin_enabled, pin, visibility, status } = req.body;

        if (closeAt !== undefined) updates.closeAt = closeAt ? new Date(closeAt) : null;
        if (status !== undefined) updates.status = status;

        if (visibility !== undefined) {
            updates.visibility = visibility;
            updates.workspace_id = visibility === 'workspace' ? (req.activeOrganizationId || null) : null;
        }

        if (pin_enabled !== undefined) {
            updates.pin_enabled = pin_enabled;
            if (!pin_enabled) {
                updates.pin_hash = null;
            } else if (pin) {
                updates.pin_hash = await bcrypt.hash(pin, 10);
            }
        } else if (pin) {
            updates.pin_hash = await bcrypt.hash(pin, 10);
        }

        const updated = await Poll.findByIdAndUpdate(id, updates, { new: true })
            .populate('created_by', 'public_user_name user_public_profile_pic avatar_config')
            .lean();

        delete updated.pin_hash;

        await cache.del(pollDetailCacheKey(poll.slug));
        await cache.delByPattern(pollListCachePattern());

        return res.status(200).json({ status: 'Success', data: updated, message: 'Poll settings updated' });
    } catch (error) {
        console.error('updatePollSettings error:', error);
        return res.status(500).json({ status: 'Failed', data: null, message: 'Something went wrong' });
    }
};

const deletePoll = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id || req.user.id;

        const poll = await Poll.findOne({ _id: id, access: true });
        if (!poll) {
            return res.status(404).json({ status: 'Failed', data: null, message: 'Poll not found' });
        }

        if (poll.created_by.toString() !== userId.toString()) {
            return res.status(403).json({ status: 'Failed', data: null, message: 'Only the poll creator can delete this poll' });
        }

        await Poll.findByIdAndUpdate(id, { access: false });

        await cache.del(pollDetailCacheKey(poll.slug));
        await cache.delByPattern(pollListCachePattern());

        return res.status(200).json({ status: 'Success', data: null, message: 'Poll deleted successfully' });
    } catch (error) {
        console.error('deletePoll error:', error);
        return res.status(500).json({ status: 'Failed', data: null, message: 'Something went wrong' });
    }
};

const getPollAnalytics = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id || req.user.id;

        const poll = await Poll.findOne({ _id: id, access: true }).lean();
        if (!poll) {
            return res.status(404).json({ status: 'Failed', data: null, message: 'Poll not found' });
        }

        if (poll.created_by.toString() !== userId.toString()) {
            return res.status(403).json({ status: 'Failed', data: null, message: 'Only the poll creator can view analytics' });
        }

        const cacheKey = cache.generateKey('poll', 'analytics', id);
        const cached = await cache.get(cacheKey);
        if (cached) {
            return res.status(200).json({ status: 'Success', data: cached, message: 'Poll analytics (cached)' });
        }

        const results = await computeResults(poll._id, poll.options, poll.total_votes);

        // Vote timeline by day
        const timeline = await PollVote.aggregate([
            { $match: { poll_id: new mongoose.Types.ObjectId(id) } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    count: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ]);

        const analyticsData = {
            total_votes: poll.total_votes,
            status: poll.status,
            closeAt: poll.closeAt,
            options: results,
            timeline: timeline.map((t) => ({ date: t._id, count: t.count })),
        };

        await cache.set(cacheKey, analyticsData, TTL.POLL_ANALYTICS);

        return res.status(200).json({ status: 'Success', data: analyticsData, message: 'Poll analytics fetched' });
    } catch (error) {
        console.error('getPollAnalytics error:', error);
        return res.status(500).json({ status: 'Failed', data: null, message: 'Something went wrong' });
    }
};

const verifyPin = async (req, res) => {
    try {
        const { id } = req.params;
        const { pin } = req.body;

        const poll = await Poll.findOne({ _id: id, access: true }).select('+pin_hash');
        if (!poll) {
            return res.status(404).json({ status: 'Failed', data: null, message: 'Poll not found' });
        }
        if (!poll.pin_enabled) {
            return res.status(400).json({ status: 'Failed', data: null, message: 'Poll is not PIN protected' });
        }

        const match = await bcrypt.compare(pin, poll.pin_hash || '');
        if (!match) {
            return res.status(401).json({ status: 'Failed', data: null, message: 'Invalid PIN' });
        }

        return res.json({ status: 'Success', data: { valid: true }, message: 'PIN verified' });
    } catch (error) {
        console.error('verifyPin error:', error);
        return res.status(500).json({ status: 'Failed', data: null, message: 'Something went wrong' });
    }
};

module.exports = { createPoll, getPolls, getPollBySlug, castVote, updatePollSettings, deletePoll, getPollAnalytics, verifyPin };
