import crypto from 'crypto';
import sendEmail from './sendEmail.js';
export const generateOtp = () => {
  const otp = crypto.randomBytes(3).toString('hex');
  const numericOtp = parseInt(otp, 16).toString().slice(0, 6);
  if (numericOtp.length < 6) {
    return generateOtp(); // Ensure the OTP is always 6 digits
  }
  return numericOtp;
};
export const sendOtpEmail = async (email, otp) => {
  const subject = 'Your OTP Code';
  const message = `Your OTP code is ${otp}. It will expire in 1 hour.`;
  await sendEmail(email, subject, message);
};