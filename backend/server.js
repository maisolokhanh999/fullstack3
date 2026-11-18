import express from "express";
import "dotenv/config";
import cors from "cors";
import connectDB from "./configs/db.js";
import routes from "./router/index.js";
import { attachRequestId, sendErpError } from "./services/erpErrorHandler.js";

const app = express();

app.use(cors());
app.use(attachRequestId);
app.use(express.json({ limit: "1mb" }));
app.use("/", routes);

app.get("/", (req, res) => {
  res.json({ success: true, service: "erp-inventory" });
});

app.use((req, res) => {
  sendErpError(res, Object.assign(new Error("ERP route không tồn tại"), { status: 404 }), req);
});

app.use((error, req, res, next) => {
  sendErpError(res, error, req, "Lỗi máy chủ ERP");

});

await connectDB();

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
