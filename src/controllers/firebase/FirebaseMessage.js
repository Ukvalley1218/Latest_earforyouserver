// controllers/notificationController.js
// import { Console } from 'winston/lib/winston/transports/index.js';
import firebaseConfig from '../../config/firebaseConfig.js';
import User from '../../models/Users.js';
import admin from 'firebase-admin';

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
// export const sendBulkNotification = async (req, res) => {
//   const { title, body } = req.body;

//   try {
//     // Fetch all users who have a device token
//     const users = await User.find({ 
//       deviceToken: { $exists: true, $ne: null } 
//     });

//     if (!users || users.length === 0) {
//       return res.status(404).json({ 
//         success: false, 
//         message: 'No users with device tokens found' 
//       });
//     }

//     // Create an array of notification promises
//     const notificationPromises = users.map(user => 
//       sendSingleNotification(user.deviceToken, title, body)
//     );

//     // Send notifications in parallel and wait for all to complete
//     const results = await Promise.allSettled(notificationPromises);

//     // Count successful and failed notifications
//     const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
//     const failureCount = results.length - successCount;

//     return res.status(200).json({
//       success: true,
//       message: 'Bulk notifications processed',
//       summary: {
//         total: results.length,
//         successful: successCount,
//         failed: failureCount
//       }
//     });

//   } catch (error) {
//     console.error('Error sending bulk notifications:', error);
//     return res.status(500).json({ 
//       success: false, 
//       message: 'Failed to process bulk notifications', 
//       error: error.message 
//     });
//   }
// };



export const sendBulkNotification = async (req, res) => {
  const { title, body } = req.body;

  try {
    // Input validation
    if (!title || !body) {
      return res.status(400).json({
        success: false,
        message: 'Title and body are required fields'
      });
    }

    // Get all device tokens
    const users = await User.find(
      { deviceToken: { $exists: true, $ne: null } },
      { deviceToken: 1 }
    ).lean();

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No device tokens found'
      });
    }

    // Extract tokens and create batches
    const registrationTokens = users.map(user => user.deviceToken);
    const BATCH_SIZE = 500;
    const batches = [];

    for (let i = 0; i < registrationTokens.length; i += BATCH_SIZE) {
      batches.push(registrationTokens.slice(i, i + BATCH_SIZE));
    }

    const results = await Promise.all(
      batches.map(async (tokenBatch) => {
        const message = {
          data: {
            title,
            body,
          },
          tokens: tokenBatch
        };

        try {
          return await admin.messaging().sendEachForMulticast(message);
        } catch (error) {
          console.error('Batch error:', error);
          return {
            successCount: 0,
            failureCount: tokenBatch.length,
            responses: tokenBatch.map(() => ({ success: false }))
          };
        }
      })
    );

    // Aggregate results
    const totalResults = {
      successCount: 0,
      failureCount: 0,
      responses: []
    };

    results.forEach(result => {
      totalResults.successCount += result.successCount;
      totalResults.failureCount += result.failureCount;
      totalResults.responses.push(...result.responses);
    });

    return res.status(200).json({
      success: true,
      message: 'Notifications sent',
      summary: {
        total: registrationTokens.length,
        successful: totalResults.successCount,
        failed: totalResults.failureCount
      }
    });

  } catch (error) {
    console.error('Error sending multicast:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send notifications',
      error: error.message
    });
  }
};




// Original single user notification function (kept for backward compatibility)


export const sendPushNotification = async (req, res) => {
  
  const { userId } = req.body

  try {
    const user = await User.findById(userId);
    console.log("user",user);
    console.log("user",user.deviceToken);
    
    if (!user || !user.deviceToken)
       {
      console.log()
      return res.status(404).json({
        success: false,
        message: 'User or device token not found'
      });
    }

    // Create body text with user's name
    const body = `Your True Listener ${user.username || user.name || 'Unknown Person'}`;
    const title = `Are you free now, ${user.username || user.name || 'Unknown Person'} If Yes, Let's Connect Over A Call`
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