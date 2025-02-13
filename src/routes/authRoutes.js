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
    listener,
    registerUser,
    initiateRegistration,
    verifyLoginOtp,
    updateStatus,
    addBio,
    getChatsWithLatestMessages,
    Reporte_User,
    addBankDetails,
    getBankDetails,
    getAllUsers1,
    getAllUsers2,
    UserCategoryData
} from '../controllers/authController.js';
// import { validateUserSignup } from '../middlewares/auth/validators.js';
import { protect } from '../middlewares/auth/authMiddleware.js'
import multer from 'multer';
import { userStatics } from '../controllers/UserData/UserData.js';


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

// router.get('/users', protect, getAllUsers);
router.get('/users', protect, getAllUsers1);

router.get('/getAllUsers2', protect, getAllUsers2);

router.get('/listener', protect, listener);

router.post('/Category', protect, UserCategoryData);
// Delete User
router.delete('/deleteUser', protect, deleteUser);

router.post('/addBankDetails', protect, addBankDetails);

router.get('/getBankDetails', protect, getBankDetails);





router.post('/initiate/registration', initiateRegistration);



// Verify the login OTP
router.post('/login/verify', verifyLoginOtp);

router.get('/userStatics', protect, userStatics);

router.get('/getUsersByLatestActivity', protect, getChatsWithLatestMessages);

export default router;