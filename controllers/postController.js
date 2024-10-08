const Post = require("../models/postModel");
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
        let query = {};

        if (user_id) {
            query = { posted_by: user_id };
        }

        const redis = getRedisInstance()
        const postedByRedisKey = user_id ? `${process.env.APP_ENV}_posted_by_${user_id}` : `${process.env.APP_ENV}_posts`
        const cachedData = await redis.get(postedByRedisKey)
        const parsedCachedData = JSON.parse(cachedData)

        if (parsedCachedData) {
            return res.status(200).json({
                status: 'Success',
                data: parsedCachedData,
                message: "Posts fetched successfully (Cached)"
            })
        } else if (parsedCachedData === null) {
            const posts = await Post.find(query)
                .sort({ createdAt: -1 })
                .populate("posted_by", "public_user_name is_email_verified")
                .populate({
                    path: 'comments',
                    match: { access: { $ne: false } },
                    populate: { path: 'commented_by', select: 'public_user_name is_email_verified' }
                }).maxTimeMS(15000).lean()
            await redis.set(postedByRedisKey, JSON.stringify(posts), 'EX', 21600); //Cached for 6 hours

            return res.status(200).json({
                status: 'Success',
                data: posts,
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
            if (post.upvoted_by.includes(req.user._id)) {
                const postData = await Post.findByIdAndUpdate(req.body.post_id, { $pull: { upvoted_by: req.user._id } }, { new: true }).populate("posted_by", "public_user_name is_email_verified").populate({
                    path: 'comments',
                    match: { access: { $ne: false } },
                });
                await populateChildComments(postData.comments)
                io.emit('listen_upvote', {
                    data: postData,
                    upvoted_by: req.user._id
                })

                if (postData) {
                    return res.status(200).json({
                        status: 'Success',
                        data: postData,
                        message: "Post Upvote Removed successfully"
                    })
                }

            } else {
                const postData = await Post.findByIdAndUpdate(req.body.post_id, { $addToSet: { upvoted_by: req.user._id } }, { new: true }).populate("posted_by", "public_user_name is_email_verified").populate({
                    path: 'comments',
                    match: { access: { $ne: false } },
                });
                await populateChildComments(postData.comments)
                io.emit('listen_upvote', {
                    data: postData,
                    upvoted_by: req.user._id
                })
                if (postData) {
                    return res.status(200).json({
                        status: 'Success',
                        data: postData,
                        message: "Post Upvoted successfully"
                    })
                }

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