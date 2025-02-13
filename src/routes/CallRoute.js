import express from 'express';
import { initiateCall, acceptCall, rejectCall, endCall, handleMissedCall, getRecentCalls } from '../controllers/CallController/CallController.js';
import { protect } from '../middlewares/auth/authMiddleware.js';

const router = express.Router();


router.get('/recent-calls/', protect, getRecentCalls);

// Route to initiate a call

router.post('/initiate', initiateCall);

// Route to accept a call
router.post('/accept', acceptCall);

// Route to reject a call or log a missed call
router.post('/reject', rejectCall);

// Route to end an ongoing call
router.post('/end', endCall);

// Route to handle missed calls (optional route for logging missed calls)
router.post('/missed', handleMissedCall);

export default router;
