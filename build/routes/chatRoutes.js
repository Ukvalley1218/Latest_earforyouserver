import express from 'express';
import { sendMessage, receiveMessage } from '../controllers/chatController.js';
// import { protect } from '../../middlewares/auth/authMiddleware.js';

const router = express.Router();

// router.post('/send',  sendMessage);
// router.post('/receive',  receiveMessage);

export default router;