import mongoose from "mongoose";

const erpCustomerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 160 },
  customerKey: { type: String, required: true, unique: true, index: true },
  phone: { type: String, trim: true, default: "", maxlength: 40 },
  address: { type: String, trim: true, default: "", maxlength: 300 },
  note: { type: String, trim: true, default: "", maxlength: 500 },
}, { timestamps: true });

export default mongoose.model("ErpCustomer", erpCustomerSchema);
