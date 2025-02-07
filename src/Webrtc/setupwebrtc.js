import mongoose from 'mongoose';
import CallLog from '../models/Talk-to-friend/callLogModel.js';
import logger from '../logger/winston.logger.js';
import User from '../models/Users.js';
import Wallet from '../models/Wallet/Wallet.js'
import admin from 'firebase-admin';
// import { ChatMessage } from '../models/message.models.js';

export const setupWebRTC = (io) => {
  // Store active users and their socket connections
  const users = {}; // { userId: [socketId1, socketId2, ...] }
  const activeCalls = {}; // { userId: otherUserId }
  const callTimings = {};
  const randomCallQueue = new Set();
  const onlineUsers = new Map(); // Map to track user IDs and their socket IDs
  const CALL_TIMEOUT = 60000; // 1 minute in milliseconds
  const pendingCalls = {}; // Track pending calls between users
  // Queue to store connected users
  const userQueue = [];

  // Function to add user to the queue
  const addUserToQueue = (userId, socketId) => {
    userQueue.push({ userId, socketId });
  };

  // Function to remove user from the queue
  const removeUserFromQueue = (socketId) => {
    const index = userQueue.findIndex(user => user.socketId === socketId);
    if (index !== -1) userQueue.splice(index, 1);
  };


  io.on('connection', (socket) => {
    logger.http(`User connected: ${socket.id}`);


    socket.on('join', async ({ userId }) => {
      try {
        // Ensure user entry in the users object
        if (!users[userId]) {
          users[userId] = [];
        }
        users[userId].push(socket.id);

        // Log socket connection
        logger.info(`User ${userId} joined with socket ID ${socket.id}`);

        // Update user's status in the database
        const updatedUser = await User.findByIdAndUpdate(
          userId,
          { status: 'Online' }, // Assuming `status` is the field
          { new: true } // Returns the updated document
        );

        if (updatedUser) {
          logger.info(`User ${userId}'s status updated to online in the database.`);

          // Emit the status update to all connected clients
          io.emit('statusUpdated', { userId, status: 'Online' });
        }
      } catch (error) {
        logger.error(`Error updating status for user ${userId}: ${error.message}`);
      }
    });



    // Listen for `statusUpdated` event
    socket.on('statusUpdated', ({ userId, status }) => {
      try {

        // Validate the incoming data
        if (!userId || !status) {
          throw new Error('Invalid data: userId and status are required.');
        }

        // Emit the updated status to all connected clients
        io.emit('statusUpdated', { userId, status });

        // Provide a response to the sender (acknowledgment)

      } catch (error) {
        console.error('Error handling statusUpdated event:', error.message);


      }
    });

    socket.on('registerUser', async (userId) => {
      addUserToQueue(userId, socket.id);
      console.log(`User registered: ${userId}`);
      console.log('Current queue:', userQueue);
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { status: 'Online' }, // Assuming `status` is the field
        { new: true } // Returns the updated document
      );
      if (updatedUser) {

        io.emit('updateQueue', userQueue);
      }

      // Emit the current queue to all connected clients
    });

    socket.on('requestRandomCall', async ({ userId }) => {
      try {
        logger.info(`User ${userId} requesting random call`);

        // Check if user is already in a call
        if (activeCalls[userId]) {
          socket.emit('callError', { message: 'You are already in a call' });
          return;
        }

        // Check if user is already in queue
        if (randomCallQueue.has(userId)) {
          socket.emit('callError', { message: 'You are already in random call queue' });
          return;
        }

        const user = await User.findById(userId);

        // Check if user exists and is a CALLER
        if (!user || user.userType !== 'CALLER') {
          socket.emit('callError', { message: 'Only CALLER users can initiate calls' });
          return;
        }

        // Check if user is eligible to initiate a call based on category
        if (['Doctor', 'Therapist', 'Healer', 'Psychologist'].includes(user.userCategory)) {
          socket.emit('callError', { message: 'You are not eligible to initiate a call based on your category' });
          return;
        }

        // Get all available RECEIVER users only
        const allAvailableUsers = Object.keys(users).filter(async potentialUserId => {
          const potentialUser = await User.findById(potentialUserId);
          return potentialUserId !== userId && // Not the requesting user
            !activeCalls[potentialUserId] && // Not in a call
            users[potentialUserId]?.length > 0 && // Has active socket connections
            !randomCallQueue.has(potentialUserId) && // Not already in queue
            potentialUser?.userType === 'RECEIVER'; // Must be a RECEIVER type
        });

        logger.info(`Available RECEIVER users for call with ${userId}:`, {
          totalAvailable: allAvailableUsers.length,
          availableUserIds: allAvailableUsers,
          activeConnections: allAvailableUsers.map(id => ({
            userId: id,
            socketCount: users[id]?.length || 0
          }))
        });

        if (allAvailableUsers.length > 0) {
          // Match with a random available RECEIVER user
          const randomIndex = Math.floor(Math.random() * allAvailableUsers.length);
          const matchedUserId = allAvailableUsers[randomIndex];

          // Get user details for both parties
          const [caller, receiver] = await Promise.all([
            User.findById(userId),
            User.findById(matchedUserId)
          ]);

          if (!caller || !receiver) {
            socket.emit('callError', { message: 'Failed to match users' });
            return;
          }

          // Verify again that receiver is of type RECEIVER
          if (receiver.userType !== 'RECEIVER') {
            socket.emit('callError', { message: 'Invalid match - Receiver type mismatch' });
            return;
          }

          // Set active call status
          activeCalls[userId] = matchedUserId;
          activeCalls[matchedUserId] = userId;

          // Notify the caller about the match
          socket.emit('randomCallMatched', {
            matchedUserId: matchedUserId,
            matchedUsername: receiver.username,
            socketId: socket.id
          });

          // Notify the matched RECEIVER about incoming call
          users[matchedUserId].forEach((receiverSocketId) => {
            socket.to(receiverSocketId).emit('incomingRandomCall', {
              callerId: userId,
              callerUsername: caller.username,
              socketId: socket.id
            });
          });

          // Send push notification if receiver has a device token
          if (receiver.deviceToken) {
            const title = 'Incoming Call';
            const message = `${caller.username} wants to connect with you!`;
            await sendNotification(matchedUserId, title, message);
            logger.info(`Push notification sent to RECEIVER ${matchedUserId}`);
          }

          logger.info(`Call matched: CALLER ${userId} with RECEIVER ${matchedUserId}`);

        } else {
          // Add CALLER to queue if no RECEIVER users available
          randomCallQueue.add(userId);
          socket.emit('waitingForRandomMatch', {
            message: 'Waiting for a RECEIVER to become available'
          });
          logger.info(`CALLER ${userId} added to call queue`);

          // Set a timeout for queue waiting
          setTimeout(() => {
            if (randomCallQueue.has(userId)) {
              randomCallQueue.delete(userId);
              socket.emit('randomCallTimeout', {
                message: 'No RECEIVER users available. Please try again later.'
              });
              logger.info(`CALLER ${userId} removed from queue due to timeout`);
            }
          }, 60000); // 60 seconds queue timeout
        }
      } catch (error) {
        logger.error(`Error in call handler: ${error.message}`);
        socket.emit('callError', { message: 'Failed to process call request' });
      }
    });

    // Add a middleware to prevent CALLER users from receiving calls
    socket.use((packet, next) => {
      const eventName = packet[0];
      if (eventName === 'incomingRandomCall') {
        const userId = socket.userId; // Assuming you store userId in socket
        User.findById(userId)
          .then(user => {
            if (user && user.userType === 'CALLER') {
              // Block the incoming call event for CALLER users
              return;
            }
            next();
          })
          .catch(error => {
            logger.error(`Error in socket middleware: ${error.message}`);
            next();
          });
      } else {
        next();
      }
    });



    socket.on('acceptRandomCall', async ({ receiverId, callerId }) => {
      try {
        logger.info(`User ${receiverId} accepted random call from User ${callerId}`);

        // Store call start time
        const callKey = `${receiverId}_${callerId}`;

        callTimings[callKey] = {
          startTime: new Date()
        };



        if (users[callerId]) {
          users[callerId].forEach((socketId) => {
            socket.to(socketId).emit('randomCallAccepted', {
              receiverId,
              socketId: socket.id
            });
          });
        }
      } catch (error) {
        logger.error(`Error in acceptRandomCall handler: ${error.message}`);
        socket.emit('callError', { message: 'Failed to accept random call' });
      }
    });

    // Handle random call rejection

    socket.on('rejectRandomCall', async ({ receiverId, callerId }) => {
      try {
        logger.info(`User ${receiverId} rejected random call from User ${callerId}`);

        // Clean up call status
        delete activeCalls[callerId];
        delete activeCalls[receiverId];

        // Notify caller about rejection
        if (users[callerId]) {
          users[callerId].forEach((socketId) => {
            socket.to(socketId).emit('randomCallRejected', { receiverId });
          });
        }

        // Create call log
        await CallLog.create({
          caller: new mongoose.Types.ObjectId(callerId),
          receiver: new mongoose.Types.ObjectId(receiverId),
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
          status: 'rejected',
          callType: 'random'
        });
      } catch (error) {
        logger.error(`Error in rejectRandomCall handler: ${error.message}`);
        socket.emit('callError', { message: 'Failed to reject random call' });
      }
    });

    // Cancel random call request

    socket.on('cancelRandomCall', ({ userId }) => {
      if (randomCallQueue.has(userId)) {
        randomCallQueue.delete(userId);
        socket.emit('randomCallCancelled', {
          message: 'Random call request cancelled'
        });
        logger.info(`User ${userId} cancelled random call request`);
      }
    });

    // socket.on('call', async ({ callerId, receiverId }) => {
    //   try {
    //     logger.info(`User ${callerId} is calling User ${receiverId}`);

    //     // Check if either user is already in a call
    //     if (activeCalls[receiverId] || activeCalls[callerId]) {
    //       socket.emit('userBusy', { receiverId });
    //       logger.warn(`User ${receiverId} or ${callerId} is already in a call`);
    //       return;
    //     }

    //     // Fetch user details
    //     const [receiver, caller] = await Promise.all([
    //       User.findById(receiverId),
    //       User.findById(callerId),
    //     ]);

    //     if (!receiver) {
    //       socket.emit('receiverUnavailable', { receiverId });
    //       logger.warn(`Receiver user ${receiverId} not found`);
    //       return;
    //     }

    //     if (!caller) {
    //       socket.emit('callerUnavailable', { callerId });
    //       logger.warn(`Caller user ${callerId} not found`);
    //       return;
    //     }

    //     // Initialize socket arrays if needed
    //     users[callerId] = users[callerId] || [];
    //     users[receiverId] = users[receiverId] || [];

    //     // Add current socket to caller's list if not already present
    //     if (!users[callerId].includes(socket.id)) {
    //       users[callerId].push(socket.id);
    //     }

    //     if (users[receiverId].length > 0) {
    //       // Notify all receiver's sockets about the incoming call
    //       users[receiverId].forEach((socketId) => {
    //         socket.to(socketId).emit('incomingCall', {
    //           callerId,
    //           callerSocketId: socket.id, // Provide caller's socket ID
    //         });
    //       });

    //       // Notify the caller to play caller tune
    //       socket.emit('playCallerTune', { callerId });

    //       // Send push notification if the receiver has a device token
    //       if (receiver.deviceToken) {
    //         const title = 'Incoming Call';
    //         const message = `${caller.username || 'Unknown Caller'} is calling you!`;
    //         const type = 'incoming_call';
    //         const senderName = caller.username || 'Unknown Caller';
    //         const senderAvatar = caller.avatarUrl || 'https://investogram.ukvalley.com/avatars/default.png';

    //         await sendNotification_call(receiverId, title, message, type, callerId, senderName, senderAvatar);
    //         logger.info(`Push notification sent to User ${receiverId}`);
    //       }

    //     } else {
    //       // Handle case where receiver is offline or unavailable
    //       if (receiver.deviceToken) {
    //         const title = 'Incoming Call';
    //         const message = `${caller.username || 'Unknown Caller'} is calling you!`;
    //         const type = 'incoming_call';
    //         const senderName = caller.username || 'Unknown Caller';
    //         const senderAvatar = caller.avatarUrl || 'https://investogram.ukvalley.com/avatars/default.png';

    //         try {
    //           // Send initial notification
    //           await sendNotification_call(receiverId, title, message, type, callerId, senderName, senderAvatar);
    //           logger.info(`Push notification sent to User ${receiverId}`);

    //           // Cleanup timeout if the call is accepted, rejected, or ended
    //           const cleanupTimeout = () => {
    //             logger.info(`Call timeout cleared for User ${receiverId}`);
    //           };

    //           socket.on('acceptCall', cleanupTimeout);
    //           socket.on('rejectCall', cleanupTimeout);
    //           socket.on('endCall', cleanupTimeout);
    //         } catch (error) {
    //           logger.error(`Failed to send push notification to User ${receiverId}: ${error.message}`);
    //         }
    //       } else {
    //         logger.warn(`No device token available for User ${receiverId}, skipping notification`);
    //       }
    //     }
    //   } catch (error) {
    //     logger.error(`Error in call handler: ${error.message}`);
    //     socket.emit('callError', { message: 'Failed to initiate call' });
    //   }
    // });



    // Handle WebRTC offer


    socket.on('call', async ({ callerId, receiverId }) => {
      try {
        // Input validation
        if (!callerId || !receiverId) {
          logger.error('[CALL_VALIDATION] Invalid caller or receiver ID', { callerId, receiverId });
          socket.emit('callError', { message: 'Invalid user IDs provided' });
          return;
        }

        logger.info(`[CALL_START] User ${callerId} is calling User ${receiverId}`);
        logger.debug(`[CALL_STATE] Current active calls:`, JSON.stringify(activeCalls));
        logger.debug(`[CALL_STATE] Current pending calls:`, JSON.stringify(pendingCalls));

        // Check if either user is already in a call
        if (activeCalls[receiverId] || activeCalls[callerId]) {
          logger.warn(`[CALL_BUSY] User ${activeCalls[receiverId] ? receiverId : callerId} is already in a call`);
          socket.emit('userBusy', { receiverId });
          return;
        }

        // Generate pending call key with string conversion to prevent NaN
        const pendingCallKey = `${callerId}_${receiverId}`;
        logger.debug(`[CALL_KEY] Generated pending call key: ${pendingCallKey}`);

        // Check for existing pending calls
        if (pendingCalls[pendingCallKey]) {
          const existingCall = pendingCalls[pendingCallKey];
          const timeSinceCall = Date.now() - existingCall.timestamp;

          logger.debug(`[CALL_CONFLICT_CHECK] Found existing call:`, {
            existingCall: JSON.stringify(existingCall),
            timeSinceCall,
            isStale: timeSinceCall >= 5000
          });

          // Handle call conflict if call is not stale
          if (timeSinceCall < 5000) {
            logger.warn(`[CALL_CONFLICT] Simultaneous call detected between users ${callerId} and ${receiverId}`);

            // Update conflict state
            pendingCalls[pendingCallKey] = {
              conflict: true,
              timestamp: Date.now(),
              users: [callerId, receiverId],
              originalCall: existingCall
            };

            // Notify about conflict
            const conflictMessage = {
              message: 'Simultaneous call detected',
              timestamp: Date.now()
            };

            // Notify caller
            socket.emit('callConflict', {
              ...conflictMessage,
              otherUserId: receiverId
            });

            // Notify receiver
            if (users[receiverId]) {
              users[receiverId].forEach(socketId => {
                socket.to(socketId).emit('callConflict', {
                  ...conflictMessage,
                  otherUserId: callerId
                });
              });
            }

            // Set cleanup timeout for conflict state
            setTimeout(() => {
              if (pendingCalls[pendingCallKey]?.conflict) {
                logger.info(`[CALL_CONFLICT_CLEANUP] Clearing conflict state for call between ${callerId} and ${receiverId}`);
                delete pendingCalls[pendingCallKey];
              }
            }, 5000);

            // Return early to prevent incoming call emission
            return;
          } else {
            // Clear stale pending call
            logger.info(`[CALL_CLEANUP] Clearing stale call entry for ${pendingCallKey}`);
            delete pendingCalls[pendingCallKey];
          }
        }

        // Store new call attempt
        pendingCalls[pendingCallKey] = {
          callerId,
          receiverId,
          timestamp: Date.now(),
          socketId: socket.id,
          conflict: false
        };

        logger.debug(`[CALL_NEW] Stored new call attempt:`, pendingCalls[pendingCallKey]);

        // Set cleanup timeout
        const cleanupTimeout = setTimeout(() => {
          if (pendingCalls[pendingCallKey]) {
            logger.info(`[CALL_TIMEOUT] Call request timed out between ${callerId} and ${receiverId}`);
            delete pendingCalls[pendingCallKey];

            socket.emit('callTimeout', {
              receiverId,
              message: 'Call request timed out'
            });
          }
        }, 30000);

        // Store cleanup timeout reference
        pendingCalls[pendingCallKey].cleanupTimeout = cleanupTimeout;

        // Fetch user details
        logger.debug(`[CALL_FETCH] Fetching user details for caller ${callerId} and receiver ${receiverId}`);
        const [receiver, caller] = await Promise.all([
          User.findById(receiverId),
          User.findById(callerId),
        ]);

        // Validate users exist
        if (!receiver) {
          logger.warn(`[CALL_ERROR] Receiver ${receiverId} not found in database`);
          socket.emit('receiverUnavailable', { receiverId });
          return;
        }

        if (!caller) {
          logger.warn(`[CALL_ERROR] Caller ${callerId} not found in database`);
          socket.emit('callerUnavailable', { callerId });
          return;
        }

        // Initialize socket arrays
        users[callerId] = users[callerId] || [];
        users[receiverId] = users[receiverId] || [];

        // Register caller socket if needed
        if (!users[callerId].includes(socket.id)) {
          users[callerId].push(socket.id);
          logger.debug(`[SOCKET_REGISTER] Registered socket ${socket.id} for caller ${callerId}`);
        }

        // Check if we can proceed with the call
        // Important: We check again for conflicts here
        const currentCallState = pendingCalls[pendingCallKey];
        if (!currentCallState || currentCallState.conflict) {
          logger.info(`[CALL_BLOCKED] Call blocked due to state change:`, {
            exists: !!currentCallState,
            hasConflict: currentCallState?.conflict
          });
          return;
        }

        // Only emit incoming call if receiver has active sockets
        if (users[receiverId].length > 0) {
          // Notify receiver's sockets
          users[receiverId].forEach((socketId) => {
            socket.to(socketId).emit('incomingCall', {
              callerId,
              callerSocketId: socket.id,
              callerName: caller.username || 'Unknown Caller',
              timestamp: Date.now()
            });
            logger.info(`[CALL_NOTIFY] Sent incoming call notification to receiver ${receiverId} via socket ${socketId}`);
          });

          // Emit caller tune
          socket.emit('playCallerTune', {
            callerId,
            timestamp: Date.now()
          });
        }

        // Handle push notification
        if (receiver.deviceToken) {
          try {
            const notificationData = {
              title: 'Incoming Call',
              message: `${caller.username || 'Unknown Caller'} is calling you!`,
              type: 'incoming_Call',
              senderName: caller.username || 'Unknown Caller',
              senderAvatar: caller.avatarUrl || 'https://investogram.ukvalley.com/avatars/default.png'
            };

            await sendNotification_call(
              receiverId,
              notificationData.title,
              notificationData.message,
              notificationData.type,
              callerId,
              notificationData.senderName,
              notificationData.senderAvatar
            );
            logger.info(`[PUSH_NOTIFY] Successfully sent push notification to User ${receiverId}`);
          } catch (notifyError) {
            logger.error(`[PUSH_ERROR] Failed to send push notification:`, notifyError);
          }
        }

      } catch (error) {
        logger.error(`[CALL_ERROR] Error in call handler:`, {
          error: error.message,
          stack: error.stack,
          callerId,
          receiverId
        });

        socket.emit('callError', {
          message: 'Failed to initiate call',
          details: error.message
        });

        // Cleanup any partial call state
        const pendingCallKey = `${callerId}_${receiverId}`;
        if (pendingCalls[pendingCallKey]) {
          if (pendingCalls[pendingCallKey].cleanupTimeout) {
            clearTimeout(pendingCalls[pendingCallKey].cleanupTimeout);
          }
          delete pendingCalls[pendingCallKey];
        }
      }
    });

    socket.on('offer', async ({ offer, callerId, receiverId }) => {
      try {
        logger.info(`User ${callerId} sending offer to User ${receiverId}`);

        // Set active call status during WebRTC setup
        activeCalls[callerId] = receiverId;
        activeCalls[receiverId] = callerId;

        if (users[receiverId]) {
          users[receiverId].forEach((socketId) => {
            socket.to(socketId).emit('offer', { offer, callerId });
          });
          logger.info(`Offer sent to User ${receiverId}`);
        } else {
          socket.emit('userUnavailable', { receiverId });
          logger.warn(`User ${receiverId} not found during offer`);
        }
      } catch (error) {
        logger.error(`Error in offer handler: ${error.message}`);
        socket.emit('callError', { message: 'Failed to process offer' });
      }
    });

    // Handle WebRTC answer
    socket.on('answer', ({ answer, receiverId, callerId }) => {
      try {
        logger.info(`User ${receiverId} sending answer to User ${callerId}`);

        if (users[callerId]) {
          users[callerId].forEach((socketId) => {
            socket.to(socketId).emit('answer', { answer, receiverId });
          });
        }
      } catch (error) {
        logger.error(`Error in answer handler: ${error.message}`);
        socket.emit('callError', { message: 'Failed to process answer' });
      }
    });




    socket.on('iceCandidate', ({ candidate, callerId, receiverId }) => {
      try {
        // Log incoming ICE candidate
        logger.info('ICE candidate received', { callerId, receiverId });

        // Check if candidate exists
        if (!candidate) {
          logger.warn('Invalid ICE candidate received');
          socket.emit('error', {
            type: 'ICE_CANDIDATE_ERROR',
            message: 'Invalid ICE candidate'
          });
          return;
        }

        // Check if receiver exists in users
        if (!users[receiverId]) {
          logger.warn(`Receiver ${receiverId} not found in users`);
          socket.emit('error', {
            type: 'ICE_CANDIDATE_ERROR',
            message: 'Receiver not found'
          });
          return;
        }

        // Check if receiver has any socket connections
        if (!Array.isArray(users[receiverId]) || users[receiverId].length === 0) {
          logger.warn(`No active sockets for receiver ${receiverId}`);
          socket.emit('error', {
            type: 'ICE_CANDIDATE_ERROR',
            message: 'Receiver not connected'
          });
          return;
        }

        // Forward ICE candidate to all receiver's sockets
        users[receiverId].forEach((socketId) => {
          socket.to(socketId).emit('iceCandidate', {
            candidate,
            callerId,
            timestamp: Date.now()
          });
          logger.info(`ICE candidate forwarded`, {
            from: callerId,
            to: receiverId,
            socketId
          });
        });

      } catch (error) {
        logger.error('Error in iceCandidate handler:', {
          error: error.message,
          callerId,
          receiverId
        });

        socket.emit('error', {
          type: 'ICE_CANDIDATE_ERROR',
          message: 'Failed to process ICE candidate'
        });
      }
    });


    socket.on('acceptCall', async ({ receiverId, callerId }) => {
      try {
        logger.info(`User ${receiverId} accepted the call from User ${callerId}`);

        // Generate a unique key for the call session
        const callKey = `${receiverId}_${callerId}`;
        logger.info(`Call session key: ${callKey}`);

        // Record the start time of the call
        callTimings[callKey] = {
          startTime: new Date(), // Start time as a Date object
        };

        // Notify the caller that the call has been accepted
        if (users[callerId] && users[callerId].length > 0) {
          users[callerId].forEach((socketId) => {
            // Emit 'callAccepted' to all the caller's connected sockets
            socket.to(socketId).emit('callAccepted', {
              receiverId,
              receiverSocketId: socket.id, // Provide the receiver's socket ID
            });

            // Notify about the active call
            socket.to(socketId).emit('activeCall', {
              callerId,
              receiverId,
              receiverSocketId: socket.id,
            });
          });

          logger.info(`Call accepted notification sent to User ${callerId}`);

          // Stop the caller's tune after call acceptance
          socket.emit('stopCallerTune', { callerId });
        } else {
          // Handle the case where the caller's socket information is missing
          logger.warn(`Caller sockets not found for User ${callerId}`);
          socket.emit('callError', {
            message: `Unable to notify User ${callerId} about call acceptance.`,
          });
        }

        // Log successful acceptance
        logger.info(
          `Call between User ${callerId} and User ${receiverId} is now active.`
        );

      } catch (error) {
        // Handle errors gracefully
        logger.error(`Error in acceptCall handler: ${error.message}`);
        socket.emit('callError', {
          message: 'An error occurred while accepting the call. Please try again.',
        });
      }
    });





    socket.on('missedcall', async ({ receiverId, callerId }) => {
      try {
        // Validate input
        if (!receiverId || !callerId) {
          return socket.emit('callError', { message: 'Invalid call parameters' });
        }

        // Fetch user details
        const caller = await User.findById(callerId).select('username name profilePicture');
        const receiver = await User.findById(receiverId).select('username deviceToken notificationSettings -_id');

        if (!caller || !receiver) {
          return socket.emit('callError', { message: 'Caller or receiver not found' });
        }

        const callerName = caller.name || caller.username;

        // Notify receiver via socket
        const receiverSockets = users[receiverId];
        if (receiverSockets?.length) {
          // Send socket notification to all connected sockets for the receiver
          receiverSockets.forEach((socketId) => {
            socket.to(socketId).emit('callMissed', {
              callerId,
              callerName,
              callerPicture: caller.profilePicture,
              timestamp: new Date(),
            });
          });
        }

        // Send push notification (only once)
        if (receiver.deviceToken && receiver.notificationSettings?.missedCalls !== false) {
          await sendMNotification(
            receiverId,
            'Missed Call',
            `You missed a call from ${callerName}`,
            'missed_call',
            receiverId,
            callerName,
            caller.profilePicture
          );
        }

        // Log missed call for caller
        const logForCaller = await CallLog.create({
          caller: new mongoose.Types.ObjectId(callerId),
          receiver: new mongoose.Types.ObjectId(receiverId),
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
          status: 'missed',
        });

        // Log missed call for receiver
        const logForReceiver = await CallLog.create({
          caller: new mongoose.Types.ObjectId(receiverId),
          receiver: new mongoose.Types.ObjectId(callerId),
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
          status: 'missed',
        });

        console.log('Missed call logs created:', { logForCaller, logForReceiver });
      } catch (error) {
        console.error('Error processing missed call:', error);
        socket.emit('callError', { message: 'Failed to process missed call' });
      }
    });



    socket.on('rejectCall', async ({ receiverId, callerId }) => {
      try {
        logger.info(`User ${receiverId} rejected call from User ${callerId}`);

        // Clean up call status
        delete activeCalls[callerId];
        delete activeCalls[receiverId];

        // Notify caller about rejection
        if (users[callerId]) {
          users[callerId].forEach((socketId) => {
            socket.to(socketId).emit('callRejected', { receiverId });
          });
        }

        // Stop caller tune
        socket.emit('stopCallerTune', { callerId });

        // Create call log
        await CallLog.create({
          caller: new mongoose.Types.ObjectId(callerId),
          receiver: new mongoose.Types.ObjectId(receiverId),
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
          status: 'rejected'
        });



      } catch (error) {
        logger.error(`Error in rejectCall handler: ${error.message}`);
        socket.emit('callError', { message: 'Failed to reject call' });
      }
    });


    socket.on('endCall', async ({ receiverId, callerId }) => {
      try {
        logger.info('Attempting to end call', { callerId, receiverId });

        // Debug log current state
        logger.info('Current active calls:', activeCalls);
        logger.info('Current call timings:', callTimings);

        // Validate IDs
        if (!callerId || !receiverId) {
          logger.warn('Missing caller or receiver ID');
          return;
        }

        // Check active calls with more detailed logging
        const isCallerActive = activeCalls[callerId] === receiverId;
        const isReceiverActive = activeCalls[receiverId] === callerId;

        logger.info('Call status check:', {
          isCallerActive,
          isReceiverActive,
          callerActivePair: `${callerId} -> ${activeCalls[callerId]}`,
          receiverActivePair: `${receiverId} -> ${activeCalls[receiverId]}`
        });

        if (isCallerActive || isReceiverActive) {
          // Handle active call ending
          logger.info(`Ending active call between ${callerId} and ${receiverId}`);

          // Notify receiver of call end
          if (users[receiverId]) {
            const receiverSockets = users[receiverId];
            logger.info(`Found ${receiverSockets.length} sockets for receiver`);

            receiverSockets.forEach((socketId) => {
              socket.to(socketId).emit('callEnded', {
                callerId,
                timestamp: Date.now()
              });

              socket.to(socketId).emit('inactiveCall', {
                callerId,
                receiverId,
                socketId: socket.id,
                timestamp: Date.now()
              });

              logger.info(`Sent end call notifications to socket: ${socketId}`);
            });
          } else {
            logger.warn(`No active sockets found for receiver: ${receiverId}`);
          }

          // Handle call duration calculation
          const callerCallKey = `${callerId}_${receiverId}`;
          const receiverCallKey = `${receiverId}_${callerId}`;

          logger.info('Checking call timing keys:', {
            callerCallKey,
            receiverCallKey,
            callerTiming: callTimings[callerCallKey],
            receiverTiming: callTimings[receiverCallKey]
          });

          const startTime = callTimings[callerCallKey]?.startTime || callTimings[receiverCallKey]?.startTime;

          if (!startTime) {
            logger.warn('Call timing not found', {
              callerCallKey,
              receiverCallKey,
              callTimings: JSON.stringify(callTimings)
            });
            return;
          }

          const endTime = new Date();
          const duration = Math.round((endTime - new Date(startTime)) / 1000);

          logger.info('Call duration calculated:', {
            startTime,
            endTime,
            durationSeconds: duration
          });

          // Save call log
          try {
            await CallLog.create({
              caller: new mongoose.Types.ObjectId(callerId),
              receiver: new mongoose.Types.ObjectId(receiverId),
              startTime: new Date(startTime),
              endTime,
              duration,
              status: 'completed',
            });

            logger.info('Call log saved successfully');
          } catch (dbError) {
            logger.error('Failed to save call log:', dbError);
          }

          // Cleanup with logging
          logger.info('Cleaning up call data...');
          delete activeCalls[callerId];
          delete activeCalls[receiverId];
          delete callTimings[callerCallKey];
          delete callTimings[receiverCallKey];

          logger.info('Call cleanup completed');

        } else {
          // No active call found - log detailed state
          logger.warn('No active call found', {
            requestedPair: `${callerId} <-> ${receiverId}`,
            activeCallsState: JSON.stringify(activeCalls),
            callTimingsState: JSON.stringify(callTimings)
          });

          socket.emit('error', {
            type: 'END_CALL_ERROR',
            message: 'No active call found'
          });
        }
      } catch (error) {
        logger.error('Error in endCall handler:', {
          error: error.message,
          stack: error.stack,
          callerId,
          receiverId
        });

        socket.emit('error', {
          type: 'END_CALL_ERROR',
          message: 'Failed to end call'
        });
      }
    });

    socket.on('disconnect', async () => {
      try {
        logger.info(`Socket disconnected: ${socket.id}`);

        // Handle queue cleanup
        removeUserFromQueue(socket.id);
        logger.debug('Current queue after disconnect:', userQueue);

        let disconnectedUserId = null;

        // Clear any pending calls for this socket
        for (const key in pendingCalls) {
          if (pendingCalls[key].socketId === socket.id) {
            logger.info(`Cleaning up pending call: ${key}`);
            delete pendingCalls[key];
          }
        }

        // Find and handle the disconnected user
        for (const [userId, socketIds] of Object.entries(users)) {
          const index = socketIds.indexOf(socket.id);

          if (index !== -1) {
            // Remove the socket from user's socket list
            socketIds.splice(index, 1);
            disconnectedUserId = userId;
            logger.info(`Removed socket ${socket.id} from user ${userId}. Remaining sockets: ${socketIds.length}`);

            // If no more sockets, handle complete disconnection
            if (socketIds.length === 0) {
              delete users[userId];
              logger.info(`User ${userId} has no more active sockets. Updating status to offline`);

              try {
                // Update user status to offline in database
                const updatedUser = await User.findOneAndUpdate(
                  { _id: disconnectedUserId },
                  { status: 'offline', lastSeen: new Date() },
                  { new: true }
                );

                if (updatedUser) {
                  // Broadcast status change to all connected users
                  io.emit('userStatusChanged', {
                    userId: disconnectedUserId,
                    status: 'offline',
                    lastSeen: updatedUser.lastSeen
                  });
                  logger.info(`Successfully updated offline status for user ${disconnectedUserId}`);
                } else {
                  logger.warn(`User ${disconnectedUserId} not found while updating offline status`);
                }
              } catch (error) {
                logger.error(`Failed to update offline status for user ${disconnectedUserId}:`, error);
              }
            }
            break;
          }
        }

        // Handle active call disconnection if user was in a call
        if (disconnectedUserId && activeCalls[disconnectedUserId]) {
          const otherUserId = activeCalls[disconnectedUserId];
          const callKey = `${Math.min(disconnectedUserId, otherUserId)}_${Math.max(disconnectedUserId, otherUserId)}`;

          try {
            // Get call timing information
            const callTiming = callTimings[callKey];

            if (callTiming?.startTime) {
              const endTime = new Date();
              const duration = Math.floor((endTime - callTiming.startTime) / 1000);

              // Create call log
              await CallLog.create({
                caller: new mongoose.Types.ObjectId(callTiming.callerId),
                receiver: new mongoose.Types.ObjectId(callTiming.receiverId),
                startTime: callTiming.startTime,
                endTime,
                duration,
                status: 'disconnected',
                disconnectedBy: disconnectedUserId
              });

              logger.info(`Call log created for disconnected call between ${disconnectedUserId} and ${otherUserId}`);

              // Cleanup call timing
              delete callTimings[callKey];
            }

            // Notify other user about call end
            if (users[otherUserId]) {
              users[otherUserId].forEach((socketId) => {
                socket.to(socketId).emit('callEnded', {
                  callerId: disconnectedUserId,
                  reason: 'disconnect'
                });
              });
              logger.info(`Notified user ${otherUserId} about call end due to disconnect`);
            }

            // Cleanup active calls
            delete activeCalls[disconnectedUserId];
            delete activeCalls[otherUserId];

            logger.info(`Cleaned up call state for users ${disconnectedUserId} and ${otherUserId}`);
          } catch (error) {
            logger.error(`Error handling call disconnection for user ${disconnectedUserId}:`, error);
          }
        }

        // Emit final disconnect event for other features that might need it
        io.emit('userDisconnected', {
          userId: disconnectedUserId,
          socketId: socket.id,
          timestamp: new Date()
        });

      } catch (error) {
        logger.error('Unhandled error in disconnect handler:', error);
      }
    });


  });
};

async function sendNotification_call(userId, title, message, type, receiverId, senderName, senderAvatar) {
  try {
    // Fetch the user from the database
    const user = await User.findById(userId);
    if (!user || !user.deviceToken) {
      console.error("No device token found for user:", userId);
      return;
    }

    const deviceToken = user.deviceToken;

    // Construct the payload for FCM
    const payload = {
      android: {
        priority: 'high',
        notification: {
          channelId: 'calls',
          title: 'Incoming Call',
          body: `${senderName} is calling...`,
        }
      },
      data: {
        screen: 'incoming_Call', // Target screen
        type: type, // Type of call
        caller_name: senderName,
        caller_id: userId,
        call_type: "audio", // or "video"
        params: JSON.stringify({
          user_id: userId, // Include Call ID
          agent_id: receiverId, // Receiver ID
          username: senderName, // Sender name
          imageurl: senderAvatar || 'https://investogram.ukvalley.com/avatars/default.png', // Sender avatar with default fallback
        }),
        // Add any additional parameters if needed
      },


      token: deviceToken,
    };
    logger.info(`Push notification sent to User  in  notification  function`);

    // Send the notification
    const response = await admin.messaging().send(payload);
    console.log("Notification sent successfully:", response);
  } catch (error) {
    console.error("Error sending notification:", error);
  }
}


async function sendNotification(userId, title, message, type, receiverId, senderName, senderAvatar) {
  try {
    // Fetch the user from the database
    const user = await User.findById(userId);
    if (!user || !user.deviceToken) {
      console.error("No device token found for user:", userId);
      return;
    }

    const deviceToken = user.deviceToken;

    // Construct the payload for FCM
    const payload = {
      notification: {
        title: title,
        body: message,
      },
      data: {
        screen: 'incoming_Call', // Target screen
        params: JSON.stringify({
          user_id: userId, // Include Call ID
          type: type, // Type of call
          agent_id: receiverId, // Receiver ID
          username: senderName, // Sender name
          imageurl: senderAvatar || 'https://investogram.ukvalley.com/avatars/default.png', // Sender avatar with default fallback
        }),
        // Add any additional parameters if needed
      },


      token: deviceToken,
    };
    logger.info(`Push notification sent to User  in  notification  function`);

    // Send the notification
    const response = await admin.messaging().send(payload);
    console.log("Notification sent successfully:", response);
  } catch (error) {
    console.error("Error sending notification:", error);
  }
}

async function sendMNotification(userId, title, message, type, receiverId, senderName, senderAvatar) {
  try {
    // Fetch the user from the database
    const user = await User.findById(userId);
    if (!user || !user.deviceToken) {
      console.error("No device token found for user:", userId);
      return;
    }

    const deviceToken = user.deviceToken;

    // Construct the payload for FCM
    const payload = {
      notification: {
        title: title,
        body: message,
      },
      data: {
        screen: 'Recent_Calls', // Target screen
        params: JSON.stringify({
          user_id: userId, // Include Call ID
          type: type, // Type of call
          agent_id: receiverId, // Receiver ID
          username: senderName, // Sender name
          imageurl: senderAvatar || 'https://investogram.ukvalley.com/avatars/default.png', // Sender avatar with default fallback
        }),
        // Add any additional parameters if needed
      },


      token: deviceToken,
    };
    logger.info(`Push notification sent to User  in  notification  function`);

    // Send the notification
    const response = await admin.messaging().send(payload);
    console.log("Notification sent successfully:", response);
  } catch (error) {
    console.error("Error sending notification:", error);
  }
}


