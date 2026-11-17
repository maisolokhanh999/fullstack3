import { useEffect, useMemo, useState } from 'react'
import { createErpDocument, createErpPayment, getErpCustomerPayments, getErpDebts, getErpDocument, getErpDocuments, uploadErpPaymentProof } from '../services/erpApi.js'

const today = () => new Date().toISOString().slice(0, 10)
const newNumber = (type) => `${type === 'salesInvoice' ? 'HD' : 'PX'}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`
let lineSequence = 0
const newLine = () => ({ key: `line-${Date.now()}-${lineSequence++}`, productId: '', quantity: '', unitPrice: 0, packageNote: '', weight: '' })
const money = (value) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })
const quantityText = (value) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
const printedDate = (value) => value ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${value}T12:00:00`)) : '—'
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100
const newForm = (type = 'salesInvoice') => ({
  documentNumber: newNumber(type), documentDate: today(), deliveryDate: '', customerName: '', customerPhone: '',
  customerAddress: '', deliveryAddress: '', issuerName: '', imageUrl: '', note: '', oldDebt: '', depositAmount: '', paidAmount: '', paymentInWords: '',
  priceType: 'retail', isDebt: false,
  lines: [newLine()],
})

function CustomerDebtPanel({ onBack }) {
  const [customers, setCustomers] = useState([])
  const [selected, setSelected] = useState(null)
  const [payments, setPayments] = useState([])
  const [amount, setAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState(today())
  const [method, setMethod] = useState('bankTransfer')
  const [proofFile, setProofFile] = useState(null)
  const [proofPreview, setProofPreview] = useState('')
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
    if (!proofFile) { setProofPreview(''); return undefined }
    const url = URL.createObjectURL(proofFile)
    setProofPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [proofFile])

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
      const proofImageUrl = method === 'bankTransfer' ? (await uploadErpPaymentProof(proofFile)).secure_url : ''
      await createErpPayment({
        customerName: selected.customerName,
        customerPhone: selected.customerPhone,
        amount: Number(amount),
        paymentDate: new Date(`${paymentDate}T12:00:00+07:00`).toISOString(),
        method,
        proofImageUrl,
        reference,
        note,
      })
      setAmount('')
      setProofFile(null)
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
          {method === 'bankTransfer' && <label>Ảnh giao dịch<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" required onChange={(event) => setProofFile(event.target.files?.[0] || null)} />{proofPreview && <img className="erp-payment-preview" src={proofPreview} alt="Ảnh giao dịch chuyển khoản" />}</label>}
          <label>Mã giao dịch<input value={reference} onChange={(event) => setReference(event.target.value)} /></label>
          <label>Ghi chú<input value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <button className="erp-button erp-button--dark" disabled={busy}>{busy ? 'Đang ghi nhận...' : 'Ghi nhận thanh toán'}</button>
        </form>
        <h4>Lịch sử thanh toán</h4>
        {payments.length === 0 ? <p className="erp-empty">Chưa có thanh toán.</p> : <div className="erp-payment-history">{payments.map((payment) => <p key={payment._id}><span><b>{printedDate(new Date(payment.paymentDate).toISOString().slice(0, 10))} · {payment.method === 'bankTransfer' ? 'Chuyển khoản' : payment.method === 'cash' ? 'Tiền mặt' : 'Khác'}</b><small>{payment.reference || 'Không có mã giao dịch'}{payment.proofImageUrl && <> · <a href={payment.proofImageUrl} target="_blank" rel="noreferrer">Ảnh chứng từ</a></>}</small></span><strong>{money(payment.amount)} đ</strong></p>)}</div>}
      </>}</div>
    </div>
  </section>
}

export default function ErpDocuments({ products, onBack, onSaved }) {
  const [type, setType] = useState('salesInvoice')
  const [section, setSection] = useState('documents')
  const [form, setForm] = useState(() => newForm())
  const [documents, setDocuments] = useState([])
  const [customerDebts, setCustomerDebts] = useState([])
  const [readOnly, setReadOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const productById = useMemo(() => new Map(products.map((product) => [product._id, product])), [products])
  const total = form.lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0)
  const totalWeight = form.lines.reduce((sum, line) => sum + Number(line.weight || 0), 0)

  const loadDocuments = async () => {
    try { setDocuments(await getErpDocuments()) }
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
        unitPrice: form.priceType === 'store' ? product?.storePrice || 0 : product?.salePrice || 0,
        weight: product?.weightPerUnit ? Number(item.quantity || 0) * product.weightPerUnit : item.weight,
      } : item),
    }))
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
    setReadOnly(false)
    setError('')
    setNotice('')
  }
  const reopen = async (id) => {
    setBusy(true)
    setError('')
    try {
      const document = await getErpDocument(id)
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
        paidAmount: form.isDebt
          ? Number(form.paidAmount || 0)
          : roundMoney(total + Number(form.oldDebt || 0) - Number(form.depositAmount || 0)),
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
      setNotice('Đã lưu chứng từ và ghi xuất kho thành công.')
    } catch (saveError) { setError(saveError.message) }
    finally { setBusy(false) }
  }
  const print = () => window.print()

  if (section === 'debts') return <main className="erp-page erp-document-mode">
    <header className="erp-topbar erp-document-controls"><button className="erp-button erp-button--quiet" type="button" onClick={onBack}>← Kho hàng</button><a className="erp-brand" href="/"><span>ERP</span><i>CÔNG NỢ</i></a><div className="erp-topbar__right"><button className="erp-button erp-button--quiet" type="button" onClick={() => setSection('documents')}>Mẫu chứng từ</button></div></header>
    <div className="erp-content erp-document-controls"><CustomerDebtPanel onBack={() => setSection('documents')} /></div>
  </main>

  return <main className="erp-page erp-document-mode">
    <header className="erp-topbar erp-document-controls"><button className="erp-button erp-button--quiet" type="button" onClick={onBack}>← Kho hàng</button><a className="erp-brand" href="/"><span>ERP</span><i>CHỨNG TỪ</i></a><div className="erp-topbar__right"><button className="erp-button erp-button--quiet" type="button" onClick={() => setSection('debts')}>Kiểm tra dư nợ</button><button className="erp-button erp-button--quiet" type="button" onClick={reset}>＋ Tạo mới</button></div></header>
    <div className="erp-content erp-document-controls">
      <section className="erp-titlebar"><div><p className="erp-eyebrow">MẪU IN A4 · GHI SỔ KHO</p><h1>Chứng từ bán hàng</h1><p className="erp-subtitle">Điền thông tin chứng từ, in bản giấy hoặc lưu để đồng bộ xuất kho.</p></div><div className="erp-document-actions"><button className="erp-button erp-button--outline" type="button" onClick={print}>In / Lưu PDF</button>{!readOnly && <button className="erp-button erp-button--dark" type="button" disabled={busy} onClick={save}>{busy ? 'Đang ghi...' : 'Lưu chứng từ & xuất kho'}</button>}</div></section>
      {(error || notice) && <div className={error ? 'erp-alert erp-alert--error' : 'erp-alert erp-alert--success'} role={error ? 'alert' : 'status'}>{error || notice}<button type="button" aria-label="Đóng thông báo" onClick={() => { setError(''); setNotice('') }}>×</button></div>}
      <div className="erp-document-layout">
        <section className="erp-document-editor">
          <div className="erp-document-type" role="tablist" aria-label="Chọn mẫu chứng từ">
            <button type="button" role="tab" aria-selected={type === 'salesInvoice'} disabled={readOnly} onClick={() => changeType('salesInvoice')}>Hóa đơn bán hàng</button>
            <button type="button" role="tab" aria-selected={type === 'stockIssue'} disabled={readOnly} onClick={() => changeType('stockIssue')}>Phiếu xuất kho</button>
          </div>
          <div className="erp-form-grid">
            <label>Số chứng từ<input disabled={readOnly} value={form.documentNumber} onChange={(event) => change('documentNumber', event.target.value)} /></label>
            <label>Ngày lập<input type="date" disabled={readOnly} value={form.documentDate} onChange={(event) => change('documentDate', event.target.value)} /></label>
            <label>Khách hàng<input disabled={readOnly} required value={form.customerName} onChange={(event) => change('customerName', event.target.value)} onBlur={(event) => { const match = customerDebts.find((item) => normalizeCustomerName(item.customerName) === normalizeCustomerName(event.target.value)); if (match && !form.customerPhone) change('customerPhone', match.customerPhone || '') }} /></label>
            {matchingCustomerDebt && <p className="erp-customer-debt-hint" aria-live="polite">Dư nợ hiện tại: <b>{money(matchingCustomerDebt.balance)} đ</b> · sau hóa đơn này: <b>{money(projectedBalance)} đ</b></p>}
            <label>Điện thoại<input disabled={readOnly} value={form.customerPhone} onChange={(event) => change('customerPhone', event.target.value)} /></label>
            <label className="erp-form-wide">Địa chỉ khách hàng<input disabled={readOnly} value={form.customerAddress} onChange={(event) => change('customerAddress', event.target.value)} /></label>
            <label>Ngày giao<input type="date" disabled={readOnly} value={form.deliveryDate} onChange={(event) => change('deliveryDate', event.target.value)} /></label>
            <label>Địa chỉ giao hàng<input disabled={readOnly} value={form.deliveryAddress} onChange={(event) => change('deliveryAddress', event.target.value)} /></label>
            {type === 'stockIssue' && <label className="erp-form-wide">Đơn vị xuất kho<input disabled={readOnly} value={form.issuerName} onChange={(event) => change('issuerName', event.target.value)} placeholder="Tên cửa hàng / công ty" /></label>}
            <label className="erp-form-wide">Ảnh minh họa giao hàng (URL)<input type="url" disabled={readOnly} value={form.imageUrl} onChange={(event) => change('imageUrl', event.target.value)} placeholder="https://..." /></label>
            {type === 'salesInvoice' && <>
              <label>Loại giá<select disabled={readOnly} value={form.priceType || 'retail'} onChange={(event) => changePriceType(event.target.value)}><option value="retail">Giá bán lẻ</option><option value="store">Giá cửa hàng</option></select></label>
              <div className="erp-settlement-mode erp-form-wide" role="group" aria-label="Hình thức thanh toán"><button type="button" aria-pressed={!form.isDebt} disabled={readOnly} onClick={() => change('isDebt', false)}>Đóng tiền · không ghi nợ</button><button type="button" aria-pressed={Boolean(form.isDebt)} disabled={readOnly} onClick={() => change('isDebt', true)}>Ghi nợ · ẩn giá khi in</button></div>
              <label>Nợ cũ<input type="number" min="0" step="0.01" disabled={readOnly} value={form.oldDebt} onChange={(event) => change('oldDebt', event.target.value)} /></label>
              <label>Tiền cọc<input type="number" min="0" step="0.01" disabled={readOnly} value={form.depositAmount} onChange={(event) => change('depositAmount', event.target.value)} /></label>
              {form.isDebt && <label>Khách trả trước<input type="number" min="0" step="0.01" disabled={readOnly} value={form.paidAmount} onChange={(event) => change('paidAmount', event.target.value)} /></label>}
              <label className="erp-form-wide">Thanh toán bằng chữ<input disabled={readOnly} value={form.paymentInWords} onChange={(event) => change('paymentInWords', event.target.value)} /></label>
            </>}
            <label className="erp-form-wide">Ghi chú<input disabled={readOnly} value={form.note} onChange={(event) => change('note', event.target.value)} /></label>
          </div>
          <div className="erp-document-line-editor">
            <div className="erp-document-line-heading"><h2>Hàng hóa</h2>{!readOnly && <button type="button" className="erp-button erp-button--outline" onClick={() => setForm((current) => ({ ...current, lines: [...current.lines, newLine()] }))}>＋ Thêm dòng</button>}</div>
            {form.lines.map((line, index) => {
              const product = productById.get(line.productId)
              return <div className="erp-document-line" key={line.key}>
                <span className="erp-document-line__number">{index + 1}</span>
                <label className="erp-line-product">Hàng hóa<select disabled={readOnly} value={line.productId} onChange={(event) => chooseProduct(line, event.target.value)}><option value="">Chọn hàng</option>{products.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.sku}</option>)}</select></label>
                <label>Số lượng<input type="number" min="0.001" step="0.001" disabled={readOnly} value={line.quantity} onChange={(event) => changeLine(line.key, 'quantity', event.target.value)} /></label>
                {type === 'salesInvoice' ? <label>Đơn giá<input type="number" min="0" step="0.01" readOnly value={line.unitPrice} /></label> : <label>Trọng lượng<input type="number" min="0" step="0.001" disabled={readOnly} value={line.weight} onChange={(event) => changeLine(line.key, 'weight', event.target.value)} /></label>}
                <small>{product ? `${product.sku} · ${product.unit} · tồn ${quantityText(product.currentStock)}` : 'Chưa chọn hàng'}</small>
                {!readOnly && form.lines.length > 1 && <button type="button" className="erp-line-remove" aria-label={`Bỏ dòng ${index + 1}`} onClick={() => setForm((current) => ({ ...current, lines: current.lines.filter((item) => item.key !== line.key) }))}>×</button>}
              </div>
            })}
          </div>
        </section>

        <aside className="erp-saved-documents"><h2>Chứng từ gần đây</h2>{documents.length === 0 ? <p>Chưa có chứng từ đã lưu.</p> : documents.slice(0, 12).map((document) => <button key={document._id} type="button" onClick={() => reopen(document._id)}><span><strong>{document.documentNumber}</strong><small>{document.customerName} · {printedDate(new Date(document.documentDate).toISOString().slice(0, 10))}</small></span><i>{document.type === 'salesInvoice' ? 'Hóa đơn' : 'Phiếu xuất'}</i></button>)}</aside>
      </div>
    </div>

    <article className={`erp-paper erp-paper--${type}`} aria-label={type === 'salesInvoice' ? 'Hóa đơn bán hàng' : 'Phiếu xuất kho'}>
      {type === 'salesInvoice' ? <>
        <header className="erp-paper__invoice-heading"><h1>HÓA ĐƠN BÁN HÀNG</h1><div className="erp-paper__number"><span>HĐ:</span><strong>{form.documentNumber}</strong><time>{printedDate(form.documentDate)}</time></div></header>
        <div className="erp-paper__customer"><b>Khách hàng:</b><strong>{form.customerName || '........................................................'}</strong></div>
        <div className="erp-paper__meta"><span>ĐTDD:</span><b>{form.customerPhone || ' '}</b></div>
        <div className="erp-paper__meta"><span>Địa chỉ:</span><b>{form.customerAddress || ' '}</b></div>
        <div className="erp-paper__meta"><span>Ngày giao:</span><b>{printedDate(form.deliveryDate)}</b><span>Mã hóa vận:</span><b>{form.deliveryAddress || ' '}</b></div>
        <table className={`erp-paper__table erp-paper__table--invoice${form.isDebt ? ' is-debt' : ''}`}><thead><tr><th>TT</th><th>Mã hàng</th><th>Tên hàng</th><th>Đơn vị</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>
          {form.lines.map((line, index) => { const product = productById.get(line.productId); return <tr key={line.key}><td>{index + 1}</td><td>{product?.sku || ''}</td><td>{product?.name || ''}</td><td>{product?.unit || ''}</td><td>{quantityText(line.quantity)}</td><td>{form.isDebt ? '' : money(line.unitPrice)}</td><td>{form.isDebt ? '' : money(Number(line.quantity || 0) * Number(line.unitPrice || 0))}</td></tr> })}
          {Array.from({ length: Math.max(0, 10 - form.lines.length) }, (_, index) => <tr className="erp-paper__blank-row" key={`blank-${index}`}><td>{form.lines.length + index + 1}</td><td /><td /><td /><td /><td /><td /></tr>)}
        </tbody></table>
        {form.isDebt && <p className="erp-paper__debt-stamp">GHI NỢ KHÁCH HÀNG</p>}
        <div className="erp-paper__totals"><p><span>Phải thanh toán:</span><strong>{form.isDebt ? '' : money(total + Number(form.oldDebt || 0))}</strong></p><p><span>Nợ cũ:</span><strong>{form.isDebt ? '' : money(form.oldDebt)}</strong></p><p><span>Tiền hàng:</span><strong>{form.isDebt ? '' : money(total)}</strong></p><p><span>Đặt cọc:</span><strong>{form.isDebt ? '' : money(form.depositAmount)}</strong></p><p><span>Thanh toán hết:</span><strong>{form.isDebt ? '' : money(total + Number(form.oldDebt || 0))}</strong></p></div>
        <p className="erp-paper__words"><b>Thanh toán hết bằng chữ:</b><span>{form.isDebt ? '' : form.paymentInWords || '........................................................................................................'}</span></p>
        <p className="erp-paper__note"><b>Ghi chú:</b><span>{form.note || 'Cảm ơn quý khách đã ủng hộ cửa hàng.'}</span></p>
        <footer className="erp-paper__signatures"><span>KHÁCH HÀNG</span><span>NGƯỜI LẬP PHIẾU</span></footer>
      </> : <>
        <header className="erp-paper__issue-heading"><div><small>{form.issuerName || 'ĐƠN VỊ: CỬA HÀNG'}</small><h1>PHIẾU XUẤT KHO</h1></div><div><span>Số: <b>{form.documentNumber}</b></span><time>{printedDate(form.documentDate)}</time></div></header>
        <div className="erp-paper__issue-meta"><p><b>Khách hàng:</b><span>{form.customerName || '................................................'}</span><b>Điện thoại:</b><span>{form.customerPhone || ' '}</span></p><p><b>Địa chỉ:</b><span>{form.customerAddress || ' '}</span></p><p><b>Địa chỉ giao hàng:</b><span>{form.deliveryAddress || form.customerAddress || ' '}</span><b>Ngày giao:</b><span>{printedDate(form.deliveryDate)}</span></p></div>
        <table className="erp-paper__table erp-paper__table--issue"><thead><tr><th>Stt</th><th>Mã hàng</th><th>Tên hàng</th><th>Đơn vị</th><th>Số lượng</th><th>Ghi chú (hộp, bao...)</th><th>Trọng lượng</th></tr></thead><tbody>
          {form.lines.map((line, index) => { const product = productById.get(line.productId); return <tr key={line.key}><td>{index + 1}</td><td>{product?.sku || ''}</td><td>{product?.name || ''}</td><td>{product?.unit || ''}</td><td>{quantityText(line.quantity)}</td><td>{line.packageNote || ''}</td><td>{quantityText(line.weight)}</td></tr> })}
          {Array.from({ length: Math.max(0, 12 - form.lines.length) }, (_, index) => <tr className="erp-paper__blank-row" key={`blank-${index}`}><td>{form.lines.length + index + 1}</td><td /><td /><td /><td /><td /><td /></tr>)}
        </tbody></table>
        <div className="erp-paper__issue-total"><span>Tổng trọng lượng:</span><strong>{quantityText(totalWeight)} Kg</strong></div>
        {form.imageUrl && <p className="erp-paper__image-url">Ảnh giao hàng: {form.imageUrl}</p>}
        <p className="erp-paper__issue-note"><b>Ghi chú:</b><span>{form.note || ' '}</span></p>
        <footer className="erp-paper__issue-signatures"><span>Người mua hàng<br />(ký, ghi rõ họ tên)</span><span>Người nhận hàng<br />(ký, ghi rõ họ tên)</span><span>Người giao hàng<br />(ký, ghi rõ họ tên)</span></footer>
      </>}
    </article>
  </main>
}
