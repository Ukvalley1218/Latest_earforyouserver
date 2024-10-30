import express from 'express';
import { initiatePhonePePayment, handlePhonePeCallback } from '../../controllers/Recharge/RechargeWallet.js';
import { deductPerMinute } from '../../controllers/Recharge/Decudition.js';
const router = express.Router();

// Deduct balance per minute and credit the receiver
// Route to initiate PhonePe payment
router.post('/recharge', initiatePhonePePayment);

// Route to handle PhonePe callback after payment
router.post('/payment-callback', handlePhonePeCallback);
router.post('/deductPerMinute', deductPerMinute);
// router.get('/balance/:userId', getWalletAmount);

export default router;