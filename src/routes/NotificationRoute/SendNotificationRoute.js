// routes/notificationRoutes.js
import express from 'express';
import { sendPushNotification, sendBulkNotification, getValidTokenCount } from "../../controllers/firebase/FirebaseMessage.js";
import { getNotifications } from "../../controllers/firebase/GetNotificaton.js"
import { protect } from '../../middlewares/auth/authMiddleware.js';

const router = express.Router();

router.post('/send-notification', protect, sendPushNotification);
router.get('/Notification', getNotifications);
router.post('/BulkNotification', sendBulkNotification);
// check validity
router.get('/getValidTokenCount', getValidTokenCount);

export default router;
