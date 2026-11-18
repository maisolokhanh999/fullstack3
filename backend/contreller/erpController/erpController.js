import ExcelJS from "exceljs";
import mongoose from "mongoose";
import ErpProduct from "../../model/erpProduct.js";
import ErpMovement from "../../model/erpMovement.js";
import {
  buildMovementFilter,
  ErpError,
  isMovementType,
  parseMovementDate,
  rebuildProductStock,
  validateMovement,
  validateWarehouse,
  withErpTransaction,
} from "../../services/erpInventoryService.js";

const movementActor = process.env.ERP_ACTOR_NAME || "erp-api";

const respondError = (res, error) => {
  if (error.status) return res.status(error.status).json({ success: false, message: error.message });
  if (error.code === 11000) return res.status(409).json({ success: false, message: "Mã SKU đã tồn tại" });
  console.error(error);
  return res.status(500).json({ success: false, message: "Lỗi xử lý dữ liệu ERP" });
};

export const getProducts = async (req, res) => {
  try {
    const { keyword = "", category, isActive } = req.query;
    const filter = { isDeleted: false };
    if (category) filter.category = category;
    if (isActive !== undefined) filter.isActive = isActive === "true";
    if (keyword.trim()) {
      const safeKeyword = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: safeKeyword, $options: "i" } },
        { sku: { $regex: safeKeyword, $options: "i" } },
      ];
    }
    const products = await ErpProduct.find(filter).sort({ name: 1 }).limit(500);
    res.json({ success: true, data: products });
  } catch (error) { respondError(res, error); }
};

export const createProduct = async (req, res) => {
  try {
    if (["currentStock", "openingStock", "stock"].some((field) => Object.hasOwn(req.body, field))) {
      throw new ErpError(400, "Tồn kho chỉ được thay đổi bằng phiếu nhập hoặc kiểm kê");
    }
    const product = await ErpProduct.create({
      sku: req.body.sku,
      name: req.body.name,
      category: req.body.category,
      unit: req.body.unit || "cái",
      description: req.body.description,
      salePrice: req.body.salePrice ?? 0,
      storePrice: req.body.storePrice ?? 0,
      weightPerUnit: req.body.weightPerUnit ?? 0,
      reorderLevel: req.body.reorderLevel ?? 0,
      isActive: req.body.isActive ?? true,
    });
    res.status(201).json({ success: true, data: product });
  } catch (error) { respondError(res, error); }
};

export const getProduct = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ErpError(400, "Mã sản phẩm không hợp lệ");
    const product = await ErpProduct.findOne({ _id: req.params.id, isDeleted: false });
    if (!product) throw new ErpError(404, "Không tìm thấy sản phẩm");
    res.json({ success: true, data: product });
  } catch (error) { respondError(res, error); }
};

export const updateProduct = async (req, res) => {
  try {
    if (["currentStock", "openingStock", "stock"].some((field) => Object.hasOwn(req.body, field))) {
      throw new ErpError(400, "Tồn kho chỉ được thay đổi bằng phiếu nhập hoặc kiểm kê");
    }
    const allowed = ["sku", "name", "category", "unit", "description", "salePrice", "storePrice", "weightPerUnit", "reorderLevel", "isActive"];
    const update = Object.fromEntries(allowed.filter((field) => Object.hasOwn(req.body, field)).map((field) => [field, req.body[field]]));
    if (!Object.keys(update).length) throw new ErpError(400, "Không có thông tin sản phẩm cần cập nhật");
    const product = await ErpProduct.findOneAndUpdate(
      { _id: req.params.id, isDeleted: false },
      update,
      { new: true, runValidators: true }
    );
    if (!product) throw new ErpError(404, "Không tìm thấy sản phẩm");
    res.json({ success: true, data: product });
  } catch (error) { respondError(res, error); }
};

export const deleteProduct = async (req, res) => {
  try {
    const product = await ErpProduct.findOne({ _id: req.params.id, isDeleted: false });
    if (!product) throw new ErpError(404, "Không tìm thấy sản phẩm");
    if (product.currentStock !== 0) throw new ErpError(409, "Chỉ có thể ngừng sản phẩm khi tồn kho bằng 0");
    product.isDeleted = true;
    await product.save();
    res.json({ success: true, data: product });
  } catch (error) { respondError(res, error); }
};

export const createMovement = async (req, res) => {
  try {
    const { productId, type, quantity, customerName = "", imageUrl = "", reference = "", note = "", warehouse = "thanh-phu" } = req.body;
    if (!mongoose.isValidObjectId(productId)) throw new ErpError(400, "Mã sản phẩm không hợp lệ");
    validateMovement({ type, quantity, customerName, imageUrl });
    validateWarehouse(warehouse);
    const movementDate = parseMovementDate(req.body.movementDate);
    const movement = await withErpTransaction(async (session) => {
      const product = await ErpProduct.findOne({ _id: productId, isDeleted: false, isActive: true }).session(session);
      if (!product) throw new ErpError(404, "Không tìm thấy sản phẩm đang hoạt động");
      const [created] = await ErpMovement.create([{
        productId: product._id,
        warehouse,
        productName: product.name,
        sku: product.sku,
        type,
        quantity,
        stockBefore: 0,
        stockAfter: 0,
        customerName: type === "issue" ? customerName.trim() : "",
        imageUrl: type === "issue" ? imageUrl.trim() : "",
        reference,
        note,
        movementDate,
        createdBy: movementActor,
      }], { session });
      await rebuildProductStock(product._id, session);
      return ErpMovement.findById(created._id).session(session);
    });
    res.status(201).json({ success: true, data: movement });
  } catch (error) { respondError(res, error); }
};

export const createReceiptBatch = async (req, res) => {
  try {
    const { lines, movementDate, reference = "", note = "", warehouse = "thanh-phu" } = req.body;
    if (!Array.isArray(lines) || lines.length < 1 || lines.length > 200) {
      throw new ErpError(400, "Phiếu nhập cần từ 1 đến 200 mặt hàng");
    }
    const date = parseMovementDate(movementDate);
    validateWarehouse(warehouse);
    for (const line of lines) {
      if (!mongoose.isValidObjectId(line.productId)) throw new ErpError(400, "Có sản phẩm không hợp lệ trong danh sách");
      validateMovement({ type: "receipt", quantity: line.quantity });
    }

    const batchReference = reference.trim() || `PN-${Date.now()}`;
    const movements = await withErpTransaction(async (session) => {
      const productIds = [...new Set(lines.map((line) => String(line.productId)))];
      const products = await ErpProduct.find({ _id: { $in: productIds }, isDeleted: false, isActive: true }).session(session);
      const productById = new Map(products.map((product) => [String(product._id), product]));
      if (productById.size !== productIds.length) throw new ErpError(404, "Không tìm thấy một hoặc nhiều sản phẩm đang hoạt động");

      const createdMovements = [];
      const affectedProductIds = new Set();
      for (const line of lines) {
        const product = productById.get(String(line.productId));
        const [movement] = await ErpMovement.create([{
          productId: product._id,
          warehouse: line.warehouse || warehouse,
          productName: product.name,
          sku: product.sku,
          type: "receipt",
          quantity: line.quantity,
          stockBefore: 0,
          stockAfter: 0,
          reference: batchReference,
          note: line.note?.trim() || note.trim(),
          movementDate: date,
          createdBy: movementActor,
        }], { session });
        createdMovements.push(movement);
        affectedProductIds.add(String(product._id));
      }

      for (const productId of affectedProductIds) await rebuildProductStock(productId, session);
      return ErpMovement.find({ _id: { $in: createdMovements.map((movement) => movement._id) } }).session(session);
    });

    res.status(201).json({ success: true, reference: batchReference, data: movements });
  } catch (error) { respondError(res, error); }
};

export const updateMovement = async (req, res) => {
  try {
    const movement = await withErpTransaction(async (session) => {
      const existing = await ErpMovement.findById(req.params.id).session(session);
      if (!existing) throw new ErpError(404, "Không tìm thấy chứng từ kho");

      const oldProductId = String(existing.productId);
      const productId = req.body.productId ?? oldProductId;
      if (!mongoose.isValidObjectId(productId)) throw new ErpError(400, "Mã sản phẩm không hợp lệ");
      const product = await ErpProduct.findOne({ _id: productId, isDeleted: false, isActive: true }).session(session);
      if (!product) throw new ErpError(404, "Không tìm thấy sản phẩm đang hoạt động");

      const next = {
        productId: product._id,
        warehouse: req.body.warehouse ?? existing.warehouse ?? "thanh-phu",
        type: req.body.type ?? existing.type,
        quantity: req.body.quantity ?? existing.quantity,
        customerName: req.body.customerName ?? existing.customerName,
        imageUrl: req.body.imageUrl ?? existing.imageUrl,
        reference: req.body.reference ?? existing.reference,
        note: req.body.note ?? existing.note,
      };
      validateMovement(next);
      validateWarehouse(next.warehouse);
      existing.productId = product._id;
      existing.warehouse = next.warehouse;
      existing.productName = product.name;
      existing.sku = product.sku;
      existing.type = next.type;
      existing.quantity = next.quantity;
      existing.customerName = next.type === "issue" ? next.customerName.trim() : "";
      existing.imageUrl = next.type === "issue" ? next.imageUrl.trim() : "";
      existing.reference = next.reference;
      existing.note = next.note;
      if (Object.hasOwn(req.body, "movementDate")) existing.movementDate = parseMovementDate(req.body.movementDate);
      existing.updatedBy = movementActor;
      await existing.save({ session });

      await rebuildProductStock(oldProductId, session);
      if (String(product._id) !== oldProductId) await rebuildProductStock(product._id, session);
      return ErpMovement.findById(existing._id).session(session);
    });
    res.json({ success: true, data: movement });
  } catch (error) { respondError(res, error); }
};

export const getMovements = async (req, res) => {
  try {
    const filter = buildMovementFilter(req.query);
    const movements = await ErpMovement.find(filter)
      .sort({ movementDate: -1, createdAt: -1 })
      .limit(500);
    res.json({ success: true, data: movements });
  } catch (error) { respondError(res, error); }
};

export const getShippedProducts = async (req, res) => {
  try {
    const filter = buildMovementFilter({ ...req.query, type: "issue" });
    const shipments = await ErpMovement.find(filter)
      .sort({ movementDate: -1 })
      .limit(500);
    res.json({ success: true, data: shipments });
  } catch (error) { respondError(res, error); }
};

export const getProductMovements = async (req, res) => {
  try {
    const filter = buildMovementFilter({ ...req.query, productId: req.params.id });
    const movements = await ErpMovement.find(filter).sort({ movementDate: -1, createdAt: -1 }).limit(500);
    res.json({ success: true, data: movements });
  } catch (error) { respondError(res, error); }
};

export const exportMovements = async (req, res) => {
  try {
    if (req.query.year === undefined || req.query.month === undefined) {
      throw new ErpError(400, "Vui lòng chọn tháng và năm xuất báo cáo");
    }
    const filter = buildMovementFilter(req.query);
    const movements = await ErpMovement.find(filter).sort({ movementDate: 1, createdAt: 1 });
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "ERP Inventory";
    const sheet = workbook.addWorksheet("So kho");
    sheet.columns = [
      { header: "Ngày giờ", key: "date", width: 22 },
      { header: "Loại chứng từ", key: "type", width: 18 },
      { header: "Mã SKU", key: "sku", width: 18 },
      { header: "Tên sản phẩm", key: "name", width: 32 },
      { header: "Số lượng", key: "quantity", width: 14 },
      { header: "Tồn trước", key: "before", width: 14 },
      { header: "Tồn sau", key: "after", width: 14 },
      { header: "Khách hàng", key: "customer", width: 24 },
      { header: "Ảnh xuất hàng", key: "image", width: 52 },
      { header: "Mã tham chiếu", key: "reference", width: 20 },
      { header: "Đơn giá", key: "unitPrice", width: 16 },
      { header: "Loại giá", key: "priceType", width: 14 },
      { header: "Thành tiền", key: "amount", width: 18 },
      { header: "Ghi chú", key: "note", width: 36 },
    ];
    sheet.addRows(movements.map((item) => ({
      date: item.movementDate,
      type: { receipt: "Nhập", issue: "Xuất", stocktake: "Kiểm kê" }[item.type],
      sku: item.sku,
      name: item.productName,
      quantity: item.quantity,
      before: item.stockBefore,
      after: item.stockAfter,
      customer: item.customerName,
      image: item.imageUrl,
      reference: item.reference,
      unitPrice: item.unitPrice,
      priceType: item.priceType || "retail",
      amount: item.quantity * item.unitPrice,
      note: item.note,
    })));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF263C35" } };
    sheet.getColumn("date").numFmt = "dd/mm/yyyy hh:mm";
    sheet.autoFilter = { from: "A1", to: "N1" };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=erp-inventory-${req.query.year}-${String(req.query.month).padStart(2, "0")}.xlsx`);
    res.send(Buffer.from(buffer));
  } catch (error) { respondError(res, error); }
};

