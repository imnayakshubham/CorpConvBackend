'use strict';

const mongoose = require('mongoose');
const { PUBLIC_EMAIL_DOMAINS } = require('../constants');
const { sendRawEmail } = require('../utils/emailService');

/**
 * GET /api/workspace/discover
 * Returns workspaces whose domain matches the authenticated user's email domain,
 * excluding personal workspaces and public email providers.
 */
const discoverWorkspaces = async (req, res) => {
    try {
        const email = req.user?.user_email_id;
        if (!email) return res.json({ workspaces: [] });

        const domain = email.split('@')[1]?.toLowerCase();
        if (!domain || PUBLIC_EMAIL_DOMAINS.has(domain)) {
            return res.json({ workspaces: [] });
        }

        const orgDb = mongoose.connection.db;

        // Find all orgs with matching domain (exclude personal type)
        const orgs = await orgDb.collection('organization').find({ domain }).toArray();

        const nonPersonal = orgs.filter((org) => {
            try {
                const meta = org.metadata ? JSON.parse(org.metadata) : {};
                return meta.type !== 'personal';
            } catch {
                return true;
            }
        });

        // Check which ones the user is already a member of
        const userId = req.user._id?.toString() || req.user.id?.toString();
        const existingMemberships = await orgDb.collection('member')
            .find({ userId, organizationId: { $in: nonPersonal.map((o) => o._id) } })
            .toArray();
        const memberOrgIds = new Set(existingMemberships.map((m) => m.organizationId));

        const result = nonPersonal
            .filter((org) => !memberOrgIds.has(org._id))
            .map((org) => ({ id: org._id, name: org.name, slug: org.slug, logo: org.logo }));

        res.json({ workspaces: result });
    } catch (err) {
        console.error('[discoverWorkspaces]', err);
        res.status(500).json({ message: 'Failed to discover workspaces' });
    }
};

/**
 * POST /api/workspace/:id/request-join
 * Notifies all owners/admins of a workspace that the user wants to join.
 */
const requestJoinWorkspace = async (req, res) => {
    try {
        const orgId = req.params.id;
        const userId = req.user._id?.toString() || req.user.id?.toString();
        const userEmail = req.user.user_email_id;
        const userName = req.user.public_user_name || req.user.actual_user_name || userEmail;

        const orgDb = mongoose.connection.db;

        const org = await orgDb.collection('organization').findOne({ _id: orgId });
        if (!org) return res.status(404).json({ message: 'Workspace not found' });

        // Verify this is not a personal workspace
        const meta = org.metadata ? JSON.parse(org.metadata) : {};
        if (meta.type === 'personal') {
            return res.status(400).json({ message: 'Cannot join a personal workspace' });
        }

        // Get all owners and admins
        const User = require('../models/userModel');
        const adminMembers = await orgDb.collection('member')
            .find({ organizationId: orgId, role: { $in: ['owner', 'admin'] } })
            .toArray();

        if (adminMembers.length === 0) {
            return res.json({ message: 'Request sent' });
        }

        const adminUserIds = adminMembers.map((m) => m.userId);
        const adminUsers = await User.find({ _id: { $in: adminUserIds } }, { user_email_id: 1 }).lean();

        const frontendUrl = process.env.FRONTEND_URL || '';
        const invitePageUrl = `${frontendUrl}/settings/workspace`;

        // Notify each admin
        await Promise.allSettled(
            adminUsers.map((admin) =>
                sendRawEmail({
                    to: admin.user_email_id,
                    subject: `${userName} wants to join ${org.name} on Hushwork`,
                    html: `<p><strong>${userName}</strong> (${userEmail}) has requested to join your workspace <strong>${org.name}</strong> on Hushwork.</p><p><a href="${invitePageUrl}">Go to workspace settings</a> to invite them.</p>`,
                    text: `${userName} (${userEmail}) has requested to join your workspace ${org.name} on Hushwork. Visit ${invitePageUrl} to invite them.`,
                })
            )
        );

        res.json({ message: 'Join request sent to workspace admins' });
    } catch (err) {
        console.error('[requestJoinWorkspace]', err);
        res.status(500).json({ message: 'Failed to send join request' });
    }
};

module.exports = { discoverWorkspaces, requestJoinWorkspace };
