import axios from 'axios';
import crypto from 'crypto';
import Wallet from '../../models/Wallet/Wallet.js';
import User from '../../models/Users.js'
import sha256 from "sha256";
import uniqid from "uniqid";
import admin from 'firebase-admin';
import firebaseConfig from '../../config/firebaseConfig.js';
import SubscriptionPlan from '../../models/Subscription/Subscription.js';



// export const initiatePayment = async (req, res) => {
//   try {
//     const { userId, amount } = req.body;

//     if (amount < 100) {
//       await logTransaction(transactionId, 'VALIDATION_FAILED', new Error('Amount below minimum'));
//       return res.status(400).json({
//         success: false,
//         message: 'Minimum recharge amount is 100'
//       });
//     }
//     // Transaction amount from query params




//     // Generate a unique merchant transaction ID
//     const merchantTransactionId = uniqid();

//     // Create the payload for PhonePe
//     const normalPayLoad = {
//       merchantId: process.env.MERCHANT_ID, // Ensure you use the merchant ID from environment variables
//       merchantTransactionId: merchantTransactionId,
//       merchantUserId: userId,
//       amount: amount * 100, // converting to paise
//       redirectUrl: `${process.env.APP_BE_URL}/api/v1/validate/${merchantTransactionId}/${userId}`,
//       redirectMode: "REDIRECT",
//       mobileNumber: "9999999999",
//       paymentInstrument: {
//         type: "PAY_PAGE",
//       },
//     };

//     // Encode the payload to base64
//     const bufferObj = Buffer.from(JSON.stringify(normalPayLoad), "utf8");
//     const base64EncodedPayload = bufferObj.toString("base64");

//     // Create the X-VERIFY checksum
//     const stringToHash = base64EncodedPayload + "/pg/v1/pay" + process.env.SALT_KEY;
//     const sha256Hash = sha256(stringToHash);
//     const xVerifyChecksum = `${sha256Hash}###${process.env.SALT_INDEX}`;

//     // Make the request to PhonePe
//     const response = await axios.post(
//       `${process.env.PHONE_PE_HOST_URL}/pg/v1/pay`,
//       { request: base64EncodedPayload },
//       {
//         headers: {
//           "Content-Type": "application/json",
//           "X-VERIFY": xVerifyChecksum,
//           accept: "application/json",
//         },
//       }
//     );

//     // Redirect the user to the payment page
//     return res.status(200).json({
//       success: true,
//       paymentUrl: response.data.data.instrumentResponse.redirectInfo.url
//     });
//   } catch (error) {
//     console.error("Error in payment initiation:", error);
//     return res.status(500).send({ error: "Payment initiation failed" });
//   }
// };


// export const validatePayment = async (req, res) => {
//   const { merchantTransactionId, userId } = req.body; // Since we're now passing it in the URL params
//   console.log("userId and merchantTransactionId:", userId, merchantTransactionId);
//   if (!merchantTransactionId) {
//     return res.status(400).send("Invalid transaction ID");
//   }
//   if (!userId) {
//     return res.status(400).send("Invalid UserId ID");
//   }

//   try {
//     // Construct the status URL
//     const statusUrl = `${process.env.PHONE_PE_HOST_URL}/pg/v1/status/${process.env.MERCHANT_ID}/${merchantTransactionId}`;

//     // Create the X-VERIFY checksum
//     const stringToHash = `/pg/v1/status/${process.env.MERCHANT_ID}/${merchantTransactionId}${process.env.SALT_KEY}`;
//     const sha256Hash = sha256(stringToHash);
//     const xVerifyChecksum = `${sha256Hash}###${process.env.SALT_INDEX}`;

//     // Make the request to check payment status
//     const response = await axios.get(statusUrl, {
//       headers: {
//         "Content-Type": "application/json",
//         "X-VERIFY": xVerifyChecksum,
//         "X-MERCHANT-ID": merchantTransactionId,
//         accept: "application/json",
//       },
//     });

//     console.log("Payment validation response->", response.data);

//     // Check if the payment was successful
//     if (response.data && response.data.code === "PAYMENT_SUCCESS") {
//       const { amount } = response.data.data;

//       let wallet = await Wallet.findOne({ userId });

//       if (!wallet) {


//         wallet = await Wallet.create({
//           userId: userId,
//           balance: 0,
//           currency: 'inr', // matches schema default
//           recharges: [],
//           deductions: [],
//           lastUpdated: new Date()
//         });
//       }

//       // Create recharge object matching your schema exactly
//       const newRecharge = {
//         amount: amount / 100, // Convert from paise to rupees
//         merchantTransactionId: merchantTransactionId,
//         state: response.data.data.state || 'COMPLETED',
//         responseCode: response.data.code,
//         rechargeMethod: "PhonePe",
//         rechargeDate: new Date(),
//         transactionId: merchantTransactionId // Using merchantTransactionId as transactionId
//       };

//       // Calculate new balance
//       const newBalance = Number(wallet.balance) + Number(newRecharge.amount);

//       // Update wallet
//       wallet.balance = newBalance;
//       wallet.recharges.push(newRecharge);
//       // lastUpdated will be automatically updated by the pre-save hook

//       await wallet.save();
//       await sendNotification(userId, "Payment Successful", `Your wallet has been credited with ₹${newRecharge.amount}. New balance: ₹${wallet.balance}.`);

//       return res.status(200).send({
//         success: true,
//         message: "Payment validated and wallet updated",
//         data: {
//           balance: wallet.balance,
//           transaction: newRecharge
//         }
//       });
//     } else {
//       // For failed payments
//       let wallet = await Wallet.findOne({ userId });

//       if (wallet) {
//         const failedRecharge = {
//           amount: response.data.data?.amount ? response.data.data.amount / 100 : 0,
//           merchantTransactionId: merchantTransactionId,
//           state: response.data.data?.state || 'FAILED',
//           responseCode: response.data.code,
//           rechargeMethod: "PhonePe",
//           rechargeDate: new Date(),
//           transactionId: merchantTransactionId
//         };

//         wallet.recharges.push(failedRecharge);
//         await wallet.save();
//         await sendNotification(userId, "Payment failed", `Your wallet has been failed with ₹${newRecharge.amount}. New balance: ₹${wallet.balance}.`);

//       }

//       return res.status(400).send({
//         success: false,
//         message: "Payment validation failed",
//         data: response.data
//       });
//     }
//   } catch (error) {
//     console.error("Error in payment validation:", error);
//     return res.status(500).send({ error: "Payment validation failed" });
//   }
// };






export const initiatePayment = async (req, res) => {
  try {
    const { userId, planId } = req.body;

    if (!planId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID and Plan ID are required'
      });
    }

    // Fetch the subscription plan by ID
    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    const { price, talkTime } = plan;

    if (price < 100) {
      await logTransaction(transactionId, 'VALIDATION_FAILED', new Error('Amount below minimum'));
      return res.status(400).json({
        success: false,
        message: 'Minimum recharge amount is 100'
      });
    }

    // Generate a unique merchant transaction ID
    const merchantTransactionId = uniqid();

    // Fetch user to get the mobile number (optional)
    const user = await User.findById(userId);
    if (!user || !user.mobileNumber) {
      return res.status(400).json({
        success: false,
        message: 'User not found or mobile number is missing'
      });
    }

    const normalPayLoad = {
      merchantId: process.env.MERCHANT_ID,
      merchantTransactionId: merchantTransactionId,
      merchantUserId: userId,
      amount: price * 100, // Convert to paise
      redirectUrl: `${process.env.APP_BE_URL}/api/v1/validate/${merchantTransactionId}/${userId}`,
      redirectMode: "REDIRECT",
      mobileNumber: user.mobileNumber, // Use actual mobile number
      paymentInstrument: { type: "PAY_PAGE" },
    };

    const bufferObj = Buffer.from(JSON.stringify(normalPayLoad), "utf8");
    const base64EncodedPayload = bufferObj.toString("base64");

    const stringToHash = base64EncodedPayload + "/pg/v1/pay" + process.env.SALT_KEY;
    const sha256Hash = sha256(stringToHash);
    const xVerifyChecksum = `${sha256Hash}###${process.env.SALT_INDEX}`;

    const response = await axios.post(
      `${process.env.PHONE_PE_HOST_URL}/pg/v1/pay`,
      { request: base64EncodedPayload },
      {
        headers: {
          "Content-Type": "application/json",
          "X-VERIFY": xVerifyChecksum,
          accept: "application/json",
        },
      }
    );

    return res.status(200).json({
      success: true,
      paymentUrl: response.data.data.instrumentResponse.redirectInfo.url
    });
  } catch (error) {
    console.error("Error in payment initiation:", error);
    return res.status(500).send({ error: "Payment initiation failed" });
  }
};

export const validatePayment = async (req, res) => {
  const { merchantTransactionId, userId ,planId} = req.body;

  if (!merchantTransactionId || !userId) {
    return res.status(400).send("Invalid transaction ID or user ID");
  }

  try {
    const statusUrl = `${process.env.PHONE_PE_HOST_URL}/pg/v1/status/${process.env.MERCHANT_ID}/${merchantTransactionId}`;
    const stringToHash = `/pg/v1/status/${process.env.MERCHANT_ID}/${merchantTransactionId}${process.env.SALT_KEY}`;
    const sha256Hash = sha256(stringToHash);
    const xVerifyChecksum = `${sha256Hash}###${process.env.SALT_INDEX}`;

    const response = await axios.get(statusUrl, {
      headers: {
        "Content-Type": "application/json",
        "X-VERIFY": xVerifyChecksum,
        accept: "application/json",
      },
    });

    if (response.data && response.data.code === "PAYMENT_SUCCESS") {
      const { amount } = response.data.data;
      // const planId = response.data.data.planId; // Assuming planId is returned in response

      // Fetch the subscription plan
      const plan = await SubscriptionPlan.findById(planId);
      if (!plan) {
        return res.status(400).send("Invalid plan ID");
      }

      const { price, talkTime } = plan;

      let wallet = await Wallet.findOne({ userId });
      if (!wallet) {
        wallet = await Wallet.create({
          userId,
          balance: 0,
          currency: 'inr',
          recharges: [],
          deductions: [],
          plan:[],
          lastUpdated: new Date()
        });
      }

      const newRecharge = {
        amount: amount / 100, 
        merchantTransactionId,
        state: response.data.data.state || 'COMPLETED',
        responseCode: response.data.code,
        rechargeMethod: "PhonePe",
        rechargeDate: new Date(),
        transactionId: merchantTransactionId
      };

      const newBalance = wallet.balance + talkTime;
      wallet.balance = newBalance;
      wallet.recharges.push(newRecharge);

      // Update the wallet balance and talk time
      wallet.talkTime = (wallet.talkTime || 0) + talkTime; // Add the talk time from the plan
      await wallet.save();

      // Send notification about successful payment
      await sendNotification(userId, "Payment Successful", `Your wallet has been credited with ₹${newRecharge.amount}. New balance: ₹${wallet.balance}. You have been credited with ${talkTime} minutes of talk time.`);

      return res.status(200).send({
        success: true,
        message: "Payment validated and wallet updated",
        data: { balance: wallet.balance, talkTime: wallet.talkTime, transaction: newRecharge }
      });
    } else {
      let wallet = await Wallet.findOne({ userId });
      if (wallet) {
        const failedRecharge = {
          amount: response.data.data?.amount ? response.data.data.amount / 100 : 0,
          merchantTransactionId,
          state: response.data.data?.state || 'FAILED',
          responseCode: response.data.code,
          rechargeMethod: "PhonePe",
          rechargeDate: new Date(),
          transactionId: merchantTransactionId
        };
        wallet.recharges.push(failedRecharge);
        await wallet.save();
        await sendNotification(userId, "Payment failed", `Your payment failed. Transaction ID: ${merchantTransactionId}.`);
      }
      return res.status(400).send({ success: false, message: "Payment validation failed", data: response.data });
    }
  } catch (error) {
    console.error("Error in payment validation:", error);
    return res.status(500).send({ error: "Payment validation failed" });
  }
};

export const getRechargeHistory = async (req, res) => {
  try {
    const { userId } = req.params; // Assuming userId is passed as a route parameter

    // Find the wallet for the specified userId
    const wallet = await Wallet.findOne({ userId });

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: "Wallet not found for this user",
      });
    }
    const rechargeHistory = wallet.recharges.slice(-20); // Fetch the most recent 20 recharges

    // Return the recharges array from the wallet
    return res.status(200).json({
      success: true,
      message: "Recharge history retrieved successfully",
      data: rechargeHistory,
      balance: wallet.balance,
    });
  } catch (error) {
    console.error("Error retrieving recharge history:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve recharge history",
      error: error.message,
    });
  }
};




export const getAllPlans = async (req, res) => {
  try {
    // Fetch all plans
    const plans = await SubscriptionPlan.find();

    if (!plans || plans.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No subscription plans found",
      });
    }

    // Respond with the fetched plans
    return res.status(200).json({
      success: true,
      message: "Subscription plans retrieved successfully",
      data: plans,
    });
  } catch (error) {
    console.error("Error fetching subscription plans:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch subscription plans",
      error: error.message,
    });
  }
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


