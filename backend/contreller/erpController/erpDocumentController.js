import mongoose from "mongoose";
import ErpDocument from "../../model/erpDocument.js";
import ErpMovement from "../../model/erpMovement.js";
import ErpPayment from "../../model/erpPayment.js";
import ErpProduct from "../../model/erpProduct.js";
import ErpCustomer from "../../model/erpCustomer.js";
import {
  buildMonthRange,
  ErpError,
  parseMovementDate,
  rebuildProductStock,
  withErpTransaction,
  validateWarehouse,
} from "../../services/erpInventoryService.js";

const movementActor = process.env.ERP_ACTOR_NAME || "erp-api";
const validAmount = (value) => Number.isFinite(value) && value >= 0;
const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const customerKeyOf = (name) => name.trim().toLocaleLowerCase("vi-VN").normalize("NFC");

const respondError = (res, error) => {
  if (error.status) return res.status(error.status).json({ success: false, message: error.message });
  if (error.code === 11000) return res.status(409).json({ success: false, message: "Số chứng từ đã tồn tại" });
  console.error(error);
  return res.status(500).json({ success: false, message: "Lỗi xử lý chứng từ ERP" });
};

const validateDocument = (body) => {
  if (!["salesInvoice", "stockIssue"].includes(body.type)) throw new ErpError(400, "Mẫu chứng từ không hợp lệ");
  if (body.priceType !== undefined && !["retail", "store"].includes(body.priceType)) throw new ErpError(400, "Loại giá không hợp lệ");
  if (!body.documentNumber?.trim() || !body.customerName?.trim()) {
    throw new ErpError(400, "Số chứng từ và tên khách hàng là bắt buộc");
  }
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100) {
    throw new ErpError(400, "Chứng từ cần từ 1 đến 100 dòng hàng");
  }
  for (const line of body.lines) {
    if (body.type === "stockIssue") validateWarehouse(line.warehouse || body.warehouse || "thanh-phu");
    if (!mongoose.isValidObjectId(line.productId)) throw new ErpError(400, "Có sản phẩm không hợp lệ");
    if (!Number.isFinite(line.quantity) || line.quantity <= 0 || Math.round(line.quantity * 1000) !== line.quantity * 1000) {
      throw new ErpError(400, "Số lượng phải lớn hơn 0 và tối đa 3 chữ số thập phân");
    }
    if (line.unitPrice !== undefined && !validAmount(line.unitPrice)) throw new ErpError(400, "Đơn giá không hợp lệ");
    if (line.weight !== undefined && !validAmount(line.weight)) throw new ErpError(400, "Trọng lượng không hợp lệ");
  }
  for (const field of ["oldDebt", "depositAmount", "paidAmount"]) {
    if (body[field] !== undefined && !validAmount(body[field])) throw new ErpError(400, "Thông tin thanh toán không hợp lệ");
  }
};

export const createErpDocument = async (req, res) => {
  try {
    validateDocument(req.body);
    const body = req.body;
    const documentDate = parseMovementDate(body.documentDate);
    const deliveryDate = body.deliveryDate ? parseMovementDate(body.deliveryDate) : null;

    const document = await withErpTransaction(async (session) => {
      const productIds = [...new Set(body.lines.map((line) => String(line.productId)))];
      const products = await ErpProduct.find({
        _id: { $in: productIds },
        isDeleted: false,
        isActive: true,
      }).session(session);
      const productById = new Map(products.map((product) => [String(product._id), product]));
      if (productById.size !== productIds.length) throw new ErpError(404, "Không tìm thấy một hoặc nhiều sản phẩm đang hoạt động");

      const lines = body.lines.map((line) => {
        const product = productById.get(String(line.productId));
        const quantity = line.quantity;
        const unitPrice = body.type === "salesInvoice" && body.documentMode !== "noPrice"
          ? (body.priceType === "store" ? product.storePrice : product.salePrice)
          : 0;
        return {
          productId: product._id,
          warehouse: body.type === "stockIssue" ? line.warehouse || body.warehouse || "thanh-phu" : undefined,
          sku: product.sku,
          productName: product.name,
          unit: product.unit,
          quantity,
          unitPrice,
          amount: roundMoney(quantity * unitPrice),
          packageNote: line.packageNote || "",
          weight: line.weight ?? Math.round((quantity * (product.weightPerUnit || 0) + Number.EPSILON) * 1000) / 1000,
        };
      });
      const totalAmount = roundMoney(lines.reduce((sum, line) => sum + line.amount, 0));
      const priceType = body.type === "salesInvoice" ? body.priceType || "retail" : "retail";
      const depositAmount = body.type === "salesInvoice" ? body.depositAmount ?? 0 : 0;
      if (body.type === "salesInvoice" && depositAmount > totalAmount + (body.oldDebt ?? 0)) {
        throw new ErpError(400, "Tiền cọc không thể lớn hơn tổng thanh toán");
      }
      if (body.type === "salesInvoice" && body.isDebt && (body.paidAmount ?? 0) + depositAmount > totalAmount + (body.oldDebt ?? 0)) {
        throw new ErpError(400, "Tiền cọc và trả trước không thể lớn hơn tổng công nợ");
      }
      const totalWeight = Math.round((lines.reduce((sum, line) => sum + line.weight, 0) + Number.EPSILON) * 1000) / 1000;
      const [createdDocument] = await ErpDocument.create([{
        documentNumber: body.documentNumber.trim(),
        type: body.type,
        documentDate,
        deliveryDate,
        customerName: body.customerName.trim(),
        customerKey: customerKeyOf(body.customerName),
        customerPhone: body.customerPhone || "",
        customerAddress: body.customerAddress || "",
        deliveryAddress: body.deliveryAddress || "",
        issuerName: body.issuerName || "",
        imageUrl: body.imageUrl || "",
        note: body.note || "",
        oldDebt: body.type === "salesInvoice" ? body.oldDebt ?? 0 : 0,
        depositAmount,
        isDebt: body.type === "salesInvoice" ? Boolean(body.isDebt) : false,
        paidAmount: body.type === "salesInvoice"
          ? (body.isDebt ? body.paidAmount ?? 0 : roundMoney(totalAmount + (body.oldDebt ?? 0) - depositAmount))
          : 0,
        priceType,
        documentMode: ["standard", "noPrice", "quantityDebt"].includes(body.documentMode) ? body.documentMode : "standard",
        paymentInWords: body.type === "salesInvoice" ? body.paymentInWords || "" : "",
        totalAmount,
        totalWeight,
        lines,
        createdBy: movementActor,
      }], { session });

      const affectedProductIds = new Set();
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (body.type !== "stockIssue") continue;
        const [movement] = await ErpMovement.create([{
          documentId: createdDocument._id,
          productId: line.productId,
          warehouse: line.warehouse,
          productName: line.productName,
          sku: line.sku,
          type: "issue",
          quantity: line.quantity,
          stockBefore: 0,
          stockAfter: 0,
          unitPrice: line.unitPrice,
          priceType,
          customerName: body.customerName.trim(),
          imageUrl: body.imageUrl || "",
          reference: body.documentNumber.trim(),
          note: line.packageNote || body.note || "",
          movementDate: documentDate,
          createdBy: movementActor,
        }], { session });
        createdDocument.lines[index].movementId = movement._id;
        affectedProductIds.add(String(line.productId));
      }

      for (const productId of affectedProductIds) await rebuildProductStock(productId, session);
      await createdDocument.save({ session });
      return createdDocument;
    });

    res.status(201).json({ success: true, data: document });
  } catch (error) { respondError(res, error); }
};

export const getErpDocuments = async (req, res) => {
  try {
    const filter = {};
    if (req.query.year !== undefined || req.query.month !== undefined) {
      const range = buildMonthRange(req.query.year, req.query.month);
      if (range) filter.documentDate = range;
    }
    if (req.query.type) {
      if (!["salesInvoice", "stockIssue"].includes(req.query.type)) throw new ErpError(400, "Mẫu chứng từ không hợp lệ");
      filter.type = req.query.type;
    }
    if (req.query.keyword?.trim()) {
      const escaped = req.query.keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { documentNumber: { $regex: escaped, $options: "i" } },
        { customerName: { $regex: escaped, $options: "i" } },
      ];
    }
    const documents = await ErpDocument.find(filter).sort({ documentDate: -1, createdAt: -1 }).limit(300);
    res.json({ success: true, data: documents });
  } catch (error) { respondError(res, error); }
};

export const getErpDocument = async (req, res) => {
  try {
    const document = await ErpDocument.findOne({
      $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { documentNumber: req.params.id.toUpperCase() }],
    });
    if (!document) throw new ErpError(404, "Không tìm thấy chứng từ");
    res.json({ success: true, data: document });
  } catch (error) { respondError(res, error); }
};

export const getCustomerDebts = async (req, res) => {
  try {
    const docs = await ErpDocument.find({ type: "salesInvoice", isDebt: true }).sort({ documentDate: 1, createdAt: 1 });
    const paymentGroups = await ErpPayment.aggregate([
      { $unwind: "$allocations" },
      { $group: { _id: "$allocations.documentId", paid: { $sum: "$allocations.amount" } } },
    ]);
    const paidByDocument = new Map(paymentGroups.map((row) => [String(row._id), row.paid]));
    const customers = new Map();
    for (const document of docs) {
      const key = customerKeyOf(document.customerName);
      const balance = roundMoney(document.totalAmount + document.oldDebt - document.depositAmount - document.paidAmount - (paidByDocument.get(String(document._id)) || 0));
      const customer = customers.get(key) || {
        customerKey: key,
        customerName: document.customerName,
        customerPhone: document.customerPhone,
        balance: 0,
        invoiceCount: 0,
        invoices: [],
      };
      customer.balance = roundMoney(customer.balance + balance);
      customer.invoiceCount += 1;
      if (balance > 0) customer.invoices.push({
        _id: document._id,
        documentNumber: document.documentNumber,
        documentDate: document.documentDate,
        totalAmount: document.totalAmount,
        balance,
        isDebt: document.isDebt,
      });
      customers.set(key, customer);
    }
    const result = [...customers.values()].filter((customer) => customer.balance > 0.005).sort((a, b) => b.balance - a.balance);
    res.json({ success: true, data: result });
  } catch (error) { respondError(res, error); }
};

export const createErpCustomer = async (req, res) => {
  try {
    const { name, phone = "", address = "", note = "" } = req.body;
    if (!name?.trim()) throw new ErpError(400, "Tên khách hàng là bắt buộc");
    const customerKey = customerKeyOf(name);
    const customer = await ErpCustomer.create({ name: name.trim(), customerKey, phone, address, note });
    res.status(201).json({ success: true, data: customer });
  } catch (error) { respondError(res, error); }
};

export const getCustomerPayments = async (req, res) => {
  try {
    const key = req.params.customerKey;
    const payments = await ErpPayment.find({ customerKey: key }).sort({ paymentDate: -1 });
    res.json({ success: true, data: payments });
  } catch (error) { respondError(res, error); }
};

export const createCustomerPayment = async (req, res) => {
  try {
    const { customerName, customerPhone = "", amount, paymentDate, method = "bankTransfer", proofImageUrl = "", reference = "", note = "" } = req.body;
    if (!customerName?.trim() || !Number.isFinite(amount) || amount <= 0) throw new ErpError(400, "Khách hàng và số tiền thanh toán là bắt buộc");
    if (!["bankTransfer", "cash", "other"].includes(method)) throw new ErpError(400, "Phương thức thanh toán không hợp lệ");
    if (method === "bankTransfer" && !proofImageUrl.trim()) throw new ErpError(400, "Thanh toán chuyển khoản cần ảnh giao dịch");
    const date = parseMovementDate(paymentDate);
    const customerKey = customerKeyOf(customerName);

    const payment = await withErpTransaction(async (session) => {
      const escapedName = customerName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const invoices = await ErpDocument.find({
        type: "salesInvoice",
        isDebt: true,
        $or: [
          { customerKey },
          { customerName: { $regex: `^${escapedName}$`, $options: "i" } },
        ],
      })
        .sort({ documentDate: 1, createdAt: 1 })
        .session(session);
      const priorPayments = await ErpPayment.aggregate([
        { $unwind: "$allocations" },
        { $group: { _id: "$allocations.documentId", paid: { $sum: "$allocations.amount" } } },
      ]).session(session);
      const paidByDocument = new Map(priorPayments.map((row) => [String(row._id), row.paid]));
      let remaining = roundMoney(amount);
      const allocations = [];
      for (const invoice of invoices) {
        if (remaining <= 0) break;
        const outstanding = roundMoney(invoice.totalAmount + invoice.oldDebt - invoice.depositAmount - invoice.paidAmount - (paidByDocument.get(String(invoice._id)) || 0));
        if (outstanding <= 0) continue;
        const applied = Math.min(outstanding, remaining);
        allocations.push({ documentId: invoice._id, amount: applied });
        remaining = roundMoney(remaining - applied);
      }
      if (remaining > 0.005) throw new ErpError(409, "Số tiền thanh toán vượt quá dư nợ hiện tại");
      const [created] = await ErpPayment.create([{
        customerKey,
        customerName: customerName.trim(),
        customerPhone,
        amount: roundMoney(amount),
        paymentDate: date,
        method,
        proofImageUrl: method === "bankTransfer" ? proofImageUrl.trim() : "",
        reference,
        note,
        allocations,
        createdBy: movementActor,
      }], { session });
      return created;
    });

    res.status(201).json({ success: true, data: payment });
  } catch (error) { respondError(res, error); }
};
