import mongoose from "mongoose";

const erpProductSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true, uppercase: true, maxlength: 60 },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    category: { type: String, trim: true, default: "", maxlength: 100 },
    unit: { type: String, required: true, trim: true, default: "cái", maxlength: 40 },
    description: { type: String, trim: true, default: "", maxlength: 1000 },
    salePrice: { type: Number, min: 0, default: 0 },
    storePrice: { type: Number, min: 0, default: 0 },
    weightPerUnit: { type: Number, min: 0, default: 0 },
    currentStock: { type: Number, min: 0, default: 0 },
    reorderLevel: { type: Number, min: 0, default: 0 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

erpProductSchema.index({ sku: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
erpProductSchema.index({ name: "text", category: "text" });

export default mongoose.model("ErpProduct", erpProductSchema);