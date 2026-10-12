const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!pass) return res.json({ error: 'GMAIL_APP_PASSWORD not set' });

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'ericrbond@gmail.com', pass: pass.replace(/\s/g, '') },
  });

  try {
    await transporter.verify();
    await transporter.sendMail({
      from: 'ericrbond@gmail.com',
      to: 'ericrbond@gmail.com',
      subject: 'Stekel email test',
      text: 'Email notifications are working.',
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.json({ error: err.message, code: err.code });
  }
};
