import { useEffect, useMemo, useState, useTransition } from 'react'
import { createErpReceiptBatch, downloadErpWorkbook, getErpMovements, getErpProducts, saveErpMovement, saveErpProduct } from '../services/erpApi.js'
import ErpDocuments from '../components/ErpDocuments.jsx'
import '../styles/erp.css'

const labels = { receipt: 'Nhập kho', issue: 'Xuất kho', stocktake: 'Kiểm kê' }
const warehouses = [['thanh-phu', 'Kho Thanh Phú'], ['duc-hoa', 'Kho Đức Hòa'], ['ben-luc', 'Kho Bến Lức']]
const warehouseStock = (product, warehouse) => {
  const stocks = product.warehouseStocks || {}
  const recordedTotal = (stocks['thanh-phu'] || 0) + (stocks['duc-hoa'] || 0) + (stocks['ben-luc'] || 0)
  if (!recordedTotal && product.currentStock > 0) return warehouse === 'thanh-phu' ? product.currentStock : 0
  return stocks[warehouse] || 0
}
const currentPeriod = () => {
  const now = new Date()
  return { year: String(now.getFullYear()), month: String(now.getMonth() + 1) }
}
const localInputDate = (value) => {
  const date = value ? new Date(value) : new Date()
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
const formatDate = (value) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))

function ProductEditor({ product, onClose, onSaved }) {
  const [form, setForm] = useState({
    sku: product?.sku || '', name: product?.name || '', category: product?.category || '',
    unit: product?.unit || 'cái', description: product?.description || '',
    salePrice: product?.salePrice ?? 0, storePrice: product?.storePrice ?? 0, weightPerUnit: product?.weightPerUnit ?? 0,
    reorderLevel: product?.reorderLevel ?? 0, isActive: product?.isActive ?? true,
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const change = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await saveErpProduct(product?._id, {
        ...form,
        salePrice: Number(form.salePrice),
        storePrice: Number(form.storePrice),
        weightPerUnit: Number(form.weightPerUnit),
        reorderLevel: Number(form.reorderLevel),
      })
      await onSaved()
      onClose()
    } catch (saveError) { setError(saveError.message) }
    finally { setBusy(false) }
  }
  return <div className="erp-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="erp-dialog" role="dialog" aria-modal="true" aria-labelledby="product-editor-title">
      <header><div><p className="erp-eyebrow">DANH MỤC</p><h2 id="product-editor-title">{product ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}</h2></div><button className="erp-icon-button" type="button" aria-label="Đóng" onClick={onClose}>×</button></header>
      <form className="erp-form-grid" onSubmit={submit}>
        <label>Mã SKU<input required maxLength={60} value={form.sku} onChange={(event) => change('sku', event.target.value)} /></label>
        <label>Tên sản phẩm<input required maxLength={160} value={form.name} onChange={(event) => change('name', event.target.value)} /></label>
        <label>Nhóm hàng<input value={form.category} onChange={(event) => change('category', event.target.value)} /></label>
        <label>Đơn vị<input required value={form.unit} onChange={(event) => change('unit', event.target.value)} /></label>
        <label>Giá bán lẻ<input type="number" min="0" step="0.01" value={form.salePrice} onChange={(event) => change('salePrice', event.target.value)} /></label>
        <label>Giá cửa hàng<input type="number" min="0" step="0.01" value={form.storePrice} onChange={(event) => change('storePrice', event.target.value)} /></label>
        <label>Trọng lượng / đơn vị (kg)<input type="number" min="0" step="0.001" value={form.weightPerUnit} onChange={(event) => change('weightPerUnit', event.target.value)} /></label>
        <label>Mức tồn tối thiểu<input type="number" min="0" step="1" value={form.reorderLevel} onChange={(event) => change('reorderLevel', event.target.value)} /></label>
        {product && <label className="erp-checkbox"><input type="checkbox" checked={form.isActive} onChange={(event) => change('isActive', event.target.checked)} /> Đang kinh doanh</label>}
        <label className="erp-form-wide">Mô tả<textarea rows="3" maxLength={1000} value={form.description} onChange={(event) => change('description', event.target.value)} /></label>
        {error && <p className="erp-error erp-form-wide" role="alert">{error}</p>}
        <footer className="erp-form-wide"><button type="button" className="erp-button" onClick={onClose}>Hủy</button><button className="erp-button erp-button--dark" disabled={busy}>{busy ? 'Đang lưu...' : 'Lưu sản phẩm'}</button></footer>
      </form>
    </section>
  </div>
}

function MovementEditor({ products, movement, onClose, onSaved }) {
  const isEditing = Boolean(movement?._id)
  const [form, setForm] = useState({
    productId: movement?.productId?._id || movement?.productId || '',
    type: movement?.type || 'receipt', quantity: movement?.quantity ?? '', warehouse: movement?.warehouse || 'thanh-phu',
    customerName: movement?.customerName || '', imageUrl: movement?.imageUrl || '',
    reference: movement?.reference || '', note: movement?.note || '',
    movementDate: localInputDate(movement?.movementDate),
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const change = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await saveErpMovement(movement?._id || null, {
        ...form,
        type: isEditing ? form.type : 'receipt',
        quantity: Number(form.quantity),
        movementDate: new Date(form.movementDate).toISOString(),
      })
      await onSaved()
      onClose()
    } catch (saveError) { setError(saveError.message) }
    finally { setBusy(false) }
  }
  return <div className="erp-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="erp-dialog" role="dialog" aria-modal="true" aria-labelledby="movement-editor-title">
      <header><div><p className="erp-eyebrow">SỔ GIAO DỊCH</p><h2 id="movement-editor-title">{isEditing ? 'Điều chỉnh chứng từ' : 'Lập phiếu nhập kho'}</h2></div><button className="erp-icon-button" type="button" aria-label="Đóng" onClick={onClose}>×</button></header>
      <form className="erp-form-grid" onSubmit={submit}>
        {isEditing && <label>Loại chứng từ<select value={form.type} onChange={(event) => change('type', event.target.value)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
        <label>Sản phẩm<select required value={form.productId} onChange={(event) => change('productId', event.target.value)}><option value="">Chọn sản phẩm</option>{products.filter((item) => item.isActive || item._id === form.productId).map((item) => <option key={item._id} value={item._id}>{item.name} · {item.sku}</option>)}</select></label>
        <label>{form.type === 'stocktake' ? 'Tồn thực tế' : 'Số lượng'}<input type="number" min="0" step="1" required value={form.quantity} onChange={(event) => change('quantity', event.target.value)} /></label>
        <label>Kho<select value={form.warehouse} onChange={(event) => change('warehouse', event.target.value)}>{warehouses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Ngày giờ<input type="datetime-local" required value={form.movementDate} onChange={(event) => change('movementDate', event.target.value)} /></label>
        {form.type === 'issue' && isEditing && <>
          <label>Khách hàng<input required value={form.customerName} onChange={(event) => change('customerName', event.target.value)} /></label>
          <label>URL ảnh xuất hàng<input required type="url" placeholder="https://..." value={form.imageUrl} onChange={(event) => change('imageUrl', event.target.value)} /></label>
        </>}
        <label>Mã tham chiếu<input maxLength="100" value={form.reference} onChange={(event) => change('reference', event.target.value)} /></label>
        <label className="erp-form-wide">Ghi chú<textarea rows="3" maxLength="1000" value={form.note} onChange={(event) => change('note', event.target.value)} /></label>
        {error && <p className="erp-error erp-form-wide" role="alert">{error}</p>}
        <footer className="erp-form-wide"><button type="button" className="erp-button" onClick={onClose}>Hủy</button><button className="erp-button erp-button--dark" disabled={busy}>{busy ? 'Đang lưu...' : isEditing ? 'Lưu chỉnh sửa' : 'Nhập hàng vào kho'}</button></footer>
      </form>
    </section>
  </div>
}

let receiptLineSequence = 0
const newReceiptLine = () => ({ key: `receipt-${Date.now()}-${receiptLineSequence++}`, productId: '', quantity: '', note: '' })

function ReceiptBatchEditor({ products, onClose, onSaved }) {
  const [lines, setLines] = useState([newReceiptLine()])
  const [movementDate, setMovementDate] = useState(localInputDate())
  const [warehouse, setWarehouse] = useState('thanh-phu')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const productById = new Map(products.map((product) => [product._id, product]))
  const updateLine = (key, field, value) => setLines((current) => current.map((line) => line.key === key ? { ...line, [field]: value } : line))

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await createErpReceiptBatch({
        movementDate: new Date(movementDate).toISOString(),
        warehouse,
        reference,
        note,
        lines: lines.map(({ key, ...line }) => ({ ...line, quantity: Number(line.quantity) })),
      })
      await onSaved()
      onClose()
    } catch (saveError) { setError(saveError.message) }
    finally { setBusy(false) }
  }

  return <div className="erp-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="erp-dialog erp-receipt-dialog" role="dialog" aria-modal="true" aria-labelledby="receipt-batch-title">
      <header><div><p className="erp-eyebrow">NHẬP KHO · NHIỀU MẶT HÀNG</p><h2 id="receipt-batch-title">Lập phiếu nhập kho</h2></div><button className="erp-icon-button" type="button" aria-label="Đóng" onClick={onClose}>×</button></header>
      <form onSubmit={submit}>
        <div className="erp-form-grid">
          <label>Kho nhập<select value={warehouse} onChange={(event) => setWarehouse(event.target.value)}>{warehouses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Ngày giờ nhập<input type="datetime-local" required value={movementDate} onChange={(event) => setMovementDate(event.target.value)} /></label>
          <label>Số phiếu / tham chiếu<input maxLength="100" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Tự sinh nếu để trống" /></label>
          <label className="erp-form-wide">Ghi chú chung<input maxLength="1000" value={note} onChange={(event) => setNote(event.target.value)} /></label>
        </div>
        <div className="erp-receipt-lines-heading"><h3>Danh sách hàng nhập</h3><button type="button" className="erp-button erp-button--outline" onClick={() => setLines((current) => [...current, newReceiptLine()])}>＋ Thêm mặt hàng</button></div>
        <div className="erp-receipt-lines">
          {lines.map((line, index) => {
            const product = productById.get(line.productId)
            return <div className="erp-receipt-line" key={line.key}>
              <span className="erp-document-line__number">{index + 1}</span>
              <label className="erp-receipt-product">Sản phẩm<select required value={line.productId} onChange={(event) => updateLine(line.key, 'productId', event.target.value)}><option value="">Chọn sản phẩm</option>{products.filter((item) => item.isActive).map((item) => <option key={item._id} value={item._id}>{item.name} · {item.sku}</option>)}</select><small>{product ? `Tồn hiện tại: ${quantityText(product.currentStock)} ${product.unit}` : 'Chọn mặt hàng trong danh mục'}</small></label>
              <label>Số lượng nhập<input type="number" min="0.001" step="0.001" required value={line.quantity} onChange={(event) => updateLine(line.key, 'quantity', event.target.value)} /></label>
              <label>Ghi chú dòng<input maxLength="1000" value={line.note} onChange={(event) => updateLine(line.key, 'note', event.target.value)} /></label>
              <button type="button" className="erp-line-remove" aria-label={`Bỏ mặt hàng ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}>×</button>
            </div>
          })}
        </div>
        {error && <p className="erp-error" role="alert">{error}</p>}
        <footer className="erp-receipt-actions"><button type="button" className="erp-button" onClick={onClose}>Hủy</button><button type="submit" className="erp-button erp-button--dark" disabled={busy || !products.length}>{busy ? 'Đang ghi phiếu...' : `Nhập ${lines.length} mặt hàng`}</button></footer>
      </form>
    </section>
  </div>
}

export default function ErpPage() {
  const period = useMemo(currentPeriod, [])
  const [year, setYear] = useState(period.year)
  const [month, setMonth] = useState(period.month)
  const [products, setProducts] = useState([])
  const [movements, setMovements] = useState([])
  const [tab, setTab] = useState('ledger')
  const [isTabPending, startTabTransition] = useTransition()
  const [documentsMode, setDocumentsMode] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [activeKeyword, setActiveKeyword] = useState('')
  const [productEditor, setProductEditor] = useState(null)
  const [movementEditor, setMovementEditor] = useState(null)
  const [receiptEditorOpen, setReceiptEditorOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reloadId, setReloadId] = useState(0)

  const refresh = async () => {
    const [productRows, movementRows] = await Promise.all([
      getErpProducts(),
      getErpMovements({ year, month, productName: activeKeyword, shippedOnly: tab === 'shipments' }),
    ])
    setProducts(productRows)
    setMovements(movementRows)
    setError('')
  }

  useEffect(() => {
    let alive = true
    getErpProducts().then((productRows) => {
      if (alive) setProducts(productRows)
    }).catch((loadError) => {
      if (alive) setError(loadError.message)
    })
    return () => { alive = false }
  }, [reloadId])

  useEffect(() => {
    if (tab === 'products') { setBusy(false); return undefined }
    let alive = true
    setBusy(true)
    getErpMovements({ year, month, productName: activeKeyword, shippedOnly: tab === 'shipments' })
      .then((movementRows) => {
        if (!alive) return
        setMovements(movementRows)
        setError('')
      }).catch((loadError) => {
        if (alive) setError(loadError.message)
      }).finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [year, month, activeKeyword, tab, reloadId])

  const search = (event) => { event.preventDefault(); setActiveKeyword(keyword.trim()) }
  const handleMovementSaved = async () => { await refresh(); setNotice('Đã lưu chứng từ và cập nhật tồn kho.') }
  const handleProductSaved = () => { setReloadId((value) => value + 1); setNotice('Đã lưu thông tin sản phẩm.') }
  const exportExcel = async () => {
    setBusy(true)
    setError('')
    try { await downloadErpWorkbook({ year, month }); setNotice(`Đã xuất sổ kho tháng ${String(month).padStart(2, '0')}/${year}.`) }
    catch (exportError) { setError(exportError.message) }
    finally { setBusy(false) }
  }

  const totalUnits = products.reduce((sum, product) => sum + (product.currentStock || 0), 0)
  const lowStock = products.filter((product) => product.currentStock <= product.reorderLevel).length

  if (documentsMode) {
    return <ErpDocuments
      products={products}
      onBack={() => setDocumentsMode(false)}
      onSaved={async () => { await refresh(); setReloadId((value) => value + 1) }}
    />
  }

  return <main className="erp-page">
    <header className="erp-topbar"><a className="erp-brand" href="/erp"><span>ERP</span><i>INVENTORY</i></a><div className="erp-topbar__right"><span className="erp-connection"><i />{error ? 'Lỗi kết nối' : busy ? 'Đang đồng bộ' : 'Đã kết nối'}</span><button className="erp-button erp-button--quiet" type="button" onClick={() => setDocumentsMode(true)}>Mẫu chứng từ</button></div></header>
    <div className="erp-content">
      <section className="erp-titlebar"><div><p className="erp-eyebrow">ĐIỀU HÀNH · KHO HÀNG</p><h1>Quản lý tồn kho</h1><p className="erp-subtitle">Theo dõi luân chuyển hàng hóa, đối chiếu tồn và tra cứu giao hàng.</p></div><button type="button" className="erp-button erp-button--dark" onClick={() => setReceiptEditorOpen(true)}>＋ Lập phiếu nhập</button></section>
      {(error || notice) && <div className={error ? 'erp-alert erp-alert--error' : 'erp-alert erp-alert--success'} role={error ? 'alert' : 'status'}>{error || notice}<button type="button" aria-label="Đóng thông báo" onClick={() => { setError(''); setNotice('') }}>×</button></div>}

      <section className="erp-metrics" aria-label="Tổng quan kho">
        <div><span>Mã hàng đang quản lý</span><strong>{products.length}</strong><small>Danh mục sản phẩm</small></div>
        <div><span>Tổng số lượng tồn</span><strong>{totalUnits.toLocaleString('vi-VN')}</strong><small>Đơn vị hàng hóa</small></div>
        <div className={lowStock ? 'erp-metric-warning' : ''}><span>Cần bổ sung</span><strong>{lowStock}</strong><small>Dưới mức tồn tối thiểu</small></div>
      </section>

      <section className={`erp-ledger${isTabPending ? ' is-tab-pending' : ''}`}>
        <div className="erp-ledger-toolbar">
          <div className="erp-tabs" role="tablist" aria-label="Dữ liệu kho">
            {[['ledger', 'Sổ giao dịch'], ['shipments', 'Hàng đã xuất'], ['products', 'Sản phẩm']].map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => startTabTransition(() => setTab(value))}>{label}</button>)}
          </div>
          <div className="erp-period-tools"><label>Tháng<select value={month} onChange={(event) => setMonth(event.target.value)}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{String(index + 1).padStart(2, '0')}</option>)}</select></label><label>Năm<input type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(event.target.value)} /></label><button className="erp-button erp-button--outline" type="button" onClick={exportExcel} disabled={busy}>↓ Excel</button></div>
        </div>

        {tab !== 'products' && <div className="erp-filterbar"><form onSubmit={search}><label htmlFor="erp-product-query">Tìm theo tên hàng</label><div><input id="erp-product-query" placeholder="Tên sản phẩm đã nhập hoặc xuất" value={keyword} onChange={(event) => setKeyword(event.target.value)} /><button className="erp-button erp-button--outline" type="submit">Tìm kiếm</button></div></form><span>{movements.length} chứng từ · {String(month).padStart(2, '0')}/{year}</span></div>}

        {tab === 'products' ? <>
          <div className="erp-table-heading"><div><h2>Danh mục sản phẩm</h2><p>Thông tin hàng hóa và số tồn hiện tại</p></div><button className="erp-button erp-button--outline" type="button" onClick={() => setProductEditor({})}>＋ Thêm sản phẩm</button></div>
          <div className="erp-table-scroll"><table><thead><tr><th>SKU</th><th>Tên sản phẩm</th><th>Nhóm</th><th>Đơn vị</th><th>Giá bán lẻ</th><th>Giá cửa hàng</th><th>Kg / đơn vị</th><th>Tồn kho (Thanh Phú · Đức Hòa · Bến Lức / tổng)</th><th>Mức tối thiểu</th><th>Trạng thái</th><th /></tr></thead><tbody>{products.map((product) => <tr key={product._id}><td className="erp-mono">{product.sku}</td><td><strong>{product.name}</strong></td><td>{product.category || '—'}</td><td>{product.unit}</td><td>{Number(product.salePrice || 0).toLocaleString('vi-VN')}</td><td>{Number(product.storePrice || 0).toLocaleString('vi-VN')}</td><td>{Number(product.weightPerUnit || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 })}</td><td className={product.currentStock <= product.reorderLevel ? 'erp-stock-low' : ''}>{`${warehouseStock(product, 'thanh-phu')} · ${warehouseStock(product, 'duc-hoa')} · ${warehouseStock(product, 'ben-luc')} / ${product.currentStock}`}</td><td>{product.reorderLevel}</td><td><span className={product.isActive ? 'erp-status erp-status--active' : 'erp-status'}>{product.isActive ? 'Đang bán' : 'Ngừng bán'}</span></td><td><button className="erp-text-button" type="button" onClick={() => setProductEditor(product)}>Chỉnh sửa</button></td></tr>)}</tbody></table></div>
        </> : <div className="erp-table-scroll"><table><thead><tr><th>Ngày giờ</th><th>Loại</th><th>Kho</th><th>SKU / Sản phẩm</th><th>Số lượng</th><th>Tồn trước → sau</th><th>Khách hàng</th><th>Ảnh hàng xuất</th><th>Tham chiếu / ghi chú</th><th /></tr></thead><tbody>{movements.map((item) => <tr key={item._id}><td className="erp-date-cell">{formatDate(item.movementDate)}</td><td><span className={`erp-movement-type erp-movement-type--${item.type}`}>{labels[item.type]}</span></td><td>{warehouses.find(([value]) => value === (item.warehouse || 'thanh-phu'))?.[1] || 'Kho Thanh Phú'}</td><td><strong>{item.productName}</strong><small className="erp-table-subline">{item.sku}</small></td><td>{item.quantity}{item.type === 'stocktake' && ' thực tế'}</td><td>{item.stockBefore} → {item.stockAfter}</td><td>{item.customerName || '—'}</td><td>{item.imageUrl ? <a href={item.imageUrl} target="_blank" rel="noreferrer" className="erp-image-link">Xem ảnh ↗</a> : '—'}</td><td>{[item.reference, item.note].filter(Boolean).join(' · ') || '—'}</td><td><button className="erp-text-button" type="button" onClick={() => setMovementEditor(item)}>Sửa</button></td></tr>)}</tbody></table>{!busy && movements.length === 0 && <p className="erp-empty">Không có chứng từ trong kỳ này.</p>}{busy && <p className="erp-empty">Đang đồng bộ dữ liệu...</p>}</div>}
      </section>
      <p className="erp-footnote">Mọi thay đổi tồn được ghi nhận qua chứng từ. Điều chỉnh ngày hoặc số lượng sẽ tính lại tồn theo lịch sử.</p>
    </div>
    {productEditor && <ProductEditor product={productEditor._id ? productEditor : null} onClose={() => setProductEditor(null)} onSaved={handleProductSaved} />}
    {receiptEditorOpen && <ReceiptBatchEditor products={products} onClose={() => setReceiptEditorOpen(false)} onSaved={handleMovementSaved} />}
    {movementEditor && <MovementEditor products={products} movement={movementEditor._id ? movementEditor : null} onClose={() => setMovementEditor(null)} onSaved={handleMovementSaved} />}
  </main>
}
