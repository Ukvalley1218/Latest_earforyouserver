import mongoose from 'mongoose';

const ChatCommissionSchema = new mongoose.Schema({
  // Type of commission calculation
  commissionType: {
    type: String,
    enum: ['percentage', 'fixed'],
    default: 'percentage'
  },
  // Percentage of chat price to credit (0-100)
  percentageAmount: {
    type: Number,
    default: 100,
    min: 0,
    max: 100
  },
  // Fixed amount to credit (in rupees)
  fixedAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  // Chat price per chat (used for percentage calculation)
  chatPrice: {
    type: Number,
    default: 0,
    min: 0
  },
  // Admin who set this configuration
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  // Whether this configuration is active
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt timestamp before saving
ChatCommissionSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Get the active commission settings
ChatCommissionSchema.statics.getActiveSettings = async function() {
  return await this.findOne({ isActive: true }).sort({ createdAt: -1 });
};

// Calculate credit amount based on settings
ChatCommissionSchema.methods.calculateCredit = function() {
  if (this.commissionType === 'percentage') {
    return (this.percentageAmount / 100) * this.chatPrice;
  } else {
    return this.fixedAmount;
  }
};

export const ChatCommission = mongoose.models.ChatCommission || mongoose.model('ChatCommission', ChatCommissionSchema);