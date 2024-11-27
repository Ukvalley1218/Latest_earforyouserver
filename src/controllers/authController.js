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
import {CallRate} from '../models/Wallet/AdminCharges.js'

const generateAccessAndRefreshTokens = async (userId) => {
  try {
    const user = await User.findById(userId);

    if (!user) {
      throw new Error("User not found");
    }

    // Generate tokens
    const accessToken = user.generateAccessToken(); // Short-lived token
    const refreshToken = user.generateRefreshToken(); // Long-lived token

    // Set token expiry (180 days for refresh token)
    const refreshTokenExpires = Date.now() + 180 * 24 * 60 * 60 * 1000; // 180 days

    // Save refresh token and expiry in the user document
    user.refreshToken = refreshToken;
    user.refreshTokenExpires = refreshTokenExpires;

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
        message: 'User ID is required'
      });
    }
    
    // Validate individual fields if they are provided
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
      const phoneRegex = /^\+?[\d\s-]{10,}$/;  // Basic example - adjust as needed
      if (!phoneRegex.test(phone)) {
        validationErrors.push('Invalid phone number format');
      }
    }
    
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
      ...(username !== undefined && { username }),
      ...(dateOfBirth !== undefined && { dateOfBirth }),
      ...(gender !== undefined && { gender: gender.toLowerCase() }),
      ...(Language !== undefined && { Language: Language }), // Note the capital L in Language
      ...(phone !== undefined && { phone }),
      ...(userCategory !== undefined && { userCategory }),
      ...(avatarUrl !== undefined && { avatarUrl }),
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
      message: 'Profile updated successfully',
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



//--------------------------Update User Avatra-----------------------------------------



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

// getAllUsers
export const getAllUsers = async (req, res) => {
  try {
    // Get the logged-in user's ID (assuming it's stored in req.user)
    const loggedInUserId = req.user.id;

    // Find all users except the logged-in user, excluding password and refreshToken fields
    const users = await User.find(
      { _id: { $ne: loggedInUserId } }, // Exclude the logged-in user
      { password: 0, refreshToken: 0 }
    );

    // If no other users are found, return an appropriate message
    if (users.length === 0) {
      return res.status(404).json({ message: 'No other users found' });
    }

    // Return the list of users
    res.status(200).json({
      message: 'Users found successfully',
      users
    });
  } catch (error) {
    // Handle any errors that occur
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
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