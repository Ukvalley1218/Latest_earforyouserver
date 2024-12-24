import User from "../models/Users.js";

import jwt from "jsonwebtoken";
import ROLES_LIST from "../config/Roles_list.js";
import crypto from "crypto";
import { generateOtp, sendOtpEmail } from "../utils/generateOtp.js";
import bcrypt from "bcrypt";
import multer from "multer";
import unirest from "unirest";
import otpGenerator from 'otp-generator';
import dotenv from 'dotenv';
import mongoose from 'mongoose'
import admin from 'firebase-admin';
import Wallet from "../models/Wallet/Wallet.js";
import { CallRate } from '../models/Wallet/AdminCharges.js'
import emailValidator from 'email-validator';
import Review from "../models/LeaderBoard/Review.js";
import { title } from "process";
import EarningWallet from "../models/Wallet/EarningWallet.js";
import { ChatMessage } from "../models/message.models.js";
import callLog from '.././models/Talk-to-friend/callLogModel.js'

import { Chat } from "../models/chat.modal.js";




const generateAccessAndRefreshTokens = async (userId) => {
  try {
    const user = await User.findById(userId);

    if (!user) {
      throw new Error("User not found");
    }

    // Generate tokens
    const accessToken = user.generateAccessToken(); // Optional: Short-lived or no expiry
    const refreshToken = user.generateRefreshToken(); // No expiry

    // Save refresh token and its issued timestamp
    user.refreshToken = refreshToken;
    user.refreshTokenIssuedAt = new Date();

    await user.save({ validateBeforeSave: false });

    return { accessToken, refreshToken };
  } catch (error) {
    console.error("Error in generateAccessAndRefreshTokens:", error);
    throw new Error("Error while generating tokens");
  }
};



export const registerUser = async (req, res) => {
  const { phone, password } = req.body; // Ensure correct field names

  try {
    // Check for required fields
    const requiredFields = { phone, password };
    const missingFields = Object.entries(requiredFields)
      .filter(([key, value]) => !value)
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `The following are required: ${missingFields.join(', ')}`,
      });
    }

    // Check if user with phone already exists
    const userExists = await User.findOne({ phone });
    if (userExists) {
      return res.status(400).json({ message: "User with this phone already exists" });
    }

    // Create new user
    const user = await User.create({
      phone,
      password,
    });

    if (user) {
      const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id);

      res.status(201).json({
        _id: user._id,
        accessToken,
        refreshToken,
        phone: user.phone,
      });
    } else {
      res.status(400).json({ message: "Invalid user data" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const authUser = async (req, res) => {
  const { phone, password, deviceToken, platform } = req.body;

  // If phone is missing
  if (!phone) {
    return res.status(400).json({ message: "Phone is required" });
  }

  // If password is missing
  if (!password) {
    return res.status(400).json({ message: "Password is required" });
  }

  try {
    const user = await User.findOne({ phone });

    if (user && (await user.matchPassword(password))) {
      const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id);

      // Update device token if provided
      if (deviceToken) {
        user.deviceToken = deviceToken;
        user.platform = platform || user.platform; // Use provided platform or keep the existing one
        await user.save();
      }

      return res.json({
        _id: user._id,
        phone: user.phone,
        // Include only necessary fields
        accessToken,
        refreshToken,
        message: "User logged in successfully",
      });
    } else {
      return res.status(401).json({ message: "Invalid phone or password" });
    }
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};



export const logoutUser = async (req, res) => {
  try {
    await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          refreshToken: '',
        },
      },
      { new: true }
    );

    const options = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    };

    return res
      .status(200)
      .clearCookie("accessToken", options)
      .clearCookie("refreshToken", options)
      .json({ message: "User logged out successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//reset password flow :

//   ---------------initiating-Phase--------------------

export const initiatePasswordReset = async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const otp = generateOtp();
    user.otp = otp;
    user.otpExpires = Date.now() + 3600000; // 1 hour

    await user.save();
    await sendOtpEmail(email, otp);

    res.status(200).json({ message: "OTP sent to email" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};

//   ---------------verify-Phase--------------------

export const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.otp !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    res.status(200).json({ message: "OTP verified" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};


//-----------------initiateRegistration-------------------



export const initiateRegistration = async (req, res) => {
  const { email } = req.body;
  console.log("email:", email);
  // console.log("playstore verification id:", playstoreVerificationId);

  try {
    // Check if it's a playstore verification request
    const isPlaystoreVerification = email === 'playtest@gmail.com';

    const isValidEmail = emailValidator.validate(email);
    if (!isValidEmail) {
      return res.status(400).json({ message: "Invalid email address" });
    }

    // Check if the user already exists
    const existingUser = await User.findOne({ email });
    console.log(existingUser);

    if (existingUser) {
      // If it's a playstore verification, generate tokens
      if (isPlaystoreVerification) {
        // Generate access token
        const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(existingUser._id);


        // Save refresh token to user document
        existingUser.refreshToken = refreshToken;
        await existingUser.save();

        return res.status(200).json({
          message: "Playstore verification successful",
          accessToken,
          refreshToken,
          userId: existingUser._id,
          email: existingUser.email,
          username: existingUser.username
        });
      }
      return await initiateLogin(req, res);
    }

    // For playstore verification, bypass OTP
    if (isPlaystoreVerification) {
      const username = generateRandomUsername();
      const newUser = new User({
        email,
        username,
        isVerified: true, // Auto verify for playstore
        verificationSource: 'playstore'
      });

      // Start a transaction
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await newUser.save({ session });

        const callRateData = await CallRate.findOne().session(session);
        if (!callRateData) {
          await session.abortTransaction();
          return res.status(500).json({
            success: false,
            message: 'Call rate configuration not found',
          });
        }

        const { free } = callRateData;

        // Create wallet with transaction
        const wallet = await Wallet.create([{
          userId: newUser._id,
          balance: free,
          currency: 'inr',
          recharges: [],
          deductions: [],
          lastUpdated: new Date()
        }], { session });

        // Create wallet with transaction
        const EarningWallet2 = await EarningWallet.create([{
          userId: newUser._id,
          balance: 0,
          currency: 'inr',
          earnings: [],
          deductions: [],
          lastUpdated: new Date()
        }], { session });

        // Generate access token
        const authToken = jwt.sign(
          { userId: newUser._id },
          process.env.JWT_SECRET,
          { expiresIn: '1h' }
        );

        // Generate refresh token
        const refreshToken = jwt.sign(
          { userId: newUser._id },
          process.env.REFRESH_TOKEN_SECRET,
          { expiresIn: '30d' }
        );

        // Save refresh token to user document
        newUser.refreshToken = refreshToken;
        await newUser.save({ session });

        await session.commitTransaction();

        return res.status(200).json({
          message: "Playstore verification account created",
          authToken,
          refreshToken,
          userId: newUser._id,
          email: newUser.email,
          username: newUser.username
        });
      } catch (error) {
        await session.abortTransaction();
        throw error;
      } finally {
        session.endSession();
      }
    }

    // Regular registration flow with OTP
    const otp = generateOtp();
    const otpExpires = Date.now() + 3600000; // 1 hour expiry

    console.log(`Generated OTP: ${otp} for email: ${email}`);

    const otpSent = await sendOtpEmail(email, otp);

    console.log("otpSent =", otp);
    if (!otp) {
      console.error("Failed to send OTP to email:", email);
      return res.status(500).json({ message: "Failed to send OTP" });
    }

    const username = generateRandomUsername();
    const newUser = new User({
      email,
      otp,
      username,
      otpExpires,
    });

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      await newUser.save({ session });

      const callRateData = await CallRate.findOne().session(session);
      if (!callRateData) {
        await session.abortTransaction();
        return res.status(500).json({
          success: false,
          message: 'Call rate configuration not found',
        });
      }

      const { free } = callRateData;

      const wallet = await Wallet.create([{
        userId: newUser._id,
        balance: free,
        currency: 'inr',
        recharges: [],
        deductions: [],
        lastUpdated: new Date()
      }], { session });

      await EarningWallet.create([{
        userId: newUser._id,
        balance: 0,
        currency: 'inr',
        earnings: [],
        deductions: [],
        lastUpdated: new Date()
      }], { session });

      console.log("Wallet created with initial balance for user:", newUser._id, wallet);

      await session.commitTransaction();

      res.status(200).json({
        message: "OTP sent to email for registration",
        userId: newUser._id,
        email: newUser.email,
        username: newUser.username
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ message: "Server error", error });
  }
};




//----------------initiateLogin---------------


// export const initiateLogin = async (req, res) => {
//    const { email } = req.body;

//   try {
//     // Check if the user exists
//     const user = await User.findOne({ email });

//     if (!user) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     // Generate OTP and set expiry
//     const otp = generateOtp();
//     user.otp = otp;
//     user.otpExpires = Date.now() + 3600000; // OTP valid for 1 hour


//     console.log("Login,", otp);
//     // Save OTP details to user
//     await user.save();

//     // Send OTP to the user's email
//     await sendOtpEmail(email, otp);

//     res.status(200).json({ message: "OTP sent to email" });
//   } catch (error) {
//     res.status(500).json({ message: "Server error", error });
//   }
// };


export const initiateLogin = async (req, res) => {
  const { email } = req.body;

  try {
    // Check if the user exists
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if the user is blocked
    if (user.UserStatus === "Blocked") {
      return res.status(403).json({ message: `You are blocked, ${user.username}` });
    }

    // Generate OTP and set expiry
    const otp = generateOtp();
    user.otp = otp;
    user.otpExpires = Date.now() + 3600000; // OTP valid for 1 hour

    console.log("Login OTP:", otp);

    // Save OTP details to user
    await user.save();

    // Send OTP to the user's email
    await sendOtpEmail(email, otp);

    // Generate tokens
    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id);

    res.status(200).json({
      message: "OTP sent to email",
      accessToken,
      refreshToken,
    });

  } catch (error) {
    console.error("Error in initiateLogin:", error);
    res.status(500).json({ message: "Server error", error });
  }
};

// Rest of the code remains the same...

//---------------verifyLoginOtp--------------------

export const verifyLoginOtp = async (req, res) => {
  const { email, otp, deviceToken, platform } = req.body;
  console.log({ email, otp, deviceToken, platform })
  try {
    // Find user by email
    const user = await User.findOne({ email });
    const user_id = user._id;
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if the OTP is valid and not expired
    if (user.otp !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    // OTP verified successfully, clear the OTP fields
    user.otp = undefined;
    user.otpExpires = undefined;

    // Save the user without OTP fields
    await user.save();

    // Generate JWT or session token for authenticated user
    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id);

    // Update device token if provided
    if (deviceToken) {
      user.deviceToken = deviceToken;
      user.platform = platform || user.platform; // Use provided platform or keep the existing one
      await user.save();
    }

    res.status(200).json({
      message: "Login successful",
      user_id,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: "Server error", error });
  }
};

//   ---------------resetPassword-Phase--------------------

export const resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.otp !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    console.log(user.password)
    // Clear OTP and its expiration
    user.otp = undefined;
    user.otpExpires = undefined;

    await user.save();

    res.status(200).json({ message: "Password reset successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// Delete User 
export const deleteUser = async (req, res) => {
  try {
    const userId = req.user._id; // Get user ID from the request (assuming it's set in middleware)

    // Check if the user exists
    const userToDelete = await User.findById(userId);
    if (!userToDelete) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Delete the user
    await User.findByIdAndDelete(userId);

    res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ success: false, message: 'Error deleting user', error: error.message });
  }
};


// ---------------Update User Profile -------------------------

// Add validation utilities if needed


// ------------------------Update User CategoryController.js---------------------------------------
export const updateOrCreateUserCategory = async (req, res) => {
  try {
    const { userId } = req.params;
    const { userCategory } = req.body;

    // Input validation
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }

    if (!userCategory) {
      return res.status(400).json({ success: false, message: 'userCategory is required' });
    }

    // Validate userCategory (adjust the valid categories as needed)
    const validUserCategories = ["Doctor", "Therapist", "Healer", "Psychologist"]; // Replace with your actual categories
    if (!validUserCategories.includes(userCategory)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid userCategory. Must be one of: ' + validUserCategories.join(', ')
      });
    }

    // Check if user with the specified userId exists
    const existingUser = await User.findById(userId);

    if (existingUser) {
      // Update the userCategory if the user exists
      existingUser.userCategory = userCategory; // Update the field
      await existingUser.save(); // Save the updated user

      return res.status(200).json({
        success: true,
        message: 'User category updated successfully',
        data: existingUser // Return the updated user object
      });
    } else {
      // Create a new user if the user does not exist
      const newUser = new User({
        _id: userId, // Set userId as _id
        userCategory, // Set the new userCategory
        // Add other required fields as necessary
      });

      await newUser.save(); // Save the new user

      return res.status(201).json({
        success: true,
        message: 'New user created successfully',
        data: newUser // Return the newly created user object
      });
    }

  } catch (error) {
    console.error('Error updating or creating user category:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating or creating user category',
      error: error.message
    });
  }
};

// ------------------------useruserController.js---------------------------------------
export const updateProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const { username, dateOfBirth, gender, Language, phone, userCategory, avatarUrl } = req.body;

    // Input validation
    const validationErrors = [];

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
      });
    }

    if (username !== undefined) {
      if (typeof username !== 'string' || username.trim().length === 0) {
        validationErrors.push('Username must be a non-empty string');
      }
    }

    if (dateOfBirth !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
        validationErrors.push('Date of birth must be in YYYY-MM-DD format');
      } else {
        const date = new Date(dateOfBirth);
        if (isNaN(date.getTime())) {
          validationErrors.push('Invalid date of birth');
        }
      }
    }

    if (gender !== undefined) {
      if (!['male', 'female', 'other'].includes(gender.toLowerCase())) {
        validationErrors.push('Gender must be either "male", "female", or "other"');
      }
    }

    if (phone !== undefined) {
      const phoneRegex = /^\+?[\d\s-]{10,}$/; // Basic regex for phone validation
      if (!phoneRegex.test(phone.trim())) {
        validationErrors.push('Invalid phone number format');
      }
    }

    if (Language !== undefined && typeof Language !== 'string') {
      validationErrors.push('Language must be a string');
    }

    if (userCategory !== undefined && typeof userCategory !== 'string') {
      validationErrors.push('User category must be a string');
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors,
      });
    }

    // Check if user exists
    const existingUser = await User.findById(userId);
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Prepare update data
    const updateData = {
      ...(username !== undefined && { username: username.trim() }),
      ...(dateOfBirth !== undefined && { dateOfBirth }),
      ...(gender !== undefined && { gender: gender.toLowerCase() }),
      ...(Language !== undefined && { Language }),
      ...(phone !== undefined && { phone: phone.trim() }),
      ...(userCategory !== undefined && { userCategory }),
      ...(avatarUrl !== undefined && { avatarUrl }),
      status: 'Online',
      UserStatus: 'Active',
      updatedAt: new Date(),
    };

    // Update user profile
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      {
        new: true, // Return the updated document
        runValidators: true, // Apply schema validation
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser,
    });
  } catch (error) {
    console.error('Profile update error:', error);

    // Handle mongoose validation errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: Object.values(error.errors).map((err) => err.message),
      });
    }

    return res.status(500).json({
      success: false,
      message: 'An error occurred while updating the profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};



// -------------------------- Update Status --------------------------

export const updateStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body;

    // Input validation
    const validationErrors = [];

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // Validate individual fields if they are provided


    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    // Check if user exists
    const existingUser = await User.findById(userId);

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prepare update data with only provided fields
    const updateData = {
      ...(status !== undefined && { status }),
      updatedAt: new Date()
    };

    // Update user profile
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      {
        new: true,
        runValidators: true
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Status updated successfully',
      user: updatedUser
    });

  } catch (error) {
    console.error('Profile update error:', error);

    // Handle mongoose validation errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }

    return res.status(500).json({
      success: false,
      message: 'An error occurred while updating the profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};



//--------------------------Get  User Listener-----------------------------------------

export const listener = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: userId is required',
      });
    }

    // Retrieve pagination parameters
    const { page = 1, limit = 10 } = req.query;

    // Convert to integers
    const pageNumber = parseInt(page, 10);
    const limitNumber = parseInt(limit, 10);

    // Query the database for users with userType 'RECEIVER' and exclude logged-in user
    const query = {
      userType: 'RECEIVER',
      _id: { $ne: userId }, // Exclude the logged-in user's ID
      UserStatus: { $nin: ['inActive', 'Blocked', 'InActive'] } // Exclude unwanted statuses
    };

    const users = await User.find(query)
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber);

    // Count total documents for this query
    const totalUsers = await User.countDocuments(query);

    // Calculate total pages
    const totalPages = Math.ceil(totalUsers / limitNumber);

    // Send response
    res.status(200).json({
      success: true,
      data: users,
      pagination: {
        totalUsers,
        totalPages,
        currentPage: pageNumber,
        limit: limitNumber,
      },
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message,
    });
  }
};


export const UserCategoryData = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id; // Logged-in user's ID
    const { Category } = req.body;

    // Check if userId is provided
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: userId is required',
      });
    }

    // Retrieve pagination parameters
    const { page = 1, limit = 20 } = req.query;

    // Convert to integers for pagination
    const pageNumber = parseInt(page, 10);
    const limitNumber = parseInt(limit, 10);

    // Query the database for users
    const query = {
      userCategory: Category, // Filter by category
      _id: { $ne: userId },   // Exclude the logged-in user's ID
      UserStatus: { $nin: ["inActive", "Blocked", "InActive"] }, // Exclude users with unwanted statuses
    };

    // Fetch users with pagination
    const users = await User.find(query)
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber);

    // Count total documents for pagination
    const totalUsers = await User.countDocuments(query);

    // Calculate total pages
    const totalPages = Math.ceil(totalUsers / limitNumber);

    // Send response
    res.status(200).json({
      success: true,
      data: users,
      pagination: {
        totalUsers,
        totalPages,
        currentPage: pageNumber,
        limit: limitNumber,
      },
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message,
    });
  }
};


// ------------------------userController.js---------------------------------------
export const updateDeviceToken = async (req, res) => {
  const { deviceToken } = req.body;

  try {
    const userId = req.user._id; // Assuming you get the user ID from JWT or session
    const user = await User.findByIdAndUpdate(userId, { deviceToken }, { new: true });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({ message: 'Device token updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to update device token' });
  }
};

//reuest  OTP with Firebase Authentication
const generateRandomUsername = (length = 8) => {
  const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};

export const requestOTP = async (req, res) => {
  const { phone, password } = req.body;

  try {
    if (!phone && !password) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    // Ensure phone number is in E.164 format
    const phoneStr = `${String(phone).trim()}`;

    // Check if user exists by phone number
    let user = await User.findOne({ phone: phoneStr });
    console.log(user)
    if (!user) {
      console.log('user creation');

      // Generate a random username
      const username = generateRandomUsername();

      // Create new user with phone number and generated username
      user = await User.create({
        phone: phoneStr,
        password: password,
        username: username, // Store the generated username
        // Other fields can be added as needed
      });
    }


    // Use Firebase's phoneAuth flow to send an OTP
    const sessionInfo = await admin.auth().createCustomToken(phoneStr);
    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id);
    return res.status(200).json({
      message: "OTP sent successfully",
      _id: user._id,
      sessionInfo: sessionInfo,
      accessToken,
      refreshToken

    });

  } catch (error) {
    console.error("Error sending OTP:", error);
    return res.status(500).json({
      message: "Failed to send OTP. Please try again later.",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Verify OTP
export const verifyOTP = async (req, res) => {
  const { phone, otp, sessionInfo } = req.body;

  if (!phone || !otp || !sessionInfo) {
    return res.status(400).json({
      message: "Phone, OTP, and session info are required."
    });
  }

  try {
    // Verify the OTP using Firebase's session verification
    const decodedToken = await admin.auth().verifyIdToken(sessionInfo);

    // Ensure the decoded token contains the correct phone number
    if (!decodedToken || decodedToken.phone_number !== `${phone}`) {
      return res.status(401).json({ message: 'Invalid or expired OTP.' });
    }

    // Check if the user exists
    const user = await User.findOne({ phone: `+${phone}` });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // Update device info if provided
    if (req.body.deviceToken) {
      user.deviceToken = req.body.deviceToken;
      user.platform = req.body.platform || user.platform;
      await user.save();
    }

    // Generate tokens (assuming generateAccessAndRefreshTokens is defined elsewhere)
    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id);

    return res.status(200).json({
      message: "OTP verified successfully",
      userId: user._id,
      accessToken,
      refreshToken,
    });

  } catch (error) {
    console.error('Error verifying OTP:', error);
    return res.status(401).json({
      message: 'Invalid or expired OTP.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


// update User Type Controller Function
export const changeUserType = async (req, res) => {
  try {
    const { userId } = req.params;
    const { userType } = req.body;

    // Input validation
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }

    if (!userType) {
      return res.status(400).json({ success: false, message: 'userType is required' });
    }

    // Validate userType (must be either 'CALLER' or 'RECEIVER')
    const validUserTypes = ['CALLER', 'RECEIVER'];
    if (!validUserTypes.includes(userType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid userType. Must be either CALLER or RECEIVER'
      });
    }

    // Find the user and update the userType
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { userType: userType },
      { new: true, runValidators: true } // Enable validators and return updated document
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'User type updated successfully',
      data: updatedUser // Return the full updated user object
    });

  } catch (error) {
    console.error('Error updating user type:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating user type',
      error: error.message
    });
  }
};


// get userby id
export const getUserById = async (req, res) => {
  try {
    const { userId } = req.params;  // Extract userId from the request URL parameters

    // Find the user by ID
    const user = await User.findById(userId);

    // If the user doesn't exist, return a 404 error
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // If found, return the user object (excluding password for security reasons)
    res.status(200).json({
      message: 'User found successfully',
      user: {
        ...user.toObject(),
        password: undefined, // Hide sensitive fields like password
        refreshToken: undefined // Optionally hide refreshToken as well
      }
    });
  } catch (error) {
    // Handle any other errors
    console.error('Error fetching user:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};







export const getAllUsers1 = async (req, res) => {
  try {
    // Extract logged-in user's details
    const loggedInUserId = new mongoose.Types.ObjectId(req.user.id);
    const loggedInUserGender = req.user.gender;

    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = 21;
    const skip = (page - 1) * limit;

    // Find users excluding the logged-in user and specific statuses
    const users = await User.aggregate([
      {
        $match: {
          _id: { $ne: loggedInUserId },
          UserStatus: { $nin: ["inActive", "Blocked", "InActive"] },
        },
      },

      {
        $lookup: {
          from: "reviews",
          localField: "_id",
          foreignField: "user",
          as: "ratings",
        },
      },
      // Add computed fields for sorting and filtering
      {
        $addFields: {

          avgRating: { $avg: "$ratings.rating" },
          reviewCount: { $size: "$ratings" },
          isOppositeGender: {
            $cond: { if: { $ne: ["$gender", loggedInUserGender] }, then: 1, else: 0 },
          },
          isOnline: {
            $cond: { if: { $eq: ["$status", "Online"] }, then: 1, else: 0 },
          },

        },
      },
      // Sort users based on criteria
      {
        $sort: {
          isOnline: -1,          // Online users prioritized
          isOppositeGender: -1,  // Opposite gender prioritized
          avgRating: -1,         // Higher ratings prioritized
        },
      },
      // Pagination using $facet
      {
        $facet: {
          metadata: [{ $count: "totalUsers" }],
          users: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                password: 0,
                refreshToken: 0,
                ratings: 0,
              },
            },
          ],
        },
      },
    ]);

    // Extract results
    const totalUsers = users[0]?.metadata[0]?.totalUsers || 0;
    const userList = users[0]?.users || [];

    // Handle no users found
    if (userList.length === 0) {
      return res.status(404).json({ message: "No users found" });
    }


    // Send response
    res.status(200).json({
      message: "Users fetched successfully",
      users: userList,
      pagination: {
        totalUsers,
        currentPage: page,
        totalPages: Math.ceil(totalUsers / limit),
        limit,
      },
    });

  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};







export const addBio = async (req, res) => {
  try {
    const userId = req.user._id;
    const { bio } = req.body; // Bio data is passed in the request body

    if (!bio || !Array.isArray(bio)) {
      return res.status(400).json({ message: "Invalid bio data. Must be an array of strings." });
    }

    // Find the user by ID and add new bio entries
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // Add new bio entries to the existing ones
    user.Bio.push(...bio);

    // Save the updated user
    await user.save();

    res.status(200).json({
      message: "Bio updated successfully.",
      bio: user.Bio,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An error occurred while updating the bio.", error });
  }
};




// Edit a bio entry
export const editBio = async (req, res) => {
  try {
    const userId = req.user._id; // Get user ID from the request (assuming it's set in middleware)
    const { index, newBio } = req.body; // Pass index and new bio data in the request body

    if (typeof index !== "number" || !newBio) {
      return res.status(400).json({ message: "Invalid input. Provide index and newBio." });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    if (index < 0 || index >= user.Bio.length) {
      return res.status(400).json({ message: "Invalid index." });
    }

    // Update the specific bio entry
    user.Bio[index] = newBio;
    await user.save();

    res.status(200).json({ message: "Bio updated successfully.", bio: user.Bio });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An error occurred while editing the bio.", error });
  }
};

// Delete a bio entry
export const deleteBio = async (req, res) => {
  try {
    const userId = req.user._id; // Get user ID from the request (assuming it's set in middleware)
    const { index } = req.body; // Pass index of the bio to delete in the request body

    if (typeof index !== "number") {
      return res.status(400).json({ message: "Invalid input. Provide index." });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    if (index < 0 || index >= user.Bio.length) {
      return res.status(400).json({ message: "Invalid index." });
    }

    // Remove the specific bio entry
    user.Bio.splice(index, 1);
    await user.save();

    res.status(200).json({ message: "Bio deleted successfully.", bio: user.Bio });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An error occurred while deleting the bio.", error });
  }
};

// Reporte_User
export const Reporte_User = async (req, res) => {
  const { reporterId, reportedUserId, reportType } = req.body;

  // Validate the input
  if (!reporterId || !reportedUserId || !reportType) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields: reporterId, reportedUserId, or reportType.',
    });
  }

  try {
    // Fetch the reporter and reported user to ensure they exist
    const [reporter, reportedUser] = await Promise.all([
      User.findById(reporterId),
      User.findById(reportedUserId),
    ]);

    // Validate users
    if (!reporter || !reportedUser) {
      return res.status(404).json({
        success: false,
        message: 'Reporter or reported user not found.',
      });
    }

    // Prevent self-reporting
    if (reporterId === reportedUserId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot report yourself.',
      });
    }

    // Check if the reported user is already blocked
    if (reportedUser.UserStatus === 'Blocked') {
      return res.status(400).json({
        success: false,
        message: 'User is already blocked.',
      });
    }

    // Add the `reportType` to the reported user's `report` array
    reportedUser.report.push(reportType);
    // reportedUser.report.push(reportType);

    const title = "Warning..";
    let message = "";

    switch (reportedUser.report.length) {
      case 1:
        message = `Someone reported your account because of the ${reportType}. This is your 1st report. Please ensure compliance with our community guidelines.`;
        break;
      case 2:
        message = `Your account has been reported again for ${reportType}. This is your 2nd report. Continued violations may lead to account suspension.`;
        break;
      case 3:
        message = `Your account has been reported for the 3rd time due to ${reportType}. Your account is now blocked. Contact support for further assistance.`;

        // Add logic here to block the account, e.g., setting a `blocked` flag

        break;
      default:
        message = `Your account has been reported ${reportedUser.report.length} times. Continued violations may lead to further action.`;
    }

    sendNotification(reportedUser, title, message);


    // If reports reach 3 or more, block the user
    if (reportedUser.report.length >= 3) {
      reportedUser.UserStatus = 'Blocked';
      console.log(
        `User ${reportedUser.username || reportedUserId} has been blocked due to excessive reports.`
      );
    }

    // Save the changes
    await reportedUser.save();

    return res.status(200).json({
      success: true,
      message:
        reportedUser.UserStatus === 'Blocked'
          ? 'User has been reported and blocked due to multiple reports.'
          : 'Report has been submitted successfully.',
    });
  } catch (error) {
    console.error('Error reporting user:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while reporting the account.',
    });
  }
};



export const addBankDetails = async (req, res) => {
  const userId = req.user._id || req.user.id;
  const {
    bankName,
    accountNumber,
    ifscCode,
    accountHolderName,
  } = req.body;
  console.log("req.body", req.body)
  try {
    // Validate input
    if (!bankName || !accountNumber || !ifscCode || !accountHolderName) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    // Find the user by ID
    const user = await User.findById(userId);

    console.log("user", user)

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Check for duplicate account numbers
    const isDuplicateAccount = user.bankDetails.some(
      (detail) => detail.accountNumber === accountNumber
    );

    if (isDuplicateAccount) {
      return res.status(400).json({ message: 'Account number already exists.' });
    }

    // Add the new bank details
    user.bankDetails.push({
      bankName,
      accountNumber,
      ifscCode,
      accountHolderName,
    });

    // Save the updated user document
    await user.save();

    res.status(201).json({
      message: 'Bank details added successfully.',
      bankDetails: user.bankDetails,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};


export const getBankDetails = async (req, res) => {
  const userId = req.user._id || req.user.id; // Assuming user info is in `req.user`

  try {
    // Find the user by ID
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Return the user's bank details
    res.status(200).json({
      message: 'Bank details retrieved successfully.',
      bankDetails: user.bankDetails,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};








export const getChatsWithLatestMessages = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id; // Get logged-in user ID
    const page = parseInt(req.query.page) || 1; // Page number
    const limit = parseInt(req.query.limit) || 20; // Results per page
    const skip = (page - 1) * limit;

    // Step 1: Fetch chats where the user is a participant with pagination
    const chats = await Chat.find({ participants: userId })
      .populate({
        path: 'participants',
        model: User,
        select: '-password -refreshToken',
      })
      .sort({ updatedAt: -1 }) // Sort by the latest chat
      .skip(skip)
      .limit(limit);

    if (!chats.length) {
      return res.json({ chats: [], page, limit });
    }

    // Step 2: Use a Map to filter unique users
    const uniqueUsersMap = new Map();

    for (const chat of chats) {
      chat.participants.forEach((participant) => {
        if (participant._id.toString() !== userId.toString()) {
          if (!uniqueUsersMap.has(participant._id.toString())) {
            uniqueUsersMap.set(participant._id.toString(), {
              user: participant,
              chatId: chat._id,
              lastMessage: chat.lastMessage || null,
              updatedAt: chat.updatedAt,
            });
          }
        }
      });
    }

    // Step 3: Fetch reviews for unique participants
    const participantIds = Array.from(uniqueUsersMap.keys());
    const reviews = await Review.find({ user: { $in: participantIds } });

    // Step 4: Calculate average ratings for participants
    const userRatingsMap = {};
    reviews.forEach((review) => {
      const userId = review.user.toString();
      if (!userRatingsMap[userId]) {
        userRatingsMap[userId] = { sum: 0, count: 0 };
      }
      userRatingsMap[userId].sum += review.rating || 0;
      userRatingsMap[userId].count += 1;
    });

    const avgRatings = {};
    for (const [userId, ratingData] of Object.entries(userRatingsMap)) {
      avgRatings[userId] = (ratingData.sum || 0) / (ratingData.count || 1);
    }

    // Step 5: Format unique user chat data with participants in array format
    const formattedChats = Array.from(uniqueUsersMap.values()).map((item) => {
      const avgRating = avgRatings[item.user._id.toString()] || 0;
      const { password, refreshToken, ...userDetails } = item.user.toObject();

      return {
        participants: [{ ...userDetails, averageRating: avgRating }], // Wrap in array format
        chatId: item.chatId,
        lastMessage: item.lastMessage,
        updatedAt: item.updatedAt,
      };
    });

    res.json({ chats: formattedChats, page, limit });
  } catch (error) {
    console.error('Error fetching chats with latest messages:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
};






async function sendNotification(userId, title, message) {
  // Assuming you have the FCM device token stored in your database
  const user = await User.findById(userId);
  const deviceToken = user.deviceToken;

  if (!deviceToken) {
    console.error("No device token found for user:", userId);
    return;
  }

  const payload = {
    notification: {
      title: title,
      body: message,
    },
    token: deviceToken,
  };

  try {
    const response = await admin.messaging().send(payload);
    console.log("Notification sent successfully:", response);
  } catch (error) {
    console.error("Error sending notification:", error);
  }
}
