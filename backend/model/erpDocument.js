import mongoose from "mongoose";

const documentLineSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "ErpProduct", required: true },
  warehouse: { type: String, enum: ["thanh-phu", "duc-hoa", "ben-luc"], default: "thanh-phu" },
  movementId: { type: mongoose.Schema.Types.ObjectId, ref: "ErpMovement" },
  sku: { type: String, required: true, trim: true },
  productName: { type: String, required: true, trim: true },
  unit: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 0.001 },
  unitPrice: { type: Number, min: 0, default: 0 },
  amount: { type: Number, min: 0, default: 0 },
  packageNote: { type: String, trim: true, default: "", maxlength: 160 },
  weight: { type: Number, min: 0, default: 0 },
}, { _id: false });

const erpDocumentSchema = new mongoose.Schema({
  documentNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 60, unique: true },
  type: { type: String, enum: ["salesInvoice", "stockIssue"], required: true },
  sourceDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "ErpDocument", default: null, index: true },
  sourceDocumentNumber: { type: String, trim: true, default: "", maxlength: 60 },
  requestedLines: { type: [documentLineSchema], default: [] },
  fulfillmentStatus: { type: String, enum: ["pending", "partial", "complete"], default: "complete" },
  documentDate: { type: Date, required: true },
  deliveryDate: { type: Date, default: null },
  customerName: { type: String, required: true, trim: true, maxlength: 160 },
  customerKey: { type: String, trim: true, index: true },
  customerPhone: { type: String, trim: true, default: "", maxlength: 40 },
  customerAddress: { type: String, trim: true, default: "", maxlength: 300 },
  deliveryAddress: { type: String, trim: true, default: "", maxlength: 300 },
  issuerName: { type: String, trim: true, default: "", maxlength: 180 },
  imageUrl: { type: String, trim: true, default: "", maxlength: 2048 },
  note: { type: String, trim: true, default: "", maxlength: 1000 },
  oldDebt: { type: Number, min: 0, default: 0 },
  depositAmount: { type: Number, min: 0, default: 0 },
  paidAmount: { type: Number, min: 0, default: 0 },
  isDebt: { type: Boolean, default: false },
  paymentMethod: { type: String, enum: ["bankTransfer", "cash", "mixed"], default: "cash" },
  cashPaidAmount: { type: Number, min: 0, default: 0 },
  bankPaidAmount: { type: Number, min: 0, default: 0 },
  priceType: { type: String, enum: ["retail", "store"], default: "retail" },
  documentMode: { type: String, enum: ["standard", "noPrice", "quantityDebt"], default: "standard" },
  paymentInWords: { type: String, trim: true, default: "", maxlength: 300 },
  totalAmount: { type: Number, min: 0, default: 0 },
  totalWeight: { type: Number, min: 0, default: 0 },
  lines: { type: [documentLineSchema], validate: [(lines) => lines.length > 0, "Chứng từ cần ít nhất một dòng hàng"] },
  createdBy: { type: String, required: true, default: "erp-api" },
  updatedBy: { type: String },
}, { timestamps: true });

erpDocumentSchema.index({ documentDate: -1, type: 1 });
erpDocumentSchema.index({ customerKey: 1, isDebt: 1, documentDate: 1 });

export default mongoose.model("ErpDocument", erpDocumentSchema);
