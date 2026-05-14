'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { discoverWorkspaces, requestJoinWorkspace, getWorkspaceMembers } = require('../controllers/workspaceController');

router.get('/discover', protect, discoverWorkspaces);
router.get('/:orgId/members', protect, getWorkspaceMembers);
router.post('/:id/request-join', protect, requestJoinWorkspace);

module.exports = router;
