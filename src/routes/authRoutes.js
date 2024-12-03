import express from 'express';
import {
    getUserById,
    logoutUser,
    requestOTP,
    verifyOTP,
    updateDeviceToken,
    changeUserType,
    updateProfile,
    updateOrCreateUserCategory,
    deleteUser,
    authUser,
    getAllUsers,
    registerUser,
    initiateRegistration,
    verifyLoginOtp,
    updateStatus,
    addBio,
    Reporte_User
} from '../controllers/authController.js';
// import { validateUserSignup } from '../middlewares/auth/validators.js';
import { protect } from '../middlewares/auth/authMiddleware.js'
import multer from 'multer';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', authUser);

router.post('/logout', protect, logoutUser);


// Route for updating user profile

router.post('/update-device-token', protect, updateDeviceToken);
router.post('/addBio', protect, addBio);



router.put('/category/:userId', updateOrCreateUserCategory);

// updateUserDeatil

router.put('/updateProfile/:userId', updateProfile);
router.put('/updateStatus/:userId', updateStatus);
router.put('/users/:userId', changeUserType);

// Route to request OTP 
router.post('/request-otp', requestOTP);
// Route to verify OTP and log in
router.post('/verify-otp', verifyOTP);
router.post('/Reporte_User', Reporte_User);


// Update userType route

router.get('/user/:userId', getUserById);

router.get('/users', protect, getAllUsers);
// Delete User
router.delete('/deleteUser', protect, deleteUser);





router.post('/initiate/registration', initiateRegistration);

// Initiate login by sending OTP to email

// Verify the login OTP
router.post('/login/verify', verifyLoginOtp);

export default router;