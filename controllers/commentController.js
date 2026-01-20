const Comment = require("../models/commentModel");
const Post = require("../models/postModel");
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
        await Post.findByIdAndUpdate(
            post_id,
            { $addToSet: { comments: newComment._id } },
            { new: true }
        );

        // Populate the new comment with user info
        const populatedComment = await Comment.findById(newComment._id)
            .populate('commented_by', 'public_user_name is_email_verified');

        res.status(201).json({
            status: 'Success',
            message: 'Comment added successfully',
            data: {
                comment: populatedComment,
                post_id
            },
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

        // Create a new comment as a reply
        const newComment = await Comment.create({
            comment,
            commented_by,
            post_id,
            parent_comment_id: comment_id,
        });

        // Add new comment to the child comments of parent
        await Comment.findByIdAndUpdate(
            comment_id,
            { $addToSet: { nested_comments: newComment._id } },
            { new: true }
        );

        // Populate the new reply comment with user info
        const populatedReply = await Comment.findById(newComment._id)
            .populate('commented_by', 'public_user_name is_email_verified');

        res.status(201).json({
            status: 'Success',
            message: 'Reply added successfully',
            data: {
                comment: populatedReply,
                post_id,
                parent_comment_id: comment_id
            },
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
        const commentData = await Comment.findById(comment_id);
        if (!commentData) {
            return res.status(404).json({
                status: 'Failed',
                message: 'Comment not found',
                data: null
            });
        }

        const userId = req.user._id;
        const isAlreadyUpvoted = commentData.upvoted_by.includes(userId);
        const action = isAlreadyUpvoted ? 'removed' : 'added';

        // Update upvote status
        const updateOp = isAlreadyUpvoted
            ? { $pull: { upvoted_by: userId } }
            : { $addToSet: { upvoted_by: userId } };

        const updatedComment = await Comment.findByIdAndUpdate(
            comment_id,
            updateOp,
            { new: true }
        ).select('upvoted_by');

        if (updatedComment) {
            // Minimal payload for response
            const minimalPayload = {
                comment_id,
                post_id,
                upvoted_by: updatedComment.upvoted_by,
                action,
                user_id: userId.toString()
            };

            return res.status(200).json({
                status: 'Success',
                data: minimalPayload,
                message: action === 'removed' ? "Comment Upvote removed successfully" : "Comment Upvote added successfully"
            });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            status: 'Failed',
            message: 'Internal Server Error',
            data: null
        });
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
        const { comment_id, post_id } = req.body;

        const updatedComment = await Comment.findByIdAndUpdate(
            { _id: comment_id },
            { $set: { access: false } },
            { new: true }
        ).select('_id post_id access');

        if (updatedComment) {
            // Minimal payload for response
            const minimalPayload = {
                comment_id,
                post_id: post_id || updatedComment.post_id,
                deleted: true
            };

            return res.status(200).json({
                status: 'Success',
                data: minimalPayload,
                message: "Comment deleted successfully"
            });
        }

        return res.status(404).json({
            status: 'Failed',
            message: 'Comment not found',
            data: null
        });
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


module.exports = { postComments, getComment, updateComment, deleteComment, postReplyComments, likeComment, deleteComment, getCommentReplies };