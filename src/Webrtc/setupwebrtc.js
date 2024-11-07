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
  const randomCallQueue = new Set();
  io.on('connection', (socket) => {
    logger.http(`User connected: ${socket.id}`);

    socket.on('join', async ({ userId }) => {
      if (!users[userId]) {
        users[userId] = [];
      }
      users[userId].push(socket.id);
      logger.info(`User ${userId} joined with socket ID ${socket.id}`);
    });

    
     // Handle random call request
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
    
        // Get all available users (excluding the requester and users in calls)
        const allAvailableUsers = Object.keys(users).filter(potentialUserId => 
          potentialUserId !== userId && // Not the requesting user
          !activeCalls[potentialUserId] && // Not in a call
          users[potentialUserId]?.length > 0 && // Has active socket connections
          !randomCallQueue.has(potentialUserId) // Not already in queue
        );

        logger.info(`Available users for random call with ${userId}:`, {
          totalAvailable: allAvailableUsers.length,
          availableUserIds: allAvailableUsers,
          activeConnections: allAvailableUsers.map(id => ({
            userId: id,
            socketCount: users[id]?.length || 0
          }))
        });

        if (allAvailableUsers.length > 0) {
          // Match with a random available user
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
    
          // Set active call status
          activeCalls[userId] = matchedUserId;
          activeCalls[matchedUserId] = userId;
    
          // Notify the caller about the match
          socket.emit('randomCallMatched', { 
            matchedUserId: matchedUserId,
            matchedUsername: receiver.username,
            socketId: socket.id
          });
    
          // Notify the matched user about incoming call
          users[matchedUserId].forEach((receiverSocketId) => {
            socket.to(receiverSocketId).emit('incomingRandomCall', {
              callerId: userId,
              callerUsername: caller.username,
              socketId: socket.id
            });
          });
    
          // Send push notification if receiver has a device token
          if (receiver.deviceToken) {
            const title = 'Random Call';
            const message = `${caller.username} wants to connect with you!`;
            await sendNotification(matchedUserId, title, message);
            logger.info(`Push notification sent to User ${matchedUserId}`);
          }
    
          logger.info(`Random call matched: ${userId} with ${matchedUserId}`);
          
          // Set a timeout for call acceptance
          setTimeout(async () => {
            // If call wasn't accepted/rejected, clean up
            if (activeCalls[userId] === matchedUserId) {
              delete activeCalls[userId];
              delete activeCalls[matchedUserId];
              
              socket.emit('callError', { message: 'Call request timed out' });
              users[matchedUserId]?.forEach((receiverSocketId) => {
                socket.to(receiverSocketId).emit('callEnded', { callerId: userId });
              });
              
              logger.info(`Random call timed out between ${userId} and ${matchedUserId}`);
            }
          }, 30000); // 30 seconds timeout
    
        } else {
          // Add user to queue if no users available
          randomCallQueue.add(userId);
          socket.emit('waitingForRandomMatch', { 
            message: 'Waiting for another user to connect' 
          });
          logger.info(`User ${userId} added to random call queue`);
    
          // Set a timeout for queue waiting
          setTimeout(() => {
            if (randomCallQueue.has(userId)) {
              randomCallQueue.delete(userId);
              socket.emit('randomCallTimeout', { 
                message: 'No users available for random call. Please try again later.' 
              });
              logger.info(`User ${userId} removed from queue due to timeout`);
            }
          }, 60000); // 60 seconds queue timeout
        }
      } catch (error) {
        logger.error(`Error in random call handler: ${error.message}`);
        socket.emit('callError', { message: 'Failed to process random call request' });
      }
    });
    
    // Handle random call acceptance
    socket.on('acceptRandomCall', async ({ receiverId, callerId }) => {
      try {
        logger.info(`User ${receiverId} accepted random call from User ${callerId}`);
    
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
    socket.on('call', async ({ callerId, receiverId }) => {
      try {
        logger.info(`User ${callerId} is calling User ${receiverId}`);

        // Check if either user is already in a call
        if (activeCalls[receiverId] || activeCalls[callerId]) {
          socket.emit('userBusy', { receiverId });
          logger.warn(`User ${receiverId} or ${callerId} is already in a call`);
          return;
        }

        // Get user details
        const receiver = await User.findById(receiverId);
        const caller = await User.findById(callerId);

        if (!receiver) {
          socket.emit('userUnavailable', { receiverId });
          logger.warn(`User ${receiverId} not found`);
          return;
        }

        // Initialize socket arrays if needed
        if (!users[callerId]) users[callerId] = [];
        if (!users[receiverId]) users[receiverId] = [];

        // Add current socket to caller's sockets if not already present
        if (!users[callerId].includes(socket.id)) {
          users[callerId].push(socket.id);
        }

        if (users[receiverId].length > 0) {
          // Emit incoming call to all receiver's sockets
          users[receiverId].forEach((socketId) => {
            socket.to(socketId).emit('incomingCall', { 
              callerId, 
              socketId: socket.id 
            });
          });

          socket.emit('playCallerTune', { callerId });

          // Send push notification if available
          if (receiver.deviceToken) {
            const title = 'Incoming Call';
            const message = `${caller.username} is calling you!`;
            await sendNotification(receiverId, title, message);
            logger.info(`Push notification sent to User ${receiverId}`);
          }
        } else {
          socket.emit('userUnavailable', { receiverId });
          logger.warn(`User ${receiverId} is unavailable for the call`);
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

    // Handle call acceptance
    socket.on('acceptCall', async ({ receiverId, callerId }) => {
      try {
        logger.info(`User ${receiverId} accepted call from User ${callerId}`);

        if (users[callerId]) {
          users[callerId].forEach((socketId) => {
            socket.to(socketId).emit('callAccepted', { 
              receiverId, 
              socketId: socket.id 
            });
          });

          // Stop caller tune
          socket.emit('stopCallerTune', { callerId });
        }
      } catch (error) {
        logger.error(`Error in acceptCall handler: ${error.message}`);
        socket.emit('callError', { message: 'Failed to accept call' });
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

    // Handle call end
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

          // Clean up call status
          delete activeCalls[callerId];
          delete activeCalls[receiverId];

          // Create call log
          const endTime = new Date();
          const startTime = new Date(endTime - 1000); // Placeholder, adjust based on your needs
          const duration = Math.floor((endTime - startTime) / 1000);

          await CallLog.create({
            caller: new mongoose.Types.ObjectId(callerId),
            receiver: new mongoose.Types.ObjectId(receiverId),
            startTime,
            endTime,
            duration,
            status: 'completed'
          });
        }
      } catch (error) {
        logger.error(`Error in endCall handler: ${error.message}`);
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
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
          }
          break;
        }
      }

      // End any active calls for the disconnected user
      if (disconnectedUserId && activeCalls[disconnectedUserId]) {
        const otherUserId = activeCalls[disconnectedUserId];
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






async function sendNotification(userId, title, message) {
  // Assuming you have the FCM device token stored in your database
  const user = await User.findById(userId);
  const deviceToken = user.deviceToken;

  if (!deviceToken) {
    console.error("No device token found for user:", userId);
    return;
  }

  const payload = {
    notification: {
      title: title,
      body: message,
    },
    token: deviceToken,
  };

  try {
    const response = await admin.messaging().send(payload);
    console.log("Notification sent successfully:", response);
  } catch (error) {
    console.error("Error sending notification:", error);
  }
}