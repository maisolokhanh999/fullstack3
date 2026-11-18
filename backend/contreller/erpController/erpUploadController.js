import { randomUUID } from "node:crypto";
import cloudinary from "../../configs/cloudinary.js";

const uploadImage = (file) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream({
    folder: "erp/payment-proofs",
    public_id: `${Date.now()}-${randomUUID()}`,
    resource_type: "image",
  }, (error, uploaded) => error ? reject(error) : resolve({ secure_url: uploaded.secure_url, public_id: uploaded.public_id }));
  stream.end(file.buffer);
});

export const uploadErpImage = async (req, res) => {
  const files = req.files?.images || req.files?.image || [];
  if (!files.length) return res.status(400).json({ success: false, message: "Vui lòng chọn ít nhất một ảnh giao dịch" });
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    return res.status(503).json({ success: false, message: "Cloudinary chưa được cấu hình trên backend" });
  }
  try {
    const uploaded = await Promise.all(files.map(uploadImage));
    return res.status(201).json({ success: true, data: uploaded });
  } catch (error) {
    console.error("ERP payment image upload failed:", error.message);
    return res.status(502).json({ success: false, message: "Không tải được ảnh lên Cloudinary" });
  }
};