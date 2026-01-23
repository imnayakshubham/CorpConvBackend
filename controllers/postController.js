const Post = require("../models/postModel");
const Comment = require("../models/commentModel");
const { getIo } = require("../utils/socketManger");
const { populateChildComments } = require("../utils/utils");
const cache = require("../redisClient/cacheHelper");
const TTL = require("../redisClient/cacheTTL");


const createPost = async (req, res) => {
    try {

        const postPayload = {
            category: req.body.category,
            content: req.body.content,
            posted_by: req.user._id,
        }

        const post = await Post.create(postPayload)
        const postData = await post.populate("posted_by", "public_user_name is_email_verified avatar_config")
        if (postData) {
            // Invalidate posts caches
            const postsKey = cache.generateKey('posts', 'all');
            const userPostsKey = cache.generateKey('posts', 'user', req.user._id);
            const categoriesKey = cache.generateKey('posts', 'categories');
            await cache.del(postsKey, userPostsKey, categoriesKey);

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
            const postData = await Post.findByIdAndUpdate(req.body._id, { content: req.body.content, category: req.body.category }, { new: true }).populate("posted_by", "public_user_name is_email_verified avatar_config").populate({
                path: 'comments',
                match: { access: { $ne: false } },
            });
            await populateChildComments(postData.comments)

            if (postData) {
                // Invalidate posts caches
                const postsKey = cache.generateKey('posts', 'all');
                const userPostsKey = cache.generateKey('posts', 'user', post.posted_by);
                const categoriesKey = cache.generateKey('posts', 'categories');
                await cache.del(postsKey, userPostsKey, categoriesKey);

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
            const cacheKey = user_id
                ? cache.generateKey('posts', 'user', user_id)
                : cache.generateKey('posts', 'all');

            const cachedData = await cache.get(cacheKey);

            if (cachedData) {
                return res.status(200).json({
                    status: 'Success',
                    data: cachedData,
                    message: "Posts fetched successfully (Cached)"
                });
            }
        }

        // Build query with optional comments population
        let postsQuery = Post.find(query)
            .sort({ createdAt: -1 })
            .limit(limit + 1) // Fetch one extra to check if there are more
            .populate("posted_by", "public_user_name is_email_verified avatar_config");

        if (include_comments) {
            postsQuery = postsQuery.populate({
                path: 'comments',
                match: { access: { $ne: false } },
                populate: { path: 'commented_by', select: 'public_user_name is_email_verified avatar_config' }
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
            const cacheKey = user_id
                ? cache.generateKey('posts', 'user', user_id)
                : cache.generateKey('posts', 'all');
            await cache.set(cacheKey, resultPosts, TTL.POSTS_LIST);
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
                // Invalidate posts caches
                const postsKey = cache.generateKey('posts', 'all');
                const userPostsKey = cache.generateKey('posts', 'user', post.posted_by);
                await cache.del(postsKey, userPostsKey);

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
        const post = await Post.findById(req.params.id).populate("posted_by", "public_user_name is_email_verified avatar_config").populate({
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

const getCategories = async (req, res) => {
    try {
        // Try to get from cache
        const cacheKey = cache.generateKey('posts', 'categories');
        const cached = await cache.get(cacheKey);
        if (cached) {
            return res.status(200).json({
                status: 'Success',
                data: cached,
                cached: true
            });
        }

        const categories = await Post.distinct('category');
        const predefinedCategories = [
            'company_review', 'random', 'reading',
            'learning', 'thoughts', 'project', 'Watching'
        ];

        // Merge and deduplicate (case-insensitive)
        const categoryMap = new Map();
        [...predefinedCategories, ...categories].forEach(cat => {
            if (cat && cat.trim()) {
                const lowerKey = cat.toLowerCase().trim();
                if (!categoryMap.has(lowerKey)) {
                    categoryMap.set(lowerKey, cat.trim());
                }
            }
        });

        const uniqueCategories = Array.from(categoryMap.values()).sort();

        // Cache the categories
        await cache.set(cacheKey, uniqueCategories, TTL.CATEGORIES);

        return res.status(200).json({
            status: 'Success',
            data: uniqueCategories
        });
    } catch (error) {
        return res.status(500).json({ status: 'Failed', message: "Failed to fetch categories" });
    }
};

module.exports = { createPost, fetchPosts, upVotePost, updatePost, deletePost, getPost, getCategories };
