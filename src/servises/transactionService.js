// paymentService.js
import axios from 'axios';
import crypto from 'crypto';
import Transaction from './../models/TransactionModal.js'
import Wallet from './../models/Wallet/Wallet.js'


const PHONEPE_API_URL = process.env.PHONEPE_API_URL || 'https://api-preprod.phonepe.com/apis/pg-sandbox';
const SALT_KEY = process.env.SALT_KEY;
const SALT_INDEX = process.env.SALT_INDEX;

export const verifyPhonePePayment = async (merchantId, merchantTransactionId) => {
  try {
    // Base URL and endpoint configuration
    const baseUrl = process.env.PHONEPE_API_URL || 'https://api-preprod.phonepe.com/apis/pg-sandbox';
    const url = `/v3/transaction/${merchantId}/${merchantTransactionId}/status`;
    
    // Generate X-VERIFY checksum
    const saltKey = '14fa5465-f8a7-443f-8477-f986b8fcfde9';
    const saltIndex = 1;
    
    if (!saltKey || !saltIndex) {
      throw new Error('Missing SALT_KEY or SALT_INDEX in environment variables');
    }

    // Create the string to hash exactly as per PhonePe specs
    const stringToHash = `/pg/v1/status/${merchantId}/${merchantTransactionId}${saltKey}`;
    
    // Generate checksum with proper encoding
    const checksum = crypto.createHash('sha256')
      .update(stringToHash)
      .digest('hex') + '###' + saltIndex;

    console.log('Request URL:', `${baseUrl}${url}`);
    console.log('Checksum:', checksum);

    const response = await axios.get(`${baseUrl}${url}`, {
      headers: {
        'X-VERIFY': checksum,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      // Add timeout to prevent hanging requests
      timeout: 10000
    });

    if (response.status !== 200) {
      throw new Error(`Unexpected status code: ${response.status}`);
    }

    return response.data;
  } catch (error) {
    if (error.response) {
      // Log detailed error information
      console.error('PhonePe API Error Details:', {
        status: error.response.status,
        headers: error.response.headers,
        data: error.response.data
      });
      throw new Error(`PhonePe verification failed: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    throw new Error(`PhonePe verification failed: ${error.message}`);
  }
};

// transactionService.js


export const updateTransaction = async (transactionData) => {
  const transaction = new Transaction(transactionData);
  await transaction.save();
};

export const updateWalletBalance = async (userId, amount) => {
  await Wallet.findOneAndUpdate(
    { userId },
    { $inc: { balance: amount } },
    { new: true }
  );
};
