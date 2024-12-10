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
      merchantTransactionId: {
        type: String,
        required: true,
      },
      state: {
        type: String,
        required: true,
      },
      responseCode: {
        type: String,
        required: true,
      },
      rechargeMethod: {
        type: String,
        required: true,
        enum: ['PhonePe', 'CALL','admin','INTERNAL'], // Add more as needed
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
  plan: [
    {
      planId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SubscriptionPlan',
        required: false,
        default: null
      }
    }
  ],
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
});

// Middleware to automatically calculate expirationDate and deduct minutes


// Method to deduct from wallet balance and plan minutes
walletSchema.methods.deductBalanceAndMinutes = async function (amount, minutes, planId) {
  // Deduct the balance from the wallet
  if (this.balance < amount) {
    throw new Error('Insufficient balance');
  }

  this.balance -= amount;

  // Find the active plan and deduct minutes
  const plan = this.plans.find(plan => plan.planId.toString() === planId.toString() && plan.status === 'active');

  if (!plan) {
    throw new Error('Active plan not found');
  }

  if (plan.minutesLeft < minutes) {
    throw new Error('Not enough minutes in the plan');
  }

  plan.minutesLeft -= minutes;

  // Save changes
  await this.save();

  // Update the plan's remaining minutes and wallet balance
  return { balance: this.balance, minutesLeft: plan.minutesLeft };
};

// Create a method to check and clean expired wallets periodically (optional, can be run in background)
// walletSchema.statics.cleanExpiredWallets = async function () {
//   await this.deleteMany({ 'plans.status': 'expired' });
// };

const Wallet = mongoose.model('Wallet', walletSchema);

export default Wallet;
