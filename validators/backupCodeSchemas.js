'use strict';

const { z } = require('zod');

// XXXXX-XXXXX  (hex uppercase, optional lowercase accepted then normalised)
const codePattern = /^[A-Fa-f0-9]{5}-[A-Fa-f0-9]{5}$/;

const verifyBackupCodeBody = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(codePattern, 'Invalid backup code format'),
}).strict();

// No body needed for generate / regenerate — auth is the signal
const generateBackupCodesBody = z.object({}).strict();

module.exports = { verifyBackupCodeBody, generateBackupCodesBody };
