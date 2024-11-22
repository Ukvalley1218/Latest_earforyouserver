import axios from 'axios';
import crypto from 'crypto';
import Wallet from '../../models/Wallet/Wallet.js';
import User from '../../models/Users.js'
import sha256 from "sha256";
import uniqid from "uniqid";
import admin from 'firebase-admin';
import firebaseConfig from '../../config/firebaseConfig.js';
import SubscriptionPlan from '../../models/Subscription/Subscription.js';


export const initiatePayment = async (req, res) => {
  try {
    const { userId, planId  } = req.body;
    const plan = await SubscriptionPlan.findById(planId);
    console.log(plan)
     // Step 1: Validate the input
     if (!userId || !planId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid input. User ID and plan ID are required.',
      });
    }

    
    // Step 2: Fetch the plan details from the SubscriptionPlan collection
    const amount=plan.price;
    console


  

    // Generate a unique merchant transaction ID
    const merchantTransactionId = uniqid();

    // Create the payload for PhonePe
    const normalPayLoad = {
      merchantId: process.env.MERCHANT_ID, // Ensure you use the merchant ID from environment variables
      merchantTransactionId: merchantTransactionId,
      merchantUserId: userId,
      amount: amount * 100, // converting to paise
      redirectUrl: `${process.env.APP_BE_URL}/api/v1/validate/${merchantTransactionId}/${userId}`,
      redirectMode: "REDIRECT",
      mobileNumber: "9999999999",
      paymentInstrument: {
        type: "PAY_PAGE",
      },
    };

    // Encode the payload to base64
    const bufferObj = Buffer.from(JSON.stringify(normalPayLoad), "utf8");
    const base64EncodedPayload = bufferObj.toString("base64");

    // Create the X-VERIFY checksum
    const stringToHash = base64EncodedPayload + "/pg/v1/pay" + process.env.SALT_KEY;
    const sha256Hash = sha256(stringToHash);
    const xVerifyChecksum = `${sha256Hash}###${process.env.SALT_INDEX}`;

    // Make the request to PhonePe
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

    // Redirect the user to the payment page
    return res.status(200).json({
      success: true,
      paymentUrl: response.data.data.instrumentResponse.redirectInfo.url
    });
  } catch (error) {
    console.error("Error in payment initiation:", error);
    return res.status(500).send({ error: "Payment initiation failed" });
  }
};


// export const validatePayment = async (req, res) => {
//   const { merchantTransactionId, userId } = req.body; // Since we're now passing it in the URL params

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

//     // Check if the payment was successful
//     if (response.data && response.data.code === "PAYMENT_SUCCESS") {
//       const { amount } = response.data.data;

//       // Fetch the plan from the database
//       const plan = await SubscriptionPlan.findOne({ planId: response.data.data.planId });

//       if (!plan) {
//         return res.status(404).json({
//           success: false,
//           message: 'Plan not found.',
//         });
//       }

//       // Assign the plan to the user
//       const expirationDate = new Date(Date.now() + plan.validity * 24 * 60 * 60 * 1000); // Validity in days
//       const planDetails = {
//         planId: plan._id,
//         validity: plan.validity,
//         expirationDate: expirationDate,
//         status: 'active', // Initially, the plan is active
//         minutesLeft: plan.talkTime, // Allocate minutes to the plan (using `talkTime` from the schema)
//       };

//       // Fetch the user's wallet (optional: you can log the purchase here too)
//       const wallet = await Wallet.findOne({ userId });
      
//       if (!wallet) {
//         return res.status(404).json({
//           success: false,
//           message: 'Wallet not found for this user',
//         });
//       }

//       // Add the plan to the user's account
//       wallet.plans = wallet.plans || [];
//       wallet.plans.push(planDetails);
      
//       // Log the payment in the recharge history
//       wallet.recharges.push({
//         amount: amount / 100,  // Convert from paise to rupees
//         rechargeMethod: 'PhonePe',
//         transactionId: merchantTransactionId, // Unique transaction ID
//         state: 'COMPLETED',
//         createdAt: new Date(),
//       });

//       // Save the wallet and plan info
//       await wallet.save();

//       // Send a notification to the user
//       await sendNotification(userId, 'Plan Purchased Successfully', `You have successfully purchased the plan. Your new plan expires on ${expirationDate}.`);

//       return res.status(200).json({
//         success: true,
//         message: 'Plan purchased and wallet updated successfully',
//         data: {
//           plan: planDetails,
//         },
//       });
//     } else {
//       return res.status(400).json({
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


export const buyPlan = async (req, res) => {
  const { userId, planId } = req.body;

  try {
    // Step 1: Validate the input
    if (!userId || !planId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid input. User ID and plan ID are required.',
      });
    }

    // Step 2: Fetch the plan details from the SubscriptionPlan collection
    const plan = await SubscriptionPlan.findById(planId);
    
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found.',
      });
    }

    // Step 3: Initiate the payment through PhonePe
    const paymentResponse = await initiatePayment(req, res);  // Calling the initiatePayment function
    const paymentUrl = paymentResponse.paymentUrl;

    // Step 4: Redirect the user to the payment URL (on the frontend)
    return res.status(200).json({
      success: true,
      message: 'Redirecting to payment gateway',
      paymentUrl,  // Send the URL to the frontend for redirection
    });

  } catch (error) {
    console.error('Error in buying plan:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process the plan purchase',
      error: error.message,
    });
  }
};

export const validatePayment = async (req, res) => {
  const { merchantTransactionId, userId } = req.body; // Since we're now passing it in the URL params
  console.log("userId and merchantTransactionId:", userId, merchantTransactionId);
  if (!merchantTransactionId) {
    return res.status(400).send("Invalid transaction ID");
  }
  if (!userId) {
    return res.status(400).send("Invalid UserId ID");
  }

  try {
    // Construct the status URL
    const statusUrl = `${process.env.PHONE_PE_HOST_URL}/pg/v1/status/${process.env.MERCHANT_ID}/${merchantTransactionId}`;

    // Create the X-VERIFY checksum
    const stringToHash = `/pg/v1/status/${process.env.MERCHANT_ID}/${merchantTransactionId}${process.env.SALT_KEY}`;
    const sha256Hash = sha256(stringToHash);
    const xVerifyChecksum = `${sha256Hash}###${process.env.SALT_INDEX}`;

    // Make the request to check payment status
    const response = await axios.get(statusUrl, {
      headers: {
        "Content-Type": "application/json",
        "X-VERIFY": xVerifyChecksum,
        "X-MERCHANT-ID": merchantTransactionId,
        accept: "application/json",
      },
    });

    console.log("Payment validation response->", response.data);

    // Check if the payment was successful
    if (response.data && response.data.code === "PAYMENT_SUCCESS") {
      const { amount } = response.data.data;
      
      let wallet = await Wallet.findOne({ userId });

      if (!wallet) {

        
        wallet = await Wallet.create({
          userId: userId,
          balance: 0,
          currency: 'inr', // matches schema default
          recharges: [],
          deductions: [],
          lastUpdated: new Date()
        });
      }

      // Create recharge object matching your schema exactly
      const newRecharge = {
        amount: amount / 100, // Convert from paise to rupees
        merchantTransactionId: merchantTransactionId,
        state: response.data.data.state || 'COMPLETED',
        responseCode: response.data.code,
        rechargeMethod: "PhonePe",
        rechargeDate: new Date(),
        transactionId: merchantTransactionId // Using merchantTransactionId as transactionId
      };

      // Calculate new balance
      const newBalance = Number(wallet.balance) + Number(newRecharge.amount);
      
      // Update wallet
      wallet.balance = newBalance;
      wallet.recharges.push(newRecharge);
      // lastUpdated will be automatically updated by the pre-save hook

      await wallet.save();
      await sendNotification(userId, "Payment Successful", `Your wallet has been credited with ₹${newRecharge.amount}. New balance: ₹${wallet.balance}.`);

      return res.status(200).send({ 
        success: true, 
        message: "Payment validated and wallet updated",
        data: {
          balance: wallet.balance,
          transaction: newRecharge
        }
      });
    } else {
      // For failed payments
      let wallet = await Wallet.findOne({ userId });
      
      if (wallet) {
        const failedRecharge = {
          amount: response.data.data?.amount ? response.data.data.amount / 100 : 0,
          merchantTransactionId: merchantTransactionId,
          state: response.data.data?.state || 'FAILED',
          responseCode: response.data.code,
          rechargeMethod: "PhonePe",
          rechargeDate: new Date(),
          transactionId: merchantTransactionId
        };

        wallet.recharges.push(failedRecharge);
        await wallet.save();
        await sendNotification(userId, "Payment failed",` Your wallet has been failed with ₹${newRecharge.amount}. New balance: ₹${wallet.balance}.`);

      }

      return res.status(400).send({
        success: false,
        message: "Payment validation failed",
        data: response.data
      });
    }
  } catch (error) {
    console.error("Error in payment validation:", error);
    return res.status(500).send({ error: "Payment validation failed" });
  }
};






// export const buyPlan = async (req, res) => {
//   const { userId, planId } = req.body;

//   try {
//     // Step 1: Validate the input
//     if (!userId || !planId) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid input. User ID and plan ID are required.',
//       });
//     }

//     // Step 2: Fetch the plan details from the SubscriptionPlan collection
//     const plan = await SubscriptionPlan.findById(planId);
    
//     if (!plan) {
//       return res.status(404).json({
//         success: false,
//         message: 'Plan not found.',
//       });
//     }

//     // Step 3: Fetch the user's wallet to check balance
//     const wallet = await Wallet.findOne({ userId });
    
//     if (!wallet) {
//       return res.status(404).json({
//         success: false,
//         message: 'Wallet not found for this user',
//       });
//     }

//     // Step 4: Check if the user has enough balance
//     if (wallet.balance < plan.price) {
//       return res.status(400).json({
//         success: false,
//         message: 'Insufficient balance for the plan purchase',
//       });
//     }

//     // Step 5: Deduct the amount from the user's wallet
//     wallet.balance -= plan.price;

//     // Step 6: Add the plan to the user's account
//     const expirationDate = new Date(Date.now() + plan.validity * 24 * 60 * 60 * 1000); // Validity in days
//     const planDetails = {
//       planId: planId,
//       validity: plan.validity,
//       expirationDate: expirationDate,
//       status: 'active', // Initially, the plan is active
//       minutesLeft: plan.talkTime, // Allocate minutes to the plan (using `talkTime` from the schema)
//     };

//     wallet.plans = wallet.plans || []; // Ensure that the plans array exists
//     wallet.plans.push(planDetails);

//     // Step 7: Log the transaction in the wallet
//     wallet.recharges.push({
//       amount: plan.price,
//       rechargeMethod: 'PLAN_PURCHASE',
//       transactionId: uniqid(), // Unique transaction ID
//       createdAt: new Date(),
//       state: 'COMPLETED',
//     });

//     // Step 8: Save the updated wallet information
//     await wallet.save();

//     // Step 9: Send a notification to the user about the successful plan purchase
//     await sendNotification(
//       userId,
//       'Plan Purchased Successfully',
//       `You have successfully purchased the plan. Your new balance is ₹${wallet.balance}.`
//     );

//     // Step 10: Return a success response without balance information
//     return res.status(200).json({
//       success: true,
//       message: 'Plan purchased successfully',
//       data: {
//         plan: planDetails, // Return only the plan details
//       },
//     });

//   } catch (error) {
//     console.error('Error in buying plan:', error);
//     return res.status(500).json({
//       success: false,
//       message: 'Failed to process the plan purchase',
//       error: error.message,
//     });
//   }
// };


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




// Function to send FCM notification
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


