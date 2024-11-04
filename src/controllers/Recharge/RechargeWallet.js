import axios from 'axios';
import crypto from 'crypto';
import Wallet from '../../models/Wallet/Wallet.js';

// PhonePe test mode configuration
const MERCHANT_ID = 'PGTESTPAYUAT77';
const SALT_KEY = '14fa5465-f8a7-443f-8477-f986b8fcfde9';
const SALT_INDEX = 1;
const API_BASE_URL = 'https://api-preprod.phonepe.com/apis/pg-sandbox';
const TRANSACTION_EXPIRY_TIME = 30 * 60 * 1000; // 30 minutes

// Create axios instance with timeout
const phonepeApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Helper function to generate SHA256 hash
const generateHash = (string) => {
  return crypto.createHash('sha256').update(string, 'utf-8').digest('hex');
};

// Helper functions for amount conversion
const convertToPaise = (rupeeAmount) => {
  return Math.round(rupeeAmount * 100);
};

const convertToRupees = (paiseAmount) => {
  return Math.round(paiseAmount) / 100;
};

// Function to create payment request payload
const createPayloadForPhonePe = (amount, transactionId, callbackUrl) => {
  const payload = {
    merchantId: MERCHANT_ID,
    merchantTransactionId: transactionId,
    merchantUserId: 'MUID' + Date.now(),
    amount: convertToPaise(amount),
    redirectUrl: callbackUrl,
    redirectMode: 'POST',
    callbackUrl: callbackUrl,
    mobileNumber: '',
    paymentInstrument: {
      type: 'PAY_PAGE'
    }
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64');
};

// Validate callback signature - FIXED
const validateCallback = (responseData, saltKey, saltIndex, receivedXVerify) => {
  try {
    // Generate SHA256 hash of base64 response + salt key
    const string = `${responseData}${saltKey}`;
    const sha256Hash = crypto.createHash('sha256').update(string).digest('hex');
    const expectedXVerify = `${sha256Hash}###${saltIndex}`;

    console.log('Generated Hash:', sha256Hash);
    console.log('Expected X-Verify:', expectedXVerify);
    console.log('Received X-Verify:', receivedXVerify);

    return expectedXVerify === receivedXVerify;
  } catch (error) {
    console.error('Validation Error:', error);
    return false;
  }
};

// Logger function
const logTransaction = async (transactionId, status, error = null) => {
  const logData = {
    timestamp: new Date(),
    transactionId,
    status,
    error: error ? error.message : null
  };
  console.log('Transaction Log:', logData);
};

// Initiate PhonePe payment
export const initiatePhonePePayment = async (req, res) => {
  try {
    const { userId, amount } = req.body;
    const transactionId = 'TXN' + Date.now();
    const callbackUrl = 'http://localhost:8080/api/v1/payment-callback';

    // Validate minimum amount
    if (amount < 100) {
      await logTransaction(transactionId, 'VALIDATION_FAILED', new Error('Amount below minimum'));
      return res.status(400).json({
        success: false,
        message: 'Minimum recharge amount is 100'
      });
    }

    // Create base64 payload
    const base64Payload = createPayloadForPhonePe(amount, transactionId, callbackUrl);

    // Generate X-VERIFY header
    const string = `${base64Payload}/pg/v1/pay${SALT_KEY}`;
    const sha256 = generateHash(string);
    const xVerify = `${sha256}###${SALT_INDEX}`;

    // Make API call to PhonePe
    const response = await phonepeApi.post(
      '/pg/v1/pay',
      {
        request: base64Payload
      },
      {
        headers: {
          'X-VERIFY': xVerify
        }
      }
    );

    await logTransaction(transactionId, 'INITIATED');

    // Store transaction details
  

    return res.status(200).json({
      success: true,
      paymentUrl: response.data.data.instrumentResponse.redirectInfo.url
    });

  } catch (error) {
    console.error('PhonePe Payment Error:', error);
    await logTransaction('UNKNOWN', 'ERROR', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to initiate payment'
    });
  }
};

// Handle PhonePe callback
export const handlePhonePeCallback = async (req, res) => {
  let transactionId = 'UNKNOWN';

  try {
    console.log('Callback Headers:', req.headers);
    console.log('Callback Body:', req.body);
    
    // Get x-verify header (case-insensitive)
    const xVerifyHeader = req.headers['x-verify'] || req.headers['X-VERIFY'];
    console.log('X-Verify Header:', xVerifyHeader);

    // Check if we have the base64 response in the request body
    const base64Response = req.body.checksum;
    if (!base64Response) {
      throw new Error('No response data in callback');
    }

    console.log("Base64 Response:", base64Response);

    // Validate callback signature
    const isValid = validateCallback(
      base64Response,
      SALT_KEY,
      SALT_INDEX,
      xVerifyHeader
    );

    if (!isValid) {
      throw new Error('Invalid callback signature');
    }

    // Decode and parse the response
    let decodedResponse;
    try {
      decodedResponse = JSON.parse(Buffer.from(base64Response, 'base64').toString());
      console.log('Decoded Response:', decodedResponse);
    } catch (error) {
      throw new Error('Failed to decode response: ' + error.message);
    }

    // Extract transaction details
    if (!decodedResponse.data || !decodedResponse.data.merchantTransactionId) {
      throw new Error('Invalid response format: missing transaction ID');
    }

    transactionId = decodedResponse.data.merchantTransactionId;
    const transaction = await getTransactionDetails(transactionId);

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    // Check if transaction expired
    if (isTransactionExpired(transaction)) {
      await updateTransactionStatus(transactionId, 'EXPIRED');
      await logTransaction(transactionId, 'EXPIRED');
      return res.status(200).json({ success: false, message: 'Transaction expired' });
    }

    // Process payment status
    switch (decodedResponse.code) {
      case 'PAYMENT_SUCCESS': {
        const { amount } = decodedResponse.data;

        // Update wallet balance
        const wallet = await Wallet.findOne({ userId: transaction.userId });
        if (!wallet) {
          throw new Error('Wallet not found');
        }

        // Update wallet balance and add recharge record
        wallet.balance += convertToRupees(amount);
        wallet.recharges.push({
          amount: convertToRupees(amount),
          rechargeMethod: 'PhonePe',
          transactionId,
          phonepeTransactionId: decodedResponse.data.transactionId
        });

        await wallet.save();
        await updateTransactionStatus(transactionId, 'SUCCESS');
        await logTransaction(transactionId, 'SUCCESS');

        return res.status(200).json({ success: true, message: 'Payment successful' });
      }

      case 'PAYMENT_PENDING':
        await updateTransactionStatus(transactionId, 'PENDING');
        await logTransaction(transactionId, 'PENDING');
        return res.status(200).json({ success: true, message: 'Payment pending' });

      case 'PAYMENT_DECLINED':
      case 'PAYMENT_ERROR':
      default:
        await updateTransactionStatus(transactionId, 'FAILED');
        await logTransaction(transactionId, 'FAILED');
        return res.status(200).json({ success: false, message: 'Payment failed' });
    }

  } catch (error) {
    console.error('PhonePe Callback Error:', error);
    await logTransaction(transactionId, 'CALLBACK_ERROR', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process callback'
    });
  }
};

