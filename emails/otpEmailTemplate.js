'use strict';

/**
 * Generates plain-HTML for the secondary email OTP verification email.
 * Pure JS — no JSX, no React Email, no build step required.
 *
 * @param {{ otp: string, email: string, userName?: string|null }} opts
 * @returns {string} HTML string
 */
function buildOtpEmailHtml({ otp, email, userName }) {
  const greeting = userName ? `Hi ${userName},` : 'Hi there,';
  const year = new Date().getFullYear();

  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verify your secondary email</title>
</head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:sans-serif;color:#0f172a;">
  <table cellspacing="0" cellpadding="0" width="100%" style="background:#f0f2f5;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table cellpadding="0" cellspacing="0" width="560"
          style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:100%;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding:28px 0 20px;border-bottom:1px solid #e2e8f0;">
              <span style="font-size:1.4rem;font-weight:700;color:#0f172a;">Hushwork</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <p style="font-size:1.1rem;font-weight:600;margin:0 0 12px;">
                Verify your secondary email
              </p>
              <p style="color:#475569;line-height:1.6;margin:0 0 8px;">${greeting}</p>
              <p style="color:#475569;line-height:1.6;margin:0 0 24px;">
                You requested to add <strong>${email}</strong> as a secondary email to
                your Hushwork account. Use the code below to complete verification.
                This code expires in <strong>10 minutes</strong>.
              </p>

              <!-- OTP Box -->
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;
                          padding:24px;text-align:center;margin:0 0 24px;">
                <p style="font-size:0.7rem;color:#94a3b8;font-weight:600;
                           letter-spacing:0.1em;margin:0 0 8px;text-transform:uppercase;">
                  Verification Code
                </p>
                <p style="font-size:2.4rem;font-weight:800;letter-spacing:0.3em;
                           color:#0f172a;font-family:monospace;margin:0;">
                  ${otp}
                </p>
              </div>

              <p style="color:#64748b;font-size:0.85rem;margin:0;">
                If you didn't request this, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center"
              style="padding:20px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:0.75rem;">
              &copy; ${year} Hushwork. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

module.exports = { buildOtpEmailHtml };
