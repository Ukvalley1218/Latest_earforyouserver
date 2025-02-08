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
    //     logger.info(`[CALL_START] User ${callerId} is calling User ${receiverId}`);

    //     // Input validation
    //     if (!callerId || !receiverId) {
    //       logger.error('[VALIDATION_ERROR] Invalid caller or receiver ID');
    //       socket.emit('callError', { message: 'Invalid user IDs' });
    //       return;
    //     }

    //     // Check for active calls
    //     if (activeCalls[receiverId] || activeCalls[callerId]) {
    //       const busyUser = activeCalls[receiverId] ? receiverId : callerId;
    //       logger.warn(`[CALL_BUSY] User ${busyUser} is in active call`);
    //       socket.emit('userBusy', {
    //         receiverId,
    //         message: 'User is in another call'
    //       });
    //       return;
    //     }


    //     if (activeCalls[receiverId]) {
    //       logger.warn(`[CALL_BUSY] Receiver ${receiverId} is in active call`);
    //       socket.emit('userBusy', {
    //         receiverId,
    //         message: 'User is in another call'
    //       });
    //       return;
    //     }

    //     if (activeCalls[callerId]) {
    //       logger.warn(`[CALL_BUSY] Caller ${callerId} is in active call`);
    //       socket.emit('userBusy', {
    //         receiverId: callerId,
    //         message: 'You are in another call'
    //       });
    //       return;
    //     }

    //     // Generate call key using string comparison instead of Math.min/max
    //     const pendingCallKey = [callerId, receiverId].sort().join('_');
    //     logger.debug(`[CALL_KEY] Generated key: ${pendingCallKey}`);

    //     // Check for existing calls
    //     if (pendingCalls[pendingCallKey]) {
    //       const existingCall = pendingCalls[pendingCallKey];
    //       const timeSinceCall = Date.now() - existingCall.timestamp;

    //       // Handle recent call attempts (within 5 seconds)
    //       if (timeSinceCall < 5000) {
    //         logger.warn(`[CALL_CONFLICT] Detected between ${callerId} and ${receiverId}`);

    //         // Clear existing timeouts
    //         if (existingCall.cleanupTimeout) {
    //           clearTimeout(existingCall.cleanupTimeout);
    //         }

    //         // Update conflict state
    //         pendingCalls[pendingCallKey] = {
    //           conflict: true,
    //           timestamp: Date.now(),
    //           users: [callerId, receiverId],
    //           originalCall: {
    //             callerId: existingCall.callerId,
    //             receiverId: existingCall.receiverId,
    //             timestamp: existingCall.timestamp
    //           }
    //         };

    //         // Notify caller about conflict
    //         socket.emit('callConflict', {
    //           message: 'Simultaneous call detected',
    //           otherUserId: receiverId,
    //           timestamp: Date.now(),
    //           retryAfter: 5
    //         });

    //         // Notify receiver about conflict
    //         if (users[receiverId]) {
    //           users[receiverId].forEach(socketId => {
    //             socket.to(socketId).emit('callConflict', {
    //               message: 'Simultaneous call detected',
    //               otherUserId: callerId,
    //               timestamp: Date.now(),
    //               retryAfter: 5
    //             });
    //           });
    //         }

    //         // Set conflict cleanup
    //         const cleanupTimeout = setTimeout(() => {
    //           if (pendingCalls[pendingCallKey]?.conflict) {
    //             logger.info(`[CONFLICT_CLEANUP] Clearing state for ${pendingCallKey}`);
    //             delete pendingCalls[pendingCallKey];
    //           }
    //         }, 5000);

    //         pendingCalls[pendingCallKey].cleanupTimeout = cleanupTimeout;
    //         return;
    //       }

    //       // Clear stale call
    //       logger.info(`[STALE_CLEANUP] Clearing stale call ${pendingCallKey}`);
    //       if (existingCall.cleanupTimeout) {
    //         clearTimeout(existingCall.cleanupTimeout);
    //       }
    //       delete pendingCalls[pendingCallKey];
    //     }

    //     // Store new call attempt
    //     pendingCalls[pendingCallKey] = {
    //       callerId,
    //       receiverId,
    //       timestamp: Date.now(),
    //       socketId: socket.id,
    //       conflict: false,
    //       status: 'initializing'
    //     };

    //     // Set cleanup timeout
    //     const cleanupTimeout = setTimeout(() => {
    //       if (pendingCalls[pendingCallKey] && !pendingCalls[pendingCallKey].conflict) {
    //         logger.info(`[CALL_TIMEOUT] Cleaning up ${pendingCallKey}`);
    //         delete pendingCalls[pendingCallKey];
    //         socket.emit('callTimeout', {
    //           receiverId,
    //           message: 'Call request timed out'
    //         });
    //       }
    //     }, 30000);

    //     pendingCalls[pendingCallKey].cleanupTimeout = cleanupTimeout;

    //     // Fetch user details
    //     const [receiver, caller] = await Promise.all([
    //       User.findById(receiverId),
    //       User.findById(callerId),
    //     ]).catch(error => {
    //       logger.error(`[DB_ERROR] Failed to fetch users: ${error.message}`);
    //       throw new Error('Failed to fetch user details');
    //     });

    //     if (!receiver || !caller) {
    //       const missingUser = !receiver ? 'receiver' : 'caller';
    //       logger.warn(`[USER_ERROR] ${missingUser} not found`);
    //       socket.emit(`${missingUser}Unavailable`, {
    //         userId: !receiver ? receiverId : callerId
    //       });
    //       delete pendingCalls[pendingCallKey];
    //       return;
    //     }

    //     // Initialize socket arrays
    //     users[callerId] = users[callerId] || [];
    //     users[receiverId] = users[receiverId] || [];

    //     // Register caller socket
    //     if (!users[callerId].includes(socket.id)) {
    //       users[callerId].push(socket.id);
    //     }

    //     // Final conflict check before proceeding
    //     if (pendingCalls[pendingCallKey]?.conflict) {
    //       logger.warn(`[LATE_CONFLICT] Detected after user fetch`);
    //       return;
    //     }

    //     // Handle socket notifications
    //     if (users[receiverId].length > 0) {
    //       users[receiverId].forEach((socketId) => {
    //         socket.to(socketId).emit('incomingCall', {
    //           callerId,
    //           callerSocketId: socket.id,
    //           callerName: caller.username || 'Unknown Caller',
    //           timestamp: Date.now()
    //         });
    //         logger.info(`[SOCKET_NOTIFY] Sent to ${receiverId} via socket ${socketId}`);
    //       });

    //       socket.emit('playCallerTune', { callerId });
    //     }

    //     // Handle push notification
    //     if (receiver.deviceToken && !pendingCalls[pendingCallKey]?.conflict) {
    //       try {
    //         await sendNotification_call(
    //           receiverId,
    //           'Incoming Call',
    //           `${caller.username || 'Unknown Caller'} is calling you!`,
    //           'incoming_Call',
    //           callerId,
    //           caller.username || 'Unknown Caller',
    //           caller.avatarUrl || 'default_avatar_url'
    //         );
    //         logger.info(`[PUSH_SENT] Notification sent to ${receiverId}`);
    //       } catch (error) {
    //         logger.error(`[PUSH_ERROR] ${error.message}`);
    //       }
    //     }

    //     pendingCalls[pendingCallKey].status = 'active';

    //   } catch (error) {
    //     logger.error(`[CALL_ERROR] ${error.stack}`);
    //     socket.emit('callError', {
    //       message: 'Failed to initiate call',
    //       details: error.message
    //     });
    //   }
    // });


    // socket.on('call', async ({ callerId, receiverId }) => {
    //   try {
    //     logger.info(`[CALL_START] User ${callerId} is calling User ${receiverId}`);

    //     // Input validation
    //     if (!callerId || !receiverId) {
    //       logger.error('[VALIDATION_ERROR] Invalid caller or receiver ID');
    //       socket.emit('callError', { message: 'Invalid user IDs' });
    //       return;
    //     }

    //     const pendingCallKey = [callerId, receiverId].sort().join('_');



    //     // Check if either user is in an active call
    //     const busyUsers = new Set();
    //     logger.error("busyUsers", busyUsers);
    //     Object.entries(activeCalls).forEach(([userId, callData]) => {
    //       if (callData.participants) {
    //         callData.participants.forEach(participant => busyUsers.add(participant));
    //       }
    //     });

    //     if (busyUsers.has(receiverId)) {
    //       logger.warn(`[CALL_BUSY] Receiver ${receiverId} is in active call`);
    //       socket.emit('userBusy', {
    //         receiverId,
    //         message: 'User is in another call'
    //       });
    //       return;
    //     }

    //     if (busyUsers.has(callerId)) {
    //       logger.warn(`[CALL_BUSY] Caller ${callerId} is in active call`);
    //       socket.emit('userBusy', {
    //         receiverId: callerId,
    //         message: 'You are in another call'
    //       });


    //       if (users[receiverId]) {
    //         users[receiverId].forEach(socketId => {
    //           socket.to(socketId).emit('userBusy', {
    //             otherUserId: callerId
    //           });
    //         });
    //       }

    //       return;
    //     }



    //     // Generate call key using string comparison

    //     logger.debug(`[CALL_KEY] Generated key: ${pendingCallKey}`);

    //     // Check for existing calls
    //     if (pendingCalls[pendingCallKey]) {
    //       const existingCall = pendingCalls[pendingCallKey];
    //       const timeSinceCall = Date.now() - existingCall.timestamp;

    //       if (timeSinceCall < 5000) {
    //         handleCallConflict(socket, pendingCallKey, callerId, receiverId, existingCall);
    //         return;
    //       }

    //       // Clear stale call
    //       cleanupStaleCall(pendingCallKey, existingCall);
    //     }

    //     // Store new call attempt
    //     pendingCalls[pendingCallKey] = {
    //       callerId,
    //       receiverId,
    //       timestamp: Date.now(),
    //       socketId: socket.id,
    //       conflict: false,
    //       status: 'initializing',
    //       participants: [callerId, receiverId]
    //     };

    //     // Set cleanup timeout
    //     const cleanupTimeout = setTimeout(() => {
    //       if (pendingCalls[pendingCallKey] && !pendingCalls[pendingCallKey].conflict) {
    //         logger.info(`[CALL_TIMEOUT] Cleaning up ${pendingCallKey}`);
    //         delete pendingCalls[pendingCallKey];
    //         socket.emit('callTimeout', {
    //           receiverId,
    //           message: 'Call request timed out'
    //         });
    //       }
    //     }, 30000);

    //     pendingCalls[pendingCallKey].cleanupTimeout = cleanupTimeout;

    //     // Fetch user details
    //     const [receiver, caller] = await Promise.all([
    //       User.findById(receiverId),
    //       User.findById(callerId),
    //     ]).catch(error => {
    //       logger.error(`[DB_ERROR] Failed to fetch users: ${error.message}`);
    //       throw new Error('Failed to fetch user details');
    //     });

    //     if (!receiver || !caller) {
    //       handleMissingUser(socket, pendingCallKey, receiver, caller, receiverId, callerId);
    //       return;
    //     }

    //     // Initialize socket arrays and register caller
    //     initializeUserSockets(users, callerId, receiverId, socket);

    //     // Final conflict check
    //     if (pendingCalls[pendingCallKey]?.conflict) {
    //       logger.warn(`[LATE_CONFLICT] Detected after user fetch`);
    //       return;
    //     }

    //     // Handle socket notifications
    //     if (users[receiverId].length > 0) {
    //       notifyReceiver(socket, users, receiverId, callerId, caller);
    //     }

    //     // Handle push notification
    //     if (receiver.deviceToken && !pendingCalls[pendingCallKey]?.conflict) {
    //       await sendPushNotification(receiver, caller, receiverId, callerId);
    //     }

    //     // Update call status
    //     pendingCalls[pendingCallKey].status = 'active';

    //   } catch (error) {
    //     handleError(socket, error);
    //   }
    // });


    socket.on('call', async ({ callerId, receiverId }) => {
      try {
        logger.info(`[CALL_START] User ${callerId} is calling User ${receiverId}`);

        // Input validation
        if (!callerId || !receiverId) {
          logger.error('[VALIDATION_ERROR] Invalid caller or receiver ID');
          socket.emit('callError', { message: 'Invalid user IDs' });
          return;
        }

        const pendingCallKey = [callerId, receiverId].sort().join('_');

        // Check if receiver already has any pending calls
        const hasExistingPendingCall = Object.values(pendingCalls).some(call =>
          call.receiverId === receiverId &&
          call.status === 'initializing' &&
          Date.now() - call.timestamp < 30000
        );

        if (hasExistingPendingCall) {
          logger.warn(`[CALL_BUSY] Receiver ${receiverId} already has a pending call`);
          socket.emit('userBusy', {
            receiverId,
            message: 'User already has an incoming call'
          });
          return;
        }

        // Check if either user is in an active call
        const busyUsers = new Set();
        logger.error("busyUsers", busyUsers);
        Object.entries(activeCalls).forEach(([userId, callData]) => {
          if (callData.participants) {
            callData.participants.forEach(participant => busyUsers.add(participant));
          }
        });

        if (busyUsers.has(receiverId)) {
          logger.warn(`[CALL_BUSY] Receiver ${receiverId} is in active call`);
          socket.emit('userBusy', {
            receiverId,
            message: 'User is in another call'
          });
          return;
        }

        if (busyUsers.has(callerId)) {
          logger.warn(`[CALL_BUSY] Caller ${callerId} is in active call`);
          socket.emit('userBusy', {
            receiverId: callerId,
            message: 'You are in another call'
          });

          if (users[receiverId]) {
            users[receiverId].forEach(socketId => {
              socket.to(socketId).emit('userBusy', {
                otherUserId: callerId
              });
            });
          }
          return;
        }

        // Check for existing calls with same key
        if (pendingCalls[pendingCallKey]) {
          const existingCall = pendingCalls[pendingCallKey];
          const timeSinceCall = Date.now() - existingCall.timestamp;

          if (timeSinceCall < 5000) {
            handleCallConflict(socket, pendingCallKey, callerId, receiverId, existingCall);
            return;
          }

          // Clear stale call
          cleanupStaleCall(pendingCallKey, existingCall);
        }

        // Store new call attempt
        pendingCalls[pendingCallKey] = {
          callerId,
          receiverId,
          timestamp: Date.now(),
          socketId: socket.id,
          conflict: false,
          status: 'initializing',
          participants: [callerId, receiverId]
        };

        // Set cleanup timeout
        const cleanupTimeout = setTimeout(() => {
          if (pendingCalls[pendingCallKey] && !pendingCalls[pendingCallKey].conflict) {
            logger.info(`[CALL_TIMEOUT] Cleaning up ${pendingCallKey}`);
            delete pendingCalls[pendingCallKey];
            socket.emit('callTimeout', {
              receiverId,
              message: 'Call request timed out'
            });
          }
        }, 30000);

        pendingCalls[pendingCallKey].cleanupTimeout = cleanupTimeout;

        // Fetch user details
        const [receiver, caller] = await Promise.all([
          User.findById(receiverId),
          User.findById(callerId),
        ]).catch(error => {
          logger.error(`[DB_ERROR] Failed to fetch users: ${error.message}`);
          throw new Error('Failed to fetch user details');
        });

        if (!receiver || !caller) {
          handleMissingUser(socket, pendingCallKey, receiver, caller, receiverId, callerId);
          return;
        }

        // Initialize socket arrays and register caller
        initializeUserSockets(users, callerId, receiverId, socket);

        // Final conflict check
        if (pendingCalls[pendingCallKey]?.conflict) {
          logger.warn(`[LATE_CONFLICT] Detected after user fetch`);
          return;
        }

        // Handle socket notifications
        if (users[receiverId].length > 0) {
          notifyReceiver(socket, users, receiverId, callerId, caller);
        }

        // Handle push notification
        if (receiver.deviceToken && !pendingCalls[pendingCallKey]?.conflict) {
          await sendPushNotification(receiver, caller, receiverId, callerId);
        }

        // Update call status
        pendingCalls[pendingCallKey].status = 'active';

      } catch (error) {
        handleError(socket, error);
      }
    });

    // Helper functions
    function handleCallConflict(socket, pendingCallKey, callerId, receiverId, existingCall) {
      logger.warn(`[CALL_CONFLICT] Detected between ${callerId} and ${receiverId}`);

      if (existingCall.cleanupTimeout) {
        clearTimeout(existingCall.cleanupTimeout);
      }

      pendingCalls[pendingCallKey] = {
        conflict: true,
        timestamp: Date.now(),
        users: [callerId, receiverId],
        originalCall: {
          callerId: existingCall.callerId,
          receiverId: existingCall.receiverId,
          timestamp: existingCall.timestamp
        }
      };

      emitConflictNotifications(socket, callerId, receiverId);

      const cleanupTimeout = setTimeout(() => {
        if (pendingCalls[pendingCallKey]?.conflict) {
          logger.info(`[CONFLICT_CLEANUP] Clearing state for ${pendingCallKey}`);
          delete pendingCalls[pendingCallKey];
        }
      }, 5000);

      pendingCalls[pendingCallKey].cleanupTimeout = cleanupTimeout;
    }

    function cleanupStaleCall(pendingCallKey, existingCall) {
      logger.info(`[STALE_CLEANUP] Clearing stale call ${pendingCallKey}`);
      if (existingCall.cleanupTimeout) {
        clearTimeout(existingCall.cleanupTimeout);
      }
      delete pendingCalls[pendingCallKey];
    }

    function handleMissingUser(socket, pendingCallKey, receiver, caller, receiverId, callerId) {
      const missingUser = !receiver ? 'receiver' : 'caller';
      logger.warn(`[USER_ERROR] ${missingUser} not found`);
      socket.emit(`${missingUser}Unavailable`, {
        userId: !receiver ? receiverId : callerId
      });
      delete pendingCalls[pendingCallKey];
    }

    function initializeUserSockets(users, callerId, receiverId, socket) {
      users[callerId] = users[callerId] || [];
      users[receiverId] = users[receiverId] || [];

      if (!users[callerId].includes(socket.id)) {
        users[callerId].push(socket.id);
      }
    }

    function notifyReceiver(socket, users, receiverId, callerId, caller) {
      users[receiverId].forEach((socketId) => {
        socket.to(socketId).emit('incomingCall', {
          callerId,
          callerSocketId: socket.id,
          callerName: caller.username || 'Unknown Caller',
          timestamp: Date.now()
        });
        logger.info(`[SOCKET_NOTIFY] Sent to ${receiverId} via socket ${socketId}`);
      });

      socket.emit('playCallerTune', { callerId });
    }

    async function sendPushNotification(receiver, caller, receiverId, callerId) {
      try {
        await sendNotification_call(
          receiverId,
          'Incoming Call',
          `${caller.username || 'Unknown Caller'} is calling you!`,
          'incoming_Call',
          callerId,
          caller.username || 'Unknown Caller',
          caller.avatarUrl || 'default_avatar_url'
        );
        logger.info(`[PUSH_SENT] Notification sent to ${receiverId}`);
      } catch (error) {
        logger.error(`[PUSH_ERROR] ${error.message}`);
      }
    }

    function handleError(socket, error) {
      logger.error(`[CALL_ERROR] ${error.stack}`);
      socket.emit('callError', {
        message: 'Failed to initiate call',
        details: error.message
      });
    }

    function emitConflictNotifications(socket, callerId, receiverId) {
      const conflictData = {
        message: 'Simultaneous call detected',
        timestamp: Date.now(),
        retryAfter: 5
      };

      socket.emit('callConflict', {
        ...conflictData,
        otherUserId: receiverId
      });

      if (users[receiverId]) {
        users[receiverId].forEach(socketId => {
          socket.to(socketId).emit('callConflict', {
            ...conflictData,
            otherUserId: callerId
          });
        });
      }
    }

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


