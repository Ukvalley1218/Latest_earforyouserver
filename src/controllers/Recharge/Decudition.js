import Wallet from '../../models/Wallet/Wallet.js';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid'; // Import uuid
import { CallRate } from '../../models/Wallet/AdminCharges.js';
import EarningWallet from '../../models/Wallet/EarningWallet.js';

export const deductPerMinute = async (req, res) => {
  const session = await mongoose.startSession(); // Start a session for atomic transactions
  session.startTransaction();

  try {
    const { callerId, receiverId, durationInMinutes } = req.body;

    // Validate the request body
    if (!callerId || !receiverId || durationInMinutes <= 0 || isNaN(durationInMinutes)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid input. Caller ID, receiver ID, and valid duration are required.',
      });
    }

    // Fetch the call rate configuration
    const callRateData = await CallRate.findOne().session(session); 
    
    if (!callRateData) {
      await session.abortTransaction();
      return res.status(500).json({
        success: false,
        message: 'Call rate configuration not found',
      });
    }

    const { adminCommissionPercent, ratePerMinute } = callRateData;
    
    console.log("pre:",adminCommissionPercent, "pre:",ratePerMinute );

    // Validate the rate per minute
    if (isNaN(ratePerMinute) || ratePerMinute <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Rate per minute must be a valid number greater than 0',
      });
    }

    // Calculate total deduction and receiver's earnings
    const totalDeduction = ratePerMinute * durationInMinutes;
    const commission = (adminCommissionPercent / 100) * totalDeduction;
    const amountForReceiver = totalDeduction - commission;

    // Ensure that the calculations do not result in NaN
    if (isNaN(totalDeduction) || isNaN(amountForReceiver)) {
      return res.status(500).json({
        success: false,
        message: 'Error calculating amounts. Please try again.',
      });
    }

    // Fetch the caller's wallet
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
      transactionId, // Store the generated transaction ID
      createdAt: new Date(),
    });

    // Fetch the receiver's wallet
    const receiverWallet = await EarningWallet.findOne({ userId: receiverId }).session(session);
    if (!receiverWallet) {
      //  new EarningWallet({
      //   userId: receiverId,
      //   balance: 0, // Default balance
      //   totalDeductions: 0, // Default total deductions
      //   currency: "INR",
      //   deductions: [],
      //   earnings: [],
      // });
      
      await EarningWallet.create([{
        userId: receiverId,
        balance: 0,
        currency: 'inr',
        earnings: [],
        deductions: [],
        lastUpdated: new Date()
      }]);
   
    }

    // Add the amount (minus commission) to the receiver's wallet
    receiverWallet.balance += amountForReceiver;
    receiverWallet.earnings.push({
      amount: amountForReceiver,
      source: 'CALL', // Indicate income source
      transactionId, // Use the same transaction ID for consistency
      createdAt: new Date(),
      responseCode: 'SUCCESS', // Assuming a success response from the transaction
      state: 'COMPLETED', // Indicate the transaction is complete
      merchantTransactionId: transactionId, // Use the same transaction ID
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
    // Ensure the session is aborted if an error occurs
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({
      success: false,
      message: 'Failed to process the transaction',
      error: error.message,
    });
  }
};





// // Deduct minutes from the active subscription plan
// export const deductPlanMinutes = async (req, res) => {
//   const { userId, planId, minutesToDeduct } = req.body;

//   try {
//     // Find the user's wallet
//     const wallet = await Wallet.findOne({ userId });

//     // If the wallet does not exist, return an error
//     if (!wallet) {
//       return res.status(404).json({ error: 'Wallet not found for this user' });
//     }

//     // Find the active plan in the user's wallet
//     const plan = wallet.plans.find(p => p.planId.toString() === planId.toString() && p.status === 'active');

//     // If no active plan is found, return an error
//     if (!plan) {
//       return res.status(404).json({ error: 'Active plan not found' });
//     }

//     // Check if there are enough minutes in the plan to deduct
//     if (plan.minutesLeft < minutesToDeduct) {
//       return res.status(400).json({ error: 'Not enough minutes in the plan to deduct' });
//     }

//     // Deduct the minutes from the plan
//     plan.minutesLeft -= minutesToDeduct;

//     // Save the updated wallet document
//     await wallet.save();

//     // Return success response with the remaining minutes
//     return res.status(200).json({
//       message: `Successfully deducted ${minutesToDeduct} minutes from the plan.`,
//       remainingMinutes: plan.minutesLeft
//     });
//   } catch (error) {
//     console.error(error);
//     return res.status(500).json({ error: 'An error occurred while deducting minutes from the plan' });
//   }
// };

export const deductPlanMinutes = async (req, res) => {
  const session = await mongoose.startSession(); // Start a session for atomic transactions
  session.startTransaction();

  try {
    const { userId, planId, minutesToDeduct } = req.body;

    // Validate input
    if (!userId || !planId || minutesToDeduct <= 0 || isNaN(minutesToDeduct)) {
      return res.status(400).json({ success: false, message: 'Invalid input parameters.' });
    }

    // Fetch the call rate configuration
    const callRateData = await CallRate.findOne().session(session);
    if (!callRateData) {
      await session.abortTransaction();
      return res.status(500).json({
        success: false,
        message: 'Call rate configuration not found',
      });
    }

    const { adminCommissionPercent, ratePerMinute } = callRateData;

    // Validate rate per minute
    if (isNaN(ratePerMinute) || ratePerMinute <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Rate per minute must be a valid number greater than 0',
      });
    }

    // Fetch the user's wallet
    const wallet = await Wallet.findOne({ userId }).session(session);
    if (!wallet) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Wallet not found for this user' });
    }

    // Find the active plan in the user's wallet
    const plan = wallet.plans.find(p => p.planId.toString() === planId.toString() && p.status === 'active');
    if (!plan) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Active plan not found' });
    }

    // Check if there are enough minutes in the plan to deduct
    if (plan.minutesLeft < minutesToDeduct) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Not enough minutes in the plan to deduct' });
    }

    // Calculate total deduction and receiver's earnings based on rate per minute
    const totalDeduction = ratePerMinute * minutesToDeduct;
    const commission = (adminCommissionPercent / 100) * totalDeduction;
    const amountForReceiver = totalDeduction - commission;

    // Ensure the calculations do not result in NaN
    if (isNaN(totalDeduction) || isNaN(amountForReceiver)) {
      await session.abortTransaction();
      return res.status(500).json({
        success: false,
        message: 'Error calculating amounts. Please try again.',
      });
    }

    // Deduct minutes from the active plan and wallet balance
    plan.minutesLeft -= minutesToDeduct;

    // Deduct from the user's wallet
    wallet.balance -= totalDeduction;
    wallet.deductions.push({
      amount: totalDeduction,
      deductionReason: 'plan_usage',
      transactionId: uuidv4(), // Generate unique transaction ID
      createdAt: new Date(),
    });

    // Fetch the receiver's wallet (assuming you have a receiverId passed in)
    const receiverWallet = await Wallet.findOne({ userId: req.body.receiverId }).session(session);
    if (!receiverWallet) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Receiver wallet not found' });
    }

    // Add the amount (minus commission) to the receiver's wallet
    receiverWallet.balance += amountForReceiver;
    receiverWallet.recharges.push({
      amount: amountForReceiver,
      rechargeMethod: 'CALL', // Indicate income source
      transactionId: uuidv4(), // Use the same transaction ID for consistency
      createdAt: new Date(),
      responseCode: 'SUCCESS',
      state: 'COMPLETED',
      merchantTransactionId: uuidv4(),
    });

    // Save the updated wallets and plans
    await wallet.save({ session });
    await receiverWallet.save({ session });
    await session.commitTransaction();
    session.endSession();

    // Return success response with updated balances
    res.status(200).json({
      success: true,
      message: `Successfully deducted ${minutesToDeduct} minutes from the plan.`,
      remainingMinutes: plan.minutesLeft,
      callerBalance: wallet.balance,
      receiverBalance: receiverWallet.balance,
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