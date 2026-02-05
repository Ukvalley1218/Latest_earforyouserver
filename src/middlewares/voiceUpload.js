import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";

const voiceStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "user_voice_records",
    resource_type: "video", // REQUIRED for audio
    allowed_formats: ["mp3", "wav", "webm", "m4a","mp4"],
    public_id: (req) => `voice_${req.params.userId}_${Date.now()}`,
  },
});

const uploadVoice = multer({
  storage: voiceStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

export default uploadVoice;
