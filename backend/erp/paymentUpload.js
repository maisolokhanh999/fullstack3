import multer from "multer";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!allowedTypes.has(file.mimetype)) return callback(new Error("Chỉ chấp nhận ảnh JPEG, PNG, WebP hoặc GIF"));
    callback(null, true);
  },
});

export const parsePaymentProof = (req, res, next) => upload.single("image")(req, res, (error) => {
  if (!error) return next();
  return res.status(400).json({
    success: false,
    message: error.code === "LIMIT_FILE_SIZE" ? "Ảnh không được vượt quá 5 MB" : error.message,
  });
});