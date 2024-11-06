// routes/msg91Routes.js
import express from 'express';
import {
    sendOtp,
    retryOtp,
    verifyOtp,
    updateOtpTemplate,
    getAnalyticsReport,
} from '../../controllers/OTP/msg91Controller.js'

const router = express.Router();

router.post('/otp/send', sendOtp);
router.get('/otp/retry', retryOtp);
router.get('/otp/verify', verifyOtp);
router.post('/otp/template/update', updateOtpTemplate);
router.get('/report/analytics', getAnalyticsReport);

export default router;
