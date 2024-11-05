import express from 'express';
// import { verifyPayment } from '../../controllers/Recharge/RechargeWallet.js'
import { initiatePayment,validatePayment } from '../../controllers/Recharge/RechargeWallet.js'
import { deductPerMinute } from '../../controllers/Recharge/Decudition.js'
const router = express.Router();

router.get("/pay", initiatePayment);

// Route to validate payment
router.get("/validate/:merchantTransactionId", validatePayment);;

// router.post('/verify-payment', verifyPayment);
router.post('/deductPerMinute', deductPerMinute);
// router.get('/balance/:userId', getWalletAmount);

export default router;
