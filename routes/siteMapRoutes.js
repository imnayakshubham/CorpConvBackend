const express = require("express");
const { Survey } = require("../models/surveyModel");
const { Poll } = require("../models/pollModel");
const User = require("../models/userModel");
const Profile = require("../models/bentoProfileModel");
const Post = require("../models/postModel");

const router = express.Router();

const PUBLIC_FILTER = { access: true, visibility: "public", pin_enabled: { $ne: true } };

const latest = (...dates) => {
    const valid = dates.filter(Boolean).map((d) => new Date(d).getTime());
    return valid.length ? new Date(Math.max(...valid)) : undefined;
};

const listData = async (req, res) => {
    try {
        const [surveys, polls, publishedProfiles, posts] = await Promise.all([
            Survey.find({ ...PUBLIC_FILTER, status: "published" }).select("_id updatedAt").lean(),
            Poll.find({ ...PUBLIC_FILTER, status: { $in: ["published", "open", "closed"] } }).select("slug updatedAt").lean(),
            Profile.find({ is_published: true }).select("user_id updatedAt").lean(),
            Post.find({}).select("_id updatedAt").populate("posted_by", "access").lean(),
        ]);

        const profileByUser = new Map(publishedProfiles.map((p) => [String(p.user_id), p]));

        const users = await User.find({
            access: true,
            username: { $type: "string", $ne: "" },
            $or: [
                { _id: { $in: publishedProfiles.map((p) => p.user_id) } },
                { user_bio: { $regex: /\S/ } },
            ],
        }).select("_id username updatedAt").lean();

        const data = [
            ...surveys.map((s) => ({ path: `survey/${s._id}`, lastModified: s.updatedAt })),
            ...polls.filter((p) => p.slug).map((p) => ({ path: `poll/${p.slug}`, lastModified: p.updatedAt })),
            ...users.map((u) => ({
                path: `u/${u.username}`,
                lastModified: latest(u.updatedAt, profileByUser.get(String(u._id))?.updatedAt),
            })),
            ...posts
                .filter((p) => p.posted_by && p.posted_by.access !== false)
                .map((p) => ({ path: `post/${p._id}`, lastModified: p.updatedAt })),
        ];

        return res.status(200).json({
            status: "Success",
            data,
            message: "retrieved successfully",
        });
    } catch (error) {
        return res.status(500).json({
            status: "Failed",
            message: "Server Error: Unable to fetch",
            data: null,
        });
    }
};

router.route("/data").get(listData);

module.exports = router;
