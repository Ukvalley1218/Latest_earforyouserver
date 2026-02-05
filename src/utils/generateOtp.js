import crypto from "crypto";
import sendEmail from "./sendEmail.js";

export const generateOtp = () => {
  const otp = crypto.randomBytes(3).toString("hex");
  const numericOtp = parseInt(otp, 16).toString().slice(0, 6);

  if (numericOtp.length < 6) {
    return generateOtp(); // Ensure the OTP is always 6 digits
  }

  return numericOtp;
};

export const sendOtpEmail = async (email, otp) => {
  const subject = "Your OTP Code";
  const message = `Your OTP code is ${otp}. It will expire in 1 hour.`;

  await sendEmail(email, subject, message);
};

export const SendTemplate = async (email, name) => {
  const subject = "Zoom Interview Invite – Become a Listener with Ear For You";
  const message = `
Dear ${name},

Thank you for showing interest in becoming a listener with Ear For You. We’re excited to learn more about you and share what we’re building!

We'd love to invite you to a Zoom meeting as the next step in the selection process. During the session, we’ll walk you through the listener’s role, answer any questions you may have, and get to know you better.


📅 Meeting Details:**  
   - Date:08/02/2026
   - Time: 2.00pm
   - Platform: Zoom  
   - Meeting Link: [Join Here](https://us06web.zoom.us/j/83864678681?pwd=IlwROAHXochrZdTShG7Y2alcFTTByC.1)

Feel free to bring along any doubts or thoughts — we’re here to chat openly and make sure this feels like the right fit for you. 

Looking forward to seeing you there.  

Best regards,  
Ear For You Team
`;

  await sendEmail(email, subject, message);
};
