const API_BASE_URL = (import.meta.env.VITE_ERP_API_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '')

const erpRequest = async (path, { method = 'GET', body } = {}) => {
  const isFormData = body instanceof FormData
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        ...(body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: isFormData ? body : JSON.stringify(body) } : {}),
    })
  } catch {
    const error = new Error(`Không kết nối được ERP tại ${API_BASE_URL}. Kiểm tra backend và cấu hình CORS.`)
    error.code = 'NETWORK-OFFLINE'
    throw error
  }

  if (!response.ok) {
    let payload = {}
    try { payload = await response.json() } catch { /* Keep fallback for non-JSON responses. */ }
    const message = payload.message || `ERP trả về lỗi ${response.status}.`
    const code = payload.error?.code || `HTTP-${response.status}`
    const requestId = payload.error?.requestId || response.headers.get('X-Request-Id') || ''
    const error = new Error(`${code}${requestId ? ` · ${requestId}` : ''}: ${message}`)
    error.status = response.status
    error.code = code
    error.requestId = requestId
    throw error
  }
  return response
}

export async function getErpProducts(keyword = '') {
  const response = await erpRequest(`/erp/products${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''}`)
  return (await response.json()).data || []
}

export async function saveErpProduct(productId, payload) {
  const response = await erpRequest(productId ? `/erp/products/${encodeURIComponent(productId)}` : '/erp/products', {
    method: productId ? 'PUT' : 'POST',
    body: payload,
  })
  return (await response.json()).data
}

export async function getErpMovements({ year, month, productName = '', shippedOnly = false }) {
  const params = new URLSearchParams({ year, month })
  if (productName) params.set('productName', productName)
  const path = shippedOnly ? '/erp/exports' : '/erp/movements'
  const response = await erpRequest(`${path}?${params}`)
  return (await response.json()).data || []
}

export async function saveErpMovement(movementId, payload) {
  const response = await erpRequest(movementId ? `/erp/movements/${encodeURIComponent(movementId)}` : '/erp/movements', {
    method: movementId ? 'PUT' : 'POST',
    body: payload,
  })
  return (await response.json()).data
}

export async function createErpReceiptBatch(payload) {
  const response = await erpRequest('/erp/receipts', { method: 'POST', body: payload })
  return (await response.json()).data || []
}

export async function getErpDocuments(query = {}) {
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== ''))
  const response = await erpRequest(`/erp/documents${params.size ? `?${params}` : ''}`)
  return (await response.json()).data || []
}

export async function getErpDocument(documentId) {
  const response = await erpRequest(`/erp/documents/${encodeURIComponent(documentId)}`)
  return (await response.json()).data
}

export async function createErpDocument(payload) {
  const response = await erpRequest('/erp/documents', { method: 'POST', body: payload })
  return (await response.json()).data
}

export async function createErpCustomer(payload) {
  const response = await erpRequest('/erp/customers', { method: 'POST', body: payload })
  return (await response.json()).data
}

export async function downloadErpWorkbook({ year, month }) {
  const response = await erpRequest(`/erp/export.xlsx?${new URLSearchParams({ year, month })}`)
  const blobUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = `erp-inventory-${year}-${String(month).padStart(2, '0')}.xlsx`
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(blobUrl)
}

export async function getErpDebts() {
  const response = await erpRequest('/erp/debts')
  return (await response.json()).data || []
}

export async function getErpCustomerPayments(customerKey) {
  const response = await erpRequest(`/erp/debts/${encodeURIComponent(customerKey)}/payments`)
  return (await response.json()).data || []
}

export async function createErpPayment(payload) {
  const response = await erpRequest('/erp/payments', { method: 'POST', body: payload })
  return (await response.json()).data
}

export async function uploadErpPaymentProof(file) {
  if (!file) throw new TypeError('Vui lòng chọn ảnh giao dịch chuyển khoản.')
  const formData = new FormData()
  formData.append('image', file)
  const response = await erpRequest('/erp/uploads/payment-proof', { method: 'POST', body: formData })
  return (await response.json()).data
}
