import { Router } from "express";
import {
  createOrGetAOneOnOneChat,
  deleteOneOnOneChat,
  getAllChats,
  searchAvailableUsers,
  markMessageAsRead,
  getUnreadMessagesCount
} from "../../controllers/chat-app/chat.controllers.js";
import { protect } from "../../middlewares/auth/authMiddleware.js";
import { mongoIdPathVariableValidator } from "../../validators/common/mongodb.validators.js";
import { validate } from "../../validators/validate.js";
import { getAllAgents } from "../../controllers/chat-app/getAllAgentController.js";

const router = Router();

router.use(protect);

router.route("/").get(getAllChats);
router.route("/agents").get(getAllAgents);
router.route("/users").get(searchAvailableUsers);

router
  .route("/c/:receiverId")
  .post(
    mongoIdPathVariableValidator("receiverId"),
    validate,
    createOrGetAOneOnOneChat
  );

router
  .route("/remove/:chatId")
  .delete(mongoIdPathVariableValidator("chatId"), validate, deleteOneOnOneChat);


router
  .route("/messageread/:messageId/read")
  .put(mongoIdPathVariableValidator("messageId"), validate, markMessageAsRead);


router.get("/messages/unread/count", protect, getUnreadMessagesCount);

export default router;
