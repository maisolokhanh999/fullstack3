import mongoose from "mongoose";
import { sendErpError } from "../../services/erpErrorHandler.js";
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
const isWalkInCustomer = (name) => name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("vi-VN").includes("khach le");

const respondError = (res, error, req) => sendErpError(res, error, req, error.code === 11000 ? "Dữ liệu bị trùng" : "Lỗi xử lý ERP");

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
  for (const field of ["oldDebt", "depositAmount", "paidAmount", "cashPaidAmount", "bankPaidAmount"]) {
    if (body[field] !== undefined && !validAmount(body[field])) throw new ErpError(400, "Thông tin thanh toán không hợp lệ");
  }
  if (body.paymentMethod !== undefined && !["bankTransfer", "cash", "mixed"].includes(body.paymentMethod)) throw new ErpError(400, "Phuong thuc thanh toan khong hop le");
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
      let sourceDocument = null;
      if (body.type === "stockIssue" && body.sourceDocumentId) {
        if (!mongoose.isValidObjectId(body.sourceDocumentId)) throw new ErpError(400, "Mã hóa đơn liên kết không hợp lệ");
        sourceDocument = await ErpDocument.findOne({ _id: body.sourceDocumentId, type: "salesInvoice" }).session(session);
        if (!sourceDocument) throw new ErpError(404, "Không tìm thấy hóa đơn gốc");
        const requestedLines = sourceDocument.requestedLines?.length ? sourceDocument.requestedLines : sourceDocument.lines;
        const invoiced = new Map();
        const shipped = new Map();
        const requested = new Map();
        for (const line of requestedLines) {
          const id = String(line.productId);
          invoiced.set(id, (invoiced.get(id) || 0) + line.quantity);
        }
        const previousIssues = await ErpDocument.find({ type: "stockIssue", sourceDocumentId: sourceDocument._id }).session(session);
        for (const issue of previousIssues) for (const line of issue.lines) {
          const id = String(line.productId);
          shipped.set(id, (shipped.get(id) || 0) + line.quantity);
        }
        for (const line of body.lines) {
          const id = String(line.productId);
          requested.set(id, (requested.get(id) || 0) + line.quantity);
        }
        for (const [id, quantity] of requested) {
          if (quantity > (invoiced.get(id) || 0) - (shipped.get(id) || 0) + 0.000001) {
            throw new ErpError(409, "Số lượng xuất vượt quá số lượng còn lại trên hóa đơn");
          }
        }
      }
      if (productById.size !== productIds.length) throw new ErpError(404, "Không tìm thấy một hoặc nhiều sản phẩm đang hoạt động");

      const lines = body.lines.map((line) => {
        const product = productById.get(String(line.productId));
        const quantity = line.quantity;
        const unitPrice = body.type === "salesInvoice"
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
        sourceDocumentId: sourceDocument?._id || null,
        sourceDocumentNumber: sourceDocument?.documentNumber || "",
        requestedLines: body.type === "salesInvoice" ? lines : [],
        fulfillmentStatus: body.type === "salesInvoice" ? "pending" : undefined,
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
        paymentMethod: body.type === "salesInvoice" ? body.paymentMethod || "cash" : "cash",
        cashPaidAmount: body.type === "salesInvoice" ? body.cashPaidAmount ?? 0 : 0,
        bankPaidAmount: body.type === "salesInvoice" ? body.bankPaidAmount ?? 0 : 0,
        paidAmount: body.type === "salesInvoice" ? body.paidAmount ?? 0 : 0,
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

      if (sourceDocument && body.type === "stockIssue") {
        const priorIssues = await ErpDocument.find({ type: "stockIssue", sourceDocumentId: sourceDocument._id }).session(session);
        const shippedByProduct = new Map();
        for (const issue of priorIssues) for (const line of issue.lines) {
          const id = String(line.productId);
          shippedByProduct.set(id, (shippedByProduct.get(id) || 0) + line.quantity);
        }
        const requestedLines = sourceDocument.requestedLines?.length ? sourceDocument.requestedLines : sourceDocument.lines;
        const remainingByProduct = new Map();
        const invoicedByProduct = new Map();
        for (const line of requestedLines) {
          const id = String(line.productId);
          invoicedByProduct.set(id, (invoicedByProduct.get(id) || 0) + line.quantity);
        }
        for (const [id, quantity] of invoicedByProduct) remainingByProduct.set(id, Math.max(0, quantity - (shippedByProduct.get(id) || 0)));
        const syncedLines = requestedLines.flatMap((line) => {
          const id = String(line.productId);
          const remaining = remainingByProduct.get(id) || 0;
          const quantity = Math.min(line.quantity, remaining);
          remainingByProduct.set(id, Math.max(0, remaining - quantity));
          if (!quantity) return [];
          const weight = Math.round((quantity * (productById.get(id)?.weightPerUnit || 0) + Number.EPSILON) * 1000) / 1000;
          const unitPrice = line.unitPrice || 0;
          return [{ ...line.toObject?.() || line, quantity, unitPrice, amount: roundMoney(quantity * unitPrice), weight }];
        });
        const requestedTotal = [...invoicedByProduct.values()].reduce((sum, quantity) => sum + quantity, 0);
        const shippedTotal = [...shippedByProduct.values()].reduce((sum, quantity) => sum + quantity, 0);
        const totalAmount = roundMoney(syncedLines.reduce((sum, line) => sum + line.amount, 0));
        const totalWeight = Math.round((syncedLines.reduce((sum, line) => sum + line.weight, 0) + Number.EPSILON) * 1000) / 1000;
        const cashPaidAmount = body.cashPaidAmount ?? 0;
        const bankPaidAmount = body.bankPaidAmount ?? 0;
        const paymentAmount = roundMoney(cashPaidAmount + bankPaidAmount);
        const paymentMethod = body.paymentMethod || sourceDocument.paymentMethod || "cash";
        const previouslyPaid = sourceDocument.fulfillmentStatus === "pending" ? 0 : sourceDocument.paidAmount;
        const outstanding = roundMoney(Math.max(0, totalAmount + sourceDocument.oldDebt - sourceDocument.depositAmount - previouslyPaid - (sourceDocument.debtResetAmount || 0)));
        if (paymentAmount > 0 && paymentMethod === "mixed" && (!cashPaidAmount || !bankPaidAmount)) throw new ErpError(400, "Thanh toán kết hợp cần có cả tiền mặt và chuyển khoản");
        if ((paymentMethod === "cash" && bankPaidAmount > 0) || (paymentMethod === "bankTransfer" && cashPaidAmount > 0)) throw new ErpError(400, "Số tiền không khớp hình thức thanh toán đã chọn");
        if (paymentAmount > outstanding + 0.005) throw new ErpError(400, "Tiền thanh toán vượt quá số còn phải trả sau khi trừ tiền cọc");
        if (!sourceDocument.isDebt && paymentAmount + 0.005 < outstanding) throw new ErpError(400, "Cần thanh toán đủ số còn lại sau khi trừ tiền cọc để chốt hóa đơn");
        sourceDocument.lines = syncedLines;
        sourceDocument.totalAmount = totalAmount;
        sourceDocument.totalWeight = totalWeight;
        sourceDocument.fulfillmentStatus = shippedTotal >= requestedTotal - 0.000001 ? "complete" : "partial";
        sourceDocument.paymentMethod = paymentMethod;
        sourceDocument.cashPaidAmount += cashPaidAmount;
        sourceDocument.bankPaidAmount += bankPaidAmount;
        sourceDocument.paidAmount = previouslyPaid + paymentAmount;
        await sourceDocument.save({ session });

        if (paymentAmount > 0 && isWalkInCustomer(sourceDocument.customerName)) {
          const walkInDebts = await ErpDocument.find({
            type: "salesInvoice",
            isDebt: true,
            fulfillmentStatus: { $ne: "pending" },
            customerKey: sourceDocument.customerKey,
          }).session(session);
          const invoiceIds = walkInDebts.map((invoice) => invoice._id);
          const paymentGroups = invoiceIds.length ? await ErpPayment.aggregate([
            { $unwind: "$allocations" },
            { $match: { "allocations.documentId": { $in: invoiceIds } } },
            { $group: { _id: "$allocations.documentId", paid: { $sum: "$allocations.amount" } } },
          ]).session(session) : [];
          const paidByInvoice = new Map(paymentGroups.map((row) => [String(row._id), row.paid]));
          for (const invoice of walkInDebts) {
            const balance = roundMoney(Math.max(0, invoice.totalAmount + invoice.oldDebt - invoice.depositAmount - invoice.paidAmount - (invoice.debtResetAmount || 0) - (paidByInvoice.get(String(invoice._id)) || 0)));
            if (balance > 0.005) {
              invoice.debtResetAmount = roundMoney((invoice.debtResetAmount || 0) + balance);
              await invoice.save({ session });
            }
          }
        }
      }

      for (const productId of affectedProductIds) await rebuildProductStock(productId, session);
      await createdDocument.save({ session });
      return createdDocument;
    });

    res.status(201).json({ success: true, data: document });
  } catch (error) { respondError(res, error, req); }
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
    if (req.query.sourceDocumentId) {
      if (!mongoose.isValidObjectId(req.query.sourceDocumentId)) throw new ErpError(400, "Mã hóa đơn liên kết không hợp lệ");
      filter.sourceDocumentId = req.query.sourceDocumentId;
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
  } catch (error) { respondError(res, error, req); }
};

export const getErpDocument = async (req, res) => {
  try {
    const document = await ErpDocument.findOne({
      $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { documentNumber: req.params.id.toUpperCase() }],
    });
    if (!document) throw new ErpError(404, "Không tìm thấy chứng từ");
    res.json({ success: true, data: document });
  } catch (error) { respondError(res, error, req); }
};

export const getCustomerDebts = async (req, res) => {
  try {
    const docs = await ErpDocument.find({ type: "salesInvoice", isDebt: true, fulfillmentStatus: { $ne: "pending" } }).sort({ documentDate: 1, createdAt: 1 });
    const paymentGroups = await ErpPayment.aggregate([
      { $unwind: "$allocations" },
      { $group: { _id: "$allocations.documentId", paid: { $sum: "$allocations.amount" } } },
    ]);
    const paidByDocument = new Map(paymentGroups.map((row) => [String(row._id), row.paid]));
    const customers = new Map();
    for (const document of docs) {
      const key = customerKeyOf(document.customerName);
      const balance = roundMoney(document.totalAmount + document.oldDebt - document.depositAmount - document.paidAmount - (document.debtResetAmount || 0) - (paidByDocument.get(String(document._id)) || 0));
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
  } catch (error) { respondError(res, error, req); }
};

export const createErpCustomer = async (req, res) => {
  try {
    const { name, phone = "", address = "", note = "" } = req.body;
    if (!name?.trim()) throw new ErpError(400, "Tên khách hàng là bắt buộc");
    const customerKey = customerKeyOf(name);
    const customer = await ErpCustomer.create({ name: name.trim(), customerKey, phone, address, note });
    res.status(201).json({ success: true, data: customer });
  } catch (error) { respondError(res, error, req); }
};

export const getErpCustomers = async (_req, res) => {
  try {
    const customers = await ErpCustomer.find().sort({ name: 1 }).limit(1000);
    res.json({ success: true, data: customers });
  } catch (error) { respondError(res, error, _req); }
};

export const getCustomerPayments = async (req, res) => {
  try {
    const key = req.params.customerKey;
    const payments = await ErpPayment.find({ customerKey: key }).sort({ paymentDate: -1 });
    res.json({ success: true, data: payments });
  } catch (error) { respondError(res, error, req); }
};

export const createCustomerPayment = async (req, res) => {
  try {
    const { customerName, customerPhone = "", amount, paymentDate, method = "bankTransfer", proofImageUrl = "", proofImageUrls = [], reference = "", note = "" } = req.body;
    if (!customerName?.trim() || !Number.isFinite(amount) || amount <= 0) throw new ErpError(400, "Khách hàng và số tiền thanh toán là bắt buộc");
    if (!["bankTransfer", "cash", "other"].includes(method)) throw new ErpError(400, "Phương thức thanh toán không hợp lệ");
    const proofUrls = (Array.isArray(proofImageUrls) ? proofImageUrls : []).filter((url) => typeof url === "string" && url.trim()).map((url) => url.trim());
    if (!proofUrls.length && proofImageUrl.trim()) proofUrls.push(proofImageUrl.trim());
    if (method === "bankTransfer" && !proofUrls.length) throw new ErpError(400, "Thanh toán chuyển khoản cần ít nhất một ảnh giao dịch");
    const date = parseMovementDate(paymentDate);
    const customerKey = customerKeyOf(customerName);

    const payment = await withErpTransaction(async (session) => {
      const escapedName = customerName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const invoices = await ErpDocument.find({
        type: "salesInvoice",
        isDebt: true,
        fulfillmentStatus: { $ne: "pending" },
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
        const outstanding = roundMoney(invoice.totalAmount + invoice.oldDebt - invoice.depositAmount - invoice.paidAmount - (invoice.debtResetAmount || 0) - (paidByDocument.get(String(invoice._id)) || 0));
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
        proofImageUrl: method === "bankTransfer" ? proofUrls[0] : "",
        proofImageUrls: method === "bankTransfer" ? proofUrls : [],
        reference,
        note,
        allocations,
        createdBy: movementActor,
      }], { session });
      return created;
    });

    res.status(201).json({ success: true, data: payment });
  } catch (error) { respondError(res, error, req); }
};
