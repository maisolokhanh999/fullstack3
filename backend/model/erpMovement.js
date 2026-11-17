import mongoose from "mongoose";

const erpMovementSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "ErpDocument" },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "ErpProduct", required: true },
    productName: { type: String, required: true, trim: true },
    sku: { type: String, required: true, trim: true },
    type: { type: String, enum: ["receipt", "issue", "stocktake"], required: true },
    quantity: { type: Number, required: true, min: 0 },
    stockBefore: { type: Number, required: true, min: 0 },
    stockAfter: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, min: 0, default: 0 },
    priceType: { type: String, enum: ["retail", "store"], default: "retail" },
    customerName: { type: String, trim: true, default: "", maxlength: 160 },
    imageUrl: { type: String, trim: true, default: "", maxlength: 2048 },
    reference: { type: String, trim: true, default: "", maxlength: 100 },
    note: { type: String, trim: true, default: "", maxlength: 1000 },
    movementDate: { type: Date, required: true },
    createdBy: { type: String, required: true, default: "erp-api" },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

erpMovementSchema.index({ movementDate: -1, type: 1 });
erpMovementSchema.index({ productName: 1, movementDate: -1 });
erpMovementSchema.index({ productId: 1, movementDate: 1, createdAt: 1 });

export default mongoose.model("ErpMovement", erpMovementSchema);