// routes/notificationRoutes.js
import express from 'express';
import { sendPushNotification } from "../../controllers/firebase/FirebaseMessage.js";
import { getNotifications } from "../../controllers/firebase/GetNotificaton.js";
const router = express.Router();
router.post('/send-notification', sendPushNotification);
router.get('/Notification', getNotifications);
export default router;