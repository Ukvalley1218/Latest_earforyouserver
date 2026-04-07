import { Router } from "express";
import {
  upsertChatCommission,
  getChatCommission,
  updateChatCommission,
  getChatCommissionHistory
} from "../../controllers/admin/chatCommissionController.js";
import { protect } from "../../middlewares/auth/authMiddleware.js";

const router = Router();

// All routes require authentication
router.use(protect);

// Admin routes for chat commission management
router.route("/")
  .get(getChatCommission)      // Get current active settings
  .post(upsertChatCommission); // Create new settings

router.route("/:id")
  .put(updateChatCommission);  // Update specific settings

router.route("/history")
  .get(getChatCommissionHistory); // Get all settings history

export default router;