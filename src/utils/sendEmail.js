
import nodemailer from 'nodemailer';

const sendEmail = async (email, subject, message) => {
    try {
        let transporter = nodemailer.createTransport({
            service: 'gmail',  // Using Gmail as the email service
            auth: {
                user: process.env.EMAIL_USER, // Your email id
                pass: process.env.EMAIL_PASS // Your password
            },
        });

        let mailOptions = {
            from: process.env.EMAIL_USER,  // Sender address
            to: email,  // Recipient's email
            subject: subject,  // Email subject
            text: message,  // Plain text message
        };

        // Send the email
        await transporter.sendMail(mailOptions);
        console.log('Email sent successfully');
    } catch (error) {
        console.error('Error sending email:', error);
        throw new Error('Error sending email');
    }
};

export default sendEmail;


// =ukvalleytech@gmail.com   
// =leuekrikffdperkg