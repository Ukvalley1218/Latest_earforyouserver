import nodemailer from 'nodemailer';
const sendEmail = async (email, subject, message) => {
  try {
    let transporter = nodemailer.createTransport({
      service: 'Gmail',
      // or any other email service provider
      auth: {
        user: process.env.EMAIL_USER,
        // Your email id
        pass: process.env.EMAIL_PASS // Your password
      }
    });
    let mailOptions = {
      from: process.env.EMAIL_USER,
      // sender address
      to: email,
      // list of receivers
      subject: subject,
      // Subject line
      text: message // plain text body
    };
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error('Error sending email');
  }
};
export default sendEmail;