import express from 'express';
import { 
    getUserById,
     logoutUser,
     requestOTP, 
    verifyOTP,   
     updateDeviceToken,
     changeUserType ,
     updateProfile,
     updateOrCreateUserCategory,
     deleteUser,
     authUser,
     getAllUsers,
     registerUser
} from '../controllers/authController.js';
// import { validateUserSignup } from '../middlewares/auth/validators.js';
import { protect } from '../middlewares/auth/authMiddleware.js'
import multer from 'multer';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', protect, authUser);

router.post('/logout', protect, logoutUser);


// Route for updating user profile

router.post('/update-device-token', protect, updateDeviceToken);


router.put('/api/user/category/:userId', updateOrCreateUserCategory);

// updateUserDeatil

router.put('/updateProfile', updateProfile);


// Route to request OTP 
router.post('/request-otp', requestOTP);
// Route to verify OTP and log in
router.post('/verify-otp', verifyOTP);


// Update userType route
router.put('/users/:userId', changeUserType);
router.get('/user/:userId', getUserById);

router.get('/users', getAllUsers);
// Delete User
router.delete('/deleteUser',protect, deleteUser);



export default router;