import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import requestIp from "request-ip";
import { Server } from "socket.io";

import colors from "colors";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import morganMiddleware from "./logger/morgan.logger.js";
import dotenv from "dotenv";
import logger from "./logger/winston.logger.js";
import { setupWebRTC } from "./Webrtc/setupwebrtc.js";
import { initializeSocketIO } from "./socket/index.js";
const app = express();

dotenv.config({
  path: "./.env",
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  pingTimeout: 60000,
  cors: {
    origin: "*",
    credentials: true,
  },
});
app.set("io", io);
// using set method to mount the `io` instance on the app to avoid usage of `global`

// app.set("trust proxy", 1);
initializeSocketIO(io);
setupWebRTC(io);


// global middlewares
app.use(
  cors({
    origin:
      process.env.CORS_ORIGIN === "*"
        ? "*"
        : process.env.CORS_ORIGIN?.split(","),
    credentials: true,
  })
);

app.use(requestIp.mw());

app.set('trust proxy', 1)

// Rate limiter to avoid misuse of the service and avoid cost spikes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // Limit each IP to 500 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  keyGenerator: (req, res) => {
    return req.clientIp; // IP address from requestIp.mw(), as opposed to req.ip
  },
  handler: (_, __, ___, options) => {
    throw new ApiError(
      options.statusCode || 500,
      `There are too many requests. You are only allowed ${options.max
      } requests per ${options.windowMs / 60000} minutes`
    );
  },
});

// Apply the rate limiting middleware to all requests
app.use(limiter);

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public")); // configure static file to save images locally
app.use(cookieParser());

// required for passport
app.use(
  session({
    secret: process.env.EXPRESS_SESSION_SECRET,
    resave: true,
    saveUninitialized: true,
  })
);

app.use(morganMiddleware);





import authRoutes from "./routes/authRoutes.js";
import { errorHandler } from "./middlewares/error.middlewares.js";
import { apiLimiter } from "./middlewares/rateLimiter.js";
// * Chat routes
import chatRouter from "./routes/chat-app/chat.routes.js";
import messageRouter from "./routes/chat-app/message.routes.js";
// * LeaderBoard Routes 
import reviewRoutes from './routes/LeaderBoard/reviewRoutes.js';
import userRoutes from './routes/LeaderBoard/userRoutes.js';
import SendNotificationRoute from './routes/NotificationRoute/SendNotificationRoute.js'
import CallRoute from './routes/CallRoute.js'
import RechargeRoute from './routes/Recharge/RechargeRoute.js'
import msg91Routes from './routes/OTP/msg91Routes.js'
import appRatingRoutes from './routes/LeaderBoard/apprateRoute.js'
// import { watchUserChanges } from "./servises/Stream.js";
import { checkUserStatus } from "./middlewares/auth/CheckBlock.js";
import { protect } from "./middlewares/auth/authMiddleware.js";
import ZohoRoute from './routes/ZohoRoute/ZohoRoute.js'

app.get("/", (req, res) => {
  try {
    res.send("Ear For You Server Running Smoothly");
    throw new Error("BROKEN");
  } catch (error) {
    logger.error(error);
  }
});
// watchUserChanges()




  // Apply global middlewares


  + app.use("/api/", apiLimiter);

app.use('/api/v1/msg91', msg91Routes);

app.use('/api/v1', CallRoute);
// Added middleware

//authRoutes
app.use("/api/v1", authRoutes);

app.use('/api/v1/apprating', appRatingRoutes);


app.use("/api/v1/chats", chatRouter);
app.use("/api/v1/messages", messageRouter);

// Leader Board Routes for rating and Review 
app.use('/api/v1', reviewRoutes); // Prefix all review routes with /api
app.use('/api/v1', userRoutes);
app.use('/api/v1', RechargeRoute);

app.use('/api/zoho',ZohoRoute);
// FairBaseNotification

app.use('/api/v1/notify', SendNotificationRoute)
//common error handling middleware

app.use(protect); // First protect middleware to authenticate users
app.use(checkUserStatus); // Then checkUserStatus to ensure the user's status is valid

app.use(errorHandler);

export default httpServer;
