import express from 'express';
import {
    getReviews,
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
    addOrUpdateBankDetails,
    getBankDetails,
    getAllUsers1,
    getHealer,
    getAllUsers2,
    UpdateCallStatus,
    UserCategoryData,
    RegisterEnquiry,
    getAllUserCategory,
    GetRegisterEnquiry,
    getTopListenersByDuration,
    getAllForCallUser,
    ChatStatusStatus,
    getAllForChatStatus,
    updateProfileDesc,
    deleteProfileDesc
} from '../controllers/authController.js';
// import { validateUserSignup } from '../middlewares/auth/validators.js';
import { protect } from '../middlewares/auth/authMiddleware.js'
import multer from 'multer';
import { userStatics } from '../controllers/UserData/UserData.js';
import { expirePlatformCharges } from '../controllers/CronJob/Expiry.js';
import uploadVoice from '../middlewares/voiceUpload.js';


const router = express.Router();

router.post('/register', registerUser);
router.post('/login', authUser);

router.post('/logout', protect, logoutUser);

router.get('/getTopListenersByRating', getTopListenersByDuration);

router.get('/getAllForCallUser', protect, getAllForCallUser);

router.get('/getAllForChatStatus', protect, getAllForChatStatus);


// Route for updating user profile

router.post('/update-device-token', protect, updateDeviceToken);
router.post('/addBio', protect, addBio);



router.put('/category/:userId', updateOrCreateUserCategory);

// updateUserDeatil

router.put('/updateProfile/:userId', updateProfile);
router.put('/updateStatus/:userId', updateStatus);
router.put('/users/:userId', changeUserType);
router.put(
  "/user/update-profile-desc/:userId",
  uploadVoice.single("record_desc"),
  updateProfileDesc
);

// Route to request OTP 
router.post('/request-otp', requestOTP);
// Route to verify OTP and log in
router.post('/verify-otp', verifyOTP);
router.post('/Reporte_User', Reporte_User);


// Update userType route

router.get('/user/:userId', getUserById);

// router.get('/users', protect, getAllUsers);
router.get('/users', protect, getAllUsers1);

router.get('/getHealer', protect, getHealer);

router.get('/getAllUserCategory', protect, getAllUserCategory);

router.get('/getAllUsers2', protect, getAllUsers2);

router.get('/listener', protect, listener);

router.post('/Category', protect, UserCategoryData);
// Delete User
router.delete('/deleteUser', protect, deleteUser);
// delete voice record
router.delete(
  "/user/delete-profile-desc/:userId",
  deleteProfileDesc
);

router.post('/addOrUpdateBankDetails', protect, addOrUpdateBankDetails);

router.get('/getBankDetails', protect, getBankDetails);





router.post('/initiate/registration', initiateRegistration);



// Verify the login OTP
router.post('/login/verify', verifyLoginOtp);

router.get('/userStatics', protect, userStatics);

router.get('/getUsersByLatestActivity', protect, getChatsWithLatestMessages);
router.get('/getReviews/:userId', getReviews);
router.post('/UpdateCallStatus', protect, UpdateCallStatus);

router.post('/ChatStatusStatus', protect, ChatStatusStatus);

router.get('/expirePlatformCharges', expirePlatformCharges);

router.get('/GetRegisterEnquiry', GetRegisterEnquiry);

router.post('/RegisterEnquiry', RegisterEnquiry);

export default router;