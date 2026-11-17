import express from "express";
import {
  createCustomerPayment,
  createErpDocument,
  getCustomerDebts,
  getCustomerPayments,
  getErpDocument,
  getErpDocuments,
} from "../contreller/erpController/erpDocumentController.js";
import { uploadErpImage } from "../contreller/erpController/erpUploadController.js";
import { parsePaymentProof } from "../erp/paymentUpload.js";
import {
  createMovement,
  createReceiptBatch,
  createProduct,
  deleteProduct,
  exportMovements,
  getMovements,
  getProduct,
  getProductMovements,
  getProducts,
  getShippedProducts,
  updateMovement,
  updateProduct,
} from "../contreller/erpController/erpController.js";

const router = express.Router();

router.get("/products", getProducts);
router.post("/products", createProduct);
router.get("/products/:id/movements", getProductMovements);
router.get("/products/:id", getProduct);
router.put("/products/:id", updateProduct);
router.delete("/products/:id", deleteProduct);

router.get("/documents", getErpDocuments);
router.post("/documents", createErpDocument);
router.get("/documents/:id", getErpDocument);
router.get("/debts", getCustomerDebts);
router.get("/debts/:customerKey/payments", getCustomerPayments);
router.post("/payments", createCustomerPayment);
router.post("/uploads/payment-proof", parsePaymentProof, uploadErpImage);
router.get("/exports", getShippedProducts);
router.get("/movements", getMovements);
router.post("/receipts", createReceiptBatch);
router.post("/movements", createMovement);
router.put("/movements/:id", updateMovement);
router.get("/export.xlsx", exportMovements);

export default router;