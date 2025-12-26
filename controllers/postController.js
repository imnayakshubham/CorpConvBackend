const Post = require("../models/postModel");
const getRedisInstance = require("../redisClient/redisClient");
const { createRedisKeyFromQuery, addOrUpdateCachedDataInRedis } = require("../redisClient/redisUtils");
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
        const category = req.query?.category ?? "all";
        let query = {};

        if (user_id) {
            query = { posted_by: user_id };
        }

        if (category !== "all") {
            query = {
                ...query,
                category: category
            };
        }

        const redis = getRedisInstance()
        const redisKey = createRedisKeyFromQuery(query, `${process.env.APP_ENV}_post_`)
        const cachedData = await redis.get(redisKey)
        const parsedCachedData = JSON.parse(cachedData)

        if (parsedCachedData) {
            return res.status(200).json({
                status: 'Success',
                data: parsedCachedData,
                message: "Posts fetched successfully (Cached)"
            })
        } else {
            const posts = await Post.find(query)
                .sort({ createdAt: -1 })
                .populate("posted_by", "public_user_name is_email_verified public_user_profile_pic avatar")
                .maxTimeMS(15000)
                .lean();

            // Add comment count to each post instead of populating comments
            const postsWithCommentCount = posts.map(post => ({
                ...post,
                commentCount: post.comments.length
            }));

            addOrUpdateCachedDataInRedis(redisKey, postsWithCommentCount)

            return res.status(200).json({
                status: 'Success',
                data: postsWithCommentCount,
                message: "Posts fetched successfully"
            })
        }
        // for (const post of posts) {
        //     await populateChildComments(post.comments);
        // }
    } catch (error) {
        console.log({ error })
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Posts not fetched"
        })
    }
}

const upVotePost = async (req, res) => {
    try {
        const post = await Post.findById(req.body.post_id);
        if (post) {
            const io = getIo()
            let postData;
            let message;
            if (post.upvoted_by.includes(req.user._id)) {
                postData = await Post.findByIdAndUpdate(req.body.post_id, { $pull: { upvoted_by: req.user._id } }, { new: true }).populate("posted_by", "public_user_name is_email_verified");
                message = "Post Upvote Removed successfully";
            } else {
                // Remove from downvote if exists
                await Post.findByIdAndUpdate(req.body.post_id, { $pull: { downvoted_by: req.user._id } });
                postData = await Post.findByIdAndUpdate(req.body.post_id, { $addToSet: { upvoted_by: req.user._id } }, { new: true }).populate("posted_by", "public_user_name is_email_verified");
                message = "Post Upvoted successfully";
            }

            if (postData) {
                // Update Redis Cache
                const query = { category: postData.category };
                const redisKeyAll = createRedisKeyFromQuery({ category: "all" }, `${process.env.APP_ENV}_post_`);
                const redisKeyCat = createRedisKeyFromQuery(query, `${process.env.APP_ENV}_post_`);
                const redisKeyUser = createRedisKeyFromQuery({ posted_by: postData.posted_by._id }, `${process.env.APP_ENV}_post_`);

                const redis = getRedisInstance();
                await redis.del(redisKeyAll, redisKeyCat, redisKeyUser);

                io.emit('listen_upvote', {
                    data: postData,
                    upvoted_by: req.user._id
                })

                return res.status(200).json({
                    status: 'Success',
                    data: postData,
                    message: message
                })
            }
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Post not upvoted",
                data: null
            })
        }
    } catch (error) {
        console.log(error)
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Post not upvoted"
        })
    }
}

const downVotePost = async (req, res) => {
    try {
        const post = await Post.findById(req.body.post_id);
        if (post) {
            const io = getIo()
            let postData;
            let message;
            if (post.downvoted_by.includes(req.user._id)) {
                postData = await Post.findByIdAndUpdate(req.body.post_id, { $pull: { downvoted_by: req.user._id } }, { new: true }).populate("posted_by", "public_user_name is_email_verified");
                message = "Post Downvote Removed successfully";
            } else {
                // Remove from upvote if exists
                await Post.findByIdAndUpdate(req.body.post_id, { $pull: { upvoted_by: req.user._id } });
                postData = await Post.findByIdAndUpdate(req.body.post_id, { $addToSet: { downvoted_by: req.user._id } }, { new: true }).populate("posted_by", "public_user_name is_email_verified");
                message = "Post Downvoted successfully";
            }

            if (postData) {
                // Invalidate Redis Cache
                const redisKeyAll = createRedisKeyFromQuery({ category: "all" }, `${process.env.APP_ENV}_post_`);
                const redisKeyCat = createRedisKeyFromQuery({ category: postData.category }, `${process.env.APP_ENV}_post_`);
                const redisKeyUser = createRedisKeyFromQuery({ posted_by: postData.posted_by._id }, `${process.env.APP_ENV}_post_`);

                const redis = getRedisInstance();
                await redis.del(redisKeyAll, redisKeyCat, redisKeyUser);

                io.emit('listen_downvote', {
                    data: postData,
                    downvoted_by: req.user._id
                })

                return res.status(200).json({
                    status: 'Success',
                    data: postData,
                    message: message
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
        console.log(error)
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Post not downvoted"
        })
    }
}

const awardPost = async (req, res) => {
    try {
        const { post_id, awardType } = req.body;
        const postData = await Post.findByIdAndUpdate(post_id, { $push: { awards: awardType } }, { new: true }).populate("posted_by", "public_user_name is_email_verified");
        if (postData) {
            return res.status(200).json({
                status: 'Success',
                data: postData,
                message: "Award added successfully"
            });
        }
        res.status(400).json({ status: 'Failed', message: 'Post not found' });
    } catch (error) {
        res.status(500).json({ status: 'Failed', message: 'Something went wrong' });
    }
}

const sharePost = async (req, res) => {
    try {
        const { post_id } = req.body;
        const postData = await Post.findByIdAndUpdate(post_id, { $inc: { shares: 1 } }, { new: true }).populate("posted_by", "public_user_name is_email_verified");
        if (postData) {
            return res.status(200).json({
                status: 'Success',
                data: postData,
                message: "Post shared successfully"
            });
        }
        res.status(400).json({ status: 'Failed', message: 'Post not found' });
    } catch (error) {
        res.status(500).json({ status: 'Failed', message: 'Something went wrong' });
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
        const post = await Post.findById(req.params._id).populate("posted_by", "public_user_name is_email_verified").populate({
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

module.exports = { createPost, fetchPosts, upVotePost, downVotePost, awardPost, sharePost, updatePost, deletePost, getPost };