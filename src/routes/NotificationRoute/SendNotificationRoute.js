// routes/notificationRoutes.js
import express from 'express';
import { sendPushNotification,sendBulkNotification } from "../../controllers/firebase/FirebaseMessage.js";
import { getNotifications } from "../../controllers/firebase/GetNotificaton.js"


const router = express.Router();

router.post('/send-notification', sendPushNotification);
router.get('/Notification', getNotifications);
router.get('/BulkNotification', sendBulkNotification);

export default router;
