import Wallet from '../../models/Wallet/Wallet.js';
import mongoose from 'mongoose';
export const deductPerMinute = async (req, res) => {
  const session = await mongoose.startSession(); // Start a session for atomic transactions
  session.startTransaction();
  try {
    const {
      callerId,
      receiverId,
      callId,
      ratePerMinute,
      durationInMinutes
    } = req.body;
    if (ratePerMinute <= 0 || durationInMinutes <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Rate per minute and duration must be greater than 0'
      });
    }
    const adminCommissionPercent = 10; // Example: 10% commission for admin

    // Calculate total deduction and receiver's earnings
    const totalDeduction = ratePerMinute * durationInMinutes;
    const commission = adminCommissionPercent / 100 * totalDeduction;
    const amountForReceiver = totalDeduction - commission;

    // Find the caller's wallet
    const callerWallet = await Wallet.findOne({
      userId: callerId
    }).session(session);
    console.log(callerWallet);
    if (!callerWallet) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Caller wallet not found'
      });
    }

    // Check if the caller has sufficient balance
    if (callerWallet.balance < totalDeduction) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance for the call'
      });
    }

    // Deduct from the caller's wallet
    callerWallet.balance -= totalDeduction;
    callerWallet.deductions.push({
      amount: totalDeduction,
      deductionReason: 'call',
      callId,
      createdAt: new Date()
    });

    // Find the receiver's wallet
    const receiverWallet = await Wallet.findOne({
      userId: receiverId
    }).session(session);
    if (!receiverWallet) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Receiver wallet not found'
      });
    }

    // Add the amount (minus commission) to the receiver's wallet
    receiverWallet.balance += amountForReceiver;
    receiverWallet.recharges.push({
      amount: amountForReceiver,
      rechargeMethod: 'paypal',
      // Indicate income source
      transactionId: 'TXN12345',
      // Use callId as the transaction reference
      createdAt: new Date()
    });

    // Save both wallets
    await callerWallet.save({
      session
    });
    await receiverWallet.save({
      session
    });

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();
    res.status(200).json({
      success: true,
      message: 'Balance deducted and receiver credited successfully',
      callerBalance: callerWallet.balance,
      receiverBalance: receiverWallet.balance
    });
  } catch (error) {
    console.error('Transaction error:', error);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({
      success: false,
      message: 'Failed to process the transaction',
      error: error.message
    });
  }
};