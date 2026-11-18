import { useEffect, useMemo, useState } from 'react'
import { createErpCustomer, createErpDocument, createErpPayment, getErpCustomerPayments, getErpDebts, getErpDocument, getErpDocuments, uploadErpPaymentProof } from '../services/erpApi.js'

const today = () => new Date().toISOString().slice(0, 10)
const newNumber = (type) => `${type === 'salesInvoice' ? 'HD' : 'PX'}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`
let lineSequence = 0
const newLine = () => ({ key: `line-${Date.now()}-${lineSequence++}`, productId: '', quantity: '', unitPrice: 0, packageNote: '', weight: '', warehouse: 'thanh-phu' })
const warehouses = [['thanh-phu', 'Kho Thanh Phú'], ['duc-hoa', 'Kho Đức Hòa'], ['ben-luc', 'Kho Bến Lức']]
const stockAtWarehouse = (product, warehouse) => {
  const stocks = product.warehouseStocks || {}
  const total = (stocks['thanh-phu'] || 0) + (stocks['duc-hoa'] || 0) + (stocks['ben-luc'] || 0)
  if (!total && product.currentStock > 0) return warehouse === 'thanh-phu' ? product.currentStock : 0
  return stocks[warehouse] || 0
}
const money = (value) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })
const quantityText = (value) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
const printedDate = (value) => value ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${value}T12:00:00`)) : '—'
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100
const newForm = (type = 'salesInvoice') => ({
  documentNumber: newNumber(type), documentDate: today(), deliveryDate: '', customerName: '', customerPhone: '',
  sourceDocumentId: '', sourceDocumentNumber: '',
  customerAddress: '', deliveryAddress: '', issuerName: '', imageUrl: '', note: '', oldDebt: '', depositAmount: '', paidAmount: '', paymentInWords: '',
  priceType: 'retail', isDebt: false, documentMode: 'standard', paymentMethod: 'cash', cashPaidAmount: '', bankPaidAmount: '',
  lines: [newLine()],
})

function CustomerDebtPanel({ onBack }) {
  const [customers, setCustomers] = useState([])
  const [selected, setSelected] = useState(null)
  const [payments, setPayments] = useState([])
  const [amount, setAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState(today())
  const [method, setMethod] = useState('bankTransfer')
  const [proofFiles, setProofFiles] = useState([])
  const [proofPreviews, setProofPreviews] = useState([])
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    getErpDebts().then((rows) => { if (active) setCustomers(rows) }).catch((loadError) => { if (active) setError(loadError.message) })
    return () => { active = false }
  }, [notice])
  useEffect(() => {
    const urls = proofFiles.map((file) => URL.createObjectURL(file))
    setProofPreviews(urls)
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [proofFiles])

  const openCustomer = async (customer) => {
    setSelected(customer)
    setError('')
    try { setPayments(await getErpCustomerPayments(customer.customerKey)) }
    catch (loadError) { setError(loadError.message) }
  }
  const submitPayment = async (event) => {
    event.preventDefault()
    if (!selected || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const uploadedProofs = method === 'bankTransfer' ? await uploadErpPaymentProof(proofFiles) : []
      const proofImageUrls = uploadedProofs.map((image) => image.secure_url)
      await createErpPayment({
        customerName: selected.customerName,
        customerPhone: selected.customerPhone,
        amount: Number(amount),
        paymentDate: new Date(`${paymentDate}T12:00:00+07:00`).toISOString(),
        method,
        proofImageUrl: proofImageUrls[0] || '',
        proofImageUrls,
        reference,
        note,
      })
      setAmount('')
      setProofFiles([])
      setReference('')
      setNote('')
      const [updatedCustomers, updatedPayments] = await Promise.all([
        getErpDebts(),
        getErpCustomerPayments(selected.customerKey),
      ])
      setCustomers(updatedCustomers)
      setPayments(updatedPayments)
      setSelected(updatedCustomers.find((item) => item.customerKey === selected.customerKey) || selected)
      setNotice('Đã ghi nhận thanh toán và phân bổ vào hóa đơn cũ nhất.')
    } catch (paymentError) { setError(paymentError.message) }
    finally { setBusy(false) }
  }

  return <section className="erp-debt-workspace">
    <header className="erp-debt-header"><div><p className="erp-eyebrow">ĐỐI SOÁT KHÁCH HÀNG</p><h2>Dư nợ khách hàng</h2><p>Theo dõi hóa đơn ghi nợ và lịch sử thu tiền.</p></div><button className="erp-button erp-button--outline" type="button" onClick={onBack}>← Quay lại chứng từ</button></header>
    {(error || notice) && <div className={error ? 'erp-alert erp-alert--error' : 'erp-alert erp-alert--success'} role={error ? 'alert' : 'status'}>{error || notice}</div>}
    <div className="erp-debt-grid">
      <div className="erp-debt-list"><h3>Khách còn dư nợ <span>{customers.length}</span></h3>{customers.length === 0 ? <p className="erp-empty">Hiện không có khách hàng ghi nợ.</p> : customers.map((customer) => <button key={customer.customerKey} type="button" className={selected?.customerKey === customer.customerKey ? 'is-selected' : ''} onClick={() => openCustomer(customer)}><span><strong>{customer.customerName}</strong><small>{customer.customerPhone || 'Không có số điện thoại'} · {customer.invoiceCount} hóa đơn</small></span><b>{money(customer.balance)} đ</b></button>)}</div>
      <div className="erp-debt-detail">{!selected ? <p className="erp-empty">Chọn khách hàng để xem chi tiết và ghi nhận thanh toán.</p> : <>
        <header><div><h3>{selected.customerName}</h3><span>{selected.customerPhone || 'Không có số điện thoại'}</span></div><strong>Còn nợ {money(selected.balance)} đ</strong></header>
        <h4>Hóa đơn còn dư</h4>
        <div className="erp-debt-invoices">{selected.invoices.map((invoice) => <p key={invoice._id}><span><b>{invoice.documentNumber}</b><small>{printedDate(new Date(invoice.documentDate).toISOString().slice(0, 10))}</small></span><strong>{money(invoice.balance)} đ</strong></p>)}</div>
        <h4>Ghi nhận thanh toán</h4>
        <form className="erp-payment-form" onSubmit={submitPayment}>
          <label>Số tiền<input type="number" min="0.01" max={selected.balance} step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label>Ngày thanh toán<input type="date" required value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
          <label>Phương thức<select value={method} onChange={(event) => setMethod(event.target.value)}><option value="bankTransfer">Chuyển khoản</option><option value="cash">Tiền mặt</option><option value="other">Khác</option></select></label>
          {method === 'bankTransfer' && <label>Ảnh giao dịch (có thể chọn nhiều, tối đa 10)<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple required onChange={(event) => { const files = Array.from(event.target.files || []); if (files.length > 10) { setError('Chỉ được chọn tối đa 10 ảnh cho mỗi lần thanh toán.'); setProofFiles([]); return } setError(''); setProofFiles(files) }} />{proofPreviews.length > 0 && <div className="erp-payment-previews">{proofPreviews.map((preview, index) => <img key={preview} className="erp-payment-preview" src={preview} alt={`Ảnh giao dịch ${index + 1}`} />)}</div>}</label>}
          <label>Mã giao dịch<input value={reference} onChange={(event) => setReference(event.target.value)} /></label>
          <label>Ghi chú<input value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <button className="erp-button erp-button--dark" disabled={busy}>{busy ? 'Đang ghi nhận...' : 'Ghi nhận thanh toán'}</button>
        </form>
        <h4>Lịch sử thanh toán</h4>
        {payments.length === 0 ? <p className="erp-empty">Chưa có thanh toán.</p> : <div className="erp-payment-history">{payments.map((payment) => { const proofUrls = payment.proofImageUrls?.length ? payment.proofImageUrls : payment.proofImageUrl ? [payment.proofImageUrl] : []; return <p key={payment._id}><span><b>{printedDate(new Date(payment.paymentDate).toISOString().slice(0, 10))} · {payment.method === 'bankTransfer' ? 'Chuyển khoản' : payment.method === 'cash' ? 'Tiền mặt' : 'Khác'}</b><small>{payment.reference || 'Không có mã giao dịch'}{proofUrls.map((url, index) => <span key={url}> · <a href={url} target="_blank" rel="noreferrer">Ảnh {index + 1}</a></span>)}</small></span><strong>{money(payment.amount)} đ</strong></p> })}</div>}
      </>}</div>
    </div>
  </section>
}

export default function ErpDocuments({ products, onBack, onSaved }) {
  const [type, setType] = useState('salesInvoice')
  const [section, setSection] = useState('documents')
  const [form, setForm] = useState(() => newForm())
  const [documents, setDocuments] = useState([])
  const [availableInvoices, setAvailableInvoices] = useState([])
  const [invoiceSearch, setInvoiceSearch] = useState('')
  const [linkedIssues, setLinkedIssues] = useState([])
  const [customerDebts, setCustomerDebts] = useState([])
  const [readOnly, setReadOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [customerAccountOpen, setCustomerAccountOpen] = useState(false)
  const [customerAccount, setCustomerAccount] = useState({ name: '', phone: '', address: '' })
  const [productSearch, setProductSearch] = useState('')
  const [selectedProductIds, setSelectedProductIds] = useState([])

  const productById = useMemo(() => new Map(products.map((product) => [product._id, product])), [products])
  const total = form.lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0)
  const totalWeight = form.lines.reduce((sum, line) => sum + Number(line.weight || 0), 0)
  const linkedInvoice = availableInvoices.find((invoice) => String(invoice._id) === String(form.sourceDocumentId))
  const issueLineAmount = form.lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0)
  const issuedBeforeAmount = linkedInvoice?.fulfillmentStatus === 'pending' ? 0 : Number(linkedInvoice?.totalAmount || 0)
  const linkedInvoicePaid = linkedInvoice?.fulfillmentStatus === 'pending' ? 0 : Number(linkedInvoice?.paidAmount || 0)
  const invoicePaymentDue = linkedInvoice
    ? Math.max(0, roundMoney(issuedBeforeAmount + issueLineAmount + Number(linkedInvoice.oldDebt || 0) - Number(linkedInvoice.depositAmount || 0) - linkedInvoicePaid))
    : 0
  const matchingProducts = products.filter((product) => `${product.name} ${product.sku}`.toLocaleLowerCase('vi-VN').includes(productSearch.trim().toLocaleLowerCase('vi-VN')))

  const loadDocuments = async () => {
    try {
      const [rows, invoices] = await Promise.all([getErpDocuments(), getErpDocuments({ type: 'salesInvoice' })])
      setDocuments(rows)
      setAvailableInvoices(invoices)
    }
    catch (loadError) { setError(loadError.message) }
  }
  useEffect(() => {
    loadDocuments()
    getErpDebts().then(setCustomerDebts).catch(() => {})
  }, [])

  const normalizeCustomerName = (name) => name.trim().toLocaleLowerCase('vi-VN').normalize('NFC')
  const matchingCustomerDebt = form.customerName.trim()
    ? customerDebts.find((customer) => normalizeCustomerName(customer.customerName) === normalizeCustomerName(form.customerName))
    : null
  const projectedBalance = matchingCustomerDebt
    ? roundMoney(matchingCustomerDebt.balance + (form.isDebt ? total + Number(form.oldDebt || 0) - Number(form.depositAmount || 0) - Number(form.paidAmount || 0) : 0))
    : 0

  const change = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  const changeLine = (key, field, value) => setForm((current) => ({
    ...current,
    lines: current.lines.map((line) => {
      if (line.key !== key) return line
      if (field === 'quantity' && type === 'stockIssue') {
        const product = productById.get(line.productId)
        return { ...line, quantity: value, weight: product?.weightPerUnit ? Number(value || 0) * product.weightPerUnit : line.weight }
      }
      return { ...line, [field]: value }
    }),
  }))
  const changeType = (nextType) => {
    if (readOnly) return
    setType(nextType)
    setForm((current) => ({ ...current, documentNumber: newNumber(nextType) }))
  }
  const chooseProduct = (line, productId) => {
    const product = productById.get(productId)
    setForm((current) => ({
      ...current,
      lines: current.lines.map((item) => item.key === line.key ? {
        ...item,
        productId,
        productSearch: undefined,
        unitPrice: form.priceType === 'store' ? product?.storePrice || 0 : product?.salePrice || 0,
        weight: product?.weightPerUnit ? Number(item.quantity || 0) * product.weightPerUnit : item.weight,
      } : item),
    }))
  }
  const addSelectedProducts = () => {
    if (!selectedProductIds.length) return
    const newLines = selectedProductIds.map((productId) => {
      const product = productById.get(productId)
      return {
        ...newLine(),
        productId,
        unitPrice: form.priceType === 'store' ? product?.storePrice || 0 : product?.salePrice || 0,
        weight: 0,
      }
    })
    setForm((current) => ({ ...current, lines: [...current.lines, ...newLines] }))
    setSelectedProductIds([])
    setProductSearch('')
  }
  const selectInvoiceForIssue = async (value) => {
    const normalized = value.trim().toLocaleLowerCase('vi-VN')
    const selectedInvoice = availableInvoices.find((invoice) => `${invoice.documentNumber} · ${invoice.customerName}`.toLocaleLowerCase('vi-VN') === normalized || invoice.documentNumber.toLocaleLowerCase('vi-VN') === normalized)
    if (!selectedInvoice) return
    setBusy(true)
    setError('')
    try {
      const [invoice, priorIssues] = await Promise.all([
        getErpDocument(selectedInvoice._id),
        getErpDocuments({ sourceDocumentId: selectedInvoice._id }),
      ])
      const invoiceLines = invoice.requestedLines?.length ? invoice.requestedLines : invoice.lines
      const invoicedByProduct = new Map()
      const shippedByProduct = new Map()
      for (const line of invoiceLines) {
        const productId = String(line.productId)
        invoicedByProduct.set(productId, (invoicedByProduct.get(productId) || 0) + Number(line.quantity || 0))
      }
      for (const issue of priorIssues) for (const line of issue.lines) {
        const productId = String(line.productId)
        shippedByProduct.set(productId, (shippedByProduct.get(productId) || 0) + Number(line.quantity || 0))
      }
      const remainingByProduct = new Map([...invoicedByProduct].map(([id, amount]) => [id, Math.max(0, amount - (shippedByProduct.get(id) || 0))]))
      const lines = invoiceLines.flatMap((line) => {
        const id = String(line.productId)
        const remaining = remainingByProduct.get(id) || 0
        const quantity = Math.min(Number(line.quantity || 0), remaining)
        remainingByProduct.set(id, Math.max(0, remaining - quantity))
        if (!quantity) return []
        const ratio = quantity / Number(line.quantity || 1)
        return [{ ...line, key: `invoice-${line.sku}-${Math.random()}`, quantity, weight: Number(line.weight || 0) * ratio, warehouse: line.warehouse || 'thanh-phu' }]
      })
      if (!lines.length) throw new Error('Hóa đơn này đã được xuất đủ số lượng.')
      setType('stockIssue')
      setReadOnly(false)
      setForm((current) => ({
        ...current,
        type: 'stockIssue',
        sourceDocumentId: invoice._id,
        sourceDocumentNumber: invoice.documentNumber,
        customerName: invoice.customerName,
        customerPhone: invoice.customerPhone || '',
        customerAddress: invoice.customerAddress || '',
        deliveryAddress: invoice.deliveryAddress || invoice.customerAddress || '',
        deliveryDate: invoice.deliveryDate ? new Date(invoice.deliveryDate).toISOString().slice(0, 10) : '',
        issuerName: current.issuerName || 'Kho xuất hàng',
        paymentMethod: invoice.paymentMethod || 'cash',
        cashPaidAmount: '',
        bankPaidAmount: '',
        imageUrl: invoice.imageUrl || '',
        note: `Xuất theo hóa đơn ${invoice.documentNumber}. ${invoice.note || ''}`.trim(),
        lines,
      }))
      setInvoiceSearch(`${invoice.documentNumber} · ${invoice.customerName}`)
      setNotice(`Đã lấy hóa đơn ${invoice.documentNumber}. Các mặt hàng đã xuất được trừ khỏi số lượng còn lại.`)
    } catch (selectionError) { setError(selectionError.message) }
    finally { setBusy(false) }
  }
  const changePriceType = (priceType) => setForm((current) => ({
    ...current,
    priceType,
    lines: current.lines.map((line) => {
      const product = productById.get(line.productId)
      return product ? { ...line, unitPrice: priceType === 'store' ? product.storePrice || 0 : product.salePrice || 0 } : line
    }),
  }))
  const reset = () => {
    setType('salesInvoice')
    setForm(newForm())
    setLinkedIssues([])
    setProductSearch('')
    setSelectedProductIds([])
    setReadOnly(false)
    setError('')
    setNotice('')
  }
  const reopen = async (id) => {
    setBusy(true)
    setError('')
    try {
      const document = await getErpDocument(id)
      const linked = document.type === 'salesInvoice' ? await getErpDocuments({ sourceDocumentId: document._id }).catch(() => []) : []
      setLinkedIssues(linked)
      setType(document.type)
      setForm({
        ...document,
        documentDate: new Date(document.documentDate).toISOString().slice(0, 10),
        deliveryDate: document.deliveryDate ? new Date(document.deliveryDate).toISOString().slice(0, 10) : '',
        oldDebt: document.oldDebt || '',
        paidAmount: document.paidAmount || '',
        lines: document.lines.map((line) => ({ ...line, key: `saved-${line.movementId || line.sku}-${Math.random()}` })),
      })
      setReadOnly(true)
      setNotice('Đang xem chứng từ đã lưu, có thể in lại.')
    } catch (loadError) { setError(loadError.message) }
    finally { setBusy(false) }
  }

  const save = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const payload = {
        type,
        ...form,
        oldDebt: Number(form.oldDebt || 0),
        depositAmount: Number(form.depositAmount || 0),
        paidAmount: type === 'salesInvoice' ? 0 : form.isDebt
          ? Number(form.paidAmount || 0)
          : roundMoney(total + Number(form.oldDebt || 0) - Number(form.depositAmount || 0)),
        paymentMethod: form.paymentMethod || 'cash',
        cashPaidAmount: type === 'stockIssue' && ['cash', 'mixed'].includes(form.paymentMethod) ? Number(form.cashPaidAmount || 0) : 0,
        bankPaidAmount: type === 'stockIssue' && ['bankTransfer', 'mixed'].includes(form.paymentMethod) ? Number(form.bankPaidAmount || 0) : 0,
        documentDate: new Date(`${form.documentDate}T12:00:00+07:00`).toISOString(),
        deliveryDate: form.deliveryDate ? new Date(`${form.deliveryDate}T12:00:00+07:00`).toISOString() : '',
        lines: form.lines.map((formLine) => {
          const { key: _key, ...line } = formLine
          return {
          ...line,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice || 0),
          weight: Number(line.weight || 0),
          }
        }),
      }
      const saved = await createErpDocument(payload)
      await onSaved()
      await loadDocuments()
      setCustomerDebts(await getErpDebts())
      setForm({
        ...saved,
        documentDate: new Date(saved.documentDate).toISOString().slice(0, 10),
        deliveryDate: saved.deliveryDate ? new Date(saved.deliveryDate).toISOString().slice(0, 10) : '',
        lines: saved.lines.map((line) => ({ ...line, key: `saved-${line.movementId || line.sku}-${Math.random()}` })),
      })
      setReadOnly(true)
      setNotice(type === 'stockIssue' ? 'Đã chốt phiếu xuất, trừ tồn kho và cập nhật số lượng, thành tiền của hóa đơn liên kết.' : 'Đã lưu tạm yêu cầu xuất hàng. Tồn kho và hóa đơn sẽ được chốt theo số lượng thực xuất trên phiếu xuất kho.')
    } catch (saveError) { setError(saveError.message) }
    finally { setBusy(false) }
  }
  const saveCustomerAccount = async () => {
    setError('')
    try {
      const customer = await createErpCustomer(customerAccount)
      setForm((current) => ({ ...current, customerName: customer.name, customerPhone: customer.phone, customerAddress: customer.address }))
      setCustomerAccountOpen(false)
      setCustomerAccount({ name: '', phone: '', address: '' })
      setNotice('Đã tạo hồ sơ khách hàng và điền vào chứng từ.')
    } catch (accountError) { setError(accountError.message) }
  }
  const print = () => window.print()
  const forwardInvoice = () => {
    selectInvoiceForIssue(`${form.documentNumber} · ${form.customerName}`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (section === 'debts') return <main className="erp-page erp-document-mode">
    <header className="erp-topbar erp-document-controls"><button className="erp-button erp-button--quiet" type="button" onClick={onBack}>← Kho hàng</button><a className="erp-brand" href="/"><span>ERP</span><i>CÔNG NỢ</i></a><div className="erp-topbar__right"><button className="erp-button erp-button--quiet" type="button" onClick={() => setSection('documents')}>Mẫu chứng từ</button></div></header>
    <div className="erp-content erp-document-controls"><CustomerDebtPanel onBack={() => setSection('documents')} /></div>
  </main>

  return <main className="erp-page erp-document-mode">
    <header className="erp-topbar erp-document-controls"><button className="erp-button erp-button--quiet" type="button" onClick={onBack}>← Kho hàng</button><a className="erp-brand" href="/"><span>ERP</span><i>CHỨNG TỪ</i></a><div className="erp-topbar__right"><button className="erp-button erp-button--quiet" type="button" onClick={() => setSection('debts')}>Kiểm tra dư nợ</button><button className="erp-button erp-button--quiet" type="button" onClick={reset}>＋ Tạo mới</button></div></header>
    <div className="erp-content erp-document-controls">
      <section className="erp-titlebar"><div><p className="erp-eyebrow">MẪU IN A4 · GHI SỔ KHO</p><h1>Chứng từ bán hàng</h1><p className="erp-subtitle">Lưu yêu cầu xuất tạm; chốt số lượng và doanh thu theo phiếu xuất thực tế.</p></div><div className="erp-document-actions">{readOnly && type === 'salesInvoice' && <button className="erp-button erp-button--outline" type="button" onClick={forwardInvoice}>Lập phiếu xuất từ yêu cầu</button>}<button className="erp-button erp-button--outline" type="button" onClick={print}>In / Lưu PDF</button>{!readOnly && <button className="erp-button erp-button--dark" type="button" disabled={busy} onClick={save}>{busy ? 'Đang ghi...' : type === 'stockIssue' ? 'Chốt phiếu xuất & cập nhật hóa đơn' : 'Lưu tạm yêu cầu xuất'}</button>}</div></section>
      {(error || notice) && <div className={error ? 'erp-alert erp-alert--error' : 'erp-alert erp-alert--success'} role={error ? 'alert' : 'status'}>{error || notice}<button type="button" aria-label="Đóng thông báo" onClick={() => { setError(''); setNotice('') }}>×</button></div>}
      <div className="erp-document-layout">
        <section className="erp-document-editor">
          <div className="erp-document-type" role="tablist" aria-label="Chọn mẫu chứng từ">
            <button type="button" role="tab" aria-selected={type === 'salesInvoice'} disabled={readOnly} onClick={() => changeType('salesInvoice')}>Hóa đơn bán hàng</button>
            <button type="button" role="tab" aria-selected={type === 'stockIssue'} disabled={readOnly} onClick={() => changeType('stockIssue')}>Phiếu xuất kho</button>
          </div>
          {type === 'stockIssue' && !readOnly && <div className="erp-invoice-picker"><label htmlFor="erp-source-invoice">Chọn hóa đơn để lập phiếu xuất</label><input id="erp-source-invoice" list="erp-source-invoice-options" value={invoiceSearch} disabled={busy} placeholder="Gõ số hóa đơn hoặc tên khách hàng" onChange={(event) => { setInvoiceSearch(event.target.value); selectInvoiceForIssue(event.target.value) }} /><datalist id="erp-source-invoice-options">{availableInvoices.map((invoice) => <option key={invoice._id} value={`${invoice.documentNumber} · ${invoice.customerName}`} />)}</datalist><small>Thông tin khách hàng và hàng hóa sẽ tự điền; chỉ còn số lượng chưa xuất.</small></div>}
          <div className="erp-form-grid">
            {type === 'stockIssue' && form.sourceDocumentNumber && <p className="erp-customer-debt-hint erp-form-wide">Phiếu xuất liên kết hóa đơn <b>{form.sourceDocumentNumber}</b>; khách hàng, địa chỉ và mặt hàng đã được lấy từ hóa đơn.</p>}
            {type === 'salesInvoice' && readOnly && form.fulfillmentStatus && <p className="erp-customer-debt-hint erp-form-wide">Trạng thái: <b>{form.fulfillmentStatus === 'complete' ? 'Đã chốt đủ số lượng' : form.fulfillmentStatus === 'partial' ? 'Đã xuất một phần' : 'Yêu cầu tạm, chưa chốt số lượng'}</b></p>}
            <label>Số chứng từ<input disabled={readOnly} value={form.documentNumber} onChange={(event) => change('documentNumber', event.target.value)} /></label>
            <label>Ngày lập<input type="date" disabled={readOnly} value={form.documentDate} onChange={(event) => change('documentDate', event.target.value)} /></label>
            <label>Khách hàng<input disabled={readOnly} required value={form.customerName} onChange={(event) => change('customerName', event.target.value)} onBlur={(event) => { const match = customerDebts.find((item) => normalizeCustomerName(item.customerName) === normalizeCustomerName(event.target.value)); if (match && !form.customerPhone) change('customerPhone', match.customerPhone || '') }} /></label>
            {!readOnly && <button type="button" className="erp-button erp-button--outline" onClick={() => setCustomerAccountOpen(true)}>＋ Tạo tài khoản khách hàng</button>}
            {matchingCustomerDebt && <p className="erp-customer-debt-hint" aria-live="polite">Dư nợ hiện tại: <b>{money(matchingCustomerDebt.balance)} đ</b> · sau hóa đơn này: <b>{money(projectedBalance)} đ</b></p>}
            <details className="erp-advanced-fields erp-form-wide"><summary>Thông tin giao hàng, thanh toán và ghi chú</summary><div className="erp-form-grid">
            <label>Điện thoại<input disabled={readOnly} value={form.customerPhone} onChange={(event) => change('customerPhone', event.target.value)} /></label>
            <label className="erp-form-wide">Địa chỉ khách hàng<input disabled={readOnly} value={form.customerAddress} onChange={(event) => change('customerAddress', event.target.value)} /></label>
            <label>Ngày giao<input type="date" disabled={readOnly} value={form.deliveryDate} onChange={(event) => change('deliveryDate', event.target.value)} /></label>
            <label>Địa chỉ giao hàng<input disabled={readOnly} value={form.deliveryAddress} onChange={(event) => change('deliveryAddress', event.target.value)} /></label>
            {type === 'stockIssue' && <label className="erp-form-wide">Đơn vị xuất kho<input disabled={readOnly} value={form.issuerName} onChange={(event) => change('issuerName', event.target.value)} placeholder="Tên cửa hàng / công ty" /></label>}
            <label className="erp-form-wide">Ảnh minh họa giao hàng (URL)<input type="url" disabled={readOnly} value={form.imageUrl} onChange={(event) => change('imageUrl', event.target.value)} placeholder="https://..." /></label>
            {type === 'salesInvoice' && <>
              <label>Loại giá<select disabled={readOnly} value={form.priceType || 'retail'} onChange={(event) => changePriceType(event.target.value)}><option value="retail">Giá bán lẻ</option><option value="store">Giá cửa hàng</option></select></label>
              <label>Mẫu in<select disabled={readOnly} value={form.documentMode || 'standard'} onChange={(event) => setForm((current) => ({ ...current, documentMode: event.target.value, isDebt: event.target.value === 'quantityDebt' }))}><option value="standard">Hóa đơn có giá</option><option value="noPrice">Không ghi giá</option><option value="quantityDebt">Ghi nợ, chỉ hiện số lượng</option></select></label>
              <label>Hình thức thanh toán<select disabled={readOnly} value={form.paymentMethod || 'cash'} onChange={(event) => change('paymentMethod', event.target.value)}><option value="bankTransfer">Chuyển khoản</option><option value="cash">Tiền mặt</option><option value="mixed">Chuyển khoản và tiền mặt</option></select></label>
              <label>Nợ cũ<input type="number" min="0" step="0.01" disabled={readOnly} value={form.oldDebt} onChange={(event) => change('oldDebt', event.target.value)} /></label>
              <label>Tiền cọc<input type="number" min="0" step="0.01" disabled={readOnly} value={form.depositAmount} onChange={(event) => change('depositAmount', event.target.value)} /></label>
              <label className="erp-form-wide">Thanh toán bằng chữ<input disabled={readOnly} value={form.paymentInWords} onChange={(event) => change('paymentInWords', event.target.value)} /></label>
            </>}
            <label className="erp-form-wide">Ghi chú<input disabled={readOnly} value={form.note} onChange={(event) => change('note', event.target.value)} /></label>
            </div></details>
          </div>
          {type === 'stockIssue' && !readOnly && linkedInvoice && invoicePaymentDue > 0.005 && <section className="erp-settlement-panel"><div><h3>Thanh toán và chốt hóa đơn</h3><p>Tiền cọc {money(linkedInvoice.depositAmount)} đ đã được khấu trừ. Còn phải thanh toán <strong>{money(invoicePaymentDue)} đ</strong>.</p></div><label>Hình thức thanh toán<select value={form.paymentMethod || linkedInvoice.paymentMethod || 'cash'} onChange={(event) => change('paymentMethod', event.target.value)}><option value="bankTransfer">Chuyển khoản</option><option value="cash">Tiền mặt</option><option value="mixed">Chuyển khoản và tiền mặt</option></select></label>{['cash', 'mixed'].includes(form.paymentMethod) && <label>Tiền mặt<input type="number" min="0" max={invoicePaymentDue} step="0.01" value={form.cashPaidAmount} onChange={(event) => change('cashPaidAmount', event.target.value)} /></label>}{['bankTransfer', 'mixed'].includes(form.paymentMethod) && <label>Chuyển khoản<input type="number" min="0" max={invoicePaymentDue} step="0.01" value={form.bankPaidAmount} onChange={(event) => change('bankPaidAmount', event.target.value)} /></label>}</section>}
          <div className="erp-document-line-editor">
            {!readOnly && <div className="erp-product-picker"><label>Tìm và chọn nhiều mặt hàng<input type="search" placeholder="Gõ tên hoặc mã sản phẩm" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} /></label><div className="erp-product-picker__results">{matchingProducts.slice(0, 40).map((product) => <label key={product._id}><input type="checkbox" checked={selectedProductIds.includes(product._id)} onChange={(event) => setSelectedProductIds((current) => event.target.checked ? [...current, product._id] : current.filter((id) => id !== product._id))} /><span>{product.name}<small>{product.sku} · Tồn {quantityText(product.currentStock)} {product.unit}</small></span></label>)}{matchingProducts.length > 40 && <small>Đang hiện 40 kết quả đầu tiên; hãy gõ thêm để thu hẹp kết quả.</small>}{matchingProducts.length === 0 && <small>Không tìm thấy sản phẩm khớp.</small>}</div><button type="button" className="erp-button erp-button--outline" disabled={!selectedProductIds.length} onClick={addSelectedProducts}>Thêm {selectedProductIds.length} mặt hàng đã chọn</button></div>}
            <div className="erp-document-line-heading"><h2>Hàng hóa</h2>{!readOnly && <button type="button" className="erp-button erp-button--outline" onClick={() => setForm((current) => ({ ...current, lines: [...current.lines, newLine()] }))}>＋ Thêm dòng</button>}</div>
            {form.lines.map((line, index) => {
              const product = productById.get(line.productId)
              return <div className="erp-document-line" key={line.key}>
                <span className="erp-document-line__number">{index + 1}</span>
                <label className="erp-line-product">Tìm sản phẩm<input list={`product-options-${line.key}`} disabled={readOnly} placeholder="Gõ tên hoặc mã hàng" value={line.productSearch ?? (product ? `${product.name} · ${product.sku}` : '')} onChange={(event) => { const value = event.target.value; const normalized = value.trim().toLocaleLowerCase('vi-VN'); const match = products.find((item) => `${item.name} · ${item.sku}`.toLocaleLowerCase('vi-VN') === normalized || item.sku.toLocaleLowerCase('vi-VN') === normalized); if (match) chooseProduct(line, match._id); else setForm((current) => ({ ...current, lines: current.lines.map((item) => item.key === line.key ? { ...item, productId: '', productSearch: value, unitPrice: 0 } : item) })) }} /><datalist id={`product-options-${line.key}`}>{products.map((item) => <option key={item._id} value={`${item.name} · ${item.sku}`} />)}</datalist></label>
                <label>Số lượng<input type="number" min="0.001" step="0.001" disabled={readOnly} value={line.quantity} onChange={(event) => changeLine(line.key, 'quantity', event.target.value)} /></label>
                {type === 'stockIssue' && <label>Kho xuất<select disabled={readOnly} value={line.warehouse || 'thanh-phu'} onChange={(event) => changeLine(line.key, 'warehouse', event.target.value)}>{warehouses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
                {type === 'salesInvoice' ? <label>Đơn giá<input type="number" min="0" step="0.01" readOnly value={line.unitPrice} /></label> : <label>Trọng lượng<input type="number" min="0" step="0.001" disabled={readOnly} value={line.weight} onChange={(event) => changeLine(line.key, 'weight', event.target.value)} /></label>}
                <small>{product ? `${product.sku} · ${product.unit} · tổng tồn ${quantityText(product.currentStock)}${type === 'stockIssue' ? ` · tồn kho chọn: ${quantityText(stockAtWarehouse(product, line.warehouse || 'thanh-phu'))}` : ''}` : 'Chưa chọn hàng'}</small>
                {!readOnly && form.lines.length > 1 && <button type="button" className="erp-line-remove" aria-label={`Bỏ dòng ${index + 1}`} onClick={() => setForm((current) => ({ ...current, lines: current.lines.filter((item) => item.key !== line.key) }))}>×</button>}
              </div>
            })}
          </div>
        </section>

        <aside className="erp-saved-documents"><h2>Chứng từ gần đây</h2>{documents.length === 0 ? <p>Chưa có chứng từ đã lưu.</p> : documents.slice(0, 12).map((document) => <button key={document._id} type="button" onClick={() => reopen(document._id)}><span><strong>{document.documentNumber}</strong><small>{document.customerName} · {printedDate(new Date(document.documentDate).toISOString().slice(0, 10))}</small></span><i>{document.type === 'salesInvoice' ? 'Hóa đơn' : 'Phiếu xuất'}</i></button>)}{type === 'salesInvoice' && readOnly && <div className="erp-linked-documents"><h3>Phiếu xuất liên kết</h3>{linkedIssues.length ? linkedIssues.map((issue) => <button key={issue._id} type="button" onClick={() => reopen(issue._id)}><span><strong>{issue.documentNumber}</strong><small>{printedDate(new Date(issue.documentDate).toISOString().slice(0, 10))}</small></span><i>Mở phiếu xuất</i></button>) : <p>Chưa có phiếu xuất cho hóa đơn này.</p>}</div>}</aside>
      </div>
    </div>

    {customerAccountOpen && <div className="erp-dialog-backdrop" role="presentation"><section className="erp-dialog" role="dialog" aria-modal="true" aria-labelledby="erp-customer-title"><header><h2 id="erp-customer-title">Tạo tài khoản khách hàng</h2></header><div className="erp-form-grid"><label className="erp-form-wide">Tên khách hàng<input autoFocus required value={customerAccount.name} onChange={(event) => setCustomerAccount((current) => ({ ...current, name: event.target.value }))} /></label><label>Điện thoại<input value={customerAccount.phone} onChange={(event) => setCustomerAccount((current) => ({ ...current, phone: event.target.value }))} /></label><label>Địa chỉ<input value={customerAccount.address} onChange={(event) => setCustomerAccount((current) => ({ ...current, address: event.target.value }))} /></label><footer className="erp-form-wide erp-receipt-actions"><button type="button" className="erp-button" onClick={() => setCustomerAccountOpen(false)}>Hủy</button><button type="button" className="erp-button erp-button--dark" disabled={!customerAccount.name.trim()} onClick={saveCustomerAccount}>Tạo khách hàng</button></footer></div></section></div>}
    <article className={`erp-paper erp-paper--${type}`} aria-label={type === 'salesInvoice' ? 'Hóa đơn bán hàng' : 'Phiếu xuất kho'}>
      {type === 'salesInvoice' ? <>
        <header className="erp-paper__invoice-heading"><strong className="erp-paper__company">Cty TNHH TM-SX TRƯỜNG THỊNH PHÁT</strong><h1>HÓA ĐƠN BÁN HÀNG</h1><div className="erp-paper__number"><span>HĐ:</span><strong>{form.documentNumber}</strong><time>{printedDate(form.documentDate)}</time></div></header>
        <div className="erp-paper__customer"><b>Khách hàng:</b><strong>{form.customerName || '........................................................'}</strong></div>
        <div className="erp-paper__meta"><span>ĐTDD:</span><b>{form.customerPhone || ' '}</b></div>
        <div className="erp-paper__meta"><span>Địa chỉ:</span><b>{form.customerAddress || ' '}</b></div>
        <div className="erp-paper__meta"><span>Ngày giao:</span><b>{printedDate(form.deliveryDate)}</b></div>
        <div className="erp-paper__meta erp-paper__meta--code"><span /><b /><span>Mã HV:</span><b>{form.deliveryAddress || ' '}</b></div>
        <table className={`erp-paper__table erp-paper__table--invoice${form.isDebt ? ' is-debt' : ''}`}><thead><tr><th>TT</th><th>Mã hàng</th><th>Tên hàng</th><th>Đơn vị</th><th>SL</th>{form.documentMode !== 'quantityDebt' && <><th>Đơn giá</th><th>Thành tiền</th></>}</tr></thead><tbody>
          {form.lines.map((line, index) => { const product = productById.get(line.productId); return <tr key={line.key}><td>{index + 1}</td><td>{product?.sku || ''}</td><td>{product?.name || ''}</td><td>{product?.unit || ''}</td><td>{quantityText(line.quantity)}</td>{form.documentMode !== 'quantityDebt' && <><td>{form.documentMode === 'standard' && !form.isDebt ? money(line.unitPrice) : ''}</td><td>{form.documentMode === 'standard' && !form.isDebt ? money(Number(line.quantity || 0) * Number(line.unitPrice || 0)) : ''}</td></>}</tr> })}
          {Array.from({ length: Math.max(0, 25 - form.lines.length) }, (_, index) => <tr className="erp-paper__blank-row" key={`blank-${index}`}><td>{form.lines.length + index + 1}</td><td /><td /><td /><td />{form.documentMode !== 'quantityDebt' && <><td /><td /></>}</tr>)}
        </tbody></table>
        {form.isDebt && <p className="erp-paper__debt-stamp">GHI NỢ KHÁCH HÀNG</p>}
        {form.documentMode === 'standard' && <><div className="erp-paper__totals"><p><span>Phải thanh toán:</span><strong>{form.isDebt ? '' : money(total + Number(form.oldDebt || 0))}</strong></p><p><span>Nợ cũ:</span><strong>{form.isDebt ? '' : money(form.oldDebt)}</strong></p><p><span>Tổng cộng:</span><strong>{form.isDebt ? '' : money(total + Number(form.oldDebt || 0))}</strong></p><p><span>Tiền cọc (đã trừ):</span><strong>{form.isDebt ? '' : `-${money(form.depositAmount)}`}</strong></p><p><span>Đã thanh toán:</span><strong>{form.isDebt ? '' : money(form.paidAmount)}</strong></p><p><span>Còn lại:</span><strong>{form.isDebt ? '' : money(Math.max(0, total + Number(form.oldDebt || 0) - Number(form.depositAmount || 0) - Number(form.paidAmount || 0)))}</strong></p></div>
        <p className="erp-paper__words"><b>Chưa thanh toán bằng chữ:</b><span>{form.isDebt ? '' : form.paymentInWords || '........................................................................................................'}</span></p></>}
        {!form.isDebt && <p className="erp-paper__payment-method">Hình thức thanh toán: {form.paymentMethod === 'bankTransfer' ? 'Chuyển khoản' : form.paymentMethod === 'mixed' ? 'Chuyển khoản và tiền mặt' : 'Tiền mặt'}</p>}
        <p className="erp-paper__note"><b>Ghi chú:</b><span>{form.note || 'Cảm ơn quý khách đã ủng hộ cửa hàng.'}</span></p>
        <p className="erp-paper__return-policy">Chỉ đổi trả hàng trong vòng 1 tuần kể từ ngày mua (không đổi hoặc trả tấn/bao đã khui).</p>
        <footer className="erp-paper__signatures"><span>KHÁCH HÀNG</span><span>LẬP PHIẾU</span></footer>
      </> : <>
        <header className="erp-paper__issue-heading"><div><small>{form.issuerName || 'ĐƠN VỊ: CỬA HÀNG'}</small><h1>PHIẾU XUẤT KHO</h1></div><div><span>Số: <b>{form.documentNumber}</b></span><time>{printedDate(form.documentDate)}</time></div></header>
        {form.sourceDocumentNumber && <p className="erp-paper__issue-note"><b>Hóa đơn liên kết:</b><span>{form.sourceDocumentNumber}</span></p>}
        <div className="erp-paper__issue-meta"><p><b>Khách hàng:</b><span>{form.customerName || '................................................'}</span><b>Điện thoại:</b><span>{form.customerPhone || ' '}</span></p><p><b>Địa chỉ:</b><span>{form.customerAddress || ' '}</span></p><p><b>Địa chỉ giao hàng:</b><span>{form.deliveryAddress || form.customerAddress || ' '}</span><b>Ngày giao:</b><span>{printedDate(form.deliveryDate)}</span></p></div>
        <table className="erp-paper__table erp-paper__table--issue"><thead><tr><th>Stt</th>{type === 'stockIssue' && <th>Kho xuất</th>}<th>Mã hàng</th><th>Tên hàng</th><th>Đơn vị</th><th>Số lượng</th><th>Ghi chú (hộp, bao...)</th><th>Trọng lượng</th></tr></thead><tbody>
          {form.lines.map((line, index) => { const product = productById.get(line.productId); const warehouseLabel = warehouses.find(([value]) => value === (line.warehouse || 'thanh-phu'))?.[1] || ''; return <tr key={line.key}><td>{index + 1}</td>{type === 'stockIssue' && <td>{warehouseLabel}</td>}<td>{product?.sku || ''}</td><td>{product?.name || ''}</td><td>{product?.unit || ''}</td><td>{quantityText(line.quantity)}</td><td>{line.packageNote || ''}</td><td>{quantityText(line.weight)}</td></tr> })}
          {Array.from({ length: Math.max(0, 12 - form.lines.length) }, (_, index) => <tr className="erp-paper__blank-row" key={`blank-${index}`}><td>{form.lines.length + index + 1}</td>{type === 'stockIssue' && <td />}<td /><td /><td /><td /><td /><td /></tr>)}
        </tbody></table>
        <div className="erp-paper__issue-total"><span>Tổng trọng lượng:</span><strong>{quantityText(totalWeight)} Kg</strong></div>
        {form.imageUrl && <p className="erp-paper__image-url">Ảnh giao hàng: {form.imageUrl}</p>}
        <p className="erp-paper__issue-note"><b>Ghi chú:</b><span>{form.note || ' '}</span></p>
        <footer className="erp-paper__issue-signatures"><span>Người mua hàng<br />(ký, ghi rõ họ tên)</span><span>Người nhận hàng<br />(ký, ghi rõ họ tên)</span><span>Người giao hàng<br />(ký, ghi rõ họ tên)</span></footer>
      </>}
    </article>
  </main>
}
