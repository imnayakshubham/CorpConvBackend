const Comment = require("../models/commentModel");
const Post = require("../models/postModel");
const { createRedisKeyFromQuery, addOrUpdateCachedDataInRedis, syncRedisPostCache } = require("../redisClient/redisUtils");
const getRedisInstance = require("../redisClient/redisClient");
const { populateChildComments } = require("../utils/utils");
const { getIo } = require("../utils/socketManger");

const postComments = async (req, res) => {
    try {
        const { comment, post_id, parent_comment_id, comment_id } = req.body;
        const commented_by = req.user._id;

        // Create a new comment
        const newComment = await Comment.create({
            comment,
            commented_by,
            post_id,
            parent_comment_id,
        });

        // Update Post's comments array
        const post = await Post.findByIdAndUpdate(
            post_id,
            { $addToSet: { comments: newComment._id } },
            { new: true }
        );

        // Populate comments in the updated post
        const updatedPost = await Post.findById(post_id).populate("posted_by", "public_user_name is_email_verified public_user_profile_pic avatar").populate({
            path: 'comments',
            match: { access: { $ne: false } },
        });

        await populateChildComments(updatedPost.comments)

        const dataToSync = {
            ...updatedPost.toObject(),
            commentCount: (updatedPost.comments || []).length
        };

        // Sync Redis Cache
        const redisKeyAll = createRedisKeyFromQuery({ category: "all" }, `${process.env.APP_ENV}_post_`);
        const redisKeyCat = createRedisKeyFromQuery({ category: post.category }, `${process.env.APP_ENV}_post_`);
        const redisKeyUser = createRedisKeyFromQuery({ posted_by: post.posted_by }, `${process.env.APP_ENV}_post_`);
        await syncRedisPostCache([redisKeyAll, redisKeyCat, redisKeyUser], "UPDATE", dataToSync);

        const io = getIo();
        io.emit('listen_post_update', updatedPost);

        res.status(201).json({
            status: 'Success',
            message: 'Comment added successfully',
            data: updatedPost,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

const postReplyComments = async (req, res) => {
    try {
        const { post_id, parent_comment_id, comment_id, comment } = req.body;
        const commented_by = req.user._id;

        // Create a new comment
        const newComment = await Comment.create({
            comment,
            commented_by,
            post_id,
            parent_comment_id: comment_id,
        });

        // new comment to a child comment of comment_id

        const post = await Post.findByIdAndUpdate(post_id, { $addToSet: { comments: newComment._id } }, { new: true });
        await Comment.findByIdAndUpdate(comment_id, { $addToSet: { nested_comments: newComment._id } }, { new: true });

        const updatedPost = await Post.findById(post_id).populate("posted_by", "public_user_name is_email_verified public_user_profile_pic avatar").populate({
            path: 'comments',
            match: { access: { $ne: false } },
        });
        await populateChildComments(updatedPost.comments)

        const dataToSync = {
            ...updatedPost.toObject(),
            commentCount: (updatedPost.comments || []).length
        };

        // Sync Redis Cache
        const redisKeyAll = createRedisKeyFromQuery({ category: "all" }, `${process.env.APP_ENV}_post_`);
        const redisKeyCat = createRedisKeyFromQuery({ category: updatedPost.category }, `${process.env.APP_ENV}_post_`);
        const redisKeyUser = createRedisKeyFromQuery({ posted_by: updatedPost.posted_by._id }, `${process.env.APP_ENV}_post_`);
        await syncRedisPostCache([redisKeyAll, redisKeyCat, redisKeyUser], "UPDATE", dataToSync);

        const io = getIo();
        io.emit('listen_post_update', updatedPost);

        res.status(201).json({
            status: 'Success',
            message: 'Comment added successfully',
            data: updatedPost,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

const getComment = async (req, res) => {
    try {
        const post_id = req.params.post_id;
        const comments = await Comment.find({ post_id }).populate('commented_by nested_comments');

        res.json(comments);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

const likeComment = async (req, res) => {
    const { comment_id, post_id } = req.body;
    try {
        const comment = await Comment.findById(comment_id);
        if (!comment) return res.status(404).json({ message: "Comment not found" });

        let updatedData;
        if (comment.upvoted_by.some(id => id.toString() === req.user._id.toString())) {
            updatedData = await Comment.findByIdAndUpdate(comment_id, { $pull: { upvoted_by: req.user._id } }, { new: true });
        } else {
            await Comment.findByIdAndUpdate(comment_id, { $pull: { downvoted_by: req.user._id } });
            updatedData = await Comment.findByIdAndUpdate(comment_id, { $addToSet: { upvoted_by: req.user._id } }, { new: true });
        }

        const updatedPost = await Post.findById(post_id).populate("posted_by", "public_user_name is_email_verified public_user_profile_pic avatar").populate({
            path: 'comments',
            match: { access: { $ne: false } },
        });
        await populateChildComments(updatedPost.comments)

        const redisKeyAll = createRedisKeyFromQuery({ category: "all" }, `${process.env.APP_ENV}_post_`);
        const redisKeyCat = createRedisKeyFromQuery({ category: updatedPost.category }, `${process.env.APP_ENV}_post_`);
        const redisKeyUser = createRedisKeyFromQuery({ posted_by: updatedPost.posted_by._id }, `${process.env.APP_ENV}_post_`);
        const dataToSync = { ...updatedPost.toObject(), commentCount: (updatedPost.comments || []).length };
        await syncRedisPostCache([redisKeyAll, redisKeyCat, redisKeyUser], "UPDATE", dataToSync);

        const io = getIo();
        io.emit('listen_comment_like', { comment: updatedData, user_id: req.user._id });
        io.emit('listen_post_update', updatedPost);

        return res.status(200).json({ status: 'Success', data: updatedPost, message: "Comment upvoted successfully" });
    } catch (error) {
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

const getCommentsByPostId = async (req, res) => {
    try {
        const post_id = req.params.post_id;
        const comments = await Comment.find({ post_id, parent_comment_id: null, access: { $ne: false } })
            .populate('commented_by', 'public_user_name is_email_verified public_user_profile_pic avatar')
            .populate({
                path: 'nested_comments',
                match: { access: { $ne: false } }
            })
            .sort({ commented_at: -1 });

        await populateChildComments(comments);

        res.status(200).json({
            status: 'Success',
            data: comments,
            message: 'Comments fetched successfully',
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

const downvoteComment = async (req, res) => {
    const { comment_id, post_id } = req.body;
    try {
        const comment = await Comment.findById(comment_id);
        if (!comment) return res.status(404).json({ message: "Comment not found" });

        let updatedData;
        if (comment.downvoted_by.some(id => id.toString() === req.user._id.toString())) {
            updatedData = await Comment.findByIdAndUpdate(comment_id, { $pull: { downvoted_by: req.user._id } }, { new: true });
        } else {
            await Comment.findByIdAndUpdate(comment_id, { $pull: { upvoted_by: req.user._id } });
            updatedData = await Comment.findByIdAndUpdate(comment_id, { $addToSet: { downvoted_by: req.user._id } }, { new: true });
        }

        const updatedPost = await Post.findById(post_id).populate("posted_by", "public_user_name is_email_verified public_user_profile_pic avatar").populate({
            path: 'comments',
            match: { access: { $ne: false } },
        });
        await populateChildComments(updatedPost.comments)

        const redisKeyAll = createRedisKeyFromQuery({ category: "all" }, `${process.env.APP_ENV}_post_`);
        const redisKeyCat = createRedisKeyFromQuery({ category: updatedPost.category }, `${process.env.APP_ENV}_post_`);
        const redisKeyUser = createRedisKeyFromQuery({ posted_by: updatedPost.posted_by._id }, `${process.env.APP_ENV}_post_`);
        const dataToSync = { ...updatedPost.toObject(), commentCount: (updatedPost.comments || []).length };
        await syncRedisPostCache([redisKeyAll, redisKeyCat, redisKeyUser], "UPDATE", dataToSync);

        const io = getIo();
        io.emit('listen_comment_downvote', { comment: updatedData, user_id: req.user._id });
        io.emit('listen_post_update', updatedPost);

        return res.status(200).json({ status: 'Success', data: updatedPost, message: "Comment downvoted successfully" });
    } catch (error) {
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

const awardComment = async (req, res) => {
    try {
        const { comment_id, awardType, post_id } = req.body;
        const comment = await Comment.findById(comment_id);
        if (!comment) return res.status(404).json({ message: "Comment not found" });

        if (!Array.isArray(comment.awards)) {
            comment.awards = [];
        }

        const existingAwardIndex = comment.awards.findIndex(a =>
            a.user && a.user.toString() === req.user._id.toString() && a.type === awardType
        );

        let updatedComment;
        if (existingAwardIndex !== -1) {
            // Remove the award
            updatedComment = await Comment.findByIdAndUpdate(comment_id,
                { $pull: { awards: { user: req.user._id, type: awardType } } },
                { new: true }
            );
        } else {
            // Add the award
            updatedComment = await Comment.findByIdAndUpdate(comment_id,
                { $push: { awards: { user: req.user._id, type: awardType } } },
                { new: true }
            );
        }

        const updatedPost = await Post.findById(post_id).populate("posted_by", "public_user_name is_email_verified public_user_profile_pic avatar").populate({
            path: 'comments',
            match: { access: { $ne: false } },
        });

        if (!updatedPost) {
            return res.status(404).json({ message: "Post not found for this comment" });
        }

        await populateChildComments(updatedPost.comments)

        const keys = [
            createRedisKeyFromQuery({ category: "all" }, `${process.env.APP_ENV}_post_`),
            createRedisKeyFromQuery({ category: updatedPost.category }, `${process.env.APP_ENV}_post_`),
            updatedPost.posted_by?._id ? createRedisKeyFromQuery({ posted_by: updatedPost.posted_by._id }, `${process.env.APP_ENV}_post_`) : null
        ].filter(Boolean);

        const dataToSync = { ...updatedPost.toObject(), commentCount: (updatedPost.comments || []).length };
        await syncRedisPostCache(keys, "UPDATE", dataToSync);

        const io = getIo();
        io.emit('listen_comment_award', updatedComment);
        io.emit('listen_post_update', updatedPost);

        return res.status(200).json({ status: 'Success', data: updatedPost, message: "Award updated successfully" });
    } catch (error) {
        console.error("Error in awardComment:", error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

const shareComment = async (req, res) => {
    const { comment_id, post_id } = req.body;
    try {
        const updatedComment = await Comment.findByIdAndUpdate(comment_id, { $inc: { shares: 1 } }, { new: true });
        if (updatedComment) {
            const updatedPost = await Post.findById(post_id).populate("posted_by", "public_user_name is_email_verified public_user_profile_pic avatar").populate({
                path: 'comments',
                match: { access: { $ne: false } },
            });
            await populateChildComments(updatedPost.comments)

            const io = getIo();
            io.emit('listen_comment_share', updatedComment);
            io.emit('listen_post_update', updatedPost);

            return res.status(200).json({ status: 'Success', data: updatedPost, message: "Comment shared successfully" });
        }
        res.status(404).json({ message: "Comment not found" });
    } catch (error) {
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

const updateComment = async (req, res) => {
    try {
        const comment_id = req.params.comment_id;
        const { comment } = req.body;

        const oldComment = await Comment.findById(comment_id);
        if (!oldComment) return res.status(404).json({ message: "Comment not found" });

        const historyItem = {
            comment: oldComment.comment,
            edited_at: new Date()
        };

        const updatedComment = await Comment.findByIdAndUpdate(comment_id, {
            comment,
            is_edited: true,
            $push: { edit_history: historyItem }
        }, { new: true });

        if (updatedComment) {
            const updatedPost = await Post.findById(updatedComment.post_id).populate("posted_by", "public_user_name is_email_verified public_user_profile_pic avatar").populate({
                path: 'comments',
                match: { access: { $ne: false } },
            });

            if (updatedPost) {
                await populateChildComments(updatedPost.comments)

                const keys = [
                    createRedisKeyFromQuery({ category: "all" }, `${process.env.APP_ENV}_post_`),
                    createRedisKeyFromQuery({ category: updatedPost.category }, `${process.env.APP_ENV}_post_`),
                    updatedPost.posted_by?._id ? createRedisKeyFromQuery({ posted_by: updatedPost.posted_by._id }, `${process.env.APP_ENV}_post_`) : null
                ].filter(Boolean);

                const dataToSync = { ...updatedPost.toObject(), commentCount: (updatedPost.comments || []).length };
                await syncRedisPostCache(keys, "UPDATE", dataToSync);

                const io = getIo();
                io.emit('listen_post_update', updatedPost);
            }
        }

        res.json(updatedComment);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

const deleteComment = async (req, res) => {
    try {
        const comment_id = req.body.comment_id;
        const comment = await Comment.findById(comment_id);
        if (!comment) return res.status(404).json({ message: "Comment not found" });

        const updatedComment = await Comment.findByIdAndUpdate(comment_id, { $set: { access: false } }, { new: true });

        const updatedPost = await Post.findById(updatedComment.post_id).populate("posted_by", "public_user_name is_email_verified public_user_profile_pic avatar").populate({
            path: 'comments',
            match: { access: { $ne: false } },
        });

        await populateChildComments(updatedPost.comments)

        const redisKeyAll = createRedisKeyFromQuery({ category: "all" }, `${process.env.APP_ENV}_post_`);
        const redisKeyCat = createRedisKeyFromQuery({ category: updatedPost.category }, `${process.env.APP_ENV}_post_`);
        const redisKeyUser = createRedisKeyFromQuery({ posted_by: updatedPost.posted_by._id }, `${process.env.APP_ENV}_post_`);
        const dataToSync = { ...updatedPost.toObject(), commentCount: (updatedPost.comments || []).length };
        await syncRedisPostCache([redisKeyAll, redisKeyCat, redisKeyUser], "UPDATE", dataToSync);

        const io = getIo();
        io.emit('listen_post_update', updatedPost);

        return res.status(200).json({
            status: 'Success',
            data: updatedPost,
            message: "Comment deleted successfully"
        })
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

const getCommentReplies = async (req, res) => {
    try {
        const payload = req.params;
        const comment = await Comment.find({ post_id: payload.post_id, _id: payload.comment_id });
        await populateChildComments(comment);
        if (comment[0]) {
            return res.status(200).json({ status: 'Success', message: 'Comment fetched successfully', data: comment[0] });
        } else {
            return res.status(400).json({ status: 'Failed', message: 'Comment fetched Failed', data: null });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}

const reportComment = async (req, res) => {
    try {
        const { comment_id, reason, description, category, targetUser } = req.body;
        const reporter = req.user._id;

        const report = {
            reporter,
            targetUser,
            reason,
            description,
            category,
            createdAt: Date.now(),
            status: "pending"
        };

        const updatedComment = await Comment.findByIdAndUpdate(
            comment_id,
            { $push: { reported_info: report } },
            { new: true }
        );

        if (updatedComment) {
            return res.status(200).json({
                status: 'Success',
                message: 'Comment reported successfully',
                data: updatedComment
            });
        }
        return res.status(404).json({ message: "Comment not found" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

module.exports = { postComments, getComment, updateComment, deleteComment, postReplyComments, likeComment, getCommentReplies, getCommentsByPostId, downvoteComment, awardComment, shareComment, reportComment };