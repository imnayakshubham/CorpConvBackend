const Post = require("../models/postModel");
const Comment = require("../models/commentModel");
const getRedisInstance = require("../redisClient/redisClient");
const { getIo } = require("../utils/socketManger");
const { populateChildComments } = require("../utils/utils");


const createPost = async (req, res) => {
    try {

        const postPayload = {
            category: req.body.category,
            content: req.body.content,
            posted_by: req.user._id,
        }

        const post = await Post.create(postPayload)
        const postData = await post.populate("posted_by", "public_user_name is_email_verified")
        if (postData) {
            const io = getIo()
            io.emit('listen_post_creation', postData)

            return res.status(201).json({
                status: 'Success',
                data: postData,
                message: "Post created successfully"
            })

        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Post not created",
                data: null
            })
        }

    } catch (error) {
        console.log({ error })
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Post not created"
        })
    }
}

const updatePost = async (req, res) => {
    try {
        const post = await Post.findOne({ _id: req.body._id });
        if (post) {
            const postData = await Post.findByIdAndUpdate(req.body._id, { content: req.body.content, category: req.body.category }, { new: true }).populate("posted_by", "public_user_name is_email_verified").populate({
                path: 'comments',
                match: { access: { $ne: false } },
            });
            await populateChildComments(postData.comments)

            if (postData) {
                return res.status(200).json({
                    status: 'Success',
                    data: postData,
                    message: "Post updated successfully"
                })
            } else {
                return res.status(400).json({
                    status: 'Failed',
                    message: "Post not updated",
                    data: null
                })
            }
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Post not found",
                data: null
            })
        }

    } catch (error) {
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Post not updated"
        })

    }
}

const fetchPosts = async (req, res) => {
    try {
        const user_id = req.query?.user_id ?? null;
        const limit = parseInt(req.query?.limit) || 10;
        const cursor = req.query?.cursor ?? null;
        const include_comments = req.query?.include_comments === 'true';

        let query = {};

        if (user_id) {
            query.posted_by = user_id;
        }

        // Cursor-based pagination: fetch posts older than cursor timestamp
        if (cursor) {
            query.createdAt = { $lt: new Date(cursor) };
        }

        // For non-paginated requests with caching (backward compatibility)
        if (!cursor && !req.query?.limit) {
            const redis = getRedisInstance();
            const postedByRedisKey = user_id ? `${process.env.APP_ENV}_posted_by_${user_id}` : `${process.env.APP_ENV}_posts`;

            let parsedCachedData = null;
            if (redis) {
                const cachedData = await redis.get(postedByRedisKey);
                parsedCachedData = JSON.parse(cachedData);
            }

            if (parsedCachedData) {
                return res.status(200).json({
                    status: 'Success',
                    data: parsedCachedData,
                    message: "Posts fetched successfully (Cached)"
                });
            }
        }

        // Build query with optional comments population
        let postsQuery = Post.find(query)
            .sort({ createdAt: -1 })
            .limit(limit + 1) // Fetch one extra to check if there are more
            .populate("posted_by", "public_user_name is_email_verified");

        if (include_comments) {
            postsQuery = postsQuery.populate({
                path: 'comments',
                match: { access: { $ne: false } },
                populate: { path: 'commented_by', select: 'public_user_name is_email_verified' }
            });
        }

        const posts = await postsQuery.maxTimeMS(15000).lean();

        // Determine if there are more posts
        const hasMore = posts.length > limit;
        const resultPosts = hasMore ? posts.slice(0, limit) : posts;

        // Get next cursor (timestamp of last post)
        const nextCursor = hasMore && resultPosts.length > 0
            ? resultPosts[resultPosts.length - 1].createdAt
            : null;

        // If not including comments, add comment_count for list view
        if (!include_comments) {
            const postIds = resultPosts.map(p => p._id);
            const commentCounts = await Comment.aggregate([
                { $match: { post_id: { $in: postIds }, access: { $ne: false } } },
                { $group: { _id: "$post_id", count: { $sum: 1 } } }
            ]);

            const countMap = {};
            commentCounts.forEach(c => { countMap[c._id.toString()] = c.count; });

            resultPosts.forEach(post => {
                post.comment_count = countMap[post._id.toString()] || 0;
                delete post.comments; // Remove comments array if present
            });
        }

        // Cache non-paginated requests
        if (!cursor && !req.query?.limit) {
            const redis = getRedisInstance();
            const postedByRedisKey = user_id ? `${process.env.APP_ENV}_posted_by_${user_id}` : `${process.env.APP_ENV}_posts`;
            if (redis) {
                await redis.set(postedByRedisKey, JSON.stringify(resultPosts), 'EX', 21600);
            }
        }

        return res.status(200).json({
            status: 'Success',
            data: {
                posts: resultPosts,
                nextCursor,
                hasMore
            },
            message: "Posts fetched successfully"
        });
    } catch (error) {
        console.log({ error });
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Posts not fetched"
        });
    }
}

const upVotePost = async (req, res) => {
    try {
        const post = await Post.findById(req.body.post_id);
        if (post) {
            const io = getIo();
            const userId = req.user._id;
            const isAlreadyUpvoted = post.upvoted_by.includes(userId);
            const action = isAlreadyUpvoted ? 'removed' : 'added';

            // Update upvote status
            const updateOp = isAlreadyUpvoted
                ? { $pull: { upvoted_by: userId } }
                : { $addToSet: { upvoted_by: userId } };

            const postData = await Post.findByIdAndUpdate(
                req.body.post_id,
                updateOp,
                { new: true }
            ).select('upvoted_by');

            if (postData) {
                // Minimal payload for response and socket
                const minimalPayload = {
                    post_id: req.body.post_id,
                    upvoted_by: postData.upvoted_by,
                    action,
                    user_id: userId.toString()
                };

                io.emit('listen_upvote', minimalPayload);

                return res.status(200).json({
                    status: 'Success',
                    data: minimalPayload,
                    message: action === 'removed' ? "Post Upvote Removed successfully" : "Post Upvoted successfully"
                });
            }
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Post not found",
                data: null
            });
        }
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Post not upvoted"
        });
    }
}

const deletePost = async (req, res) => {
    try {
        const post = await Post.findById(req.body._id);
        if (post) {
            const postData = await Post.findByIdAndDelete(req.body._id);
            if (postData) {
                return res.status(200).json({
                    status: 'Success',
                    data: null,
                    message: "Post deleted successfully"
                })
            } else {
                return res.status(400).json({
                    status: 'Failed',
                    message: "Post not found",
                    data: null
                })
            }

        }
    } catch (error) {
        console.log(error)
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Post not deleted"
        })
    }
}

const getPost = async (req, res) => {
    try {
        const post = await Post.findById(req.params.id).populate("posted_by", "public_user_name is_email_verified").populate({
            path: 'comments',
            match: { access: { $ne: false } },
        });
        if (post) {
            await populateChildComments(post.comments)
            return res.status(200).json({
                status: 'Success',
                data: post,
                message: "Post fetched successfully"
            })
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Post not found",
                data: null
            })
        }
    } catch (error) {
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Something went wrong while fetching post"
        })
    }
}

module.exports = { createPost, fetchPosts, upVotePost, updatePost, deletePost, getPost };