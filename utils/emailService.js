'use strict';

/**
 * Reusable email service.
 * Supports both SMTP (dev) and Google OAuth2 (production).
 * Uses React Email + @react-email/render for HTML generation.
 */

const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const { render } = require('@react-email/render');

let _transporter = null;

async function getTransporter() {
  if (_transporter) return _transporter;

  const useOAuth = process.env.EMAIL_USE_OAUTH === 'true';

  if (useOAuth) {
    const OAuth2 = google.auth.OAuth2;
    const oauth2Client = new OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });
    const { token: accessToken } = await oauth2Client.getAccessToken();

    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.EMAIL_FROM_ADDRESS,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
        accessToken,
      },
    });
  } else {
    // SMTP fallback (works for Mailtrap, SendGrid SMTP, etc.)
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || process.env.EMAIL_FROM_ADDRESS,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  return _transporter;
}

/**
 * Sends an email using a React Email component.
 *
 * @param {object} opts
 * @param {string}   opts.to
 * @param {string}   opts.subject
 * @param {Function} opts.component   - React component (default export)
 * @param {object}   [opts.props={}]  - Props passed to the component
 */
async function sendTemplateEmail({ to, subject, component, props = {} }) {
  const React = require('react');
  const html = await render(React.createElement(component, props));

  const transporter = await getTransporter();

  await transporter.sendMail({
    from: `"Hushwork" <${process.env.EMAIL_FROM_ADDRESS}>`,
    to,
    subject,
    html,
  });
}

/**
 * Sends a plain-text + HTML email without a React component.
 */
async function sendRawEmail({ to, subject, html, text }) {
  const transporter = await getTransporter();
  await transporter.sendMail({
    from: `"Hushwork" <${process.env.EMAIL_FROM_ADDRESS}>`,
    to,
    subject,
    html,
    text,
  });
}

module.exports = { sendTemplateEmail, sendRawEmail };
