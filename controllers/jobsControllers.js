
const asyncHandler = require('express-async-handler');
const Job = require('../models/jobModel');
const { getIo } = require('../utils/socketManger');
const axios = require("axios");
const { load } = require("cheerio");
const { isJobVerified } = require('../utils/utils');

const jobMetaData = async (link) => {
    /*request url html document*/
    const { data } = await axios.get(link);
    //load html document in cheerio
    const $ = load(data);

    const getMetaTag = (name) => {
        return (
            $(`meta[name=${name}]`).attr("content") ||
            $(`meta[property="twitter${name}"]`).attr("content") ||
            $(`meta[property="og:${name}"]`).attr("content")
        );
    };

    const preview = {
        job_post_link: link,
        title: $("title").first().text(),
        favicon:
            $('link[rel="shortcut icon"]').attr("href") ||
            $('link[rel="alternate icon"]').attr("href"),
        description: getMetaTag("description"),
        image: getMetaTag("image"),
        author: getMetaTag("author"),
    };

    return preview;
}

const createJob = asyncHandler(async (req, res) => {
    try {

        const jobPostAlreadyExists = await Job.findOne({ "job_data.job_post_link": req.body.job_post_link });
        console.log(jobPostAlreadyExists)

        if (jobPostAlreadyExists) {
            return res.status(400).json({
                status: 'Failed',
                message: "Job already exists",
                data: null
            })
        }
        const jobPayload = {
            job_data: await jobMetaData(req.body.job_post_link),
            job_posted_by: req.user._id,
            is_job_verified: isJobVerified(req.body.job_post_link)
        }

        const job = await Job.create(jobPayload)
        const jobData = await job.populate("job_posted_by", "public_user_name is_email_verified")
        if (jobData) {
            const io = getIo()
            io.emit('listen_job_creation', jobData)

            return res.status(201).json({
                status: 'Success',
                data: jobData,
                message: "Job created successfully"
            })

        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Job not created",
                data: null
            })
        }

    } catch (error) {
        console.log({ error })
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Job not created"
        })
    }
});

const fetchJobs = asyncHandler(async (req, res) => {
    try {
        const user_id = req.query.user_id;
        let query = {};

        if (user_id) {
            query = { job_posted_by: user_id };
        }
        const jobs = await Job.find(query).sort({ updatedAt: -1 }).populate('job_posted_by', 'public_user_name is_email_verified')
        if (jobs) {
            return res.status(200).json({
                status: 'Success',
                data: jobs,
                message: "Jobs fetched successfully"
            })
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Jobs not fetched",
                data: null
            })
        }
    } catch (error) {
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Jobs not fetched"
        })
    }
});


const updateJob = asyncHandler(async (req, res) => {
    try {

        const jobExists = await Job.findOne({ _id: req.body.job_id });
        if (!jobExists) {
            return res.status(400).json({
                status: 'Failed',
                message: "Job not exists",
                data: null
            })
        }
        const job = await Job.findByIdAndUpdate(req.body.job_id, { $set: { job_data: await jobMetaData(req.body.job_post_link) } }, { new: true }).populate("job_posted_by", "public_user_name is_email_verified")

        if (job) {
            const io = getIo()
            io.emit('listen_job_edition', job)
            return res.status(200).json({
                status: 'Success',
                data: job,
                message: "Job updated successfully"
            })
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Job not updated",
                data: null
            })
        }
    } catch (error) {
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Job not updated"
        })
    }
})


const deleteJob = asyncHandler(async (req, res) => {
    try {
        const jobExists = await Job.findOne({
            _id: req.body.job_id
        });
        if (!jobExists) {
            return res.status(400).json({
                status: 'Failed',
                message: "Job not exists",
                data: null
            })
        }
        const job = await Job.findByIdAndDelete({ _id: req.body.job_id })
        if (job) {
            return res.status(200).json({
                status: 'Success',
                data: job,
                message: "Job deleted successfully"
            })
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Job not deleted",
                data: null
            })
        }
    } catch (error) {
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Job not deleted"
        })
    }
})


// handle Like and Dislike

const likeDislikeJob = asyncHandler(async (req, res) => {
    try {
        const job = await Job.findById(req.body.job_id);
        if (job) {
            const io = getIo()

            if (job.liked_by.includes(req.user._id)) {
                const jobData = await Job.findByIdAndUpdate(req.body.job_id, { $pull: { liked_by: req.user._id } }, { new: true }).populate("job_posted_by", "public_user_name is_email_verified")
                io.emit('listen_job_like', jobData)

                if (jobData) {
                    return res.status(200).json({
                        status: 'Success',
                        data: jobData,
                        message: "Job Disliked successfully"
                    })
                }

            } else {
                const jobData = await Job.findByIdAndUpdate(req.body.job_id, { $set: { liked_by: req.user._id } }, { new: true }).populate("job_posted_by", "public_user_name is_email_verified")
                console.log(jobData)
                io.emit('listen_job_like', jobData)
                if (jobData) {
                    return res.status(200).json({
                        status: 'Success',
                        data: jobData,
                        message: "Job Liked successfully"
                    })
                }

            }

            // await job.save();
            // return res.status(200).json({
            //     status: 'Success',
            //     data: job,
            //     message: "Job liked successfully"
            // })
        } else {
            return res.status(400).json({
                status: 'Failed',
                message: "Job not liked",
                data: null
            })
        }
    } catch (error) {
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Job not liked"
        })
    }
})


const bookMarkJob = asyncHandler(async (req, res) => {
    try {
        const job = await Job.findById(req.body.job_id);
        if (job) {
            const io = getIo()
            if (job.bookmarked_by.includes(req.user._id)) {
                const jobData = await Job.findByIdAndUpdate(req.body.job_id, { $pull: { bookmarked_by: req.user._id } }, { new: true }).populate("job_posted_by", "public_user_name is_email_verified")
                io.emit('listen_job_bookmark', jobData)
                if (jobData) {
                    return res.status(200).json({
                        status: 'Success',
                        data: jobData,
                        message: "Job Unbookmarked successfully"
                    })
                } else {
                    return res.status(400).json({
                        status: 'Failed',
                        message: "Job not Unbookmarked",
                        data: null
                    })
                }
            } else {
                const jobData = await Job.findByIdAndUpdate(req.body.job_id, { $set: { bookmarked_by: req.user._id } }, { new: true }).populate("job_posted_by", "public_user_name is_email_verified")
                io.emit('listen_job_bookmark', jobData)
                if (jobData) {
                    return res.status(200).json({
                        status: 'Success',
                        data: jobData,
                        message: "Job Bookmarked successfully"
                    })
                } else {
                    return res.status(400).json({
                        status: 'Failed',
                        message: "Job not Bookmarked",
                        data: null
                    })
                }
            }
        }
    } catch (error) {
        return res.status(500).json({
            data: null,
            status: 'Failed',
            message: "Something went wrong! Please try again later."
        })
    }
})




module.exports = {
    createJob,
    fetchJobs,
    updateJob,
    deleteJob,
    likeDislikeJob,
    bookMarkJob
}