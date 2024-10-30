import mongoose from 'mongoose';

const walletSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  balance: {
    type: Number,
    required: true,
    default: 0,
  },
  currency: {
    type: String,
    required: true,
    default: 'inr',
  },
  recharges: [
    {
      amount: {
        type: Number,
        required: true,
      },
      rechargeMethod: {
        type: String,
        required: true,
        enum: ['credit_card', 'paypal', 'bank_transfer', 'crypto'], // Add more as needed
      },
      rechargeDate: {
        type: Date,
        default: Date.now,
      },
      transactionId: {
        type: String, // Unique transaction ID for tracking
        required: true,
      },
    },
  ],
  deductions: [
    {
      amount: {
        type: Number,
        required: true,
      },
      deductionReason: {
        type: String,
        required: true, // e.g., "call", "chat", etc.
      },
      deductionDate: {
        type: Date,
        default: Date.now,
      },
      callId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Call', // Reference to the call or session where the deduction happened
        required: false,
      },
    },
  ],
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
});

walletSchema.pre('save', function (next) {
  this.lastUpdated = new Date();
  next();
});

const Wallet = mongoose.model('Wallet', walletSchema);

export default Wallet;
