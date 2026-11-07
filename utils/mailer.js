const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT),
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

async function sendOtpEmail(to, otp) {
  await transporter.sendMail({
    from: `"Kitchat" <${process.env.MAIL_USER}>`,
    to,
    subject: 'Your Kitchat verification code',
    text: `Your Kitchat OTP is ${otp}. Valid for ${process.env.OTP_EXPIRY_MINUTES || 10} minutes.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
        <h2 style="color:#1E88E5;margin:0 0 12px">Kitchat</h2>
        <p>Your verification code is:</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1E88E5;text-align:center;padding:16px;background:#f0f4f8;border-radius:8px">
          ${otp}
        </div>
        <p style="color:#6b7280;font-size:13px;margin-top:16px">Valid for ${process.env.OTP_EXPIRY_MINUTES || 10} minutes.</p>
      </div>
    `,
  });
}

module.exports = { sendOtpEmail };