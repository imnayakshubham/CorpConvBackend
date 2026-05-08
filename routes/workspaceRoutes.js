'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { discoverWorkspaces, requestJoinWorkspace } = require('../controllers/workspaceController');

router.get('/discover', protect, discoverWorkspaces);
router.post('/:id/request-join', protect, requestJoinWorkspace);

module.exports = router;
