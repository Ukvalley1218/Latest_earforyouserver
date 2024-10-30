import mongoose from 'mongoose';
import CallLog from '../models/Talk-to-friend/callLogModel.js';
import logger from '../logger/winston.logger.js';
import sendNotification from '../utils/sendNotification.js';
import User from '../models/Users.js';
// import handleCallRecording  from './Recording.js'
import Wallet from '../models/Wallet/Wallet.js';
export const setupWebRTC = io => {
  // Store active users and their socket connections
  const users = {}; // { userId: [socketId1, socketId2, ...] }
  const activeCalls = {}; // { userId: otherUserId }
  const randomCallQueue = new Set();
  const callTimers = {}; // Store intervals for billing
  const callConnections = {};
  const RATE_PER_MINUTE = 10;
  const BILLING_INTERVAL = 60000; // 1 minute
  const MINIMUM_BALANCE = RATE_PER_MINUTE;
  const startBilling = async (callerId, receiverId, socket) => {
    // Generate a unique transaction ID for this billing cycle
    const transactionId = `CALL-${callerId}-${receiverId}-${Date.now()}`;
    const timerId = setInterval(async () => {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const callerWallet = await Wallet.findOne({
            userId: callerId
          }).session(session);

          // Check for insufficient balance
          if (!callerWallet || callerWallet.balance < RATE_PER_MINUTE) {
            clearInterval(callTimers[callerId]);
            delete callTimers[callerId];

            // Notify both parties about insufficient balance
            socket.emit('callEnded', {
              reason: 'Insufficient balance',
              remainingBalance: callerWallet?.balance || 0
            });
            if (users[receiverId]) {
              users[receiverId].forEach(socketId => {
                io.to(socketId).emit('callEnded', {
                  callerId,
                  reason: 'Insufficient balance'
                });
              });
            }

            // Clean up call status
            delete activeCalls[callerId];
            delete activeCalls[receiverId];
            return;
          }

          // Verify payment through PhonePe before proceeding
          const paymentStatus = await verifyPaymentWithPhonePe(transactionId); // Verify using the dynamic transaction ID
          if (!paymentStatus) {
            throw new Error('Payment verification failed');
          }

          // Process billing
          const adminCommissionPercent = 10;
          const totalDeduction = RATE_PER_MINUTE;
          const commission = adminCommissionPercent / 100 * totalDeduction;
          const amountForReceiver = totalDeduction - commission;

          // Update caller's wallet
          callerWallet.balance -= totalDeduction;
          callerWallet.deductions.push({
            amount: totalDeduction,
            deductionReason: 'call',
            callId: `${callerId}-${receiverId}-${Date.now()}`,
            createdAt: new Date()
          });

          // Update receiver's wallet
          const receiverWallet = await Wallet.findOne({
            userId: receiverId
          }).session(session);
          if (receiverWallet) {
            receiverWallet.balance += amountForReceiver;
            receiverWallet.recharges.push({
              amount: amountForReceiver,
              rechargeMethod: 'call_earning',
              transactionId: `CALL-${Date.now()}`,
              createdAt: new Date()
            });
            await receiverWallet.save({
              session
            });

            // Notify receiver about earnings
            if (users[receiverId]) {
              users[receiverId].forEach(socketId => {
                io.to(socketId).emit('earningsUpdate', {
                  amount: amountForReceiver,
                  newBalance: receiverWallet.balance
                });
              });
            }
          }
          await callerWallet.save({
            session
          });

          // Notify caller about balance update
          socket.emit('balanceUpdate', {
            newBalance: callerWallet.balance,
            deduction: totalDeduction,
            timestamp: Date.now()
          });
        });
      } catch (error) {
        logger.error(`Billing error: ${error.message}`);
        clearInterval(callTimers[callerId]);
        delete callTimers[callerId];
        socket.emit('callError', {
          message: 'Billing error occurred'
        });
      } finally {
        if (session) {
          session.endSession();
        }
      }
    }, BILLING_INTERVAL);
    callTimers[callerId] = timerId;
  };

  // Function to verify payment with PhonePe
  const verifyPaymentWithPhonePe = async transactionId => {
    try {
      // Prepare the request URL and payload
      const apiUrl = 'https://api.phonepe.com/v1/transaction'; // Replace with the actual PhonePe API URL
      const headers = {
        'Content-Type': 'application/json'
        // Include authentication headers if required
        // 'Authorization': 'Bearer YOUR_ACCESS_TOKEN',
      };
      const response = await axios.get(`${apiUrl}/${transactionId}`, {
        headers
      });

      // Check the response to see if the payment is successful
      if (response.data && response.data.status === 'SUCCESS') {
        return true; // Payment is successful
      } else {
        return false; // Payment failed or status is not SUCCESS
      }
    } catch (error) {
      console.error(`Payment verification error: ${error.message}`);
      return false; // Return false in case of any error
    }
  };
  io.on('connection', socket => {
    logger.http(`User connected: ${socket.id}`);
    socket.on('join', async ({
      userId
    }) => {
      if (!users[userId]) {
        users[userId] = [];
      }
      users[userId].push(socket.id);
      logger.info(`User ${userId} joined with socket ID ${socket.id}`);
    });
    socket.on('call', async ({
      callerId,
      receiverId
    }) => {
      try {
        logger.info(`User ${callerId} is calling User ${receiverId}`);

        // Check caller's balance
        const callerWallet = await Wallet.findOne({
          userId: callerId
        });
        if (!callerWallet || callerWallet.balance < MINIMUM_BALANCE) {
          socket.emit('callError', {
            message: 'Insufficient balance to start call',
            remainingBalance: callerWallet?.balance || 0
          });
          return;
        }

        // Check if users are already in calls
        if (activeCalls[receiverId] || activeCalls[callerId]) {
          socket.emit('userBusy', {
            receiverId
          });
          return;
        }
        const [caller, receiver] = await Promise.all([User.findById(callerId), User.findById(receiverId)]);
        if (!receiver || !caller) {
          socket.emit('userUnavailable', {
            receiverId
          });
          return;
        }

        // Initialize user socket arrays
        if (!users[callerId]) users[callerId] = [];
        if (!users[receiverId]) users[receiverId] = [];
        if (!users[callerId].includes(socket.id)) {
          users[callerId].push(socket.id);
        }
        if (users[receiverId].length > 0) {
          // Notify receiver about incoming call
          users[receiverId].forEach(socketId => {
            io.to(socketId).emit('incomingCall', {
              callerId,
              callerName: caller.username,
              socketId: socket.id
            });
          });
          socket.emit('playCallerTune', {
            callerId
          });

          // Send push notification
          if (receiver.deviceToken) {
            await sendNotification(receiver.deviceToken, 'Incoming Call', `${caller.username} is calling you!`);
          }
        } else {
          socket.emit('userUnavailable', {
            receiverId
          });
        }
      } catch (error) {
        logger.error(`Error in call handler: ${error.message}`);
        socket.emit('callError', {
          message: 'Failed to initiate call'
        });
      }
    });

    // Object to maintain connection states

    socket.on('offer', ({
      offer,
      callerId,
      receiverId
    }) => {
      try {
        logger.info(`Offer from ${callerId} to ${receiverId}`);
        activeCalls[callerId] = receiverId;
        activeCalls[receiverId] = callerId;

        // Initialize the call connection state
        callConnections[callerId] = {
          connected: false
        };
        if (users[receiverId]) {
          users[receiverId].forEach(socketId => {
            io.to(socketId).emit('offer', {
              offer,
              callerId
            });
          });
        }
      } catch (error) {
        logger.error(`Error in offer handler: ${error.message}`);
        socket.emit('callError', {
          message: 'Failed to process offer'
        });
      }
    });
    socket.on('answer', async ({
      answer,
      receiverId,
      callerId
    }) => {
      try {
        const callerWallet = await Wallet.findOne({
          userId: callerId
        });
        if (!callerWallet || callerWallet.balance < MINIMUM_BALANCE) {
          socket.emit('callError', {
            message: 'Insufficient balance to start call',
            remainingBalance: callerWallet?.balance || 0
          });
          return;
        }
        if (users[callerId]) {
          users[callerId].forEach(socketId => {
            io.to(socketId).emit('answer', {
              answer,
              receiverId
            });
          });

          // Update the connection state to true
          callConnections[callerId].connected = true;
          callConnections[receiverId].connected = true;
          startBilling(callerId, receiverId, socket);
          // Emit a connected event
          io.to(callerId).emit('callConnected', {
            message: 'Call connected',
            callerId,
            receiverId
          });
          io.to(receiverId).emit('callConnected', {
            message: 'Call connected',
            callerId,
            receiverId
          });
        }
      } catch (error) {
        logger.error(`Error in answer handler: ${error.message}`);
        socket.emit('callError', {
          message: 'Failed to process answer'
        });
      }
    });
    socket.on('iceCandidate', ({
      candidate,
      callerId,
      receiverId
    }) => {
      try {
        if (users[receiverId]) {
          users[receiverId].forEach(socketId => {
            io.to(socketId).emit('iceCandidate', {
              candidate,
              callerId
            });
          });
        }
      } catch (error) {
        logger.error(`Error in iceCandidate handler: ${error.message}`);
      }
    });
    socket.on('acceptCall', async ({
      receiverId,
      callerId
    }) => {
      try {
        logger.info(`Call accepted: ${receiverId} accepted ${callerId}'s call`);
        const callerWallet = await Wallet.findOne({
          userId: callerId
        });
        if (!callerWallet || callerWallet.balance < MINIMUM_BALANCE) {
          socket.emit('callError', {
            message: 'Insufficient balance to start call',
            remainingBalance: callerWallet?.balance || 0
          });
          return;
        }
        if (users[callerId]) {
          users[callerId].forEach(socketId => {
            io.to(socketId).emit('callAccepted', {
              receiverId,
              socketId: socket.id
            });
          });
        }
      } catch (error) {
        logger.error(`Error in acceptCall handler: ${error.message}`);
        socket.emit('callError', {
          message: 'Failed to accept call'
        });
      }
    });
    socket.on('rejectCall', async ({
      receiverId,
      callerId
    }) => {
      try {
        logger.info(`Call rejected: ${receiverId} rejected ${callerId}'s call`);
        delete activeCalls[callerId];
        delete activeCalls[receiverId];
        if (users[callerId]) {
          users[callerId].forEach(socketId => {
            io.to(socketId).emit('callRejected', {
              receiverId
            });
          });
        }
        socket.emit('stopCallerTune', {
          callerId
        });
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
        socket.emit('callError', {
          message: 'Failed to reject call'
        });
      }
    });
    socket.on('endCall', async ({
      receiverId,
      callerId
    }) => {
      try {
        logger.info(`Call ended between ${callerId} and ${receiverId}`);
        if (callTimers[callerId]) {
          clearInterval(callTimers[callerId]);
          delete callTimers[callerId];
        }
        if (activeCalls[callerId] === receiverId) {
          if (users[receiverId]) {
            users[receiverId].forEach(socketId => {
              io.to(socketId).emit('callEnded', {
                callerId
              });
            });
          }
          delete activeCalls[callerId];
          delete activeCalls[receiverId];
          const endTime = new Date();
          const startTime = new Date(endTime.getTime() - BILLING_INTERVAL); // Use last billing interval
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

    // Handle random call request
    socket.on('requestRandomCall', async ({
      userId
    }) => {
      try {
        logger.info(`User ${userId} requesting random call`);

        // Check caller's balance
        const callerWallet = await Wallet.findOne({
          userId: callerId
        });
        if (!callerWallet || callerWallet.balance < MINIMUM_BALANCE) {
          socket.emit('callError', {
            message: 'Insufficient balance to start call',
            remainingBalance: callerWallet?.balance || 0
          });
          return;
        }

        // Check if user is already in a call
        if (activeCalls[userId]) {
          socket.emit('callError', {
            message: 'You are already in a call'
          });
          return;
        }

        // Check if user is already in queue
        if (randomCallQueue.has(userId)) {
          socket.emit('callError', {
            message: 'You are already in random call queue'
          });
          return;
        }

        // Get all available users (excluding the requester and users in calls)
        const allAvailableUsers = Object.keys(users).filter(potentialUserId => potentialUserId !== userId &&
        // Not the requesting user
        !activeCalls[potentialUserId] &&
        // Not in a call
        users[potentialUserId]?.length > 0 &&
        // Has active socket connections
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
          const [caller, receiver] = await Promise.all([User.findById(userId), User.findById(matchedUserId)]);
          if (!caller || !receiver) {
            socket.emit('callError', {
              message: 'Failed to match users'
            });
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
          users[matchedUserId].forEach(receiverSocketId => {
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
            await sendNotification(receiver.deviceToken, title, message);
            logger.info(`Push notification sent to User ${matchedUserId}`);
          }
          logger.info(`Random call matched: ${userId} with ${matchedUserId}`);

          // Set a timeout for call acceptance
          setTimeout(async () => {
            // If call wasn't accepted/rejected, clean up
            if (activeCalls[userId] === matchedUserId) {
              delete activeCalls[userId];
              delete activeCalls[matchedUserId];
              socket.emit('callError', {
                message: 'Call request timed out'
              });
              users[matchedUserId]?.forEach(receiverSocketId => {
                socket.to(receiverSocketId).emit('callEnded', {
                  callerId: userId
                });
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
        socket.emit('callError', {
          message: 'Failed to process random call request'
        });
      }
    });

    // Handle random call acceptance
    socket.on('acceptRandomCall', async ({
      receiverId,
      callerId
    }) => {
      try {
        logger.info(`User ${receiverId} accepted random call from User ${callerId}`);
        if (users[callerId]) {
          users[callerId].forEach(socketId => {
            socket.to(socketId).emit('randomCallAccepted', {
              receiverId,
              socketId: socket.id
            });
          });
        }
      } catch (error) {
        logger.error(`Error in acceptRandomCall handler: ${error.message}`);
        socket.emit('callError', {
          message: 'Failed to accept random call'
        });
      }
    });
    // Handle random call rejection
    socket.on('rejectRandomCall', async ({
      receiverId,
      callerId
    }) => {
      try {
        logger.info(`User ${receiverId} rejected random call from User ${callerId}`);

        // Clean up call status
        delete activeCalls[callerId];
        delete activeCalls[receiverId];

        // Notify caller about rejection
        if (users[callerId]) {
          users[callerId].forEach(socketId => {
            socket.to(socketId).emit('randomCallRejected', {
              receiverId
            });
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
        socket.emit('callError', {
          message: 'Failed to reject random call'
        });
      }
    });
    // Cancel random call request
    socket.on('cancelRandomCall', ({
      userId
    }) => {
      if (randomCallQueue.has(userId)) {
        randomCallQueue.delete(userId);
        socket.emit('randomCallCancelled', {
          message: 'Random call request cancelled'
        });
        logger.info(`User ${userId} cancelled random call request`);
      }
    });
    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`);
      let disconnectedUserId;
      for (const [userId, socketIds] of Object.entries(users)) {
        const index = socketIds.indexOf(socket.id);
        if (index !== -1) {
          socketIds.splice(index, 1);
          disconnectedUserId = userId;
          if (callTimers[userId]) {
            clearInterval(callTimers[userId]);
            delete callTimers[userId];
          }
          if (socketIds.length === 0) {
            delete users[userId];

            // Clean up random call queue
            randomCallQueue.delete(userId);
          }
          break;
        }
      }
      if (disconnectedUserId && activeCalls[disconnectedUserId]) {
        const otherUserId = activeCalls[disconnectedUserId];
        if (users[otherUserId]) {
          users[otherUserId].forEach(socketId => {
            io.to(socketId).emit('callEnded', {
              callerId: disconnectedUserId,
              reason: 'User disconnected'
            });
          });
        }
        delete activeCalls[disconnectedUserId];
        delete activeCalls[otherUserId];
      }
    });

    // Set up call recording
    // handleCallRecording(socket);
  });
};