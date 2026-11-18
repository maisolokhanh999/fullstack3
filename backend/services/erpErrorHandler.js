import { randomUUID } from "node:crypto";

const categoryFor = (path = "") => {
  if (path.includes("/documents")) return "DOCUMENT";
  if (path.includes("/payments")) return "PAYMENT";
  if (path.includes("/customers") || path.includes("/debts")) return "CUSTOMER";
  if (path.includes("/uploads")) return "UPLOAD";
  if (path.includes("/products")) return "PRODUCT";
  if (path.includes("/movements") || path.includes("/receipts") || path.includes("/exports")) return "INVENTORY";
  return "ERP";
};

export const attachRequestId = (req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
};

export const sendErpError = (res, error, req, fallbackMessage = "Lỗi xử lý ERP") => {
  const status = error.status || (error.code === 11000 ? 409 : 500);
  const category = categoryFor(req?.originalUrl);
  const requestId = req?.requestId || randomUUID();
  const code = `${category}-${status}`;
  const message = error.status ? error.message : fallbackMessage;
  const details = {
    level: status >= 500 ? "error" : "warn",
    requestId,
    code,
    category,
    method: req?.method,
    path: req?.originalUrl,
    status,
    message: error.message,
    ...(status >= 500 ? { stack: error.stack } : {}),
  };
  (status >= 500 ? console.error : console.warn)("[ERP_ERROR]", JSON.stringify(details));
  return res.status(status).json({ success: false, message, error: { code, requestId, category } });
};
