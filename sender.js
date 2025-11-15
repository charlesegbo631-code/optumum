import nodemailer from "nodemailer";

async function send() {
  let transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "YOUR_GMAIL@gmail.com",
      pass: "YOUR_APP_PASSWORD"  // NOT your Gmail password
    }
  });

  let info = await transporter.sendMail({
    from: '"Test Sender" <YOUR_GMAIL@gmail.com>',
    to: "YOUR_MAIL_TM_EMAIL",
    subject: "Mail.tm Test Message",
    text: "This is a test email sent to your Mail.tm inbox!"
  });

  console.log("Message Sent:", info.messageId);
}

send().catch(console.error);
