import mongoose from "mongoose";

const allocationSchema = new mongoose.Schema({
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: "ErpDocument", required: true },
  amount: { type: Number, min: 0, required: true },
}, { _id: false });

const erpPaymentSchema = new mongoose.Schema({
  customerKey: { type: String, required: true, index: true },
  customerName: { type: String, required: true, trim: true, maxlength: 160 },
  customerPhone: { type: String, trim: true, default: "", maxlength: 40 },
  amount: { type: Number, min: 0.01, required: true },
  paymentDate: { type: Date, required: true },
  method: { type: String, enum: ["bankTransfer", "cash", "other"], default: "bankTransfer" },
  proofImageUrl: { type: String, trim: true, default: "", maxlength: 2048 },
  proofImageUrls: { type: [{ type: String, trim: true, maxlength: 2048 }], default: [] },
  reference: { type: String, trim: true, default: "", maxlength: 160 },
  note: { type: String, trim: true, default: "", maxlength: 500 },
  allocations: { type: [allocationSchema], default: [] },
  createdBy: { type: String, required: true, default: "erp-api" },
}, { timestamps: true });

erpPaymentSchema.index({ paymentDate: -1 });

export default mongoose.model("ErpPayment", erpPaymentSchema);
