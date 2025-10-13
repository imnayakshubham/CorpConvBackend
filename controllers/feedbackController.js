const asyncHandler = require("express-async-handler");
const Feedback = require("../models/feedbackModel");
const User = require("../models/userModel");
const emailService = require("../services/emailService");

// Rate limiting storage (in production, use Redis)
const rateLimitStore = new Map();

// Helper function to check rate limit
const checkRateLimit = (ipAddress, maxRequests = 5, windowMs = 60 * 60 * 1000) => {
  const now = Date.now();
  const userRequests = rateLimitStore.get(ipAddress) || [];

  // Filter out old requests outside the window
  const recentRequests = userRequests.filter(timestamp => now - timestamp < windowMs);

  if (recentRequests.length >= maxRequests) {
    return false;
  }

  // Add current request
  recentRequests.push(now);
  rateLimitStore.set(ipAddress, recentRequests);

  return true;
};

// Helper function to validate feedback data
const validateFeedbackData = (data) => {
  const errors = [];

  // Required fields
  if (!data.type || !["bug", "feature", "general", "ui_ux", "performance", "content"].includes(data.type)) {
    errors.push("Valid feedback type is required");
  }

  if (!data.description || data.description.trim().length < 10) {
    errors.push("Description must be at least 10 characters long");
  }

  if (data.description && data.description.length > 2000) {
    errors.push("Description cannot exceed 2000 characters");
  }

  if (data.title && data.title.length > 200) {
    errors.push("Title cannot exceed 200 characters");
  }

  if (!data.priority || !["low", "medium", "high", "critical"].includes(data.priority)) {
    errors.push("Valid priority is required");
  }


  // User context validation
  if (!data.userContext || !data.userContext.page || !data.userContext.userAgent) {
    errors.push("User context (page and userAgent) is required");
  }

  return errors;
};

// Helper function to sanitize input
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  return input.trim().replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
};

// @desc    Create new feedback
// @route   POST /api/feedback
// @access  Public (with rate limiting)
const createFeedback = asyncHandler(async (req, res) => {
  const ipAddress = req.ip || req.connection.remoteAddress;

  // Check rate limit
  if (!checkRateLimit(ipAddress)) {
    res.status(429);
    throw new Error("Too many feedback submissions. Please try again later.");
  }

  // Sanitize input data
  const sanitizedData = {
    ...req.body,
    title: sanitizeInput(req.body.title),
    description: sanitizeInput(req.body.description),
  };

  // Validate input
  const validationErrors = validateFeedbackData(sanitizedData);
  if (validationErrors.length > 0) {
    res.status(400);
    throw new Error(`Validation errors: ${validationErrors.join(", ")}`);
  }

  try {
    // Create feedback object
    const feedbackData = {
      type: sanitizedData.type,
      priority: sanitizedData.priority,
      title: sanitizedData.title || sanitizedData.description.substring(0, 50) + (sanitizedData.description.length > 50 ? '...' : ''),
      description: sanitizedData.description,
      userContext: {
        page: sanitizedData.userContext.page,
        userAgent: sanitizedData.userContext.userAgent,
        timestamp: new Date(),
        errorDetails: sanitizedData.userContext.errorDetails || {},
        viewport: sanitizedData.userContext.viewport || {},
        browserInfo: sanitizedData.userContext.browserInfo || {}
      },
      attachments: sanitizedData.attachments || [],
      tags: sanitizedData.tags || [],
      source: sanitizedData.source || "manual",
      ipAddress: ipAddress,
      sessionId: req.sessionID
    };

    // Add user ID if authenticated
    if (req.user && req.user._id) {
      feedbackData.user_id = req.user._id;
    }

    // Create feedback
    const feedback = await Feedback.create(feedbackData);

    // Populate user data if available
    const populatedFeedback = await Feedback.findById(feedback._id)
      .populate('user_id', 'actual_user_name public_user_name email')
      .lean();

    // Send email notification to admin (async, don't wait for completion)
    try {
      // Only send notification if RECEIVER_EMAIL is configured
      await emailService.sendFeedbackNotificationToAdmin({
        feedback: populatedFeedback
      });
    } catch (emailError) {
      // Log email errors but don't fail the request
      console.error("Error sending feedback notification:", emailError);
    }

    res.status(201).json({
      success: true,
      message: "Feedback submitted successfully",
      data: {
        feedback: {
          id: populatedFeedback._id,
          type: populatedFeedback.type,
          priority: populatedFeedback.priority,
          title: populatedFeedback.title,
          status: populatedFeedback.status,
          createdAt: populatedFeedback.createdAt
        }
      }
    });
  } catch (error) {
    console.error("Error creating feedback:", error);
    res.status(500);
    throw new Error("Failed to submit feedback. Please try again.");
  }
});

// @desc    Get all feedback (admin only)
// @route   GET /api/feedback
// @access  Private (Admin)
const getAllFeedback = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    type,
    status,
    priority,
    sortBy = "createdAt",
    sortOrder = "desc",
    search
  } = req.query;

  // Build filter object
  const filter = {};
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (priority) filter.priority = priority;

  // Add search functionality
  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
      { tags: { $in: [new RegExp(search, "i")] } }
    ];
  }

  try {
    const feedback = await Feedback.find(filter)
      .populate('user_id', 'actual_user_name public_user_name email')
      .populate('assignedTo', 'actual_user_name public_user_name')
      .populate('resolvedBy', 'actual_user_name public_user_name')
      .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Feedback.countDocuments(filter);

    res.json({
      success: true,
      data: {
        feedback,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error("Error fetching feedback:", error);
    res.status(500);
    throw new Error("Failed to fetch feedback");
  }
});

// @desc    Get single feedback
// @route   GET /api/feedback/:id
// @access  Private (Admin) or Public (own feedback)
const getFeedback = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const feedback = await Feedback.findById(id)
      .populate('user_id', 'actual_user_name public_user_name email')
      .populate('assignedTo', 'actual_user_name public_user_name')
      .populate('resolvedBy', 'actual_user_name public_user_name')
      .populate('adminNotes.addedBy', 'actual_user_name public_user_name');

    if (!feedback) {
      res.status(404);
      throw new Error("Feedback not found");
    }

    // Check if user can access this feedback
    const canAccess = req.user.isAdmin ||
      (feedback.user_id && feedback.user_id._id.toString() === req.user._id.toString()) ||
      feedback.is_public;

    if (!canAccess) {
      res.status(403);
      throw new Error("Access denied");
    }

    res.json({
      success: true,
      data: { feedback }
    });
  } catch (error) {
    console.error("Error fetching feedback:", error);
    if (error.message === "Feedback not found" || error.message === "Access denied") {
      throw error;
    }
    res.status(500);
    throw new Error("Failed to fetch feedback");
  }
});

// @desc    Update feedback (admin only)
// @route   PUT /api/feedback/:id
// @access  Private (Admin)
const updateFeedback = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    status,
    priority,
    assignedTo,
    tags,
    is_public,
    adminNote,
    resolution
  } = req.body;

  try {
    const feedback = await Feedback.findById(id);

    if (!feedback) {
      res.status(404);
      throw new Error("Feedback not found");
    }


    // Update allowed fields
    if (status) feedback.status = status;
    if (priority) feedback.priority = priority;
    if (assignedTo !== undefined) feedback.assignedTo = assignedTo;
    if (tags) feedback.tags = tags;
    if (is_public !== undefined) feedback.is_public = is_public;

    // Add admin note if provided
    if (adminNote) {
      await feedback.addAdminNote(adminNote, req.user._id);
    }

    // Handle resolution
    if (resolution && status === "resolved") {
      await feedback.resolve(resolution, req.user._id);
    } else {
      await feedback.save();
    }

    // Fetch updated feedback with populated fields
    const updatedFeedback = await Feedback.findById(id)
      .populate('user_id', 'actual_user_name public_user_name')
      .populate('assignedTo', 'actual_user_name public_user_name')
      .populate('resolvedBy', 'actual_user_name public_user_name');


    res.json({
      success: true,
      message: "Feedback updated successfully",
      data: { feedback: updatedFeedback }
    });
  } catch (error) {
    console.error("Error updating feedback:", error);
    if (error.message === "Feedback not found") {
      throw error;
    }
    res.status(500);
    throw new Error("Failed to update feedback");
  }
});

// @desc    Delete feedback (admin only)
// @route   DELETE /api/feedback/:id
// @access  Private (Admin)
const deleteFeedback = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const feedback = await Feedback.findById(id);

    if (!feedback) {
      res.status(404);
      throw new Error("Feedback not found");
    }

    await Feedback.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Feedback deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting feedback:", error);
    if (error.message === "Feedback not found") {
      throw error;
    }
    res.status(500);
    throw new Error("Failed to delete feedback");
  }
});

// @desc    Get feedback statistics (admin only)
// @route   GET /api/feedback/stats
// @access  Private (Admin)
const getFeedbackStats = asyncHandler(async (req, res) => {
  try {
    const stats = await Feedback.getStats();
    const trending = await Feedback.getTrending();

    // Additional statistics
    const totalCount = await Feedback.countDocuments();
    const recentCount = await Feedback.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });
    const unresolvedCount = await Feedback.countDocuments({
      status: { $nin: ["resolved", "closed"] }
    });

    res.json({
      success: true,
      data: {
        overall: {
          total: totalCount,
          recent: recentCount,
          unresolved: unresolvedCount,
          resolvedRate: totalCount > 0 ? ((totalCount - unresolvedCount) / totalCount * 100).toFixed(2) : 0
        },
        detailed: stats[0] || {},
        trending
      }
    });
  } catch (error) {
    console.error("Error fetching feedback stats:", error);
    res.status(500);
    throw new Error("Failed to fetch feedback statistics");
  }
});

// @desc    Upvote/downvote feedback
// @route   POST /api/feedback/:id/vote
// @access  Private
const voteFeedback = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { action } = req.body; // "upvote" or "remove"

  try {
    const feedback = await Feedback.findById(id);

    if (!feedback) {
      res.status(404);
      throw new Error("Feedback not found");
    }

    if (!feedback.is_public) {
      res.status(403);
      throw new Error("Cannot vote on private feedback");
    }

    let result;
    if (action === "upvote") {
      result = await feedback.addUpvote(req.user._id);
    } else if (action === "remove") {
      result = await feedback.removeUpvote(req.user._id);
    } else {
      res.status(400);
      throw new Error("Invalid vote action");
    }

    res.json({
      success: true,
      message: `Vote ${action === "upvote" ? "added" : "removed"} successfully`,
      data: {
        upvotes: result.upvotes,
        hasVoted: result.upvotedBy.includes(req.user._id)
      }
    });
  } catch (error) {
    console.error("Error voting on feedback:", error);
    if (["Feedback not found", "Cannot vote on private feedback", "Invalid vote action"].includes(error.message)) {
      throw error;
    }
    res.status(500);
    throw new Error("Failed to process vote");
  }
});

// @desc    Get my feedback
// @route   GET /api/feedback/my
// @access  Private
const getMyFeedback = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, type } = req.query;

  // Build filter
  const filter = { user_id: req.user._id };
  if (status) filter.status = status;
  if (type) filter.type = type;

  try {
    const feedback = await Feedback.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Feedback.countDocuments(filter);

    res.json({
      success: true,
      data: {
        feedback,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error("Error fetching user feedback:", error);
    res.status(500);
    throw new Error("Failed to fetch your feedback");
  }
});

module.exports = {
  createFeedback,
  getAllFeedback,
  getFeedback,
  updateFeedback,
  deleteFeedback,
  getFeedbackStats,
  voteFeedback,
  getMyFeedback
};