import { marked } from "marked";


const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

class EmailService {
  constructor() {
    if (!process.env.RESEND_API_KEY) {
      console.warn("Resend API key not configured. Email functionality will be disabled.");
    }
  }

  async sendFormNotification({
    to,
    subject,
    message,
    from = "Form Builder <no-reply@ikiform.com>",
    analyticsUrl,
    customLinks = [],
  }) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("Resend API key not configured");
    }

    try {
      const htmlMessage = await marked.parse(message || "");

      // Generate HTML email template manually
      const html = this.generateBaseEmailHtml({
        heading: subject,
        content: htmlMessage,
        primaryCta: analyticsUrl ? { label: "View Form Analytics", url: analyticsUrl } : null,
        customLinks
      });

      const result = await resend?.emails.send({
        from,
        to,
        subject,
        html,
      });

      return result;
    } catch (error) {
      console.error("Email send error:", error);
      throw error;
    }
  }

  async sendWelcomeEmail({
    to,
    name = "User",
  }) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("Resend API key not configured");
    }

    try {
      const dashboardUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/dashboard`;

      const html = this.generateWelcomeEmailHtml({ name, dashboardUrl });

      return await resend?.emails.send({
        from: "Form Builder <no-reply@ikiform.com>",
        to,
        subject: "Welcome to Form Builder! 🎉",
        html,
      });
    } catch (error) {
      console.error("Welcome email send error:", error);
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
You have received a new form submission for **${formTitle}**.

**Submission details:**
${Object.entries(submissionData)
        .map(([key, value]) => `- **${key}**: ${value}`)
        .join('\n')}

You can view more details and analytics in your dashboard.
    `;

    return this.sendFormNotification({
      to,
      subject,
      message,
      analyticsUrl: formAnalyticsUrl,
    });
  }

  generateBaseEmailHtml({ heading, content, primaryCta, customLinks = [] }) {
    const ctaButtons = primaryCta ? `
      <div style="margin: 32px 0; text-align: center;">
        <a href="${primaryCta.url}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: 600;">
          ${primaryCta.label}
        </a>
      </div>
    ` : '';

    const secondaryLinks = customLinks.length > 0 ? `
      <div style="margin: 20px 0; text-align: center;">
        ${customLinks.map(link => `
          <a href="${link.url}" style="color: #067df7; text-decoration: underline; margin: 0 10px;">
            ${link.label}
          </a>
        `).join('')}
      </div>
    ` : '';

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${heading}</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen-Sans, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif;">
          <div style="margin: 0 auto; padding: 20px 0 48px; max-width: 560px;">
            <div style="padding: 24px; border: 1px solid #dedede; border-radius: 5px; text-align: center;">
              <h1 style="font-size: 24px; font-weight: 600; color: #000; margin: 0 0 20px;">${heading}</h1>
              <div style="font-size: 16px; line-height: 26px; color: #404040; text-align: left; margin: 20px 0;">
                ${content}
              </div>
              ${ctaButtons}
              ${secondaryLinks}
              <p style="font-size: 14px; color: #666666; margin: 20px 0 0;">
                Best regards,<br>
                Form Builder Team
              </p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  generateWelcomeEmailHtml({ name, dashboardUrl }) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to Form Builder!</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen-Sans, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif;">
          <div style="margin: 0 auto; padding: 20px 0 48px; max-width: 560px;">
            <div style="padding: 24px; border: 1px solid #dedede; border-radius: 5px; text-align: center;">
              <h1 style="font-size: 24px; font-weight: 600; color: #000; margin: 0 0 20px;">Welcome to Form Builder! 🎉</h1>
              <p style="font-size: 16px; line-height: 26px; color: #404040; text-align: left; margin: 0 0 16px;">
                Hi ${name},
              </p>
              <p style="font-size: 16px; line-height: 26px; color: #404040; text-align: left; margin: 0 0 16px;">
                Thank you for joining Form Builder! We're excited to have you on board.
                You can now create beautiful, interactive forms with our powerful form builder.
              </p>
              <p style="font-size: 16px; line-height: 26px; color: #404040; text-align: left; margin: 0 0 16px;">
                Here's what you can do with Form Builder:
              </p>
              <ul style="text-align: left; margin: 16px 0;">
                <li style="font-size: 16px; line-height: 26px; color: #404040; margin: 8px 0;">Create unlimited forms with drag-and-drop builder</li>
                <li style="font-size: 16px; line-height: 26px; color: #404040; margin: 8px 0;">Collect and analyze form responses</li>
                <li style="font-size: 16px; line-height: 26px; color: #404040; margin: 8px 0;">Customize form appearance and branding</li>
                <li style="font-size: 16px; line-height: 26px; color: #404040; margin: 8px 0;">View real-time analytics and insights</li>
              </ul>
              <div style="margin: 32px 0; text-align: center;">
                <a href="${dashboardUrl}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: 600; max-width: 200px;">
                  Get Started
                </a>
              </div>
              <p style="font-size: 14px; color: #666666; margin: 32px 0 0;">
                Best regards,<br>
                Form Builder Team
              </p>
            </div>
          </div>
        </body>
      </html>
    `;
  }
}

export default new EmailService();