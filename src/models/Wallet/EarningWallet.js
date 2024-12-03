import mongoose from "mongoose";

const earningWalletSchema = new mongoose.Schema({
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
  totalBalance: {
    type: Number,
    required: true,
    default: 0, // Initialize to zero
  },
  currency: {
    type: String,
    required: true,
    default: 'INR',
  },
}, {
  timestamps: true, // Automatically adds createdAt and updatedAt fields
});

export default mongoose.model('EarningWallet', earningWalletSchema);
