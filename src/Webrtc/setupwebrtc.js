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
    //       socket.emit('receiverUnavailable', { receiverId });
    //       logger.warn(`User ${receiverId} not found`);
    //       return;
    //     }

    //     if (!caller) {
    //       socket.emit('callerUnavailable', { callerId });
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
    //         const type = 'incoming_Call';
    //         const senderName = caller.username || 'Unknown Caller';
    //         const senderAvatar = caller.avatarUrl || 'https://investogram.ukvalley.com/avatars/default.png';

    //         await sendNotification(receiverId, title, message, type, callerId, senderName, senderAvatar);
    //         logger.info(`Push notification sent to User ${receiverId}`);
    //       }
    //     } else {
    //       if (receiver.deviceToken) {
    //         const title = 'Incoming Call';
    //         const message = `${caller.username || 'Unknown Caller'} is calling you!`;
    //         const type = 'incoming_Call';
    //         const senderName = caller.username || 'Unknown Caller';
    //         const senderAvatar = caller.avatarUrl || 'https://investogram.ukvalley.com/avatars/default.png';

    //         try {
    //           // Initial notification
    //           await sendNotification(receiverId, title, message, type, callerId, senderName, senderAvatar);
    //           logger.info(`Push notification sent to User ${receiverId}`);

    //           // Retry after 30 seconds if still not connected
    //           const callTimeout = setTimeout(async () => {
    //             try {
    //               await sendNotification(receiverId, title, message, type, callerId, senderName, senderAvatar);
    //               logger.info(`Retry push notification sent to User ${receiverId}`);
    //             } catch (retryError) {
    //               logger.error(`Retry push notification failed for User ${receiverId}: ${retryError.message}`);
    //             }
    //           }, 30000); // 30 seconds

    //           // Cleanup timeout if the call is accepted or rejected
    //           socket.on('acceptCall', () => {
    //             clearTimeout(callTimeout);
    //             logger.info(`Call accepted by User ${receiverId}`);
    //           });

    //           socket.on('rejectCall', () => {
    //             clearTimeout(callTimeout);
    //             logger.info(`Call rejected by User ${receiverId}`);
    //           });

    //           socket.on('endCall', () => {
    //             clearTimeout(callTimeout);
    //             logger.info(`Call ended by User ${receiverId}`);
    //           });

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
          logger.warn(`Receiver user ${receiverId} not found`);
          return;
        }

        if (!caller) {
          socket.emit('callerUnavailable', { callerId });
          logger.warn(`Caller user ${callerId} not found`);
          return;
        }

        // Initialize socket arrays if needed
        users[callerId] = users[callerId] || [];
        users[receiverId] = users[receiverId] || [];

        // Add current socket to caller's list if not already present
        if (!users[callerId].includes(socket.id)) {
          users[callerId].push(socket.id);
        }

        if (users[receiverId].length > 0) {
          // Notify all receiver's sockets about the incoming call
          users[receiverId].forEach((socketId) => {
            socket.to(socketId).emit('incomingCall', {
              callerId,
              callerSocketId: socket.id, // Provide caller's socket ID
            });
          });

          // Notify the caller to play caller tune
          socket.emit('playCallerTune', { callerId });

          // Send push notification if the receiver has a device token
          if (receiver.deviceToken) {
            const title = 'Incoming Call';
            const message = `${caller.username || 'Unknown Caller'} is calling you!`;
            const type = 'incoming_Call';
            const senderName = caller.username || 'Unknown Caller';
            const senderAvatar = caller.avatarUrl || 'https://investogram.ukvalley.com/avatars/default.png';

            await sendNotification_call(receiverId, title, message, type, callerId, senderName, senderAvatar);
            logger.info(`Push notification sent to User ${receiverId}`);
          }

        } else {
          // Handle case where receiver is offline or unavailable
          if (receiver.deviceToken) {
            const title = 'Incoming Call';
            const message = `${caller.username || 'Unknown Caller'} is calling you!`;
            const type = 'incoming_Call';
            const senderName = caller.username || 'Unknown Caller';
            const senderAvatar = caller.avatarUrl || 'https://investogram.ukvalley.com/avatars/default.png';

            try {
              // Send initial notification
              await sendNotification(receiverId, title, message, type, callerId, senderName, senderAvatar);
              logger.info(`Push notification sent to User ${receiverId}`);

              // Cleanup timeout if the call is accepted, rejected, or ended
              const cleanupTimeout = () => {
                logger.info(`Call timeout cleared for User ${receiverId}`);
              };

              socket.on('acceptCall', cleanupTimeout);
              socket.on('rejectCall', cleanupTimeout);
              socket.on('endCall', cleanupTimeout);
            } catch (error) {
              logger.error(`Failed to send push notification to User ${receiverId}: ${error.message}`);
            }
          } else {
            logger.warn(`No device token available for User ${receiverId}, skipping notification`);
          }
        }
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

    // Handle ICE candidates offer
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



    // socket.on('acceptCall', async ({ receiverId, callerId }) => {
    //   try {
    //     logger.info(`User ${receiverId} accepted call from User ${callerId}`);

    //     // Store start time as a Date object
    //     const callKey = `${receiverId}_${callerId}`;
    //     logger.info(`callKey ${callKey}`);

    //     callTimings[callKey] = {
    //       startTime: new Date() // Start time as a Date object
    //     };

    //     // Notify the caller that the call has been accepted
    //     if (users[callerId]) {
    //       users[callerId].forEach((socketId) => {
    //         socket.to(socketId).emit('callAccepted', {
    //           receiverId,
    //           socketId: socket.id
    //         });
    //         socket.to(socketId).emit('activeCall',{
    //           callerId,
    //           receiverId,
    //           socketId:socket.id
    //         }
    //       });

    //       // Stop the caller's tune after call acceptance
    //       socket.emit('stopCallerTune', { callerId });
    //     }
    //   } catch (error) {
    //     logger.error(`Error in acceptCall handler: ${error.message}`);
    //     socket.emit('callError', { message: 'Failed to accept call' });
    //   }
    // });

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

    // Handle call rejection



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
          await sendNotification(
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

        // await ChatMessage.call.push({

        //   caller: new mongoose.Types.ObjectId(callerId),
        //   receiver: new mongoose.Types.ObjectId(receiverId),
        //   startTime: new Date(),
        //   endTime: new Date(),
        //   duration: 0,
        //   status: 'rejected'


        // })

      } catch (error) {
        logger.error(`Error in rejectCall handler: ${error.message}`);
        socket.emit('callError', { message: 'Failed to reject call' });
      }
    });


    socket.on('endCall', async ({ receiverId, callerId }) => {
      try {
        logger.info(`Call ended between ${callerId} and ${receiverId}`);

        // Check if the call is active
        if (activeCalls[callerId] === receiverId || activeCalls[receiverId] === callerId) {
          // Notify the other party about the call ending
          if (users[receiverId]) {
            users[receiverId].forEach((socketId) => {
              socket.to(socketId).emit('callEnded', { callerId });
              socket.to(socketId).emit('inactiveCall', {
                callerId,
                receiverId,
                socketId: socket.id, // Include the initiating socket ID
              });
            });
          }

          // Calculate call duration
          const callerCallKey = `${callerId}_${receiverId}`;
          const receiverCallKey = `${receiverId}_${callerId}`;
          const startTime = callTimings[callerCallKey]?.startTime || callTimings[receiverCallKey]?.startTime;

          if (!startTime) {
            logger.warn(`Start time not found for call between ${callerId} and ${receiverId}`);
            return;
          }

          const endTime = new Date();
          const duration = Math.round((endTime - new Date(startTime)) / 1000); // Duration in seconds

          // Log the call with duration
          await CallLog.create({
            caller: new mongoose.Types.ObjectId(callerId),
            receiver: new mongoose.Types.ObjectId(receiverId),
            startTime: new Date(startTime),
            endTime,
            duration,
            status: 'completed',
          });

          logger.info(`Call log saved for call between ${callerId} and ${receiverId}`);

          // Clean up call-related data
          delete activeCalls[callerId];
          delete activeCalls[receiverId];
          delete callTimings[callerCallKey];
          delete callTimings[receiverCallKey];
        } else {
          logger.warn(`No active call found between ${callerId} and ${receiverId}`);
        }
      } catch (error) {
        logger.error(`Error in endCall handler: ${error.message}`);
      }
    });


    // Update disconnect handler to handle call timings cleanup

    // socket.on('disconnect', async () => {
    //   logger.info(`Socket disconnected: ${socket.id}`);

    //   // Find and remove the disconnected socket
    //   let disconnectedUserId;
    //   for (const [userId, socketIds] of Object.entries(users)) {
    //     const index = socketIds.indexOf(socket.id);
    //     if (index !== -1) {
    //       socketIds.splice(index, 1);
    //       disconnectedUserId = userId;

    //       // Remove user entry if no sockets left
    //       if (socketIds.length === 0) {
    //         delete users[userId];

    //         // Update user status to offline in database
    //         try {
    //           await User.findByIdAndUpdate(
    //             disconnectedUserId,
    //             {
    //               status: 'offline',
    //             }
    //           );

    //           // Broadcast offline status to other users
    //           socket.broadcast.emit('userStatusChanged', {
    //             userId: disconnectedUserId,
    //             status: 'offline'
    //           });
    //         } catch (error) {
    //           logger.error(`Error updating user offline status: ${error.message}`);
    //         }
    //       }
    //       break;
    //     }
    //   }

    //   // End any active calls for the disconnected user
    //   if (disconnectedUserId && activeCalls[disconnectedUserId]) {
    //     const otherUserId = activeCalls[disconnectedUserId];

    //     // Log call if it was ongoing
    //     const callKey = `${disconnectedUserId}_${otherUserId}`;
    //     const reverseCallKey = `${otherUserId}_${disconnectedUserId}`;

    //     if (callTimings[callKey] || callTimings[reverseCallKey]) {
    //       const endTime = new Date();
    //       const startTime = callTimings[callKey]?.startTime || callTimings[reverseCallKey]?.startTime;
    //       const duration = Math.floor((endTime - startTime) / 1000);

    //       // Create call log for disconnected call
    //       CallLog.create({
    //         caller: new mongoose.Types.ObjectId(disconnectedUserId),
    //         receiver: new mongoose.Types.ObjectId(otherUserId),
    //         startTime,
    //         endTime,
    //         duration,
    //         status: 'disconnected'
    //       }).catch(error => {
    //         logger.error(`Error logging disconnected call: ${error.message}`);
    //       });

    //       // Clean up call timings
    //       delete callTimings[callKey];
    //       delete callTimings[reverseCallKey];
    //     }

    //     // Notify other user about call end
    //     if (users[otherUserId]) {
    //       users[otherUserId].forEach((socketId) => {
    //         socket.to(socketId).emit('callEnded', {
    //           callerId: disconnectedUserId
    //         });
    //       });
    //     }

    //     delete activeCalls[disconnectedUserId];
    //     delete activeCalls[otherUserId];
    //   }
    // });


    // socket.on('disconnect', async () => {
    //   logger.info(`Socket disconnected: ${socket.id}`);
    //   removeUserFromQueue(socket.id);
    //   console.log('Current queue:', userQueue);

    //   let disconnectedUserId;
    //   for (const [userId, socketIds] of Object.entries(users)) {
    //     const index = socketIds.indexOf(socket.id);
    //     if (index !== -1) {
    //       socketIds.splice(index, 1);
    //       disconnectedUserId = userId;

    //       if (socketIds.length === 0) {
    //         delete users[userId];
    //         try {
    //           const updatedUser = await User.findOneAndUpdate(
    //             { _id: disconnectedUserId, userType: 'CALLER' },
    //             { status: 'offline' },
    //             { new: true }
    //           );
    //           if (updatedUser) {
    //             io.emit('userStatusChanged', { userId: disconnectedUserId, status: 'offline' });
    //           }

    //         } catch (error) {
    //           logger.error(`Failed to update offline status for user ${disconnectedUserId}: ${error.message}`);
    //         }
    //       }
    //       break;
    //     }
    //   }

    //   if (disconnectedUserId && activeCalls[disconnectedUserId]) {
    //     const otherUserId = activeCalls[disconnectedUserId];
    //     const callKey = `${disconnectedUserId}_${otherUserId}`;
    //     const reverseCallKey = `${otherUserId}_${disconnectedUserId}`;
    //     const callStartTime = callTimings[callKey]?.startTime || callTimings[reverseCallKey]?.startTime;

    //     if (callStartTime) {
    //       const endTime = new Date();
    //       const duration = Math.floor((endTime - callStartTime) / 1000);

    //       try {
    //         await CallLog.create({
    //           caller: new mongoose.Types.ObjectId(disconnectedUserId),
    //           receiver: new mongoose.Types.ObjectId(otherUserId),
    //           startTime: callStartTime,
    //           endTime,
    //           duration,
    //           status: 'disconnected',
    //         });
    //       } catch (error) {
    //         logger.error(`Failed to log call for disconnected user ${disconnectedUserId}: ${error.message}`);
    //       }

    //       delete callTimings[callKey];
    //       delete callTimings[reverseCallKey];
    //     }

    //     if (users[otherUserId]) {
    //       users[otherUserId].forEach((socketId) => {
    //         socket.to(socketId).emit('callEnded', { callerId: disconnectedUserId });
    //       });
    //     }

    //     delete activeCalls[disconnectedUserId];
    //     delete activeCalls[otherUserId];
    //   }
    // });


    socket.on('disconnect', async () => {
      logger.info(`Socket disconnected: ${socket.id}`);
      removeUserFromQueue(socket.id);
      console.log('Current queue:', userQueue);

      let disconnectedUserId;

      // Find and remove the socket ID from the user's list
      for (const [userId, socketIds] of Object.entries(users)) {
        const index = socketIds.indexOf(socket.id);
        if (index !== -1) {
          socketIds.splice(index, 1);
          disconnectedUserId = userId;

          if (socketIds.length === 0) {
            delete users[userId];

            // Update user status to offline
            try {
              const updatedUser = await User.findOneAndUpdate(
                { _id: disconnectedUserId },
                { status: 'offline' },
                { new: true }
              );
              if (updatedUser) {
                io.emit('userStatusChanged', { userId: disconnectedUserId, status: 'offline' });
                // logger.error(`  update offline status for user ${disconnectedUserId}: ${updatedUser} Userid ${userId}`);
              }
            } catch (error) {
              logger.error(`Failed to update offline status for user ${disconnectedUserId}: ${error.message}`);
            }
          }
          break;
        }
      }

      // Handle active call disconnection
      if (disconnectedUserId && activeCalls[disconnectedUserId]) {
        const otherUserId = activeCalls[disconnectedUserId];
        const callKey = `${disconnectedUserId}_${otherUserId}`;
        const reverseCallKey = `${otherUserId}_${disconnectedUserId}`;
        const callStartTime = callTimings[callKey]?.startTime || callTimings[reverseCallKey]?.startTime;

        if (callStartTime) {
          const endTime = new Date();
          const duration = Math.floor((endTime - callStartTime) / 1000);

          try {
            await CallLog.create({
              caller: new mongoose.Types.ObjectId(disconnectedUserId),
              receiver: new mongoose.Types.ObjectId(otherUserId),
              startTime: callStartTime,
              endTime,
              duration,
              status: 'disconnected',
            });
          } catch (error) {
            logger.error(`Failed to log call for disconnected user ${disconnectedUserId}: ${error.message}`);
          }

          delete callTimings[callKey];
          delete callTimings[reverseCallKey];
        }

        if (users[otherUserId]) {
          users[otherUserId].forEach((socketId) => {
            socket.to(socketId).emit('callEnded', { callerId: disconnectedUserId });
          });
        }

        delete activeCalls[disconnectedUserId];
        delete activeCalls[otherUserId];
      }
    });


  });
};


async function sendNotification_call(userId, title, message, type, callerId, senderName, senderAvatar) {
  try {
    const user = await User.findById(userId);
    if (!user || !user.deviceToken) {
      logger.error(`No device token found for user: ${userId}`);
      return;
    }

    const payload = {
      notification: {
        title: title || "Incoming Voice Call",
        body: message || `${senderName} is calling you`
      },
      data: {
        screen: 'incoming_Call',
        params: JSON.stringify({
          user_id: userId,
          type: 'voice',
          agent_id: callerId,
          username: senderName,
          imageurl: senderAvatar || 'https://investogram.ukvalley.com/avatars/default.png',
          timestamp: Date.now().toString(),
          call_id: `${callerId}_${Date.now()}`,
          channel_id: 'EarforYou123',
          priority: 'high',
          notification_type: 'call',
          action_answer: 'Answer Call',
          action_decline: 'Decline Call'
        })
      },
      android: {
        priority: 'high',
        ttl: 60000,
        notification: {
          channel_id: 'EarforYou123',
          priority: 'high',
          default_sound: true,
          notification_priority: 'PRIORITY_HIGH'
        }
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: title || "Incoming Voice Call",
              body: message || `${senderName} is calling you`
            },
            sound: 'default',
            category: 'VOICE_CALL',
            'content-available': 1,
            priority: '10'
          }
        },
        headers: {
          'apns-push-type': 'background',
          'apns-priority': '10',
          'apns-expiration': (Math.floor(Date.now() / 1000) + 60).toString()
        }
      },
      token: user.deviceToken
    };

    logger.info(`Sending voice call notification to user ${userId}`);
    const response = await admin.messaging().send(payload);
    logger.info(`Voice call notification sent successfully: ${response}`);
    return response;
  } catch (error) {
    logger.error(`Failed to send voice call notification: ${error.message}`);
    throw error;
  }
}


async function sendNotification(userId, title, message, type, receiverId, senderName, senderAvatar) {
  try {
    // Input validation
    if (!userId) {
      throw new Error('userId is required');
    }

    // Fetch the user from the database
    const user = await User.findById(userId);
    if (!user) {
      throw new Error(`User not found with ID: ${userId}`);
    }

    if (!user.deviceToken) {
      throw new Error(`No device token found for user: ${userId}`);
    }

    const deviceToken = user.deviceToken;

    // Prepare the data payload
    const notificationData = {
      screen: 'incoming_Call',
      user_id: userId,
      type: type,
      agent_id: receiverId,
      username: senderName,
      imageurl: senderAvatar || 'https://investogram.ukvalley.com/avatars/default.png',
      timestamp: new Date().toISOString(),
    };

    // Construct the notification payload
    const payload = {
      token: deviceToken,
      
      notification: {
        title: title || "Incoming Voice Call",
        body: message || `${senderName} is calling you`,
      },
      
      data: {
        ...notificationData,
        click_action: 'FLUTTER_NOTIFICATION_CLICK', // For handling notification clicks
        screen: 'incoming_Call',
      },
      
      // Android specific
      android: {
        priority: 'high',
        notification: {
          channelId: 'voice_calls',
          priority: 'max',
          defaultSound: true,
          defaultVibrate: true
        }
      },
      
      // iOS specific
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
        },
        payload: {
          aps: {
            alert: {
              title: title || "Incoming Voice Call",
              body: message || `${senderName} is calling you`,
            },
            sound: 'default',
            badge: 1,
            category: 'VOICE_CALL',
            'content-available': 1
          },
          // Custom data for iOS
          screen: 'incoming_Call',
          data: notificationData
        }
      }
    };

    // Log the notification attempt
    logger.info({
      message: 'Sending push notification',
      userId,
      type,
      deviceToken, // Log token for debugging
      timestamp: new Date().toISOString(),
    });

    // Send the notification
    const response = await admin.messaging().send(payload);
    
    // Log successful delivery
    logger.info({
      message: 'Push notification sent successfully',
      userId,
      messageId: response,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      messageId: response,
    };

  } catch (error) {
    // Enhanced error logging
    logger.error({
      message: 'Failed to send push notification',
      userId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });

    throw new Error(`Failed to send notification: ${error.message}`);
  }
}

// Example of React Native notification channel setup:
/*
// In your React Native app initialization:
import PushNotification from 'react-native-push-notification';

PushNotification.createChannel(
  {
    channelId: 'voice_calls', // Must match the channelId in the payload
    channelName: 'Voice Calls',
    channelDescription: 'Notifications for incoming voice calls',
    playSound: true,
    soundName: 'default',
    importance: 4, // max importance
    vibrate: true,
  },
  (created) => console.log(`Channel 'voice_calls' created: ${created}`)
);
*/






// async function sendMNotification(userId, title, message, type, receiverId, senderName, senderAvatar) {
//   try {
//     // Fetch the user from the database
//     const user = await User.findById(userId);
//     if (!user || !user.deviceToken) {
//       console.error("No device token found for user:", userId);
//       return;
//     }

//     const deviceToken = user.deviceToken;

//     // Construct the payload for FCM
//     const payload = {
//       notification: {
//         title: title,
//         body: message,
//       },
//       data: {
//         screen: 'misscall', // Target screen
//         params: JSON.stringify({
//           user_id: userId, // Include Call ID
//           type: type, // Type of call
//           agent_id: receiverId, // Receiver ID
//           username: senderName, // Sender name
//           imageurl: senderAvatar || 'https://investogram.ukvalley.com/avatars/default.png', // Sender avatar with default fallback
//         }),
//         // Add any additional parameters if needed
//       },
//       token: deviceToken,
//     };
//     logger.info(`Push notification sent to User  in  notification  function`);

//     // Send the notification
//     const response = await admin.messaging().send(payload);
//     console.log("Notification sent successfully:", response);
//   } catch (error) {
//     console.error("Error sending notification:", error);
//   }
// }








// // Helper function to validate call parameters
// const validateCallParams = (receiverId, callerId) => {
//   if (!receiverId || !callerId) {
//     throw new Error('Missing required parameters: receiverId or callerId');
//   }
// };

// // Helper function to mark a call as missed in the database
// const markCallAsMissed = async (callerId, receiverId, startTime) => {
//   try {
//     await CallLog.create({
//       caller: callerId,
//       receiver: receiverId,
//       status: 'missed',
//       startTime: startTime || new Date(),
//       endTime: new Date(),
//       duration: 0,
//     });
//     logger.info(`Missed call logged in database: Caller: ${callerId}, Receiver: ${receiverId}`);
//   } catch (error) {
//     logger.error(`Error saving missed call to database: ${error.message}`);
//     throw new Error('Failed to log missed call');
//   }
// };