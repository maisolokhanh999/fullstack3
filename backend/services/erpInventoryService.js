import mongoose from "mongoose";
import ErpProduct from "../model/erpProduct.js";
import ErpMovement from "../model/erpMovement.js";

export class ErpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const isMovementType = (type) => ["receipt", "issue", "stocktake"].includes(type);
export const WAREHOUSES = ["thanh-phu", "duc-hoa", "ben-luc"];
export const validateWarehouse = (warehouse) => {
  if (!WAREHOUSES.includes(warehouse)) throw new ErpError(400, "Kho không hợp lệ");
  return warehouse;
};

export const parseMovementDate = (value) => {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new ErpError(400, "Ngày chứng từ không hợp lệ");
  return date;
};

export const validateMovement = ({ type, quantity, customerName, imageUrl }) => {
  if (!isMovementType(type)) throw new ErpError(400, "Loại chứng từ không hợp lệ");
  if (!Number.isFinite(quantity) || quantity < 0 || Math.round(quantity * 1000) !== quantity * 1000 || (type !== "stocktake" && quantity === 0)) {
    throw new ErpError(400, "Số lượng phải hợp lệ và tối đa 3 chữ số thập phân");
  }
  if (type === "issue" && (!customerName?.trim() || !imageUrl?.trim())) {
    throw new ErpError(400, "Phiếu xuất cần tên khách hàng và ảnh minh họa");
  }
};

export const buildMonthRange = (yearValue, monthValue) => {
  if (yearValue === undefined && monthValue === undefined) return null;
  const year = Number(yearValue);
  const month = Number(monthValue);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new ErpError(400, "Tháng hoặc năm lọc không hợp lệ");
  }
  const vietnamOffset = 7 * 60 * 60 * 1000;
  return {
    $gte: new Date(Date.UTC(year, month - 1, 1) - vietnamOffset),
    $lt: new Date(Date.UTC(year, month, 1) - vietnamOffset),
  };
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const buildMovementFilter = ({ year, month, dateFrom, dateTo, productName, productId, type, warehouse }) => {
  const filter = {};
  let range;
  if (dateFrom || dateTo) {
    const parseLocalDate = (value) => {
      if (!value) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ErpError(400, "Khoảng ngày lọc không hợp lệ");
      const date = new Date(`${value}T00:00:00+07:00`);
      if (Number.isNaN(date.getTime())) throw new ErpError(400, "Khoảng ngày lọc không hợp lệ");
      const localDate = new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
      if (localDate !== value) throw new ErpError(400, "Khoảng ngày lọc không hợp lệ");
      return date;
    };
    const from = parseLocalDate(dateFrom);
    const to = parseLocalDate(dateTo);
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      throw new ErpError(400, "Khoảng ngày lọc không hợp lệ");
    }
    if (from && to && from > to) throw new ErpError(400, "Ngày bắt đầu không thể sau ngày kết thúc");
    range = {};
    if (from) range.$gte = from;
    if (to) range.$lt = new Date(to.getTime() + 24 * 60 * 60 * 1000);
  } else {
    range = buildMonthRange(year, month);
  }
  if (range) filter.movementDate = range;
  if (warehouse) filter.warehouse = validateWarehouse(warehouse);
  if (productName?.trim()) {
    const productPattern = { $regex: escapeRegex(productName.trim()), $options: "i" };
    filter.$or = [{ productName: productPattern }, { sku: productPattern }];
  }
  if (productId) {
    if (!mongoose.isValidObjectId(productId)) throw new ErpError(400, "Mã sản phẩm không hợp lệ");
    filter.productId = productId;
  }
  if (type) {
    if (!isMovementType(type)) throw new ErpError(400, "Loại chứng từ không hợp lệ");
    filter.type = type;
  }
  return filter;
};

export const rebuildProductStock = async (productId, session) => {
  const product = await ErpProduct.findById(productId).session(session);
  if (!product) throw new ErpError(404, "Không tìm thấy sản phẩm");
  const movements = await ErpMovement.find({ productId })
    .sort({ movementDate: 1, createdAt: 1, _id: 1 })
    .session(session);
  const stocks = Object.fromEntries(WAREHOUSES.map((warehouse) => [warehouse, 0]));
  const operations = [];

  for (const movement of movements) {
    const warehouse = movement.warehouse || "thanh-phu";
    const stockBefore = stocks[warehouse] || 0;
    let stock = stockBefore;
    if (movement.type === "receipt") stock += movement.quantity;
    else if (movement.type === "issue") stock -= movement.quantity;
    else stock = movement.quantity;
    if (stock < 0) throw new ErpError(409, `Kho ${warehouse} không đủ tồn cho ${product.name}`);
    stocks[warehouse] = stock;
    if (movement.stockBefore !== stockBefore || movement.stockAfter !== stock) {
      operations.push({
        updateOne: {
          filter: { _id: movement._id },
          update: { $set: { stockBefore, stockAfter: stock } },
        },
      });
    }
  }

  if (operations.length) await ErpMovement.bulkWrite(operations, { session });
  product.warehouseStocks = stocks;
  product.currentStock = Object.values(stocks).reduce((sum, value) => sum + value, 0);
  await product.save({ session });
  return product;
};

export const withErpTransaction = async (operation) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await operation(session); });
    return result;
  } finally {
    await session.endSession();
  }
};
