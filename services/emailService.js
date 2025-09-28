const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const { render } = require('@react-email/render');
const FeedbackNotificationEmail = require('../emails/FeedbackNotificationEmail');

class EmailService {
  constructor() {
    this.oauth2Client = null;
    this.transporter = null;
    this.initializeGoogleAuth();
  }

  async initializeGoogleAuth() {
    if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
      console.warn("Gmail OAuth credentials not configured. Email functionality will be disabled.");
      return;
    }

    try {
      this.oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
        'https://developers.google.com/oauthplayground'
      );

      this.oauth2Client.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN
      });

      await this.createTransporter();
    } catch (error) {
      console.error('Failed to initialize Gmail OAuth:', error);
    }
  }

  async createTransporter() {
    try {
      const { token } = await this.oauth2Client.getAccessToken();

      this.transporter = nodemailer.createTransporter({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user: process.env.GMAIL_USER_EMAIL,
          clientId: process.env.GMAIL_CLIENT_ID,
          clientSecret: process.env.GMAIL_CLIENT_SECRET,
          refreshToken: process.env.GMAIL_REFRESH_TOKEN,
          accessToken: token,
        },
      });
    } catch (error) {
      console.error('Failed to create Gmail transporter:', error);
      throw error;
    }
  }

  async refreshTransporter() {
    try {
      await this.createTransporter();
    } catch (error) {
      console.error('Failed to refresh Gmail transporter:', error);
      throw error;
    }
  }

  async sendEmail({ to, subject, html, from = null }) {
    if (!this.transporter) {
      throw new Error('Email service not initialized. Check Gmail OAuth configuration.');
    }

    if (!process.env.RECEIVER_EMAIL) {
      console.log('RECEIVER_EMAIL not configured. Skipping email send.');
      return null;
    }

    const mailOptions = {
      from: from || `"Hushwork" <${process.env.GMAIL_USER_EMAIL}>`,
      to: to || process.env.RECEIVER_EMAIL,
      subject,
      html,
    };

    try {
      const result = await this.transporter.sendMail(mailOptions);
      return result;
    } catch (error) {
      if (error.code === 'EAUTH' || error.responseCode === 401) {
        console.log('Gmail OAuth token expired, refreshing...');
        await this.refreshTransporter();
        return await this.transporter.sendMail(mailOptions);
      }
      throw error;
    }
  }

  async sendFeedbackNotificationToAdmin({ feedback }) {
    if (!process.env.RECEIVER_EMAIL) {
      console.log('RECEIVER_EMAIL not configured. Skipping admin notification.');
      return null;
    }

    try {
      const typeIcons = {
        bug: "🐛",
        feature: "💡",
        ui_ux: "🎨",
        performance: "⚡",
        content: "📝",
        general: "💬"
      };

      const subject = `${typeIcons[feedback.type] || "💬"} New ${feedback.type} feedback: ${feedback.title}`;
      const html = render(FeedbackNotificationEmail({ feedback }));

      return await this.sendEmail({
        to: process.env.RECEIVER_EMAIL,
        subject,
        html,
        from: `"Hushwork Feedback" <${process.env.GMAIL_USER_EMAIL}>`
      });
    } catch (error) {
      console.error("Feedback notification email error:", error);
      throw error;
    }
  }

  // Legacy methods for backward compatibility (now simplified)
  async sendFormNotification({
    to,
    subject,
    message,
    from = null,
    analyticsUrl,
    customLinks = [],
  }) {
    if (!process.env.RECEIVER_EMAIL) {
      console.log('RECEIVER_EMAIL not configured. Skipping form notification.');
      return null;
    }

    try {
      // Simple HTML template for form notifications
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${subject}</title>
          </head>
          <body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            <div style="margin: 0 auto; padding: 20px 0 48px; max-width: 560px;">
              <div style="padding: 24px; border: 1px solid #dedede; border-radius: 5px;">
                <h1 style="font-size: 24px; font-weight: 600; color: #000; margin: 0 0 20px;">${subject}</h1>
                <div style="font-size: 16px; line-height: 26px; color: #404040; margin: 20px 0;">
                  ${message}
                </div>
                ${analyticsUrl ? `
                  <div style="margin: 32px 0; text-align: center;">
                    <a href="${analyticsUrl}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: 600;">
                      View Analytics
                    </a>
                  </div>
                ` : ''}
                <p style="font-size: 14px; color: #666666; margin: 20px 0 0;">
                  Best regards,<br>
                  Hushwork Team
                </p>
              </div>
            </div>
          </body>
        </html>
      `;

      return await this.sendEmail({
        to: process.env.RECEIVER_EMAIL,
        subject,
        html,
        from
      });
    } catch (error) {
      console.error("Form notification email error:", error);
      throw error;
    }
  }

  async sendWelcomeEmail({ to, name = "User" }) {
    if (!process.env.RECEIVER_EMAIL) {
      console.log('RECEIVER_EMAIL not configured. Skipping welcome email.');
      return null;
    }

    try {
      const dashboardUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/dashboard`;

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Welcome to Hushwork!</title>
          </head>
          <body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            <div style="margin: 0 auto; padding: 20px 0 48px; max-width: 560px;">
              <div style="padding: 24px; border: 1px solid #dedede; border-radius: 5px; text-align: center;">
                <h1 style="font-size: 24px; font-weight: 600; color: #000; margin: 0 0 20px;">Welcome to Hushwork! 🎉</h1>
                <p style="font-size: 16px; line-height: 26px; color: #404040; text-align: left; margin: 0 0 16px;">
                  Hi ${name},
                </p>
                <p style="font-size: 16px; line-height: 26px; color: #404040; text-align: left; margin: 0 0 16px;">
                  Thank you for joining Hushwork! We're excited to have you on board.
                </p>
                <div style="margin: 32px 0; text-align: center;">
                  <a href="${dashboardUrl}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: 600;">
                    Get Started
                  </a>
                </div>
                <p style="font-size: 14px; color: #666666; margin: 32px 0 0;">
                  Best regards,<br>
                  Hushwork Team
                </p>
              </div>
            </div>
          </body>
        </html>
      `;

      return await this.sendEmail({
        to: process.env.RECEIVER_EMAIL,
        subject: "Welcome to Hushwork! 🎉",
        html,
        from: `"Hushwork" <${process.env.GMAIL_USER_EMAIL}>`
      });
    } catch (error) {
      console.error("Welcome email error:", error);
      throw error;
    }
  }

  async sendFormSubmissionNotification({
    to,
    formTitle,
    submissionData,
    formAnalyticsUrl,
  }) {
    const subject = `New submission for "${formTitle}"`;
    const message = `
      You have received a new form submission for <strong>${formTitle}</strong>.
      <br><br>
      <strong>Submission details:</strong><br>
      ${Object.entries(submissionData)
        .map(([key, value]) => `• <strong>${key}:</strong> ${value}`)
        .join('<br>')}
      <br><br>
      You can view more details and analytics in your dashboard.
    `;

    return this.sendFormNotification({
      to,
      subject,
      message,
      analyticsUrl: formAnalyticsUrl,
    });
  }
}

module.exports = new EmailService();