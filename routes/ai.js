const express = require('express');
const aiController = require('../controllers/aiController');
const { validateMessageRequest, validateSessionId } = require('../middleware/validation');

const router = express.Router();

router.post('/generate', validateMessageRequest, aiController.generateResponse);

router.post('/single', validateMessageRequest, aiController.generateSingleResponse);

router.get('/conversation/:sessionId', validateSessionId, aiController.getConversation);

router.delete('/conversation/:sessionId', validateSessionId, aiController.clearConversation);

router.get('/health', aiController.getHealth);

module.exports = router;
