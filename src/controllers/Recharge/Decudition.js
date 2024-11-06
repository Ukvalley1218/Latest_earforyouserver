import Wallet from '../../models/Wallet/Wallet.js';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid'; // Import uuid

export const deductPerMinute = async (req, res) => {
  const session = await mongoose.startSession(); // Start a session for atomic transactions
  session.startTransaction();

  try {
    const { callerId, receiverId, callId, ratePerMinute, durationInMinutes } = req.body;

    if (ratePerMinute <= 0 || durationInMinutes <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Rate per minute and duration must be greater than 0',
      });
    }

    const adminCommissionPercent = 10; // Example: 10% commission for admin

    // Calculate total deduction and receiver's earnings
    const totalDeduction = ratePerMinute * durationInMinutes;
    const commission = (adminCommissionPercent / 100) * totalDeduction;
    const amountForReceiver = totalDeduction - commission;

    // Find the caller's wallet
    const callerWallet = await Wallet.findOne({ userId: callerId }).session(session);
    if (!callerWallet) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Caller wallet not found',
      });
    }

    // Check if the caller has sufficient balance
    if (callerWallet.balance < totalDeduction) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance for the call',
      });
    }

    // Generate a unique transaction ID
    const transactionId = uuidv4();

    // Deduct from the caller's wallet
    callerWallet.balance -= totalDeduction;
    callerWallet.deductions.push({
      amount: totalDeduction,
      deductionReason: 'call',
      callId,
      transactionId, // Store the generated transaction ID
      createdAt: new Date(),
    });

    // Find the receiver's wallet
    const receiverWallet = await Wallet.findOne({ userId: receiverId }).session(session);
    if (!receiverWallet) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Receiver wallet not found',
      });
    }

    // Add the amount (minus commission) to the receiver's wallet
    receiverWallet.balance += amountForReceiver;
    receiverWallet.recharges.push({
      amount: amountForReceiver,
      rechargeMethod: 'CALL', // Indicate income source
      transactionId, // Use the same transaction ID for consistency
      createdAt: new Date(),
    });

    // Save both wallets
    await callerWallet.save({ session });
    await receiverWallet.save({ session });

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'Balance deducted and receiver credited successfully',
      callerBalance: callerWallet.balance,
      receiverBalance: receiverWallet.balance,
      transactionId, // Return the transaction ID in the response
    });
  } catch (error) {
    console.error('Transaction error:', error);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({
      success: false,
      message: 'Failed to process the transaction',
      error: error.message,
    });
  }
};





// server/socketHandlers/callPaymentHandler.js
// import Wallet from '../../models/Wallet/Wallet.js';
// import mongoose from 'mongoose';
// import { v4 as uuidv4 } from 'uuid';

// class CallPaymentHandler {
//   constructor(io) {
//     this.io = io;
//     this.activeDeductions = new Map(); // Store active call deductions
//   }

//   // Initialize socket handlers
//   initialize(socket) {
//     socket.on('startCall', this.handleStartCall.bind(this, socket));
//     socket.on('endCall', this.handleEndCall.bind(this, socket));
//     socket.on('disconnect', () => this.handleDisconnect(socket));
//   }

//   // Start processing deductions for a call
//   async handleStartCall(socket, { callerId, receiverId, callId, ratePerMinute }) {
//     try {
//       // Validate input
//       if (ratePerMinute <= 0) {
//         socket.emit('callError', {
//           message: 'Invalid rate per minute',
//           callId
//         });
//         return;
//       }

//       // Initial balance check
//       const callerWallet = await Wallet.findOne({ userId: callerId });
//       if (!callerWallet || callerWallet.balance < ratePerMinute) {
//         socket.emit('callError', {
//           message: 'Insufficient balance to start call',
//           callId
//         });
//         return;
//       }

//       // Store deduction info
//       this.activeDeductions.set(callId, {
//         callerId,
//         receiverId,
//         ratePerMinute,
//         lastDeductionTime: Date.now(),
//         socket,
//         intervalId: null
//       });

//       // Start periodic deduction
//       const intervalId = setInterval(
//         () => this.processMinuteDeduction(callId),
//         60000 // Run every minute
//       );

//       this.activeDeductions.get(callId).intervalId = intervalId;

//       socket.emit('callStarted', {
//         message: 'Call payment processing started',
//         callId
//       });
//     } catch (error) {
//       console.error('Error starting call payment:', error);
//       socket.emit('callError', {
//         message: 'Failed to start call payment processing',
//         callId
//       });
//     }
//   }

//   // Process deduction for one minute
//   async processMinuteDeduction(callId) {
//     const deductionInfo = this.activeDeductions.get(callId);
//     if (!deductionInfo) return;

//     const session = await mongoose.startSession();
//     session.startTransaction();

//     try {
//       const { callerId, receiverId, ratePerMinute, socket } = deductionInfo;
//       const adminCommissionPercent = 10;
//       const commission = (adminCommissionPercent / 100) * ratePerMinute;
//       const amountForReceiver = ratePerMinute - commission;
//       const transactionId = uuidv4();

//       // Find and update caller's wallet
//       const callerWallet = await Wallet.findOne({ userId: callerId }).session(session);
//       if (!callerWallet || callerWallet.balance < ratePerMinute) {
//         throw new Error('Insufficient balance');
//       }

//       callerWallet.balance -= ratePerMinute;
//       callerWallet.deductions.push({
//         amount: ratePerMinute,
//         deductionReason: 'call',
//         callId,
//         transactionId,
//         createdAt: new Date()
//       });

//       // Find and update receiver's wallet
//       const receiverWallet = await Wallet.findOne({ userId: receiverId }).session(session);
//       if (!receiverWallet) {
//         throw new Error('Receiver wallet not found');
//       }

//       receiverWallet.balance += amountForReceiver;
//       receiverWallet.recharges.push({
//         amount: amountForReceiver,
//         rechargeMethod: 'CALL',
//         transactionId,
//         createdAt: new Date()
//       });

//       // Save changes
//       await callerWallet.save({ session });
//       await receiverWallet.save({ session });
//       await session.commitTransaction();

//       // Emit updates to relevant clients
//       this.io.to(callerId).emit('balanceUpdate', {
//         newBalance: callerWallet.balance,
//         callId,
//         transactionId
//       });
//       this.io.to(receiverId).emit('balanceUpdate', {
//         newBalance: receiverWallet.balance,
//         callId,
//         transactionId
//       });

//     } catch (error) {
//       await session.abortTransaction();
//       console.error('Minute deduction error:', error);
      
//       if (error.message === 'Insufficient balance') {
//         // End call if balance is insufficient
//         this.handleEndCall(deductionInfo.socket, { callId });
//         deductionInfo.socket.emit('callEnded', {
//           message: 'Call ended due to insufficient balance',
//           callId
//         });
//       }
//     } finally {
//       session.endSession();
//     }
//   }

//   // Handle call end
//   handleEndCall(socket, { callId }) {
//     const deductionInfo = this.activeDeductions.get(callId);
//     if (deductionInfo) {
//       clearInterval(deductionInfo.intervalId);
//       this.activeDeductions.delete(callId);
//       socket.emit('callEnded', {
//         message: 'Call payment processing stopped',
//         callId
//       });
//     }
//   }

//   // Clean up on disconnect
//   handleDisconnect(socket) {
//     for (const [callId, deductionInfo] of this.activeDeductions.entries()) {
//       if (deductionInfo.socket === socket) {
//         this.handleEndCall(socket, { callId });
//       }
//     }
//   }
// }

// export default CallPaymentHandler;