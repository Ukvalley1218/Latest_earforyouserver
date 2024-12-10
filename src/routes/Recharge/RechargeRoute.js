import express from 'express';
// import { verifyPayment } from '../../controllers/Recharge/RechargeWallet.js'
import { initiatePayment,validatePayment,getRechargeHistory,getAllPlans,transferEarningsToWallet,getEarningHistory} from '../../controllers/Recharge/RechargeWallet.js'
import { deductPerMinute } from '../../controllers/Recharge/Decudition.js'
import { protect } from '../../middlewares/auth/authMiddleware.js'
const router = express.Router();

router.post("/pay", initiatePayment);

// Route to validate payment
router.post("/validate",validatePayment);

//  router.post('/buyPlan',buyPlan);

router.get("/getAllPlans",getAllPlans);

 router.post('/recharges/:userId', getRechargeHistory);

router.post('/earning/:userId', getEarningHistory);
// router.get("/validate/:merchantTransactionId/:userId", validatePayment); 


// router.post('/verify-payment', verifyPayment);
router.post('/deductPerMinute', deductPerMinute);


router.post('/transferEarningsToWallet',protect, transferEarningsToWallet);
// router.get('/balance/:userId', getWalletAmount);

export default router;
