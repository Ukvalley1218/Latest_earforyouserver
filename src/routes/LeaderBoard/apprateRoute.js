import { addRating } from '../../controllers/LeaderBord/Apprate.js';
import { protect } from '../../middlewares/auth/authMiddleware.js';
import express from 'express';
const router = express.Router();

router.post('/comment',protect, addRating);
export default router;
