// controllers/notificationController.js
// import { Console } from 'winston/lib/winston/transports/index.js';
import firebaseConfig from '../../config/firebaseConfig.js';
import User from '../../models/Users.js';
import admin from 'firebase-admin';
import { getMessaging } from 'firebase-admin/messaging';


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





const BATCH_SIZE = 450;

export const sendBulkNotification = async (req, res) => {
  const { title, body } = req.body;

  try {
    if (!title || !body) {
      return res.status(400).json({
        success: false,
        message: 'Title and body are required fields'
      });
    }

    const users = await User.find(
      { deviceToken: { $exists: true, $ne: null } },
      { deviceToken: 1 }
    ).lean();

    if (!users.length) {
      return res.status(404).json({
        success: false,
        message: 'No device tokens found'
      });
    }

    const tokens = users.map(({ deviceToken }) => deviceToken);
    const batches = Array.from(
      { length: Math.ceil(tokens.length / BATCH_SIZE) },
      (_, i) => tokens.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
    );

    let totalSuccessful = 0;
    let totalFailed = 0;
    const allInvalidTokens = [];

    for (const batchTokens of batches) {
      const result = await getMessaging().sendMulticast({
        notification: {
          title,
          body
        },
        tokens: batchTokens
      });

      totalSuccessful += result.successCount;
      totalFailed += result.failureCount;

      if (result.failureCount > 0) {
        const invalidTokens = result.responses.reduce((acc, resp, idx) => {
          if (!resp.success &&
            (resp.error.code === 'messaging/invalid-registration-token' ||
              resp.error.code === 'messaging/registration-token-not-registered')) {
            acc.push(batchTokens[idx]);
          }
          return acc;
        }, []);

        allInvalidTokens.push(...invalidTokens);
      }
    }

    if (allInvalidTokens.length > 0) {
      await User.updateMany(
        { deviceToken: { $in: allInvalidTokens } },
        { $unset: { deviceToken: "" } }
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Notifications sent',
      summary: {
        successful: totalSuccessful,
        failed: totalFailed,
        total: tokens.length
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
  const loginuserid = req.user.id || req.user._id;
  const { userId } = req.body

  try {
    const user = await User.findById(userId);
    const loginuser = await User.findById(loginuserid);

    console.log("user", user);
    console.log("user", user.deviceToken);

    if (!user || !user.deviceToken) {
      console.log()
      return res.status(404).json({
        success: false,
        message: 'User or device token not found'
      });
    }
    const capitalize = (str) => str ? str.charAt(0).toUpperCase() + str.slice(1) : 'Unknown Person';
    // Create body text with user's name
    const body = `Your True Listener ${capitalize(loginuser.username) || capitalize(user.name) || 'Unknown Person'}`;
    const title = `Are you free now, ${capitalize(user.username) || capitalize(user.name) || 'Unknown Person'}? If Yes, Let's Connect Over A Call`;

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


export const getValidTokenCount = async (req, res) => {
  try {
    const count = await User.countDocuments({
      deviceToken: { $exists: true, $ne: null }
    });

    const usersWithTokens = await User.find(
      { deviceToken: { $exists: true, $ne: null } },
      { username: 1, deviceToken: 1, _id: 0 }
    ).lean();

    return res.status(200).json({
      success: true,
      totalCount: count,
      users: usersWithTokens,
      message: `Found ${count} users with valid device tokens`
    });

  } catch (error) {
    console.error('Error counting valid tokens:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to count valid device tokens'
    });
  }
};