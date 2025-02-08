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


const DEFAULT_BATCH_SIZE = 500;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

const createBatches = (tokens, batchSize) => {
  // Filter out any null, undefined or empty tokens
  const validTokens = tokens.filter(token => token && token.trim());
  const batches = [];
  for (let i = 0; i < validTokens.length; i += batchSize) {
    batches.push(validTokens.slice(i, i + batchSize));
  }
  return batches;
};

const processBatches = async (batches, title, body) => {
  return Promise.all(
    batches.map(async (tokenBatch) => {
      // Create messages with proper validation
      const messages = tokenBatch
        .filter(token => token && typeof token === 'string' && token.trim())
        .map(token => ({
          token: token.trim(),
          notification: {
            title,
            body
          },
          android: {
            priority: 'high',
            notification: {
              sound: 'default',
              priority: 'high',
              channelId: 'default'
            }
          },
          apns: {
            headers: {
              'apns-priority': '10'
            },
            payload: {
              aps: {
                sound: 'default',
                badge: 1,
                contentAvailable: true
              }
            }
          }
        }));

      if (messages.length === 0) {
        return {
          successCount: 0,
          failureCount: tokenBatch.length,
          responses: tokenBatch.map(() => ({
            success: false,
            error: { message: 'Invalid token format' }
          })),
          tokens: tokenBatch
        };
      }

      let attempt = 0;
      while (attempt < MAX_RETRIES) {
        try {
          const response = await admin.messaging().sendEach(messages);
          return {
            successCount: response.successCount,
            failureCount: response.failureCount,
            responses: response.responses,
            tokens: tokenBatch
          };
        } catch (error) {
          attempt++;
          console.error(`Attempt ${attempt} failed:`, error);

          if (attempt === MAX_RETRIES) {
            console.error(`Failed to send batch after ${MAX_RETRIES} attempts:`, error);
            return {
              successCount: 0,
              failureCount: tokenBatch.length,
              responses: tokenBatch.map(() => ({
                success: false,
                error: { message: error.message }
              })),
              tokens: tokenBatch
            };
          }
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt)); // Exponential backoff
        }
      }
    })
  );
};

const aggregateResults = (results) => {
  const summary = {
    successCount: 0,
    failureCount: 0,
    responses: [],
    invalidTokens: new Set() // Using Set to avoid duplicates
  };

  results.forEach(result => {
    if (!result) return; // Skip if batch result is undefined

    summary.successCount += result.successCount;
    summary.failureCount += result.failureCount;

    result.responses.forEach((response, index) => {
      if (!response.success) {
        const errorCode = response.error?.code;
        if (errorCode === 'messaging/invalid-registration-token' ||
          errorCode === 'messaging/registration-token-not-registered') {
          summary.invalidTokens.add(result.tokens[index]);
        }
      }
    });
  });

  return {
    ...summary,
    invalidTokens: Array.from(summary.invalidTokens)
  };
};

const handleInvalidTokens = async (invalidTokens) => {
  if (!invalidTokens.length) return;

  try {
    const result = await User.updateMany(
      { deviceToken: { $in: invalidTokens } },
      { $unset: { deviceToken: 1 } }
    );
    console.log(`Cleaned up ${result.modifiedCount} invalid tokens`);
  } catch (error) {
    console.error('Error cleaning up invalid tokens:', error);
  }
};

export const sendBulkNotification = async (req, res) => {
  const { title, body, batchSize = DEFAULT_BATCH_SIZE } = req.body;

  try {
    // Input validation
    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Title and body are required fields and cannot be empty'
      });
    }

    // Fetch users with valid device tokens
    const users = await User.find(
      { deviceToken: { $exists: true, $ne: null } },
      { deviceToken: 1 }
    ).lean();

    if (!users?.length) {
      return res.status(404).json({
        success: false,
        message: 'No device tokens found'
      });
    }

    const registrationTokens = users
      .map(user => user.deviceToken)
      .filter(token => token && token.trim()); // Filter out invalid tokens

    if (!registrationTokens.length) {
      return res.status(404).json({
        success: false,
        message: 'No valid device tokens found'
      });
    }

    const batches = createBatches(registrationTokens, batchSize);
    const results = await processBatches(batches, title, body);
    const summary = aggregateResults(results);

    if (summary.invalidTokens.length) {
      await handleInvalidTokens(summary.invalidTokens);
    }

    return res.status(200).json({
      success: true,
      message: 'Notifications sent',
      summary: {
        total: registrationTokens.length,
        successful: summary.successCount,
        failed: summary.failureCount,
        invalidTokensRemoved: summary.invalidTokens.length
      }
    });

  } catch (error) {
    console.error('Error in sendBulkNotification:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send notifications',
      error: error.message
    });
  }
};