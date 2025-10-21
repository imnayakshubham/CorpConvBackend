// routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const { User } = require('../models/userModel');
const logger = require('../utils/logger');
const { admin, protect } = require('../middleware/authMiddleware');
const { getAuth } = require('../config/auth');

// Apply authentication and admin check to all routes
router.use(protect);
router.use(admin);

// Get all users
router.get('/users', async (req, res) => {
    try {
        const { search } = req.query;

        let query = {};
        if (search) {
            query = {
                $or: [
                    { user_email_id: { $regex: search, $options: "i" } },
                    { public_user_name: { $regex: search, $options: "i" } },
                    { actual_user_name: { $regex: search, $options: "i" } },
                ],
            };
        }

        const users = await User.find(query)
            .select("-token -credentials -passkey_credentials -verification_tokens -backup_codes -embedding")
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();

        return res.json({
            success: true,
            users,
            total: users.length,
        });
    } catch (error) {
        logger.error("Error fetching users:", error);
        return res.status(500).json({
            error: "Failed to fetch users",
            message: error.message,
        });
    }
});

// Get admin statistics
router.get('/stats', async (req, res) => {
    try {
        const [totalUsers, activeUsers, bannedUsers, premiumUsers] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ access: true, banned: { $ne: true } }),
            User.countDocuments({ banned: true }),
            User.countDocuments({ has_premium: true }),
        ]);

        return res.json({
            success: true,
            totalUsers,
            activeUsers,
            bannedUsers,
            premiumUsers,
        });
    } catch (error) {
        logger.error("Error fetching stats:", error);
        return res.status(500).json({
            error: "Failed to fetch stats",
            message: error.message,
        });
    }
});

// Ban/Unban user
router.post('/users/ban', async (req, res) => {
    try {
        const { userId, banned } = req.body;

        if (!userId) {
            return res.status(400).json({ error: "userId is required" });
        }

        const auth = getAuth();

        // Use Better Auth API to ban user
        await auth.api.setUserBanned({
            userId,
            banned: banned === true,
        });

        // Also update in User model
        await User.findByIdAndUpdate(userId, {
            banned: banned === true,
            access: banned !== true,
        });

        logger.info(`User ${userId} ${banned ? 'banned' : 'unbanned'} by admin ${req.user.id}`);

        return res.json({
            success: true,
            message: banned ? "User banned successfully" : "User unbanned successfully",
        });
    } catch (error) {
        logger.error("Error updating ban status:", error);
        return res.status(500).json({
            error: "Failed to update ban status",
            message: error.message,
        });
    }
});

// Update user role
router.post('/users/role', async (req, res) => {
    try {
        const { userId, isAdmin } = req.body;

        if (!userId) {
            return res.status(400).json({ error: "userId is required" });
        }

        // Update user role
        await User.findByIdAndUpdate(userId, {
            is_admin: isAdmin === true,
            role: isAdmin ? "admin" : "user",
        });

        logger.info(`User ${userId} role changed to ${isAdmin ? 'admin' : 'user'} by admin ${req.user.id}`);

        return res.json({
            success: true,
            message: isAdmin ? "User promoted to admin" : "User demoted to user",
        });
    } catch (error) {
        logger.error("Error updating role:", error);
        return res.status(500).json({
            error: "Failed to update role",
            message: error.message,
        });
    }
});

// Delete user
router.delete('/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({ error: "userId is required" });
        }

        // Prevent admin from deleting themselves
        if (userId === req.user.id) {
            return res.status(400).json({ error: "You cannot delete your own account" });
        }

        // Delete user from database
        const deletedUser = await User.findByIdAndDelete(userId);

        if (!deletedUser) {
            return res.status(404).json({ error: "User not found" });
        }

        // Delete user sessions
        const mongoose = require('mongoose');
        const db = mongoose.connection.db;
        await db.collection('session').deleteMany({ userId });

        // Delete user from organizations
        await db.collection('member').deleteMany({ user_id: userId });

        logger.info(`User ${userId} deleted by admin ${req.user.id}`);

        return res.json({
            success: true,
            message: "User deleted successfully",
        });
    } catch (error) {
        logger.error("Error deleting user:", error);
        return res.status(500).json({
            error: "Failed to delete user",
            message: error.message,
        });
    }
});

// Impersonate user (login as another user)
router.post('/users/impersonate', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: "userId is required" });
        }

        const auth = getAuth();

        // Create a new session for the target user
        const impersonateSession = await auth.api.createSession({
            userId,
            dontRememberMe: true, // Don't persist this session
        });

        logger.warn(`Admin ${req.user.id} impersonating user ${userId}`);

        return res.json({
            success: true,
            message: "Impersonation session created",
            session: impersonateSession,
        });
    } catch (error) {
        logger.error("Error impersonating user:", error);
        return res.status(500).json({
            error: "Failed to impersonate user",
            message: error.message,
        });
    }
});

// Get user details
router.get('/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await User.findById(userId)
            .select("-token -credentials -passkey_credentials -verification_tokens -backup_codes")
            .lean();

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Get user's organizations
        const mongoose = require('mongoose');
        const db = mongoose.connection.db;

        const organizations = await db.collection('member')
            .aggregate([
                { $match: { user_id: userId } },
                {
                    $lookup: {
                        from: 'organization',
                        localField: 'organization_id',
                        foreignField: 'organization_id',
                        as: 'organization'
                    }
                },
                { $unwind: '$organization' }
            ])
            .toArray();

        // Get user's active sessions
        const sessions = await db.collection('session')
            .find({ userId })
            .toArray();

        return res.json({
            success: true,
            user,
            organizations,
            sessions: sessions.length,
        });
    } catch (error) {
        logger.error("Error fetching user details:", error);
        return res.status(500).json({
            error: "Failed to fetch user details",
            message: error.message,
        });
    }
});

// Bulk actions
router.post('/users/bulk', async (req, res) => {
    try {
        const { action, userIds } = req.body;

        if (!action || !userIds || !Array.isArray(userIds)) {
            return res.status(400).json({ error: "action and userIds array are required" });
        }

        let result;

        switch (action) {
            case 'ban':
                result = await User.updateMany(
                    { _id: { $in: userIds } },
                    { banned: true, access: false }
                );
                break;

            case 'unban':
                result = await User.updateMany(
                    { _id: { $in: userIds } },
                    { banned: false, access: true }
                );
                break;

            case 'delete':
                result = await User.deleteMany({ _id: { $in: userIds } });
                // Also delete sessions
                const mongoose = require('mongoose');
                const db = mongoose.connection.db;
                await db.collection('session').deleteMany({ userId: { $in: userIds } });
                break;

            default:
                return res.status(400).json({ error: "Invalid action" });
        }

        logger.info(`Bulk action ${action} performed on ${userIds.length} users by admin ${req.user.id}`);

        return res.json({
            success: true,
            message: `${action} completed successfully`,
            affected: result.modifiedCount || result.deletedCount,
        });
    } catch (error) {
        logger.error("Error performing bulk action:", error);
        return res.status(500).json({
            error: "Failed to perform bulk action",
            message: error.message,
        });
    }
});

// ==================== ORGANIZATION MANAGEMENT ====================

// Get all organizations
router.get('/organizations', async (req, res) => {
    try {
        const { search } = req.query;
        const mongoose = require('mongoose');
        const db = mongoose.connection.db;

        let query = {};
        if (search) {
            query = {
                $or: [
                    { organization_name: { $regex: search, $options: "i" } },
                    { organization_slug: { $regex: search, $options: "i" } },
                    { company_name: { $regex: search, $options: "i" } },
                ],
            };
        }

        const organizations = await db.collection('organizations')
            .find(query)
            .sort({ organization_created_at: -1 })
            .limit(100)
            .toArray();

        return res.json({
            success: true,
            organizations,
            total: organizations.length,
        });
    } catch (error) {
        logger.error("Error fetching organizations:", error);
        return res.status(500).json({
            error: "Failed to fetch organizations",
            message: error.message,
        });
    }
});

// Get organization statistics
router.get('/organizations/stats', async (req, res) => {
    try {
        const mongoose = require('mongoose');
        const db = mongoose.connection.db;

        const [totalOrgs, activeOrgs, totalMembers] = await Promise.all([
            db.collection('organizations').countDocuments(),
            db.collection('organizations').countDocuments({ is_active: true }),
            db.collection('member').countDocuments(),
        ]);

        return res.json({
            success: true,
            totalOrganizations: totalOrgs,
            activeOrganizations: activeOrgs,
            totalMembers,
        });
    } catch (error) {
        logger.error("Error fetching organization stats:", error);
        return res.status(500).json({
            error: "Failed to fetch organization stats",
            message: error.message,
        });
    }
});

// Get organization details with members
router.get('/organizations/:orgId', async (req, res) => {
    try {
        const { orgId } = req.params;
        const mongoose = require('mongoose');
        const db = mongoose.connection.db;

        const organization = await db.collection('organizations')
            .findOne({ organization_id: orgId });

        if (!organization) {
            return res.status(404).json({ error: "Organization not found" });
        }

        // Get organization members with user details
        const members = await db.collection('member')
            .aggregate([
                { $match: { organization_id: orgId } },
                {
                    $lookup: {
                        from: 'users',
                        let: { userId: { $toObjectId: '$user_id' } },
                        pipeline: [
                            { $match: { $expr: { $eq: ['$_id', '$$userId'] } } },
                            {
                                $project: {
                                    _id: 1,
                                    public_user_name: 1,
                                    actual_user_name: 1,
                                    user_email_id: 1,
                                    user_public_profile_pic: 1,
                                    is_email_verified: 1,
                                    createdAt: 1
                                }
                            }
                        ],
                        as: 'user'
                    }
                },
                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } }
            ])
            .toArray();

        return res.json({
            success: true,
            organization,
            members,
            memberCount: members.length,
        });
    } catch (error) {
        logger.error("Error fetching organization details:", error);
        return res.status(500).json({
            error: "Failed to fetch organization details",
            message: error.message,
        });
    }
});

// Update organization
router.patch('/organizations/:orgId', async (req, res) => {
    try {
        const { orgId } = req.params;
        const updates = req.body;
        const mongoose = require('mongoose');
        const db = mongoose.connection.db;

        // Remove fields that shouldn't be directly updated
        delete updates.organization_id;
        delete updates.organization_created_at;
        delete updates.member_count;
        delete updates.created_by_user_id;

        const result = await db.collection('organizations')
            .updateOne(
                { organization_id: orgId },
                { $set: updates }
            );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Organization not found" });
        }

        logger.info(`Organization ${orgId} updated by admin ${req.user.id}`);

        return res.json({
            success: true,
            message: "Organization updated successfully",
        });
    } catch (error) {
        logger.error("Error updating organization:", error);
        return res.status(500).json({
            error: "Failed to update organization",
            message: error.message,
        });
    }
});

// Delete organization
router.delete('/organizations/:orgId', async (req, res) => {
    try {
        const { orgId } = req.params;
        const mongoose = require('mongoose');
        const db = mongoose.connection.db;

        // Delete organization
        const result = await db.collection('organizations')
            .deleteOne({ organization_id: orgId });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "Organization not found" });
        }

        // Delete all members
        await db.collection('member').deleteMany({ organization_id: orgId });

        // Delete all invitations
        await db.collection('invitation').deleteMany({ organization_id: orgId });

        logger.info(`Organization ${orgId} deleted by admin ${req.user.id}`);

        return res.json({
            success: true,
            message: "Organization and all related data deleted successfully",
        });
    } catch (error) {
        logger.error("Error deleting organization:", error);
        return res.status(500).json({
            error: "Failed to delete organization",
            message: error.message,
        });
    }
});

// Remove member from organization
router.delete('/organizations/:orgId/members/:userId', async (req, res) => {
    try {
        const { orgId, userId } = req.params;
        const mongoose = require('mongoose');
        const db = mongoose.connection.db;

        // Delete member
        const result = await db.collection('member')
            .deleteOne({ organization_id: orgId, user_id: userId });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "Member not found in organization" });
        }

        // Update member count
        await db.collection('organizations')
            .updateOne(
                { organization_id: orgId },
                { $inc: { member_count: -1 } }
            );

        logger.info(`User ${userId} removed from organization ${orgId} by admin ${req.user.id}`);

        return res.json({
            success: true,
            message: "Member removed successfully",
        });
    } catch (error) {
        logger.error("Error removing member:", error);
        return res.status(500).json({
            error: "Failed to remove member",
            message: error.message,
        });
    }
});

// Update member role
router.patch('/organizations/:orgId/members/:userId/role', async (req, res) => {
    try {
        const { orgId, userId } = req.params;
        const { role } = req.body;
        const mongoose = require('mongoose');
        const db = mongoose.connection.db;

        if (!['owner', 'admin', 'member'].includes(role)) {
            return res.status(400).json({ error: "Invalid role. Must be owner, admin, or member" });
        }

        const result = await db.collection('member')
            .updateOne(
                { organization_id: orgId, user_id: userId },
                { $set: { member_role: role } }
            );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Member not found in organization" });
        }

        logger.info(`User ${userId} role changed to ${role} in organization ${orgId} by admin ${req.user.id}`);

        return res.json({
            success: true,
            message: `Member role updated to ${role}`,
        });
    } catch (error) {
        logger.error("Error updating member role:", error);
        return res.status(500).json({
            error: "Failed to update member role",
            message: error.message,
        });
    }
});

module.exports = router;
