import express from "express";
import erpRoutes from "./erpRoutes.js";

const router = express.Router();
router.use("/erp", erpRoutes);

export default router;
