// controllers/notificationController.js
import firebaseConfig from '../../config/firebaseConfig.js';
import User from '../../models/Users.js';
export const sendPushNotification = async (req, res) => {
  const {
    userId,
    title,
    body
  } = req.body;
  try {
    // Find the user by userId
    const user = await User.findById(userId);
    if (!user || !user.deviceToken) {
      return res.status(404).json({
        success: false,
        message: 'User or device token not found'
      });
    }
    const message = {
      notification: {
        title,
        body
        // sound: 'default', // This sets the default sound for notifications
      },
      token: user.deviceToken // Use the device token from the database
    };
    console.log(user.deviceToken);
    // Send the notification using the Firebase messaging service
    const response = await firebaseConfig.messaging().send(message);
    return res.status(200).json({
      success: true,
      message: 'Notification sent!',
      response
    });
  } catch (error) {
    console.error('Error sending notification:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send notification',
      error
    });
  }
};