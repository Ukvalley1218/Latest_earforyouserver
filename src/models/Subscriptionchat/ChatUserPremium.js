import mongoose from "mongoose";

const PaymentDetailsSchema = new mongoose.Schema({
  gateway: {
    type: String,
    enum: ['PhonePe', 'RazorPay', 'Admin', 'Internal'],
    required: true
  },
  transactionId: {
    type: String,
    required: true,
    unique: true
  },
  orderId: String,
  paymentId: String,
  signature: String,
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: "INR"
  },
  status: { 
    type: String,
    enum: ["created", "pending", "success", "failed", "refunded"],
    required: true
  },
  gatewayResponse: mongoose.Schema.Types.Mixed,
  initiatedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date
}, { _id: false });

const ChatUserPremiumSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  plan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ChatPremium",
    required: true
  },
  purchaseDate: {
    type: Date,
    default: Date.now
  },
  expiryDate: {
    type: Date,
    required: true
  },
  remainingChats: {
    type: Number,
    required: true
  },
// new
  remainingCharacters: {
  type: Number,
  required: true
},

// Optional: keep for audit
usageLogs: [{
  chatId: mongoose.Schema.Types.ObjectId,
  charactersUsed: Number,
  usedAt: Date
}]
,
  usedChats: [
    {
      chatId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
      },
      usedAt: {
        type: Date,
        default: Date.now
      }
    }
  ],
  isActive: {
    type: Boolean,
    default: true
  },
  payment: {
    type: PaymentDetailsSchema,
    required: true
  }
}, { timestamps: true });

ChatUserPremiumSchema.index({ user: 1, isActive: 1 });
ChatUserPremiumSchema.index({ expiryDate: 1 });
ChatUserPremiumSchema.index({ "payment.transactionId": 1 }, { unique: true });

ChatUserPremiumSchema.pre('save', function(next) {
  if (this.isModified('payment.status') && this.payment.status === 'success') {
    this.isActive = true;
  }
  next();
});

ChatUserPremiumSchema.statics.createFromPayment = async function(
  userId,
  planId,
  paymentData
) {
  const plan = await mongoose.model('ChatPremium').findById(planId);
  if (!plan) {
    throw new Error('Invalid subscription plan');
  }

  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + plan.validityDays);

  return this.create({
    user: userId,
    plan: planId,
    expiryDate,
    remainingChats: plan.chatsAllowed,
    isActive: paymentData.status === 'success',
    payment: paymentData
  });
};

export const ChatUserPremium = mongoose.model("ChatUserPremium", ChatUserPremiumSchema);