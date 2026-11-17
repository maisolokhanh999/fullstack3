import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import ErpProduct from "../model/erpProduct.js";
import ErpMovement from "../model/erpMovement.js";
import ErpDocument from "../model/erpDocument.js";
import ErpPayment from "../model/erpPayment.js";
import erpRoutes from "../router/erpRoutes.js";

const app = express();
app.use(express.json());
app.use("/erp", erpRoutes);
let mongo, product;
const auth = {};

before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([ErpProduct, ErpMovement, ErpDocument, ErpPayment].map((model) => model.init()));
});
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
  product = await ErpProduct.create({ sku: "COFFEE-01", name: "Ca phe rang", unit: "kg" });
});

test("ERP receipts, issues and stocktakes maintain an editable chronological ledger", async () => {
  await request(app).get("/erp/products").expect(200);

  await request(app).post("/erp/movements").set(auth).send({
    productId: product._id, type: "receipt", quantity: 20, movementDate: "2026-03-01T10:00:00+07:00",
  }).expect(201);
  const issue = await request(app).post("/erp/movements").set(auth).send({
    productId: product._id, type: "issue", quantity: 5, customerName: "Nguyen An",
    imageUrl: "https://example.invalid/shipment.jpg", movementDate: "2026-03-02T10:00:00+07:00",
  }).expect(201);
  await request(app).post("/erp/movements").set(auth).send({
    productId: product._id, type: "stocktake", quantity: 12, movementDate: "2026-03-03T10:00:00+07:00",
  }).expect(201);

  const correction = await request(app).put(`/erp/movements/${issue.body.data._id}`).set(auth).send({ quantity: 4 }).expect(200);
  assert.equal(correction.body.data.quantity, 4);
  assert.equal((await ErpProduct.findById(product._id)).currentStock, 12);
  const ledger = await ErpMovement.find({ productId: product._id }).sort({ movementDate: 1 });
  assert.deepEqual(ledger.map(({ stockBefore, stockAfter }) => [stockBefore, stockAfter]), [[0, 20], [20, 16], [16, 12]]);

  await request(app).post("/erp/movements").set(auth).send({
    productId: product._id, type: "issue", quantity: 20, customerName: "Nguyen An",
    imageUrl: "https://example.invalid/large.jpg", movementDate: "2026-03-04T10:00:00+07:00",
  }).expect(409);
  assert.equal((await ErpProduct.findById(product._id)).currentStock, 12);
  assert.equal(await ErpMovement.countDocuments({ productId: product._id }), 3);
  const productEdit = await request(app).put(`/erp/products/${product._id}`).set(auth).send({ name: "Ca phe Arabica", reorderLevel: 3 }).expect(200);
  assert.equal(productEdit.body.data.name, "Ca phe Arabica");
  await request(app).put(`/erp/products/${product._id}`).set(auth).send({ currentStock: 999 }).expect(400);
  const found = await request(app).get("/erp/products?keyword=arabica").set(auth).expect(200);
  assert.equal(found.body.data[0]._id, String(product._id));
  const created = await request(app).post("/erp/products").set(auth).send({ sku: "CLEAN-001", name: "Nuoc rua chen", unit: "chai" }).expect(201);
  assert.equal(created.body.data.currentStock, 0);
});

test("ERP shipment queries and monthly workbook return matching product records", async () => {
  await ErpMovement.create([
    { productId: product._id, productName: product.name, sku: product.sku, type: "issue", quantity: 2, stockBefore: 8, stockAfter: 6, customerName: "Le Mai", imageUrl: "https://example.invalid/ship.jpg", movementDate: new Date("2026-03-10T03:00:00Z") },
    { productId: product._id, productName: "Nuoc rua chen", sku: "CLEAN-1", type: "issue", quantity: 1, stockBefore: 4, stockAfter: 3, movementDate: new Date("2026-03-11T03:00:00Z") },
    { productId: product._id, productName: product.name, sku: product.sku, type: "receipt", quantity: 6, stockBefore: 2, stockAfter: 8, movementDate: new Date("2026-04-01T03:00:00Z") },
  ]);

  const shipped = await request(app).get("/erp/exports?year=2026&month=3&productName=ca%20phe").set(auth).expect(200);
  assert.equal(shipped.body.data.length, 1);
  assert.equal(shipped.body.data[0].customerName, "Le Mai");
  await request(app).get("/erp/exports?year=2026&month=13").set(auth).expect(400);

  const workbook = await request(app).get("/erp/export.xlsx?year=2026&month=3").set(auth)
    .buffer(true)
    .parse((response, callback) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => callback(null, Buffer.concat(chunks)));
    })
    .expect(200);
  assert.match(workbook.headers["content-type"], /spreadsheetml\.sheet/);
  assert.match(workbook.headers["content-disposition"], /erp-inventory-2026-03\.xlsx/);
  assert.equal(workbook.body.subarray(0, 2).toString(), "PK");
});

test("sales invoices and warehouse issue slips save multiple lines and post stock atomically", async () => {
  await ErpProduct.findByIdAndUpdate(product._id, { salePrice: 120000, weightPerUnit: 0.25 });
  const second = await ErpProduct.create({ sku: "CUP-02", name: "Ly giay", unit: "cái", salePrice: 2500 });
  await request(app).post("/erp/movements").send({
    productId: product._id, type: "receipt", quantity: 20, movementDate: "2026-03-01T10:00:00+07:00",
  }).expect(201);
  await request(app).post("/erp/movements").send({
    productId: second._id, type: "receipt", quantity: 50, movementDate: "2026-03-01T10:00:00+07:00",
  }).expect(201);

  const invoice = await request(app).post("/erp/documents").send({
    type: "salesInvoice",
    documentNumber: "HD-2026-0001",
    documentDate: "2026-03-05T12:00:00+07:00",
    customerName: "Nguyen An",
    customerPhone: "0901234567",
    customerAddress: "Duc Hoa",
    oldDebt: 10000,
    paidAmount: 20000,
    paymentInWords: "Hai muoi nghin dong",
    lines: [
      { productId: product._id, quantity: 1.25 },
      { productId: second._id, quantity: 2 },
    ],
  }).expect(201);

  assert.equal(invoice.body.data.totalAmount, 155000);
  assert.equal(invoice.body.data.lines.length, 2);
  assert.equal(invoice.body.data.paidAmount, 165000);
  assert.equal(invoice.body.data.isDebt, false);
  assert.equal((await ErpProduct.findById(product._id)).currentStock, 18.75);
  assert.equal((await ErpProduct.findById(second._id)).currentStock, 48);

  const issue = await request(app).post("/erp/documents").send({
    type: "stockIssue",
    documentNumber: "PX-2026-0001",
    documentDate: "2026-03-06T12:00:00+07:00",
    customerName: "Cong ty Minh Phat",
    deliveryAddress: "Long An",
    totalWeight: 0,
    lines: [{ productId: second._id, quantity: 3.5, packageNote: "2 thung", weight: 12.75 }],
  }).expect(201);
  assert.equal(issue.body.data.totalWeight, 12.75);
  assert.equal((await ErpProduct.findById(second._id)).currentStock, 44.5);
  assert.equal(await ErpMovement.countDocuments({ documentId: issue.body.data._id }), 1);
  const weightFallback = await request(app).post("/erp/documents").send({
    type: "stockIssue", documentNumber: "PX-WEIGHT", documentDate: "2026-03-06T14:00:00+07:00",
    customerName: "Cong ty Minh Phat", lines: [{ productId: product._id, quantity: 4 }],
  }).expect(201);
  assert.equal(weightFallback.body.data.lines[0].weight, 1);

  const reloaded = await request(app).get(`/erp/documents/${invoice.body.data._id}`).expect(200);
  assert.equal(reloaded.body.data.documentNumber, "HD-2026-0001");
  const list = await request(app).get("/erp/documents?year=2026&month=3&type=stockIssue").expect(200);
  assert.equal(list.body.data.length, 2);

  await request(app).post("/erp/documents").send({
    type: "stockIssue", documentNumber: "PX-OVER", documentDate: "2026-03-07T12:00:00+07:00",
    customerName: "Test", lines: [{ productId: second._id, quantity: 1000 }],
  }).expect(409);
  assert.equal(await ErpDocument.countDocuments({ documentNumber: "PX-OVER" }), 0);
  assert.equal((await ErpProduct.findById(second._id)).currentStock, 44.5);
});

test("credit invoices use selected price tier and customer payment reduces debt with transfer proof", async () => {
  await ErpProduct.findByIdAndUpdate(product._id, { salePrice: 125, storePrice: 90 });
  await request(app).post("/erp/movements").send({
    productId: product._id, type: "receipt", quantity: 20, movementDate: "2026-03-01T10:00:00+07:00",
  }).expect(201);

  const credit = await request(app).post("/erp/documents").send({
    type: "salesInvoice",
    documentNumber: "HD-DEBT-01",
    documentDate: "2026-03-05T12:00:00+07:00",
    customerName: "Nguyen An",
    customerPhone: "0901234567",
    isDebt: true,
    priceType: "store",
    depositAmount: 30,
    lines: [{ productId: product._id, quantity: 2, unitPrice: 90 }],
  }).expect(201);
  assert.equal(credit.body.data.priceType, "store");
  assert.equal(credit.body.data.totalAmount, 180);
  assert.equal(credit.body.data.paidAmount, 0);
  assert.equal(credit.body.data.depositAmount, 30);

  const secondCredit = await request(app).post("/erp/documents").send({
    type: "salesInvoice",
    documentNumber: "HD-DEBT-02",
    documentDate: "2026-03-06T12:00:00+07:00",
    customerName: "Nguyen An",
    customerPhone: "",
    isDebt: true,
    priceType: "retail",
    lines: [{ productId: product._id, quantity: 1, unitPrice: 125 }],
  }).expect(201);
  assert.equal(secondCredit.body.data.totalAmount, 125);

  const debtList = await request(app).get("/erp/debts").expect(200);
  assert.equal(debtList.body.data.length, 1);
  assert.equal(debtList.body.data[0].balance, 275);

  const payment = await request(app).post("/erp/payments").send({
    customerName: "Nguyen An",
    customerPhone: "0901234567",
    amount: 100,
    paymentDate: "2026-03-06T12:00:00+07:00",
    method: "bankTransfer",
    proofImageUrl: "https://example.invalid/payment-proof.jpg",
    reference: "BANK-REF-01",
  }).expect(201);
  assert.equal(payment.body.data.allocations[0].documentId, credit.body.data._id);
  assert.equal(payment.body.data.proofImageUrl, "https://example.invalid/payment-proof.jpg");
  assert.equal(payment.body.data.allocations[0].documentId, credit.body.data._id);
  assert.equal((await request(app).get("/erp/debts").expect(200)).body.data[0].balance, 175);
  await request(app).post("/erp/payments").send({
    customerName: "Nguyen An", customerPhone: "0901234567", amount: 176,
    paymentDate: "2026-03-07T12:00:00+07:00", method: "cash",
  }).expect(409);
  await request(app).post("/erp/payments").send({
    customerName: "Nguyen An", customerPhone: "0901234567", amount: 1,
    paymentDate: "2026-03-07T12:00:00+07:00", method: "bankTransfer",
  }).expect(400);

  await request(app)
    .post("/erp/uploads/payment-proof")
    .attach("image", Buffer.from("not an image"), { filename: "receipt.txt", contentType: "text/plain" })
    .expect(400);
});

test("receipt batch imports multiple products together and rolls back invalid batches", async () => {
  const second = await ErpProduct.create({ sku: "TEA-002", name: "Tra xanh", unit: "hop" });
  const receipt = await request(app).post("/erp/receipts").send({
    movementDate: "2026-03-08T09:30:00+07:00",
    reference: "PN-20260308-01",
    note: "Nhap hang dot dau",
    lines: [
      { productId: product._id, quantity: 12.5 },
      { productId: second._id, quantity: 8, note: "Hang de vo" },
    ],
  }).expect(201);

  assert.equal(receipt.body.data.length, 2);
  assert.ok(receipt.body.data.every((movement) => movement.type === "receipt"));
  assert.ok(receipt.body.data.every((movement) => movement.reference === "PN-20260308-01"));
  assert.equal((await ErpProduct.findById(product._id)).currentStock, 12.5);
  assert.equal((await ErpProduct.findById(second._id)).currentStock, 8);

  await ErpProduct.findByIdAndUpdate(second._id, { isActive: false });
  await request(app).post("/erp/receipts").send({
    movementDate: "2026-03-09T09:30:00+07:00",
    lines: [
      { productId: product._id, quantity: 3 },
      { productId: second._id, quantity: 4 },
    ],
  }).expect(404);
  assert.equal((await ErpProduct.findById(product._id)).currentStock, 12.5);
  assert.equal(await ErpMovement.countDocuments({ reference: /^PN-/ }), 2);
});