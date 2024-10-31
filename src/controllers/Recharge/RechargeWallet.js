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
  return crypto.createHash('sha256').update(string,'utf-8').digest('hex');
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
    const expectedXVerify = `${sha256Hash} ${saltIndex}`;

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
    const callbackUrl = `https://webhook.site/01e8f4d6-6619-4e56-9cc6-2184cd089133  `;

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
    await storeTransactionDetails({
      userId,
      amount,
      transactionId,
      status: 'PENDING',
      createdAt: new Date()
    });

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

// Handle PhonePe callback - FIXED
export const handlePhonePeCallback = async (req, res) => {
  let transactionId = 'UNKNOWN';

  try {
    console.log('Callback Headers:', req.headers);
    console.log('Callback Body:', );
    
console.log('x-verify:', xerify);
    const responseData =req.body
    
    console.log("responseData :",responseData);
    if (!responseData) {
      throw new Error('No response data in callback');
    }


    // Validate callback signature
    const isValid = validateCallback(
      responseData,
      SALT_KEY,
      SALT_INDEX,
      req.headers['x-verify']
    );

    if (!isValid) {
      throw new Error('Invalid callback signature');
    }

    // Decode and parse the response
    let decodedResponse;
    try {
      decodedResponse = JSON.parse(Buffer.from(responseData, 'base64').toString());
      console.log('Decoded Response:', decodedResponse);
    } catch (error) {
      throw new Error('Failed to decode response: ' + error.message);
    }

    // Extract transaction details
    transactionId = decodedResponse.data.merchantTransactionId;
    const transaction = await getTransactionDetails(transactionId);

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    if (isTransactionExpired(transaction)) {
      await updateTransactionStatus(transactionId, 'EXPIRED');
      await logTransaction(transactionId, 'EXPIRED');
      return res.redirect('/payment/failed?reason=expired');
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

        return res.redirect('/payment/success');
      }

      case 'PAYMENT_PENDING':
        await updateTransactionStatus(transactionId, 'PENDING');
        await logTransaction(transactionId, 'PENDING');
        return res.redirect('/payment/pending');

      case 'PAYMENT_DECLINED':
      case 'PAYMENT_ERROR':
      default:
        await updateTransactionStatus(transactionId, 'FAILED');
        await logTransaction(transactionId, 'FAILED');
        return res.redirect('/payment/failed');
    }

  } catch (error) {
    console.error('PhonePe Callback Error:', error);
    await logTransaction(transactionId, 'CALLBACK_ERROR', error);
    return res.redirect('/payment/failed?reason=error');
  }
};

// Helper functions (unchanged)
const isTransactionExpired = (transaction) => {
  return Date.now() - new Date(transaction.createdAt).getTime() > TRANSACTION_EXPIRY_TIME;
};

const storeTransactionDetails = async (details) => {
  const { userId, amount, transactionId, status, createdAt } = details;

  let wallet = await Wallet.findOne({ userId });

  if (!wallet) {
    wallet = new Wallet({
      userId,
      balance: 0,
      recharges: [],
      transactions: []
    });
  }

  if (!wallet.transactions) {
    wallet.transactions = [];
  }

  wallet.transactions.push({
    transactionId,
    amount,
    status,
    createdAt
  });

  await wallet.save();
  await logTransaction(transactionId, 'STORED');
};

const getTransactionDetails = async (transactionId) => {
  const wallet = await Wallet.findOne({ 'transactions.transactionId': transactionId });

  if (!wallet) {
    throw new Error('Transaction not found');
  }

  const transaction = wallet.transactions.find(
    (trans) => trans.transactionId === transactionId
  );

  if (!transaction) {
    throw new Error('Transaction not found in wallet');
  }

  return {
    ...transaction.toObject(),
    userId: wallet.userId
  };
};

const updateTransactionStatus = async (transactionId, status) => {
  const wallet = await Wallet.findOne({ 'transactions.transactionId': transactionId });

  if (!wallet) {
    throw new Error('Transaction not found');
  }

  const transaction = wallet.transactions.find(
    (trans) => trans.transactionId === transactionId
  );

  if (transaction) {
    transaction.status = status;
    transaction.lastUpdated = new Date();
    await wallet.save();
    await logTransaction(transactionId, `STATUS_UPDATED_TO_${status}`);
  } else {
    throw new Error('Transaction not found in wallet');
  }
};