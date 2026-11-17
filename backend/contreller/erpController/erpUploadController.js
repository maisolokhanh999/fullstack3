import { randomUUID } from "node:crypto";
import cloudinary from "../../configs/cloudinary.js";

export const uploadErpImage = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "Vui lòng chọn ảnh giao dịch" });
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    return res.status(503).json({ success: false, message: "Cloudinary chưa được cấu hình trên backend" });
  }
  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({
        folder: "erp/payment-proofs",
        public_id: `${Date.now()}-${randomUUID()}`,
        resource_type: "image",
      }, (error, uploaded) => error ? reject(error) : resolve(uploaded));
      stream.end(req.file.buffer);
    });
    return res.status(201).json({ success: true, data: { secure_url: result.secure_url, public_id: result.public_id } });
  } catch (error) {
    console.error("ERP payment image upload failed:", error.message);
    return res.status(502).json({ success: false, message: "Không tải được ảnh lên Cloudinary" });
  }
};