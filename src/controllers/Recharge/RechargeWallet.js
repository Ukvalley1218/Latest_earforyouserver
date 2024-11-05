import axios from 'axios';
import crypto from 'crypto';
import Wallet from '../../models/Wallet/Wallet.js';

import sha256 from "sha256";
import uniqid from "uniqid";


export const initiatePayment = async (req, res) => {
  try {
    const { userId, amount } = req.body;

    if (amount < 100) {
      await logTransaction(transactionId, 'VALIDATION_FAILED', new Error('Amount below minimum'));
      return res.status(400).json({
        success: false,
        message: 'Minimum recharge amount is 100'
      });
    }
    // Transaction amount from query params
   

  

    // Generate a unique merchant transaction ID
    const merchantTransactionId = uniqid();

    // Create the payload for PhonePe
    const normalPayLoad = {
      merchantId: process.env.MERCHANT_ID, // Ensure you use the merchant ID from environment variables
      merchantTransactionId: merchantTransactionId,
      merchantUserId: userId,
      amount: amount * 100, // converting to paise
      redirectUrl: `${process.env.APP_BE_URL}/api/v1/validate/${merchantTransactionId}`,
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
//   const { merchantTransactionId } = req.params;

//   if (!merchantTransactionId) {
//     return res.status(400).send("Invalid transaction ID");
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

//     // Handle the response and redirect based on payment status
//     if (response.data && response.data.code === "PAYMENT_SUCCESS") {
      
//       console.log("Payment validation response->", response.data);

//       // Handle the response and redirect based on payment status
//       if (response.data && response.data.code === "PAYMENT_SUCCESS") {
//         const userId = response.data.merchantUserId; // Assuming this is included in the response
//         const amount = response.data.amount; // Assuming this is the amount paid
  
//         // Find the user's wallet
//         let wallet = await Wallet.findOne({ userId });
  
//         if (!wallet) {
//           // Create a new wallet if it doesn't exist
//           wallet = new Wallet({ userId, balance: 0 }); // Start with zero balance
//         }
  
//         // Update the wallet balance
//         wallet.balance += amount / 100; // Convert from paise to your currency unit
  
//         // Add recharge record
//         wallet.recharges.push({
//           amount: amount / 100,
//           rechargeMethod: 'PhonePe',
//           transactionId: merchantTransactionId,
//         });
  
//         // Save the wallet
//         await wallet.save();
  
//         return res.send(response.data); // Or redirect to a success page
//       } else {
//         // Handle payment failure/pending status
//         return res.send(response.data); // Or redirect to a failure page
//       }
      
//       return res.send(response.data); // Or redirect to a success page
//     } else {
//       // Redirect or respond with payment failure/pending status
      
//     }
//   } catch (error) {
//     console.error("Error in payment validation:", error);
//     // Handle any errors and redirect to a failure page
//     return res.status(500).send({ error: "Payment validation failed" });
//   }
// };


export const validatePayment = async (req, res) => {
  const { merchantTransactionId } = req.params;

  if (!merchantTransactionId) {
    return res.status(400).send("Invalid transaction ID");
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
      // Update the user's wallet
      const { amount, userId } = response.data.data; // Ensure these values exist in the response

      if (!userId || isNaN(amount)) {
        return res.status(400).send("Invalid payment data");
      }

      // Find the user's wallet
      const wallet = await Wallet.findOne({ userId });

      if (!wallet) {
        return res.status(404).send("Wallet not found");
      }

      // Update the wallet balance and add the recharge information
      const newRecharge = {
        amount: amount / 100, // converting back from paise to rupees
        rechargeMethod: "PhonePe",
        transactionId: merchantTransactionId,
      };

      wallet.balance += newRecharge.amount; // Ensure balance is updated with a valid number
      wallet.recharges.push(newRecharge);

      await wallet.save();

      return res.status(200).send({ success: true, message: "Payment validated and wallet updated" });
    } else {
      // Payment failed or is pending
      return res.status(400).send(response.data);
    }
  } catch (error) {
    console.error("Error in payment validation:", error);
    return res.status(500).send({ error: "Payment validation failed" });
  }
};
