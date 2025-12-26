const Comment = require("../models/commentModel");
const Post = require("../models/postModel");
const { createRedisKeyFromQuery, addOrUpdateCachedDataInRedis } = require("../redisClient/redisUtils");
const getRedisInstance = require("../redisClient/redisClient");
const { populateChildComments } = require("../utils/utils");

// app.post('/api/comments',
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
        const updatedPost = await Post.findById(post_id).populate("posted_by", "public_user_name is_email_verified").populate({
            path: 'comments',
            match: { access: { $ne: false } },
        });

        await populateChildComments(updatedPost.comments)

        // update the redis post cache based on getch post logic
        const query = {
            posted_by: post.posted_by,
            category: post.category,
        }
        const redisKey = createRedisKeyFromQuery(query, `${process.env.APP_ENV}_post_`)
        addOrUpdateCachedDataInRedis(redisKey, updatedPost)

        console.log("create comment", redisKey, updatedPost)


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

        const addToChildComments = await Comment.findByIdAndUpdate(comment_id, { $addToSet: { nested_comments: newComment._id } }, { new: true })

        const updatedPost = await Post.findById(post_id).populate("posted_by", "public_user_name is_email_verified").populate({
            path: 'comments',
            match: { access: { $ne: false } },
        });
        await populateChildComments(updatedPost.comments)

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

// app.get('/api/comments/:post_id', 

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
    const { comment_id, parent_comment_id, post_id } = req.body;
    try {
        const post = await Post.findById(post_id);
        if (post) {
            let updatedData = null;
            const commentData = await Comment.findById(comment_id);
            if (commentData) {
                if (commentData.upvoted_by.includes(req.user._id)) {
                    updatedData = await Comment.findByIdAndUpdate(comment_id, { $pull: { upvoted_by: req.user._id } }, { new: true });
                } else {
                    await Comment.findByIdAndUpdate(comment_id, { $pull: { downvoted_by: req.user._id } });
                    updatedData = await Comment.findByIdAndUpdate(comment_id, { $addToSet: { upvoted_by: req.user._id } }, { new: true });
                }

                if (updatedData) {
                    const updatedPost = await Post.findById(post_id).populate("posted_by", "public_user_name is_email_verified").populate({
                        path: 'comments',
                        match: { access: { $ne: false } },
                    });
                    await populateChildComments(updatedPost.comments)

                    return res.status(200).json({
                        status: 'Success',
                        data: updatedPost,
                        message: "Comment Upvoted successfully"
                    })
                }
            }
        }
        res.status(404).json({ message: "Post or Comment not found" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

const getCommentsByPostId = async (req, res) => {
    try {
        const post_id = req.params.post_id;
        const comments = await Comment.find({ post_id, parent_comment_id: null, access: { $ne: false } })
            .populate('commented_by', 'public_user_name is_email_verified public_user_profile_pic avatar')
            .sort({ commented_at: -1 });

        for (const comment of comments) {
            await populateChildComments(comment);
        }

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
        if (comment) {
            let updatedData;
            if (comment.downvoted_by.includes(req.user._id)) {
                updatedData = await Comment.findByIdAndUpdate(comment_id, { $pull: { downvoted_by: req.user._id } }, { new: true });
            } else {
                await Comment.findByIdAndUpdate(comment_id, { $pull: { upvoted_by: req.user._id } });
                updatedData = await Comment.findByIdAndUpdate(comment_id, { $addToSet: { downvoted_by: req.user._id } }, { new: true });
            }

            if (updatedData) {
                // Invalidate post cache
                const post = await Post.findById(post_id);
                if (post) {
                    const redisKeyAll = createRedisKeyFromQuery({ category: "all" }, `${process.env.APP_ENV}_post_`);
                    const redisKeyCat = createRedisKeyFromQuery({ category: post.category }, `${process.env.APP_ENV}_post_`);
                    const redisKeyUser = createRedisKeyFromQuery({ posted_by: post.posted_by }, `${process.env.APP_ENV}_post_`);
                    const redis = getRedisInstance();
                    await redis.del(redisKeyAll, redisKeyCat, redisKeyUser);
                }

                return res.status(200).json({
                    status: 'Success',
                    data: updatedData,
                    message: "Comment Downvoted successfully"
                });
            }
        }
        res.status(404).json({ message: "Comment not found" });
    } catch (error) {
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

const awardComment = async (req, res) => {
    const { comment_id, awardType } = req.body;
    try {
        const updatedComment = await Comment.findByIdAndUpdate(comment_id, { $push: { awards: awardType } }, { new: true });
        if (updatedComment) {
            return res.status(200).json({ status: 'Success', data: updatedComment, message: "Award given successfully" });
        }
        res.status(404).json({ message: "Comment not found" });
    } catch (error) {
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

const shareComment = async (req, res) => {
    const { comment_id } = req.body;
    try {
        const updatedComment = await Comment.findByIdAndUpdate(comment_id, { $inc: { shares: 1 } }, { new: true });
        if (updatedComment) {
            return res.status(200).json({ status: 'Success', data: updatedComment, message: "Comment shared successfully" });
        }
        res.status(404).json({ message: "Comment not found" });
    } catch (error) {
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

// app.put('/api/comments/:comment_id', 
const updateComment = async (req, res) => {
    try {
        const comment_id = req.params.comment_id;
        const { comment } = req.body;

        const updatedComment = await Comment.findByIdAndUpdate(comment_id, { comment }, { new: true });

        res.json(updatedComment);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

const deleteComment = async (req, res) => {
    try {
        const comment_id = req.body.comment_id;

        const updatedComment = await Comment.findByIdAndUpdate(
            { _id: comment_id },
            { $set: { access: false } },
            { new: true }
        );

        if (updatedComment) {
            const updatedPost = await Post.findById(updatedComment.post_id).populate("posted_by", "public_user_name is_email_verified")
                .populate({
                    path: 'comments',
                    match: { access: { $ne: false } },
                });

            await populateChildComments(updatedPost.comments)

            return res.status(200).json({
                status: 'Success',
                data: updatedPost,
                message: "Comment deleted successfully"
            })
        }
        return res.json({ message: 'Comment deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}


const getCommentReplies = async (req, res) => {
    try {
        const payload = req.params

        const comment = await Comment.find({ post_id: payload.post_id, _id: payload.comment_id })
        console.log("before", comment)

        await populateChildComments(comment)



        if (comment[0]) {
            return res.status(200).json({
                status: 'Success',
                message: 'Comment fetched successfully',
                data: comment[0],
            });
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: 'Comment fetched Failed',
                data: null,
            });
        }



    } catch (error) {

        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });

    }
}


module.exports = { postComments, getComment, updateComment, deleteComment, postReplyComments, likeComment, getCommentReplies, getCommentsByPostId, downvoteComment, awardComment, shareComment };