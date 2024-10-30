import express from 'express';
import { getUserById, logoutUser, requestOTP, verifyOTP, updateDeviceToken, changeUserType, updateProfile, updateUserAvatar, updateOrCreateUserCategory, deleteUser } from '../controllers/authController.js';
// import { validateUserSignup } from '../middlewares/auth/validators.js';
import { protect } from '../middlewares/auth/authMiddleware.js';
import multer from 'multer';
const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage()
});
router.post('/logout', protect, logoutUser);

// Route for updating user profile

router.post('/update-device-token', protect, updateDeviceToken);
router.put('/api/user/category/:userId', updateOrCreateUserCategory);

// updateUserDeatil

router.put('/updateProfile', updateProfile);
router.put('/updateUserAvatar', upload.single('avatar'), updateUserAvatar); // Assuming you're using multer for file uploads

// Route to request OTP 
router.post('/request-otp', requestOTP);
// Route to verify OTP and log in
router.post('/verify-otp', verifyOTP);

// Update userType route
router.put('/users/:userId', changeUserType);
router.get('/user/:userId', getUserById);

// Delete User
router.delete('/deleteUser', protect, deleteUser);
export default router;