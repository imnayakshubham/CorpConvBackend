const asyncHandler = require("express-async-handler");
const Feedback = require("../models/feedbackModel");

const createFeedback = asyncHandler(async (req, res) => {
    const { type, title, description } = req.body;

    if (!type || !title || !description) {
        res.status(400);
        throw new Error("Please Fill all the Fields");
    }

    const feedback = await Feedback.create({
        user: req.user._id,
        type,
        title,
        description,
    });

    if (feedback) {
        res.status(201).json({
            status: "Success",
            data: feedback,
            message: "Feedback Submitted Successfully",
        });
    } else {
        res.status(400);
        throw new Error("Failed to Submit Feedback");
    }
});

module.exports = { createFeedback };
