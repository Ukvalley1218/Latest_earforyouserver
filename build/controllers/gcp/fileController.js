import { uploadFileToGCP } from '../../servises/gcpService.js';
import { ApiError } from '../../utils/ApiError.js';
export const uploadFile = async (req, res, next) => {
  try {
    if (!req.file) {
      throw new ApiError(400, 'No file uploaded');
    }
    const fileUrl = await uploadFileToGCP(req.file);
    res.status(200).json({
      success: true,
      url: fileUrl
    });
  } catch (error) {
    next(error);
  }
};