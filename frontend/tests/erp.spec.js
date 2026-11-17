import { test, expect } from '@playwright/test'

const product = {
	_id: 'product-1', sku: 'COFFEE-01', name: 'Ca phe rang', category: 'Do uong', unit: 'kg',
	currentStock: 16, salePrice: 125, storePrice: 90, weightPerUnit: 0.25, reorderLevel: 4, isActive: true,
}

test('ERP dashboard loads product and monthly ledger without authentication', async ({ page }) => {
	const requests = []
	await page.route('http://localhost:5000/**', async (route) => {
		const request = route.request()
		const url = new URL(request.url())
		requests.push({ path: url.pathname, headers: request.headers() })
		if (url.pathname === '/erp/products') return route.fulfill({ json: { success: true, data: [product] } })
		if (url.pathname === '/erp/movements') return route.fulfill({ json: { success: true, data: [] } })
		return route.fulfill({ status: 404, json: { success: false, message: 'Not found' } })
	})

	await page.goto('/')
	await expect(page.getByRole('heading', { name: 'Quản lý tồn kho' })).toBeVisible()
	await page.getByRole('tab', { name: 'Sản phẩm' }).click()
	await expect(page.getByText('Ca phe rang', { exact: true })).toBeVisible()
	expect(requests.some((entry) => entry.path === '/erp/products')).toBe(true)
	expect(requests.every((entry) => !entry.headers.authorization)).toBe(true)
})

test('ERP product editor updates product details', async ({ page }) => {
	let updateRequest
	await page.route('http://localhost:5000/**', async (route) => {
		const request = route.request()
		const url = new URL(request.url())
		if (url.pathname === '/erp/products' && request.method() === 'GET') return route.fulfill({ json: { success: true, data: [product] } })
		if (url.pathname === '/erp/movements' && request.method() === 'GET') return route.fulfill({ json: { success: true, data: [] } })
		if (url.pathname === `/erp/products/${product._id}` && request.method() === 'PUT') {
			updateRequest = request.postDataJSON()
			return route.fulfill({ json: { success: true, data: { ...product, ...updateRequest } } })
		}
		return route.fulfill({ status: 404, json: { success: false, message: 'Not found' } })
	})

	await page.goto('/')
	await page.getByRole('tab', { name: 'Sản phẩm' }).click()
	await page.getByRole('button', { name: 'Chỉnh sửa' }).click()
	await expect(page.getByRole('heading', { name: 'Sửa sản phẩm' })).toBeVisible()
	await page.getByLabel('Tên sản phẩm').fill('Cà phê Arabica')
	await page.getByLabel('Giá bán lẻ').fill('145000')
	await page.getByLabel('Mức tồn tối thiểu').fill('6')
	await page.getByRole('button', { name: 'Lưu sản phẩm' }).click()

	await expect(page.locator('.erp-alert--success')).toContainText('Đã lưu thông tin sản phẩm')
	expect(updateRequest).toMatchObject({
		name: 'Cà phê Arabica', salePrice: 145000, reorderLevel: 6,
	})
})

test('ERP invoice and warehouse slip templates save their line items', async ({ page }) => {
	const documentRequests = []
	await page.route('http://localhost:5000/**', async (route) => {
		const request = route.request()
		const url = new URL(request.url())
		const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : undefined
		if (url.pathname === '/erp/products' && request.method() === 'GET') return route.fulfill({ json: { success: true, data: [product] } })
		if (url.pathname === '/erp/movements' && request.method() === 'GET') return route.fulfill({ json: { success: true, data: [] } })
		if (url.pathname === '/erp/documents' && request.method() === 'GET') return route.fulfill({ json: { success: true, data: [] } })
		if (url.pathname === '/erp/debts' && request.method() === 'GET') return route.fulfill({ json: { success: true, data: [] } })
		if (url.pathname === '/erp/documents' && request.method() === 'POST') {
			documentRequests.push(body)
			return route.fulfill({ status: 201, json: { success: true, data: { _id: `doc-${documentRequests.length}`, ...body, lines: body.lines.map((line, index) => ({ ...line, movementId: `movement-${index}` })) } } })
		}
		return route.fulfill({ status: 404, json: { success: false, message: 'Not found' } })
	})

	await page.goto('/')
	await page.getByRole('button', { name: 'Mẫu chứng từ' }).click()
	await expect(page.getByRole('heading', { name: 'Chứng từ bán hàng' })).toBeVisible()
	await page.getByLabel('Khách hàng', { exact: true }).fill('Nguyen An')
	await page.getByLabel('Hàng hóa').selectOption(product._id)
	await expect(page.getByLabel('Đơn giá')).toHaveValue('125')
	await page.getByLabel('Loại giá').selectOption('store')
	await expect(page.getByLabel('Đơn giá')).toHaveValue('90')
	await page.getByLabel('Loại giá').selectOption('retail')
	await expect(page.getByLabel('Đơn giá')).toHaveValue('125')
	await page.getByLabel('Số lượng').fill('1.5')
	await page.getByRole('button', { name: 'Lưu chứng từ & xuất kho' }).click()
	await expect(page.locator('.erp-alert--success')).toContainText('Đã lưu chứng từ')
	expect(documentRequests[0]).toMatchObject({
		type: 'salesInvoice', customerName: 'Nguyen An', priceType: 'retail', isDebt: false,
		lines: [{ productId: product._id, quantity: 1.5, unitPrice: 125 }],
	})

	await page.getByRole('button', { name: '＋ Tạo mới' }).click()
	await page.getByRole('tab', { name: 'Phiếu xuất kho' }).click()
	await page.getByLabel('Khách hàng', { exact: true }).fill('Cong ty Minh Phat')
	await page.getByLabel('Hàng hóa').selectOption(product._id)
	await page.getByLabel('Số lượng').fill('2.25')
	await expect(page.getByLabel('Trọng lượng')).toHaveValue('0.5625')
	await page.getByLabel('Trọng lượng').fill('15.5')
	await page.getByLabel('Địa chỉ giao hàng').fill('Duc Hoa, Long An')
	await page.getByRole('button', { name: 'Lưu chứng từ & xuất kho' }).click()
	await expect(page.locator('.erp-alert--success')).toContainText('Đã lưu chứng từ')
	expect(documentRequests[1]).toMatchObject({
		type: 'stockIssue', customerName: 'Cong ty Minh Phat', deliveryAddress: 'Duc Hoa, Long An',
		lines: [{ productId: product._id, quantity: 2.25, weight: 15.5 }],
	})
	await page.emulateMedia({ media: 'print' })
	expect(await page.locator('.erp-paper').evaluate((element) => getComputedStyle(element).visibility)).toBe('visible')
	expect(await page.locator('.erp-document-controls').first().evaluate((element) => getComputedStyle(element).visibility)).toBe('hidden')
})

test('credit invoice hides prices in print and debt payment requires an uploaded proof image', async ({ page }) => {
	const payments = []
	const invoices = []
	await page.route('http://localhost:5000/**', async (route) => {
		const request = route.request()
		const url = new URL(request.url())
		const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : undefined
		if (url.pathname === '/erp/products' && request.method() === 'GET') return route.fulfill({ json: { success: true, data: [product] } })
		if (url.pathname === '/erp/movements' && request.method() === 'GET') return route.fulfill({ json: { success: true, data: [] } })
		if (url.pathname === '/erp/documents' && request.method() === 'GET') return route.fulfill({ json: { success: true, data: [] } })
		if (url.pathname === '/erp/documents' && request.method() === 'POST') {
			invoices.push(body)
			return route.fulfill({ status: 201, json: { success: true, data: { _id: 'debt-doc', ...body, lines: body.lines.map((line) => ({ ...line, movementId: 'debt-movement' })) } } })
		}
		if (url.pathname === '/erp/debts' && request.method() === 'GET') return route.fulfill({ json: { success: true, data: [{ customerKey: 'nguyen an|0901234567', customerName: 'Nguyen An', customerPhone: '0901234567', balance: 180, invoiceCount: 1, invoices: [{ _id: 'debt-doc', documentNumber: 'HD-DEBT', documentDate: '2026-03-05T05:00:00.000Z', balance: 180 }] }] } })
		if (url.pathname.endsWith('/payments') && request.method() === 'GET') return route.fulfill({ json: { success: true, data: payments } })
		if (url.pathname === '/erp/uploads/payment-proof' && request.method() === 'POST') return route.fulfill({ status: 201, json: { success: true, data: { secure_url: 'https://res.cloudinary.com/demo/payment-proof.png' } } })
		if (url.pathname === '/erp/payments' && request.method() === 'POST') {
			payments.push({ _id: `payment-${payments.length + 1}`, ...body })
			return route.fulfill({ status: 201, json: { success: true, data: { _id: 'payment-1', ...body } } })
		}
		return route.fulfill({ status: 404, json: { success: false, message: 'Not found' } })
	})

	await page.goto('/')
	await page.getByRole('button', { name: 'Mẫu chứng từ' }).click()
	await page.getByLabel('Khách hàng', { exact: true }).fill('Nguyen An')
	await expect(page.getByText(/Dư nợ hiện tại: 180 đ/)).toBeVisible()
	await page.getByLabel('Hàng hóa').selectOption(product._id)
	await page.getByLabel('Loại giá').selectOption('store')
	await page.getByLabel('Số lượng').fill('2')
	await page.getByLabel('Tiền cọc').fill('30')
	await page.getByRole('button', { name: /Ghi nợ · ẩn giá khi in/ }).click()
	await expect(page.getByText(/sau hóa đơn này: 330 đ/)).toBeVisible()
	await expect(page.locator('.erp-paper__table--invoice th')).toHaveCount(7)
	await expect(page.locator('.erp-paper')).toContainText('GHI NỢ KHÁCH HÀNG')
	await expect(page.locator('.erp-paper__table--invoice')).toContainText('Đơn giá')
	await expect(page.locator('.erp-paper__table--invoice')).toContainText('Thành tiền')
	await page.getByRole('button', { name: 'Lưu chứng từ & xuất kho' }).click()
	await expect(page.locator('.erp-alert--success')).toContainText('Đã lưu chứng từ')
	expect(invoices[0]).toMatchObject({ isDebt: true, priceType: 'store', depositAmount: 30, lines: [{ unitPrice: 90 }] })
	await page.emulateMedia({ media: 'print' })
	await expect(page.locator('.erp-paper__table--invoice')).not.toContainText('90')
	await expect(page.locator('.erp-paper__table--invoice tbody tr').first().locator('td').nth(5)).toBeEmpty()
	await expect(page.locator('.erp-paper__table--invoice tbody tr').first().locator('td').nth(6)).toBeEmpty()
	for (const amount of await page.locator('.erp-paper__totals strong').all()) await expect(amount).toBeEmpty()
	await page.emulateMedia({ media: 'screen' })

	await page.getByRole('button', { name: 'Kiểm tra dư nợ' }).click()
	await page.getByRole('button', { name: /Nguyen An/ }).first().click()
	await page.getByLabel('Số tiền').fill('100')
	await page.getByLabel('Ảnh giao dịch').setInputFiles({ name: 'transfer.png', mimeType: 'image/png', buffer: Buffer.from('fake-image') })
	await page.getByRole('button', { name: 'Ghi nhận thanh toán' }).click()
	await expect(page.locator('.erp-alert--success')).toContainText('Đã ghi nhận thanh toán')
	expect(payments[0]).toMatchObject({ amount: 100, method: 'bankTransfer', proofImageUrl: 'https://res.cloudinary.com/demo/payment-proof.png' })
})

test('ERP inventory, documents and debts fit phone and desktop viewports', async ({ page }) => {
	await page.route('http://localhost:5000/**', async (route) => {
		const url = new URL(route.request().url())
		if (url.pathname === '/erp/products') return route.fulfill({ json: { success: true, data: [product] } })
		if (url.pathname === '/erp/movements') return route.fulfill({ json: { success: true, data: [] } })
		if (url.pathname === '/erp/documents') return route.fulfill({ json: { success: true, data: [] } })
		if (url.pathname === '/erp/debts') return route.fulfill({ json: { success: true, data: [{ customerKey: 'nguyen an', customerName: 'Nguyen An', customerPhone: '0901234567', balance: 180, invoiceCount: 1, invoices: [] }] } })
		return route.fulfill({ json: { success: true, data: [] } })
	})

	for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
		await page.setViewportSize(viewport)
		await page.goto('/')
		await expect(page.getByRole('heading', { name: 'Quản lý tồn kho' })).toBeVisible()
		await page.getByRole('tab', { name: 'Sản phẩm' }).click()
		await expect(page.locator('.erp-table-scroll')).toBeVisible()
		await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
		await page.getByRole('button', { name: 'Mẫu chứng từ' }).click()
		await expect(page.getByRole('heading', { name: 'Chứng từ bán hàng' })).toBeVisible()
		await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
		await page.getByRole('button', { name: 'Kiểm tra dư nợ' }).click()
		await expect(page.getByRole('heading', { name: 'Dư nợ khách hàng' })).toBeVisible()
		await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
	}
})

test('new inventory document creates one multi-item stock receipt batch', async ({ page }) => {
	let createdReceipt
	await page.route('http://localhost:5000/**', async (route) => {
		const request = route.request()
		const url = new URL(request.url())
		if (url.pathname === '/erp/products' && request.method() === 'GET') return route.fulfill({ json: { success: true, data: [product] } })
		if (url.pathname === '/erp/movements' && request.method() === 'GET') return route.fulfill({ json: { success: true, data: [] } })
		if (url.pathname === '/erp/receipts' && request.method() === 'POST') {
			createdReceipt = request.postDataJSON()
			return route.fulfill({ status: 201, json: { success: true, data: createdReceipt.lines.map((line, index) => ({ _id: `receipt-${index}`, ...line, type: 'receipt' })) } })
		}
		return route.fulfill({ status: 404, json: { success: false, message: 'Not found' } })
	})

	await page.goto('/')
	await page.getByRole('button', { name: /Lập phiếu nhập/ }).click()
	await expect(page.getByRole('heading', { name: 'Lập phiếu nhập kho' })).toBeVisible()
	await expect(page.getByLabel('Loại chứng từ')).toHaveCount(0)
	await page.getByLabel('Sản phẩm').nth(0).selectOption(product._id)
	await page.getByLabel('Số lượng nhập').nth(0).fill('4')
	await page.getByRole('button', { name: 'Thêm mặt hàng' }).click()
	await page.getByLabel('Sản phẩm').nth(1).selectOption(product._id)
	await page.getByLabel('Số lượng nhập').nth(1).fill('2.5')
	await page.getByRole('button', { name: 'Nhập 2 mặt hàng' }).click()
	await expect(page.locator('.erp-alert--success')).toContainText('Đã lưu chứng từ')
	expect(createdReceipt.lines).toMatchObject([
		{ productId: product._id, quantity: 4 },
		{ productId: product._id, quantity: 2.5 },
	])
})
