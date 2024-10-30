import User from "../models/Users.js";
import jwt from "jsonwebtoken";
import ROLES_LIST from "../config/Roles_list.js";
import crypto from "crypto";
import { generateOtp, sendOtpEmail } from "../utils/generateOtp.js";
import bcrypt from "bcrypt";
import { uploadFileToGCP } from "../servises/gcpService.js";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import unirest from "unirest";
import otpGenerator from 'otp-generator';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import admin from 'firebase-admin';
const generateAccessAndRefreshTokens = async userId => {
  try {
    const user = await User.findById(userId);
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    // attach refresh token to the user document to avoid refreshing the access token with multiple refresh tokens
    user.refreshToken = refreshToken;
    await user.save({
      validateBeforeSave: false
    });
    return {
      accessToken,
      refreshToken
    };
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Something went wrong while generating the access token"
    });
  }
};
export const registerUser = async (req, res) => {
  const {
    username,
    email,
    phone,
    address,
    userType,
    userCategory,
    password
  } = req.body; // Ensure correct field names

  try {
    // Check for required fields
    const requiredFields = {
      username,
      email,
      userType,
      phone,
      password
    };
    const missingFields = Object.entries(requiredFields).filter(([key, value]) => !value).map(([key]) => key);
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `The following are required: ${missingFields.join(', ')}`
      });
    }

    // Check if user with email or phone already exists
    const userExists = await User.findOne({
      $or: [{
        email
      }, {
        phone
      }]
    });
    if (userExists) {
      return res.status(400).json({
        message: "User with this email or phone already exists"
      });
    }

    // Create new user
    const user = await User.create({
      username,
      email,
      phone,
      address,
      userType,
      userCategory,
      // Ensure correct field name for userCategory
      password
    });
    if (user) {
      const {
        accessToken,
        refreshToken
      } = await generateAccessAndRefreshTokens(user._id);
      res.status(201).json({
        _id: user._id,
        accessToken,
        refreshToken,
        username: user.username,
        email: user.email,
        address: user.address,
        // Ensure consistent casing
        phone: user.phone,
        userType: user.userType,
        // Assuming you have userType in your model
        userCategory: ROLES_LIST[userCategory],
        // Ensure correct reference to userCategory
        accessToken,
        refreshToken
      });
    } else {
      res.status(400).json({
        message: "Invalid user data"
      });
    }
  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
};
export const authUser = async (req, res) => {
  const {
    email,
    phone,
    password,
    deviceToken,
    platform
  } = req.body;

  // If email or phone is missing
  if (!email && !phone) {
    return res.status(400).json({
      message: "Email or Phone is required"
    });
  }

  // If password is missing
  if (!password) {
    return res.status(400).json({
      message: "Password is required"
    });
  }
  try {
    const user = await User.findOne({
      $or: [{
        email
      }, {
        phone
      }]
    });
    if (user && (await user.matchPassword(password))) {
      const {
        accessToken,
        refreshToken
      } = await generateAccessAndRefreshTokens(user._id);
      if (deviceToken) {
        user.deviceToken = deviceToken;
        user.platform = platform || user.platform; // Use provided platform or keep the existing one
        await user.save();
      }
      return res.json({
        _id: user._id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        UserCategory: ROLES_LIST[user.UserCategory],
        accessToken,
        refreshToken,
        message: "User logged in successfully"
      });
    } else {
      return res.status(401).json({
        message: "Invalid email/phone or password"
      });
    }
  } catch (error) {
    return res.status(500).json({
      message: error.message
    });
  }
};
export const logoutUser = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        refreshToken: ''
      }
    }, {
      new: true
    });
    const options = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production"
    };
    return res.status(200).clearCookie("accessToken", options).clearCookie("refreshToken", options).json({
      message: "User logged out successfully"
    });
  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
};

//reset password flow :

//   ---------------initiating-Phase--------------------

export const initiatePasswordReset = async (req, res) => {
  const {
    email
  } = req.body;
  try {
    const user = await User.findOne({
      email
    });
    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }
    const otp = generateOtp();
    user.otp = otp;
    user.otpExpires = Date.now() + 3600000; // 1 hour

    await user.save();
    await sendOtpEmail(email, otp);
    res.status(200).json({
      message: "OTP sent to email"
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error
    });
  }
};

//   ---------------verify-Phase--------------------

export const verifyOtp = async (req, res) => {
  const {
    email,
    otp
  } = req.body;
  try {
    const user = await User.findOne({
      email
    });
    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }
    if (user.otp !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({
        message: "Invalid or expired OTP"
      });
    }
    res.status(200).json({
      message: "OTP verified"
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error
    });
  }
};

//   ---------------resetPassword-Phase--------------------

export const resetPassword = async (req, res) => {
  const {
    email,
    otp,
    newPassword
  } = req.body;
  try {
    const user = await User.findOne({
      email
    });
    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }
    if (user.otp !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({
        message: "Invalid or expired OTP"
      });
    }

    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    console.log(user.password);
    // Clear OTP and its expiration
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();
    res.status(200).json({
      message: "Password reset successfully"
    });
  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
};

// ---------------Update User Profile -------------------------

// Add validation utilities if needed

export const updateUserProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      username,
      email,
      phone,
      address
    } = req.body;
    let {
      avatar
    } = req.body; // Only used if not using file upload
    let updatedFields = {};

    // Validation
    if (username && typeof username !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Username must be a string'
      });
    }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }
    if (phone && !/^\+?\d{10,15}$/.test(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format'
      });
    }
    if (address && typeof address !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Address must be a string'
      });
    }

    // Handling avatar file upload
    if (req.file) {
      try {
        const processedBuffer = await sharp(req.file.buffer).resize(800).jpeg({
          quality: 80
        }).toBuffer();
        const uniqueFileName = `${uuidv4()}_${req.file.originalname}`;
        const fileUrl = await uploadFileToGCP({
          buffer: processedBuffer,
          mimetype: req.file.mimetype
        }, uniqueFileName);
        avatar = {
          url: fileUrl
        }; // Update avatar URL
      } catch (imageError) {
        console.error('Error processing file:', imageError);
        return res.status(500).json({
          success: false,
          message: 'Error uploading avatar image'
        });
      }
    }

    // Update user profile
    const updateData = {
      ...(username && {
        username
      }),
      ...(email && {
        email
      }),
      ...(phone && {
        phone
      }),
      ...(address && {
        address
      }),
      ...(avatar && {
        avatar
      }) // Only add avatar if it's provided
    };
    const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
      new: true
    });
    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    res.status(200).json({
      success: true,
      user: updatedUser
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// ------------------------Update User CategoryController.js---------------------------------------
export const updateOrCreateUserCategory = async (req, res) => {
  try {
    const {
      userId
    } = req.params;
    const {
      userCategory
    } = req.body;

    // Input validation
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required'
      });
    }
    if (!userCategory) {
      return res.status(400).json({
        success: false,
        message: 'userCategory is required'
      });
    }

    // Validate userCategory (adjust the valid categories as needed)
    const validUserCategories = ['category1', 'category2', 'category3']; // Replace with your actual categories
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
        _id: userId,
        // Set userId as _id
        userCategory // Set the new userCategory
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
    const userId = req.user._id;
    const {
      username,
      dateOfBirth,
      gender
    } = req.body;

    // Validation
    if (username && typeof username !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Username must be a string'
      });
    }
    if (dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date of birth format'
      });
    }
    if (gender && !['male', 'female', 'other'].includes(gender.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid gender'
      });
    }

    // Check if all required fields are provided
    if (!username || !dateOfBirth || !gender) {
      // Create a new user if details are not available
      const newUser = new User({
        username,
        dateOfBirth,
        gender
        // Add other required fields as necessary
      });
      const savedUser = await newUser.save(); // Save the new user

      return res.status(201).json({
        success: true,
        message: 'New user created successfully',
        user: savedUser // Return the newly created user object
      });
    }

    // Update user profile if all required fields are present
    const updateData = {
      ...(username && {
        username
      }),
      ...(dateOfBirth && {
        dateOfBirth
      }),
      ...(gender && {
        gender
      })
    };
    const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
      new: true
    });
    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    res.status(200).json({
      success: true,
      user: updatedUser
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};
//--------------------------Update User Avatra-----------------------------------------
export const updateUserAvatar = async (req, res) => {
  try {
    const userId = req.user._id;
    let avatar = null;

    // Handling avatar file upload
    if (req.file) {
      try {
        const processedBuffer = await sharp(req.file.buffer).resize(800).jpeg({
          quality: 80
        }).toBuffer();
        const uniqueFileName = `${uuidv4()}_${req.file.originalname}`;
        const fileUrl = await uploadFileToGCP({
          buffer: processedBuffer,
          mimetype: req.file.mimetype
        }, uniqueFileName);
        avatar = {
          url: fileUrl
        }; // Update avatar URL
      } catch (imageError) {
        console.error('Error processing file:', imageError);
        return res.status(500).json({
          success: false,
          message: 'Error uploading avatar image'
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Update user avatar
    const updatedUser = await User.findByIdAndUpdate(userId, {
      avatar
    }, {
      new: true
    });
    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    res.status(200).json({
      success: true,
      user: updatedUser
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};
// ------------------------userController.js---------------------------------------
export const updateDeviceToken = async (req, res) => {
  const {
    deviceToken
  } = req.body;
  try {
    const userId = req.user._id; // Assuming you get the user ID from JWT or session
    const user = await User.findByIdAndUpdate(userId, {
      deviceToken
    }, {
      new: true
    });
    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }
    res.status(200).json({
      message: 'Device token updated successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: 'Failed to update device token'
    });
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
  const {
    phone
  } = req.body;
  try {
    if (!phone) {
      return res.status(400).json({
        message: "Phone number is required"
      });
    }

    // Ensure phone number is in E.164 format
    const phoneStr = `+${String(phone).trim()}`;

    // Check if user exists by phone number
    let user = await User.findOne({
      phone: phoneStr
    });
    console.log(user);
    if (!user) {
      console.log('user creation');

      // Generate a random username
      const username = generateRandomUsername();

      // Create new user with phone number and generated username
      user = await User.create({
        phone: phoneStr,
        username: username // Store the generated username
        // Other fields can be added as needed
      });
    }

    // Use Firebase's phoneAuth flow to send an OTP
    const sessionInfo = await admin.auth().createCustomToken(phoneStr);
    const {
      accessToken,
      refreshToken
    } = await generateAccessAndRefreshTokens(user._id);
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
  const {
    phone,
    otp,
    sessionInfo
  } = req.body;
  if (!phone || !otp || !sessionInfo) {
    return res.status(400).json({
      message: "Phone, OTP, and session info are required."
    });
  }
  try {
    // Verify the OTP using Firebase's session verification
    const decodedToken = await admin.auth().verifyIdToken(sessionInfo);

    // Ensure the decoded token contains the correct phone number
    if (!decodedToken || decodedToken.phone_number !== `+${phone}`) {
      return res.status(401).json({
        message: 'Invalid or expired OTP.'
      });
    }

    // Check if the user exists
    const user = await User.findOne({
      phone: `+${phone}`
    });
    if (!user) {
      return res.status(404).json({
        message: "User not found."
      });
    }

    // Update device info if provided
    if (req.body.deviceToken) {
      user.deviceToken = req.body.deviceToken;
      user.platform = req.body.platform || user.platform;
      await user.save();
    }

    // Generate tokens (assuming generateAccessAndRefreshTokens is defined elsewhere)
    const {
      accessToken,
      refreshToken
    } = await generateAccessAndRefreshTokens(user._id);
    return res.status(200).json({
      message: "OTP verified successfully",
      userId: user._id,
      accessToken,
      refreshToken
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
    const {
      userId
    } = req.params;
    const {
      userType
    } = req.body;

    // Input validation
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required'
      });
    }
    if (!userType) {
      return res.status(400).json({
        success: false,
        message: 'userType is required'
      });
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
    const updatedUser = await User.findByIdAndUpdate(userId, {
      UserType: userType
    }, {
      new: true,
      runValidators: true
    } // Enable validators and return updated document
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
    const {
      userId
    } = req.params; // Extract userId from the request URL parameters

    // Find the user by ID
    const user = await User.findById(userId);

    // If the user doesn't exist, return a 404 error
    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    // If found, return the user object (excluding password for security reasons)
    res.status(200).json({
      message: 'User found successfully',
      user: {
        ...user.toObject(),
        password: undefined,
        // Hide sensitive fields like password
        refreshToken: undefined // Optionally hide refreshToken as well
      }
    });
  } catch (error) {
    // Handle any other errors
    console.error('Error fetching user:', error);
    res.status(500).json({
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Delete User 

export const deleteUser = async (req, res) => {
  try {
    const userId = req.user._id; // Get user ID from the request (assuming it's set in middleware)

    // Check if the user exists
    const userToDelete = await User.findById(userId);
    if (!userToDelete) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Delete the user
    await User.findByIdAndDelete(userId);
    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting user',
      error: error.message
    });
  }
};