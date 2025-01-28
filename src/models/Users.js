import mongoose from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { type } from "os";

const bankDetailsSchema = new mongoose.Schema({
  bankName: {
    type: String,
    required: true,
  },
  accountNumber: {
    type: String,
    required: true,
    unique: true, // Ensures account numbers are unique across all entries
  },
  ifscCode: {
    type: String,
    required: true,
  },

  accountHolderName: {
    type: String,
    required: true,
  },

});

const userSchema = new mongoose.Schema(
  {
    avatarUrl: {
      type: String,
    },
    username: {
      type: String,
      required: false,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: {
      type: String,
      required: false,
      required: false, // phone is optional
      sparse: true,
      trim: true,
    },
    dateOfBirth: {
      type: Date, // Use Date type for date of birth
      required: false,
    },
    password: {
      type: String,
    },
    referalCode: {
      type: String,
      unique: true,
      required: false,
    },

    gender: {
      type: String,
      enum: ['male', 'female', 'other'], // Enum for gender values
      index: true,

    },
    Language: {
      type: String,

    },
    userCategory: {
      type: String,
      enum: ["Therapist", "Psychologist", "Profisnal_listner", 'User'],
      default: 'User',
      index: true,
    },
    email: {
      type: String,
      unique: true
    },
    userType: {
      type: String,
      enum: ['CALLER', 'RECEIVER'], // Define the enum values
      default: 'CALLER', // Set default value
      index: true,
    },
    decs: {
      type: String,
      require: true
    },
    Bio: {
      type: [String],

    },
    report: {
      type: [String],
    },
    shortDecs: {
      type: String
    },
    password: {
      type: String,
      required: false,
    },
    deviceToken: {
      type: String
    },
    isValidUser: {
      type: Boolean,
      default: false
    },
    otp: {
      type: String,
    },
    otpExpires: {
      type: Date,
    },
    refreshToken: {
      type: String,
    },
    UserStatus: {
      type: String,
      enum: ['Active', 'inActive', 'InActive', 'Blocked'],
      default: 'inActive',
      index: true,
    },

    status: {
      type: String,
      enum: ["Online", "offline", "Busy"], // Allow only specific status values
      default: "offline", // Default t
      index: true
    },
    lastSeen: {
      type: Date, // Store the timestamp of the last seen activity
    },
    bankDetails: {
      type: [bankDetailsSchema], // Array of bank details
      default: [], // Default to an empty array
    },

  },
  { timestamps: true }
);

// Create a compound index for the phone field


userSchema.index({ userType: 1, status: 1 }); // For finding online receivers
userSchema.index({ userCategory: 1, UserStatus: 1 }); // For finding active professionals
userSchema.index({ email: 1, phone: 1 }, { sparse: true }); // For user lookup by email or phone
userSchema.index({ isValidUser: 1, UserStatus: 1 }); // For finding valid active users
userSchema.index({ createdAt: -1 }); // For timestamp-based queries
userSchema.index({ userType: 1, userCategory: 1, status: 1 }); // For complex filtering



// Hash the password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }

  // Check if the password is already hashed
  if (!this.password.startsWith('$2b$')) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }

  next();
});

// Update the status to "online" if userType is RECEIVER
userSchema.pre("save", async function (next) {
  if (this.isModified("userType") && this.userType === "RECEIVER") {
    this.status = "Online";
    console.log("Updated the Status Online RECEIVER ")
  }
  next();
});

// Method to compare passwords
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Method to generate access token
userSchema.methods.generateAccessToken = function () {
  return jwt.sign(
    {
      _id: this._id,
      username: this.username,
      userType: this.userType, // Added userType instead of serviceType
    },
    process.env.ACCESS_TOKEN_SECRET,

  );
};

// Method to generate refresh token
userSchema.methods.generateRefreshToken = function () {
  return jwt.sign(
    {
      _id: this._id,
    },
    process.env.REFRESH_TOKEN_SECRET,

  );
};

// lastSeen
userSchema.pre("save", function (next) {
  // Check if the status is being modified and changed to "offline"
  if (this.isModified("status") && this.status === "offline") {
    this.lastSeen = new Date(); // Set the lastSeen field to the current timestamp
    console.log("Updated lastSeen for user:", this._id);
  }
  next();
});


// Exporting the User model
const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;
