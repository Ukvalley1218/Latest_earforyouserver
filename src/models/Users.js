import mongoose from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

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

    },
    Language: {
      type: String,

    },
    userCategory: {
      type: String,
      enum: ["Therapist", "Psychologist", "Profisnal_listner", 'User'],
      default: 'User'
    },
    email: {
      type: String,
      unique: true
    },
    userType: {
      type: String,
      enum: ['CALLER', 'RECEIVER'], // Define the enum values
      default: 'CALLER', // Set default value
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
      enum: ['Active', 'inActive', 'Blocked'],
      default: 'inActive'
    },
    status: {
      type: String,
      enum: ["Online", "offline", "Busy"], // Allow only specific status values
      default: "offline", // Default t
    }
  },
  { timestamps: true }
);

// Create a compound index for the phone field


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
    console.log("Updated")
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

// Exporting the User model
const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;
