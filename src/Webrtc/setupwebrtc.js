import mongoose from 'mongoose';
import CallLog from '../models/Talk-to-friend/callLogModel.js';
import logger from '../logger/winston.logger.js';
import User from '../models/Users.js';
import Wallet from '../models/Wallet/Wallet.js'
import admin from 'firebase-admin';


export const setupWebRTC = (io) => {
  // Store active users and their socket connections
  const users = {}; // { userId: [socketId1, socketId2, ...] }
  const activeCalls = {}; // { userId: otherUserId }
  const callTimings = {};
  const randomCallQueue = new Set();
  const CALL_TIMEOUT = 60000; // 1 minute in milliseconds

  io.on('connection', (socket) => {
    logger.http(`User connected: ${socket.id}`);


    socket.on('registerUser', async (userId) => {
      try {
        if (!userId) {
          throw new Error('User ID is required');
        }

        // Use an in-memory reference (if applicable) or limit the database call.
        socket.userId = userId; // Associate the userId with the socket

        // Update user status to online in the background without awaiting
        User.findByIdAndUpdate(userId, { status: 'online' }).exec();

        // Immediately broadcast the online status
        socket.broadcast.emit('userStatusChanged', {
          userId,
          status: 'online',
        });

        console.log(`User ${userId} is now online`);
      } catch (error) {
        console.error(`Error updating user online status: ${error.message}`);
      }
    });

    socket.on('join', async ({ userId }) => {
      if (!users[userId]) {
        users[userId] = [];
      }
      users[userId].push(socket.id);
      logger.info(`User ${userId} joined with socket ID ${socket.id}`);
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

    // Initial call request

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

    //       socket.emit('receiver unavailable', { receiverId });
    //       logger.warn(`User ${receiverId} not found`);
    //       return;
    //     }


    //     if (!caller) {
    //       socket.emit('caller unablivale', { callerId });
    //       logger.warn(`User ${callerId} not found`);
    //       return;
    //     }

    //     // Initialize socket arrays if needed
    //     if (!users[callerId]) users[callerId] = [];
    //     if (!users[receiverId]) users[receiverId] = [];

    //     // Add current socket to caller's sockets if not already present
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
    //         const message = `${caller.username} is calling you!`;
    //         const type = 'Incoming_Call';
    //         const senderName = caller.username || 'Unknown Caller';
    //         const senderAvatar = caller.avatarUrl || 'https://investogram.ukvalley.com/avatars/default.png';

    //         await sendNotification(receiverId, title, message, type, callerId, receiverId, senderName, senderAvatar);
    //         logger.info(`Push notification sent to User ${receiverId}`);
    //       }
    //     } else {
    //       // Receiver is unavailable for the call
    //       socket.emit('userUnavailable', { receiverId });
    //       if (receiver.deviceToken) {
    //         const title = 'Incoming Call';
    //         const message = `${caller.username} is calling you!`;
    //         const type = 'Incoming_Call';
    //         const senderName = caller.username || 'Unknown Caller';
    //         const senderAvatar = caller.avatarUrl || 'https://investogram.ukvalley.com/avatars/default.png';

    //         await sendNotification(receiverId, title, message, type, callerId, receiverId, senderName, senderAvatar);
    //         logger.info(`Push notification sent to User ${receiverId}`);
    //       }

    //       logger.warn(`User ${receiverId} is unavailable for the call`);
    //     }
    //   } catch (error) {
    //     logger.error(`Error in call handler: ${error.message}`);
    //     socket.emit('callError', { message: 'Failed to initiate call' });
    //   }
    // });


    socket.on('call', async ({ callerId, receiverId }) => {
      try {
        logger.info(`User ${callerId} is calling User ${receiverId}`);
    
        // Check if either user is already in a call
        if (activeCalls[receiverId] || activeCalls[callerId]) {
          socket.emit('userBusy', { receiverId });
          logger.warn(`User ${receiverId} or ${callerId} is already in a call`);
          return;
        }
    
        // Fetch user details
        const [receiver, caller] = await Promise.all([
          User.findById(receiverId),
          User.findById(callerId),
        ]);
    
        if (!receiver) {
          socket.emit('receiverUnavailable', { receiverId });
          logger.warn(`User ${receiverId} not found`);
          return;
        }
    
        if (!caller) {
          socket.emit('callerUnavailable', { callerId });
          logger.warn(`User ${callerId} not found`);
          return;
        }
    
        // Initialize socket arrays if needed
        if (!users[callerId]) users[callerId] = [];
        if (!users[receiverId]) users[receiverId] = [];
    
        if (!users[callerId].includes(socket.id)) {
          users[callerId].push(socket.id);
        }
    
        if (users[receiverId].length > 0) {
          // Notify all receiver's sockets about the incoming call
          users[receiverId].forEach((socketId) => {
            socket.to(socketId).emit('incomingCall', {
              callerId,
              callerSocketId: socket.id,
            });
          });
    
          // Notify the caller to play caller tune
          socket.emit('playCallerTune', { callerId });
    
          // Send push notification if receiver has a device token
          if (receiver.deviceToken) {
            const title = 'Incoming Call';
            const message = `${caller.username} is calling you!`;
            const type = 'Incoming_Call';
            const senderName = caller.username || 'Unknown Caller';
            const senderAvatar = caller.avatarUrl || 'https://investogram.ukvalley.com/avatars/default.png';
    
            await sendNotification(receiverId, title, message, type, callerId, receiverId, senderName, senderAvatar);
            logger.info(`Push notification sent to User ${receiverId}`);
          }
        }
    
        // Start a 45-second timer for the call
        const callTimeout = setTimeout(async () => {
          if (!activeCalls[callerId] && !activeCalls[receiverId]) {

            if (receiver.deviceToken) {
              const title = 'Incoming Call';
              const message = `${caller.username} is calling you!`;
              const type = 'Incoming_Call';
              const senderName = caller.username || 'Unknown Caller';
              const senderAvatar = caller.avatarUrl || 'https://investogram.ukvalley.com/avatars/default.png';
      
              await sendNotification(receiverId, title, message, type, callerId, receiverId, senderName, senderAvatar);
              logger.info(`Push notification sent to User ${receiverId}`);
            }
            // Notify both users that the call was not received
            socket.emit('callNotReceived', { receiverId });
            users[receiverId]?.forEach((socketId) => {
              socket.to(socketId).emit('callMissed', { callerId });
            });
    
            // Log missed call in the database
            await CallLog.create({
              caller: callerId,
              receiver: receiverId,
              startTime: new Date(),
              status: 'missed',
            });
    
            logger.warn(`Call from User ${callerId} to User ${receiverId} was not received`);
    
            // // Send notifications to both users
            // if (caller.deviceToken) {
            //   const title = 'Call Missed';
            //   const message = `Your call to ${receiver.username} was not answered.`;
            //   const type = 'Missed_Call';
            //   const senderName = receiver.username || 'Unknown Receiver';
            //   const senderAvatar = receiver.avatarUrl || 'https://investogram.ukvalley.com/avatars/default.png';
    
            //   await sendNotification(callerId, title, message, type, callerId, receiverId, senderName, senderAvatar);
            //   logger.info(`Missed call notification sent to User ${callerId}`);
            // }
    
            // if (receiver.deviceToken) {
            //   const title = 'Missed Call';
            //   const message = `You missed a call from ${caller.username}.`;
            //   const type = 'Missed_Call';
            //   const senderName = caller.username || 'Unknown Caller';
            //   const senderAvatar = caller.avatarUrl || 'https://investogram.ukvalley.com/avatars/default.png';
    
            //   await sendNotification(receiverId, title, message, type, callerId, receiverId, senderName, senderAvatar);
            //   logger.info(`Missed call notification sent to User ${receiverId}`);
            // }
          }
        }, 45000);
    
        // Cleanup timeout if the call is accepted or rejected
        socket.on('acceptCall', () => {
          clearTimeout(callTimeout);
          logger.info(`Call accepted by User ${receiverId}`);
        });
    
        socket.on('rejectCall', () => {
          clearTimeout(callTimeout);
          logger.info(`Call rejected by User ${receiverId}`);
        });
      } catch (error) {
        logger.error(`Error in call handler: ${error.message}`);
        socket.emit('callError', { message: 'Failed to initiate call' });
      }
    });
    
    // Handle WebRTC offer
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

    // Handle ICE candidates
    socket.on('iceCandidate', ({ candidate, callerId, receiverId }) => {
      try {
        if (users[receiverId]) {
          users[receiverId].forEach((socketId) => {
            socket.to(socketId).emit('iceCandidate', { candidate, callerId });
          });
        }
      } catch (error) {
        logger.error(`Error in iceCandidate handler: ${error.message}`);
      }
    });


    socket.on('acceptCall', async ({ receiverId, callerId }) => {
      try {
        logger.info(`User ${receiverId} accepted call from User ${callerId}`);

        // Store start time as a Date object
        const callKey = `${receiverId}_${callerId}`;
        logger.info(`callKey ${callKey}`);

        callTimings[callKey] = {
          startTime: new Date() // Start time as a Date object
        };

        // Notify the caller that the call has been accepted
        if (users[callerId]) {
          users[callerId].forEach((socketId) => {
            socket.to(socketId).emit('callAccepted', {
              receiverId,
              socketId: socket.id
            });
          });

          // Stop the caller's tune after call acceptance
          socket.emit('stopCallerTune', { callerId });
        }
      } catch (error) {
        logger.error(`Error in acceptCall handler: ${error.message}`);
        socket.emit('callError', { message: 'Failed to accept call' });
      }
    });


    socket.on('missedcall', async ({ receiverId, callerId }) => {
      // Input validation
      if (!receiverId || !callerId) {
        logger.error('Missing required parameters: receiverId or callerId');
        return socket.emit('callError', {
          message: 'Invalid call parameters'
        });
      }

      const CALL_TIMEOUT = 60000; // 1 minute in milliseconds

      // Set auto-cut timer
      const autoEndCallTimeout = setTimeout(async () => {
        try {
          if (activeCalls[callerId] || activeCalls[receiverId]) {
            logger.info(`Auto-cutting call after timeout: Caller ${callerId} to Receiver ${receiverId}`);
            handleMissedCall();
          }
        } catch (error) {
          logger.error('Error in auto-end call handler:', {
            error: error.message,
            callerId,
            receiverId,
            stackTrace: error.stack
          });
        }
      }, CALL_TIMEOUT);

      async function handleMissedCall() {
        try {
          // Fetch caller and receiver details
          const [caller, receiver] = await Promise.all([
            User.findById(callerId).select('username name profilePicture'),
            User.findById(receiverId).select('username deviceToken notificationSettings')
          ]);

          if (!caller || !receiver) {
            throw new Error('Caller or receiver not found');
          }

          // Clean up call status
          if (activeCalls[callerId]) delete activeCalls[callerId];
          if (activeCalls[receiverId]) delete activeCalls[receiverId];

          // Notify receiver through socket
          if (users[receiverId]) {
            const receiverSockets = users[receiverId];
            if (Array.isArray(receiverSockets) && receiverSockets.length > 0) {
              receiverSockets.forEach((socketId) => {
                socket.to(socketId).emit('callMissed', {
                  callerId,
                  callerName: caller.name || caller.username,
                  callerPicture: caller.profilePicture,
                  timestamp: new Date()
                });
              });
            }
          }

          // Send push notification if enabled
          if (receiver.deviceToken &&
            (!receiver.notificationSettings || receiver.notificationSettings.missedCalls !== false)) {
            try {
              const notificationData = {
                title: 'Missed Call',
                body: `You missed a call from ${caller.name || caller.username}`,

              };

              await sendNotification(receiver.deviceToken, notificationData);
              logger.info(`Push notification sent to User ${receiverId} for missed call`);
            } catch (notificationError) {
              logger.error('Failed to send push notification:', {
                error: notificationError.message,
                receiverId,
                deviceToken: receiver.deviceToken
              });
            }
          }

          // Stop caller tune
          socket.emit('stopCallerTune', {
            callerId,
            status: 'missed'
          });

          // Create call log
          const currentTime = new Date();
          const callLog = await CallLog.create({
            caller: new mongoose.Types.ObjectId(callerId),
            receiver: new mongoose.Types.ObjectId(receiverId),
            startTime: currentTime,
            endTime: currentTime,
            duration: 0,
            status: 'Missed Call',
            metadata: {
              reason: 'User unavailable',
              platform: socket.handshake?.headers?.platform || 'unknown',
              notificationSent: Boolean(receiver.deviceToken),
              callerName: caller.name || caller.username
            }
          });

          logger.info(`Call log created with ID: ${callLog._id}`);

        } catch (error) {
          throw error;
        }
      }

      try {
        // Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(receiverId) ||
          !mongoose.Types.ObjectId.isValid(callerId)) {
          clearTimeout(autoEndCallTimeout);
          throw new Error('Invalid user ID format');
        }

        logger.info(`User ${receiverId} missed call from User ${callerId}`);
        await handleMissedCall();
        clearTimeout(autoEndCallTimeout);

      } catch (error) {
        clearTimeout(autoEndCallTimeout);
        logger.error('Error in missedcall handler:', {
          error: error.message,
          callerId,
          receiverId,
          stackTrace: error.stack
        });

        socket.emit('callError', {
          message: 'Failed to process missed call',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });

        // Cleanup remaining call states
        try {
          if (activeCalls[callerId]) delete activeCalls[callerId];
          if (activeCalls[receiverId]) delete activeCalls[receiverId];
        } catch (cleanupError) {
          logger.error('Error during cleanup:', cleanupError);
        }
      }
    });





    // Handle call rejection
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
        logger.info(`Call ended between ${callerId} and ${receiverId}`);

        if (activeCalls[callerId] === receiverId) {
          // Notify the other party
          if (users[receiverId]) {
            users[receiverId].forEach((socketId) => {
              socket.to(socketId).emit('callEnded', { callerId });
            });
          }

          // Calculate call duration
          const callerCallKey = `${callerId}_${receiverId}`;
          const receiverCallKey = `${receiverId}_${callerId}`;
          const startTime = callTimings[callerCallKey]?.startTime || callTimings[receiverCallKey]?.startTime;
          const endTime = new Date();
          const duration = (endTime - startTime) / 1000; // Calculate duration in seconds

          // Log the call with duration
          await CallLog.create({
            caller: new mongoose.Types.ObjectId(callerId),
            receiver: new mongoose.Types.ObjectId(receiverId),
            startTime,
            endTime,
            duration,
            status: 'completed'
          });

          // Clean up call status
          delete activeCalls[callerId];
          delete activeCalls[receiverId];
          delete callTimings[callerCallKey]?.startTime || callTimings[receiverCallKey]?.startTime;
        }
      } catch (error) {
        logger.error(`Error in endCall handler: ${error.message}`);
      }
    });

    // Update disconnect handler to handle call timings cleanup

    socket.on('disconnect', async () => {
      logger.info(`Socket disconnected: ${socket.id}`);

      // Find and remove the disconnected socket
      let disconnectedUserId;
      for (const [userId, socketIds] of Object.entries(users)) {
        const index = socketIds.indexOf(socket.id);
        if (index !== -1) {
          socketIds.splice(index, 1);
          disconnectedUserId = userId;

          // Remove user entry if no sockets left
          if (socketIds.length === 0) {
            delete users[userId];

            // Update user status to offline in database
            try {
              await User.findByIdAndUpdate(
                disconnectedUserId,
                {
                  status: 'offline',
                }
              );

              // Broadcast offline status to other users
              socket.broadcast.emit('userStatusChanged', {
                userId: disconnectedUserId,
                status: 'offline'
              });
            } catch (error) {
              logger.error(`Error updating user offline status: ${error.message}`);
            }
          }
          break;
        }
      }

      // End any active calls for the disconnected user
      if (disconnectedUserId && activeCalls[disconnectedUserId]) {
        const otherUserId = activeCalls[disconnectedUserId];

        // Log call if it was ongoing
        const callKey = `${disconnectedUserId}_${otherUserId}`;
        const reverseCallKey = `${otherUserId}_${disconnectedUserId}`;

        if (callTimings[callKey] || callTimings[reverseCallKey]) {
          const endTime = new Date();
          const startTime = callTimings[callKey]?.startTime || callTimings[reverseCallKey]?.startTime;
          const duration = Math.floor((endTime - startTime) / 1000);

          // Create call log for disconnected call
          CallLog.create({
            caller: new mongoose.Types.ObjectId(disconnectedUserId),
            receiver: new mongoose.Types.ObjectId(otherUserId),
            startTime,
            endTime,
            duration,
            status: 'disconnected'
          }).catch(error => {
            logger.error(`Error logging disconnected call: ${error.message}`);
          });

          // Clean up call timings
          delete callTimings[callKey];
          delete callTimings[reverseCallKey];
        }

        // Notify other user about call end
        if (users[otherUserId]) {
          users[otherUserId].forEach((socketId) => {
            socket.to(socketId).emit('callEnded', {
              callerId: disconnectedUserId
            });
          });
        }

        delete activeCalls[disconnectedUserId];
        delete activeCalls[otherUserId];
      }
    });
  });
};





// Make sure Firebase Admin SDK is initialized


async function sendNotification(userId, title, message, type, receiverId, senderName, senderAvatar) {
  try {
    // Fetch the user from the database
    const user = await User.findById(userId);
    if (!user || !user.deviceToken) {
      console.warn("No device token found for user:", userId);
      return;
    }

    const deviceToken = user.deviceToken;

    // Construct the payload for FCM
    const payload = {
      notification: {
        title,
        body: message,
        sound: 'default', // Optionally, add sound to the notification
      },
      data: {
        screen: 'incoming_Call', // Target screen identifier
        params: JSON.stringify({
          user_id: userId, // Caller ID
          type, // Type of notification
          agent_id: receiverId, // Receiver ID
          username: senderName, // Sender name
          imageurl: senderAvatar || 'https://investogram.ukvalley.com/avatars/default.png', // Sender avatar
        }),
        timestamp: new Date().toISOString(), // Add a timestamp for reference
      },
    };

    // Options for high-priority notifications
    const options = {
      priority: 'high', // Ensures notification wakes up the device
      timeToLive: 60 * 60 * 24, // Keep notification valid for 24 hours
    };

    // Send the notification via FCM
    const response = await admin.messaging().sendToDevice(deviceToken, payload, options);
    
    if (response.failureCount > 0) {
      console.error("Failed to send notification:", response.results);
    } else {
      console.info("Notification sent successfully:", response);
    }
  } catch (error) {
    console.error("Error sending notification:", error, { userId, title, message, type });
  }
}


