// controllers/notificationController.js
import firebaseConfig from '../../config/firebaseConfig.js';
import User from '../../models/Users.js';


// Function to send notification to a single user
const sendSingleNotification = async (deviceToken, title, body) => {
  const message = {
    notification: {
      title,
      body,
    },
    token: deviceToken,
  };
  
  try {
    return await firebaseConfig.messaging().send(message);
  } catch (error) {
    console.error(`Error sending notification to token ${deviceToken}:`, error);
    return null;
  }
};

// Function to send notification to multiple users
export const sendBulkNotification = async (req, res) => {
  const { title, body } = req.body;

  try {
    // Fetch all users who have a device token
    const users = await User.find({ 
      deviceToken: { $exists: true, $ne: null } 
    });

    if (!users || users.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'No users with device tokens found' 
      });
    }

    // Create an array of notification promises
    const notificationPromises = users.map(user => 
      sendSingleNotification(user.deviceToken, title, body)
    );

    // Send notifications in parallel and wait for all to complete
    const results = await Promise.allSettled(notificationPromises);

    // Count successful and failed notifications
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
    const failureCount = results.length - successCount;

    return res.status(200).json({
      success: true,
      message: 'Bulk notifications processed',
      summary: {
        total: results.length,
        successful: successCount,
        failed: failureCount
      }
    });

  } catch (error) {
    console.error('Error sending bulk notifications:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to process bulk notifications', 
      error: error.message 
    });
  }
};

// Original single user notification function (kept for backward compatibility)
export const sendPushNotification = async (req, res) => {
  const { userId, title, body } = req.body;

  try {
    const user = await User.findById(userId);

    if (!user || !user.deviceToken) {
      return res.status(404).json({ 
        success: false, 
        message: 'User or device token not found' 
      });
    }

    const response = await sendSingleNotification(user.deviceToken, title, body);
    
    if (!response) {
      throw new Error('Failed to send notification');
    }

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
      error: error.message 
    });
  }
};