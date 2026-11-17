import express from "express";
import "dotenv/config";
import cors from "cors";
import connectDB from "./configs/db.js";
import routes from "./router/index.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/", routes);

app.get("/", (req, res) => {
  res.json({ success: true, service: "erp-inventory" });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: "ERP route không tồn tại" });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ success: false, message: "Lỗi máy chủ ERP" });
});

await connectDB();

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
