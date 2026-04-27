// ============================================================
//  Amul Calc – Supplier Manager  |  app.js
//  Supplier-side: customers, custom prices, morning/evening orders,
//  ledger, Amul order aggregation with crate/box alignment check
// ============================================================

// ==========================================================
//  DEFAULT PRODUCTS
// ==========================================================
const DEFAULT_PRODUCTS = [
  { id:'p1',  name:'Gold 500ml',          packType:'Crate', packQty:24, rate:33.25  },
  { id:'p2',  name:'Nani Taaza 500ml',    packType:'Crate', packQty:24, rate:27.25  },
  { id:'p3',  name:'Moti Taaza 1L',       packType:'Crate', packQty:12, rate:53.5   },
  { id:'p4',  name:'Tea Special 500ml',   packType:'Crate', packQty:12, rate:61.5   },
  { id:'p5',  name:'Moti Chaas 200ml',    packType:'Crate', packQty:16, rate:19     },
  { id:'p6',  name:'Nani Chaas 200ml',    packType:'Crate', packQty:30, rate:14.3   },
  { id:'p7',  name:'10rs Dahi Cup',       packType:'Box',   packQty:48, rate:9      },
  { id:'p8',  name:'24rs Dahi Cup',       packType:'Box',   packQty:24, rate:21.667 },
  { id:'p9',  name:'400gm Dahi',          packType:null,    packQty:null, rate:32.5 },
  { id:'p10', name:'800gm Dahi',          packType:null,    packQty:null, rate:47   },
  { id:'p11', name:'1kg Dahi',            packType:null,    packQty:null, rate:73   },
  { id:'p12', name:'Amul Masti Dahi 5kg', packType:'Crate', packQty:2,  rate:685   },
  { id:'p13', name:'Amul Gold 6L',        packType:'Crate', packQty:2,  rate:745   },
];

const INITIAL_DB = {
  version: 1,
  products:  JSON.parse(JSON.stringify(DEFAULT_PRODUCTS)),
  customers: [],
  orders:    [],
  payments:  []
};

// ==========================================================
//  STATE
// ==========================================================
let DB = JSON.parse(JSON.stringify(INITIAL_DB));
let activePage = 'dashboard';

// Order page state
let orderSlot      = 'morning';
let orderCustomerId = null;
let orderItems     = {};          // { productId: qty in pcs }
let orderItemModes = {};          // { productId: 'loose'|'pack' }
let editingOrderId = null;
let editOrderSlot  = 'morning';
let editOrderItems = {};

// Ledger state
let currentLedgerFilter   = 'all';
let currentLedgerCustomer = 'all';
let ledgerSelectMode      = false;
let selectedLedgerRows    = new Set();

// Customer page state
let custFilter = 'all';

// Amul Order state
let amulSlot = 'morning';

// Payment modal state
let editingPaymentId = null;
let payModalSlotVal  = 'morning';

// Delete pending
let pendingDelete = null;

// ==========================================================
//  LOCAL STORAGE
// ==========================================================
const STORAGE_KEY = 'amulcalc_v1';

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const loaded = JSON.parse(raw);
    if (!loaded.products)  loaded.products  = JSON.parse(JSON.stringify(DEFAULT_PRODUCTS));
    if (!loaded.customers) loaded.customers = [];
    if (!loaded.orders)    loaded.orders    = [];
    if (!loaded.payments)  loaded.payments  = [];
    DB = loaded;
    showPage(activePage);
    toast('✅ Data loaded.', 'success');
  } catch(e) {
    toast('Error loading data: ' + e.message, 'error');
  }
}

function saveToLocalStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
    flashSaveIndicator();
    scheduleDriveUpload();
  } catch(e) {
    toast('❌ Save failed: ' + e.message, 'error');
  }
}

function persistDB() { saveToLocalStorage(); }

function flashSaveIndicator() {
  const el = document.getElementById('saveIndicator');
  if (!el) return;
  el.textContent = '✅ Saved';
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 2000);
}

// ==========================================================
//  UTILITIES
// ==========================================================
function uid() { return Date.now().toString(36) + Math.random().toString(36).substr(2,5); }
function todayStr() { return new Date().toISOString().split('T')[0]; }
function fmt(n) { return (Math.round(n*100)/100).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' });
}
function fmtDateLong(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' });
}

function getProduct(id)  { return DB.products.find(p => p.id === id); }
function getCustomer(id) { return DB.customers.find(c => c.id === id); }

function getProductRate(p) {
  // backward compat: old data used morningRate
  return p.rate !== undefined ? p.rate : (p.morningRate || 0);
}

function getEffectiveRate(productId, customerId) {
  const p = getProduct(productId);
  if (!p) return 0;
  const c = getCustomer(customerId);
  if (c && c.customPrices && c.customPrices[productId]) {
    const cp = c.customPrices[productId];
    // new format: {enabled) {
      return parseFloat(cp.rate);
    }
    // backward compat: old format {morningRate, eveningRate}
    if (!cp.hasOwnProperty('enabled') && cp.morningRate !== '' && cp.morningRate !== null && cp.morningRate !== undefined) {
      return parseFloat(cp.morningRate);
    }
  }
  return getProductRate(p);
}

function calcOrderTotal(order) {
  return order.items.reduce((s, it) => s + it.amount, 0);
}

function calcCustomerBalance(customerId) {
  const orders   = DB.orders.filter(o => o.customerId === customerId);
  const payments = DB.payments.filter(p => p.customerId === customerId);
  return orders.reduce((s,o) => s + calcOrderTotal(o), 0) - payments.reduce((s,p) => s + p.amount, 0);
}

function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  const icons = { success:'✅', error:'❌', info:'ℹ️' };
  t.innerHTML = `<span>${icons[type]||''}</span> ${msg}`;
  document.getElementById('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ==========================================================
//  NAVIGATION
// ==========================================================
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');
  activePage = page;

  // Close mobile menu
  ['mobileMenu','mobileMenuOverlay'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  });
  const hBtn = document.getElementById('hamburgerBtn');
  if (hBtn) hBtn.classList.remove('open');

  if (page === 'dashboard')  renderDashboard();
  if (page === 'customers')  renderCustomerList();
  if (page === 'order')      initOrderPage();
  if (page === 'ledger')     renderLedger();
  if (page === 'amulorder')  initAmulOrderPage();
  if (page === 'products')   renderProductsPage();
  if (page === 'export')     initExportPage();
}

// ==========================================================
//  DASHBOARD
// ==========================================================
function renderDashboard() {
  const today = todayStr();
  document.getElementById('dashDate').textContent = fmtDateLong(today);

  const todayOrders = DB.orders.filter(o => o.date === today);
  const todayTotal  = todayOrders.reduce((s,o) => s + calcOrderTotal(o), 0);
  const thisMonth   = today.substr(0,7);
  const monthOrders = DB.orders.filter(o => o.date && o.date.startsWith(thisMonth));
  const monthTotal  = monthOrders.reduce((s,o) => s + calcOrderTotal(o), 0);
  const totalOrders = DB.orders.reduce((s,o) => s + calcOrderTotal(o), 0);
  const totalPaid   = DB.payments.reduce((s,p) => s + p.amount, 0);
  const outstanding = totalOrders - totalPaid;

  document.getElementById('dashStats').innerHTML = `
    <div class="stat-card">
      <div class="stat-icon red">📋</div>
      <div><div class="stat-label">Today's Sales</div><div class="stat-value red">₹${fmt(todayTotal)}</div><div class="stat-sub">${todayOrders.length} order(s)</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon blue">📅</div>
      <div><div class="stat-label">This Month</div><div class="stat-value blue">₹${fmt(monthTotal)}</div><div class="stat-sub">${monthOrders.length} order(s)</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green">👥</div>
      <div><div class="stat-label">Customers</div><div class="stat-value green">${DB.customers.filter(c=>c.active!==false).length}</div><div class="stat-sub">Active</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon orange">⚖️</div>
      <div><div class="stat-label">Outstanding</div><div class="stat-value orange">₹${fmt(outstanding)}</div><div class="stat-sub">All customers</div></div>
    </div>`;

  // Customer balances
  const topCustomers = DB.customers
    .filter(c => c.active !== false)
    .map(c => ({ c, bal: calcCustomerBalance(c.id) }))
    .filter(x => x.bal > 0)
    .sort((a,b) => b.bal - a.bal)
    .slice(0, 6);

  const custBalEl = document.getElementById('dashCustomerBalances');
  if (topCustomers.length === 0) {
    custBalEl.innerHTML = '<div class="empty-state" style="padding:16px;"><div class="icon">👥</div><div class="text">No outstanding balances.</div></div>';
  } else {
    custBalEl.innerHTML = `<div class="sup-bal-row">${topCustomers.map(({c, bal}) => `
      <div class="sup-bal-card" style="background:var(--red-bg);cursor:pointer;" onclick="openCustomerLedger('${c.id}')">
        <div class="sup-bal-name" style="color:var(--red);">${c.name}</div>
        <div class="sup-bal-amount" style="color:var(--red);">₹${fmt(bal)}</div>
      </div>`).join('')}</div>`;
  }

  // Today's orders
  const todayEl = document.getElementById('dashTodayOrders');
  if (todayOrders.length === 0) {
    todayEl.innerHTML = '<div class="empty-state" style="padding:16px;"><div class="icon">📋</div><div class="text">No orders today. Tap New Order to start.</div></div>';
  } else {
    const morn = todayOrders.filter(o=>o.slot==='morning').reduce((s,o)=>s+calcOrderTotal(o),0);
    const eve  = todayOrders.filter(o=>o.slot==='evening').reduce((s,o)=>s+calcOrderTotal(o),0);
    todayEl.innerHTML = `
      <div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
        <div style="flex:1;min-width:100px;background:var(--orange-bg);border-radius:8px;padding:10px;text-align:center;">
          <div style="font-size:10px;font-weight:700;color:var(--orange);text-transform:uppercase;">🌅 Morning</div>
          <div style="font-size:16px;font-weight:700;color:var(--orange);font-family:'IBM Plex Mono',monospace;">₹${fmt(morn)}</div>
        </div>
        <div style="flex:1;min-width:100px;background:var(--blue-bg);border-radius:8px;padding:10px;text-align:center;">
          <div style="font-size:10px;font-weight:700;color:var(--blue);text-transform:uppercase;">🌆 Evening</div>
          <div style="font-size:16px;font-weight:700;color:var(--blue);font-family:'IBM Plex Mono',monospace;">₹${fmt(eve)}</div>
        </div>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Customer</th><th>Slot</th><th class="right">Total</th></tr></thead>
          <tbody>${todayOrders.map(o => {
            const c = getCustomer(o.customerId);
            return `<tr style="cursor:pointer;" onclick="showOrderDetail('${o.id}')">
              <td style="font-weight:600;">${c?c.name:'—'}</td>
              <td><span class="type-badge badge-${o.slot}">${o.slot==='morning'?'🌅 Morning':'🌆 Evening'}</span></td>
              <td class="right mono" style="font-weight:700;">₹${fmt(calcOrderTotal(o))}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
  }

  // Amul snapshot
  renderDashAmulSnapshot();

  // Monthly summary
  const monthDays = {};
  monthOrders.forEach(o => { monthDays[o.date] = (monthDays[o.date]||0) + calcOrderTotal(o); });
  const days = Object.keys(monthDays);
  document.getElementById('dashMonthlySummary').innerHTML = `
    <div class="month-summary-row">
      <div><div class="month-label">Active Days</div><div class="month-val">${days.length}</div></div>
      <div><div class="month-label">Daily Avg</div><div class="month-val" style="color:var(--red);">₹${fmt(days.length?monthTotal/days.length:0)}</div></div>
      <div><div class="month-label">Outstanding</div><div class="month-val" style="color:var(--orange);">₹${fmt(outstanding)}</div></div>
    </div>`;
}

function renderDashAmulSnapshot() {
  const today = todayStr();
  const orders = DB.orders.filter(o => o.date === today);
  const el = document.getElementById('dashAmulSnapshot');
  if (orders.length === 0) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">No orders today.</div>';
    return;
  }
  const agg = {};
  orders.forEach(o => {
    o.items.forEach(it => {
      agg[it.productId] = (agg[it.productId]||0) + it.pcs;
    });
  });
  const rows = Object.entries(agg).filter(([,pcs])=>pcs>0).map(([pid, pcs]) => {
    const p = getProduct(pid);
    if (!p) return '';
    if (!p.packQty) return `<div style="font-size:12px;padding:3px 0;">${p.name}: <strong>${pcs} pcs</strong></div>`;
    const exact = pcs / p.packQty;
    const ceil  = Math.ceil(exact);
    const ok    = Number.isInteger(exact);
    return `<div style="font-size:12px;padding:3px 0;display:flex;justify-content:space-between;">
      <span>${p.name}</span>
      <span style="font-weight:700;color:${ok?'var(--green)':'var(--red)'};">
        ${ok?'✅':'⚠️'} ${ceil} ${p.packType||'pack'}${ceil!==1?'s':''} (${pcs}pcs)
      </span>
    </div>`;
  }).join('');
  el.innerHTML = rows || '<div style="font-size:12px;color:var(--text-muted);">No products ordered.</div>';
}

function openCustomerLedger(customerId) {
  currentLedgerCustomer = customerId;
  showPage('ledger');
}

// ==========================================================
//  CUSTOMERS PAGE
// ==========================================================
function setCustFilter(filter, btn) {
  custFilter = filter;
  document.querySelectorAll('#page-customers .filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderCustomerList();
}

function renderCustomerList() {
  const search = (document.getElementById('customerSearch')?.value || '').toLowerCase().trim();
  let custs = DB.customers;
  if (custFilter === 'active')   custs = custs.filter(c => c.active !== false);
  if (custFilter === 'inactive') custs = custs.filter(c => c.active === false);
  if (search) custs = custs.filter(c => c.name.toLowerCase().includes(search) || (c.phone||'').includes(search));

  const el = document.getElementById('customerList');
  if (custs.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="icon">👥</div><div class="text">No customers found. Tap "+ Add" to create one.</div></div>';
    return;
  }
  el.innerHTML = custs.map(c => {
    const bal = calcCustomerBalance(c.id);
    const orders = DB.orders.filter(o => o.customerId === c.id).length;
    return `<div class="customer-card">
      <div class="customer-card-info">
        <div class="customer-card-name">${c.name}${c.active===false?'<span class="badge badge-gray" style="margin-left:6px;font-size:9px;">Inactive</span>':''}</div>
        <div class="customer-card-sub">${c.phone||''}${c.address?' · '+c.address:''}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${orders} order(s)</div>
      </div>
      <div class="customer-card-right">
        <div class="customer-bal ${bal>0?'bal-due':bal<0?'bal-adv':'bal-clear'}">₹${fmt(bal)}</div>
        <div class="customer-card-actions">
          <button class="btn btn-info btn-sm" onclick="openEditCustomer('${c.id}')">✏️</button>
          <button class="btn btn-success btn-sm" onclick="openCustomerLedger('${c.id}')">📒</button>
          <button class="btn btn-primary btn-sm" onclick="quickOrder('${c.id}')">➕</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function quickOrder(customerId) {
  orderCustomerId = customerId;
  showPage('order');
  setTimeout(() => selectCustomerForOrder(customerId), 100);
}

// ── Add / Edit Customer ──
function openAddCustomer() {
  document.getElementById('customerModalTitle').textContent = 'Add Customer';
  document.getElementById('editCustomerId').value = '';
  document.getElementById('custName').value = '';
  document.getElementById('custPhone').value = '';
  document.getElementById('custAddress').value = '';
  document.getElementById('custActive').value = 'true';
  document.getElementById('custDeleteBtn').style.display = 'none';
  renderCustPriceList({});
  openModal('customerModal');
}

function openEditCustomer(customerId) {
  const c = getCustomer(customerId);
  if (!c) return;
  document.getElementById('customerModalTitle').textContent = 'Edit Customer';
  document.getElementById('editCustomerId').value = c.id;
  document.getElementById('custName').value = c.name || '';
  document.getElementById('custPhone').value = c.phone || '';
  document.getElementById('custAddress').value = c.address || '';
  document.getElementById('custActive').value = (c.active===false) ? 'false' : 'true';
  document.getElementById('custDeleteBtn').style.display = 'inline-flex';
  renderCustPriceList(c.customPrices || {});
  openModal('customerModal');
}

function renderCustPriceList(customPrices) {
  const el = document.getElementById('custPriceList');
  el.innerHTML = DB.products.map(p => {
    const cp = customPrices[p.id] || {};
    const defaultRate = getProductRate(p);
    // Support both new {enabled,rate} and old {morningRate} formats
    const isEnabled = cp.enabled || (!cp.hasOwnProperty('enabled') && (cp.morningRate !== '' && cp.morningRate !== undefined && cp.morningRate !== null));
    const customVal = cp.rate !== undefined ? cp.rate : (cp.morningRate || '');
    return `<div class="cust-price-row" id="cprow-${p.id}">
      <div class="cust-price-prod">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="checkbox" id="cp_en_${p.id}" ${isEnabled?'checked':''} onchange="toggleCustPriceRow('${p.id}')" style="width:16px;height:16px;accent-color:var(--red);cursor:pointer;">
          ${p.name}
        </label>
        <div class="cust-price-default">Default: ₹${defaultRate.toFixed(3).replace(/\.?0+$/, '')}</div>
      </div>
      <div class="cust-price-inputs">
        <div>
          <label style="font-size:9px;color:var(--text-muted);display:block;margin-bottom:2px;">Custom Rate (₹/pc)</label>
          <input type="number" step="0.001" class="cust-price-input" id="cp_r_${p.id}"
                 value="${isEnabled && customVal !== '' ? customVal : ''}"
                 placeholder="${defaultRate}"
                 ${isEnabled ? '' : 'disabled style="opacity:0.4;"'}>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleCustPriceRow(productId) {
  const cb = document.getElementById('cp_en_' + productId);
  const inp = document.getElementById('cp_r_' + productId);
  if (!cb || !inp) return;
  if (cb.checked) {
    inp.disabled = false;
    inp.style.opacity = '1';
    inp.focus();
  } else {
    inp.disabled = true;
    inp.style.opacity = '0.4';
    inp.value = '';
  }
}

function saveCustomer() {
  const id   = document.getElementById('editCustomerId').value;
  const name = document.getElementById('custName').value.trim();
  if (!name) { toast('Customer name is required.', 'error'); return; }
  const phone   = document.getElementById('custPhone').value.trim();
  const address = document.getElementById('custAddress').value.trim();
  const active  = document.getElementById('custActive').value === 'true';

  // Collect custom prices
  const customPrices = {};
  DB.products.forEach(p => {
    const cbEl = document.getElementById('cp_en_' + p.id);
    const rEl  = document.getElementById('cp_r_' + p.id);
    const enabled = cbEl ? cbEl.checked : false;
    const rVal = rEl ? rEl.value.trim() : '';
    if (enabled && rVal !== '') {
      customPrices[p.id] = { enabled: true, rate: parseFloat(rVal) };
    }
  });

  if (id) {
    const idx = DB.customers.findIndex(c => c.id === id);
    if (idx !== -1) {
      DB.customers[idx] = { ...DB.customers[idx], name, phone, address, active, customPrices };
      toast('✅ Customer updated!', 'success');
    }
  } else {
    DB.customers.push({ id: uid(), name, phone, address, active, customPrices, createdAt: new Date().toISOString() });
    toast('✅ Customer added!', 'success');
  }
  persistDB();
  closeModal('customerModal');
  renderCustomerList();
}

function deleteCurrentCustomer() {
  const id = document.getElementById('editCustomerId').value;
  if (!id) return;
  const c = getCustomer(id);
  pendingDelete = { type:'customer', id };
  document.getElementById('deleteConfirmMsg').textContent = `Delete customer "${c?c.name:''}? Their orders and payments will remain in records.`;
  closeModal('customerModal');
  openModal('deleteConfirmModal');
}

// ==========================================================
//  ORDER PAGE
// ==========================================================
function initOrderPage() {
  const dateEl = document.getElementById('orderDate');
  if (!dateEl.value) dateEl.value = todayStr();
  document.getElementById('orderTodayDate').textContent = fmtDateLong(todayStr());
  setOrderSlot(orderSlot);
  if (orderCustomerId) {
    selectCustomerForOrder(orderCustomerId);
  }
  renderTodaysOrdersList();
}

function onOrderDateChange() {
  renderTodaysOrdersList();
}

function setOrderSlot(slot) {
  orderSlot = slot;
  document.getElementById('btn-morning').className = slot === 'morning' ? 'active morning' : '';
  document.getElementById('btn-evening').className = slot === 'evening' ? 'active evening' : '';
  document.getElementById('orderProductTitle').textContent = slot === 'morning' ? 'Products – Morning' : 'Products – Evening';
  if (orderCustomerId) renderOrderProductList();
  renderOrderSummary();
}

// Customer live search in order
function filterOrderCustomers() {
  const val = document.getElementById('orderCustomerSearch').value.trim().toLowerCase();
  const dropdown = document.getElementById('orderCustomerDropdown');
  const activeCusts = DB.customers.filter(c => c.active !== false);
  const matches = val ? activeCusts.filter(c => c.name.toLowerCase().includes(val) || (c.phone||'').includes(val)).slice(0,8) : activeCusts.slice(0,20);
  if (matches.length === 0) { dropdown.style.display = 'none'; return; }
  dropdown.innerHTML = matches.map(c =>
    `<div class="customer-dropdown-item" onclick="selectCustomerForOrder('${c.id}')">${c.name}${c.phone?` <span style="font-size:10px;color:var(--text-muted);">${c.phone}</span>`:''}</div>`
  ).join('');
  dropdown.style.display = 'block';
}

function showAllCustomersDropdown() {
  const dropdown = document.getElementById('orderCustomerDropdown');
  if (dropdown.style.display === 'block') { dropdown.style.display = 'none'; return; }
  const activeCusts = DB.customers.filter(c => c.active !== false);
  if (activeCusts.length === 0) return;
  dropdown.innerHTML = activeCusts.map(c =>
    `<div class="customer-dropdown-item" onclick="selectCustomerForOrder('${c.id}')">${c.name}${c.phone?` <span style="font-size:10px;color:var(--text-muted);">${c.phone}</span>`:''}</div>`
  ).join('');
  dropdown.style.display = 'block';
  document.getElementById('orderCustomerSearch').focus();
}

function selectCustomerForOrder(customerId) {
  const c = getCustomer(customerId);
  if (!c) return;
  orderCustomerId = customerId;
  document.getElementById('orderCustomerSearch').value = '';
  document.getElementById('orderCustomerDropdown').style.display = 'none';
  document.getElementById('selectedCustomerName').textContent = c.name;
  document.getElementById('selectedCustomerChip').style.display = 'flex';
  document.getElementById('orderProductSection').style.display = 'block';
  document.getElementById('orderNoCustMsg').style.display = 'none';
  orderItems = {};
  orderItemModes = {};
  renderOrderProductList();
  renderOrderSummary();
}

function clearSelectedCustomer() {
  orderCustomerId = null;
  orderItems = {};
  orderItemModes = {};
  document.getElementById('orderCustomerSearch').value = '';
  document.getElementById('selectedCustomerChip').style.display = 'none';
  document.getElementById('orderProductSection').style.display = 'none';
  document.getElementById('orderNoCustMsg').style.display = 'block';
}

function renderOrderProductList() {
  const el = document.getElementById('orderProductList');
  el.innerHTML = DB.products.map(p => {
    const pcs = orderItems[p.id] || 0;
    const rate = getEffectiveRate(p.id, orderCustomerId);
    const hasCustom = orderCustomerId && DB.customers.find(c=>c.id===orderCustomerId)?.customPrices?.[p.id];
    const hasPack = p.packQty && p.packType;
    const mode = orderItemModes[p.id] || (hasPack ? 'pack' : 'loose');  // default: pack if available
    const isPackMode = hasPack && mode === 'pack';
    const displayVal = isPackMode && pcs > 0 ? (pcs / p.packQty) : (pcs > 0 ? pcs : '');
    const total = pcs > 0 ? rate * pcs : 0;

    const packToggle = hasPack ? `
      <div class="qty-mode-toggle">
        <button class="${!isPackMode?'active':''}" onclick="setOrderItemMode('${p.id}','loose')">Loose</button>
        <button class="${isPackMode?'active':''}" onclick="setOrderItemMode('${p.id}','pack')">${p.packType}</button>
      </div>` : '';

    const placeholder = isPackMode ? `Qty (${p.packType}s)` : 'Qty (pcs)';
    const stepVal = isPackMode ? '1' : '1';

    return `<div class="product-row ${total>0?'has-value':''}" id="ordrow-${p.id}">
      <div class="prod-info">
        <div class="prod-name">${p.name}${hasCustom?'<span class="eve-badge" style="background:var(--green-bg);color:var(--green);padding:1px 6px;border-radius:8px;font-size:10px;margin-left:5px;">Custom</span>':''}</div>
        <div class="prod-price">₹${rate.toFixed(3).replace(/\.?0+$/, '')}/pc${hasPack?` · ${p.packQty}pcs/${p.packType}`:''}${isPackMode && pcs>0?` · ${pcs}pcs total`:''}</div>
      </div>
      <div class="prod-controls">
        ${packToggle}
        <input class="qty-input" type="number" min="0" step="${stepVal}" placeholder="${placeholder}"
               value="${displayVal}" oninput="updateOrderQty('${p.id}', this.value, '${mode}')" id="ordqty-${p.id}">
        <div class="row-total ${total>0?'active':''}" id="ordtotal-${p.id}">
          ${total>0?'₹'+fmt(total):'—'}
        </div>
      </div>
    </div>`;
  }).join('');
}

function setOrderItemMode(productId, mode) {
  const p = getProduct(productId);
  if (!p) return;
  orderItemModes[productId] = mode;
  // Re-render just this row by re-rendering the full list (fast enough)
  renderOrderProductList();
}

function updateOrderQty(productId, val, mode) {
  const p = getProduct(productId);
  if (!p) return;
  const currentMode = mode || orderItemModes[productId] || (p.packQty && p.packType ? 'pack' : 'loose');
  const numVal = parseFloat(val);
  if (!val || isNaN(numVal) || numVal <= 0) {
    delete orderItems[productId];
  } else if (currentMode === 'pack' && p.packQty) {
    orderItems[productId] = numVal * p.packQty;
  } else {
    orderItems[productId] = numVal;
  }
  const rate  = getEffectiveRate(productId, orderCustomerId);
  const qty   = orderItems[productId] || 0;
  const total = rate * qty;
  const totEl = document.getElementById('ordtotal-' + productId);
  if (totEl) { totEl.textContent = total>0?'₹'+fmt(total):'—'; totEl.className='row-total '+(total>0?'active':''); }
  const row = document.getElementById('ordrow-' + productId);
  if (row) row.className = 'product-row '+(total>0?'has-value':'');
  // Update pcs-total hint in prod-price line
  const priceEl = row ? row.querySelector('.prod-price') : null;
  if (priceEl && currentMode === 'pack' && p.packQty && qty > 0) {
    const base = `₹${rate.toFixed(3).replace(/\.?0+$/, '')}/pc · ${p.packQty}pcs/${p.packType}`;
    priceEl.textContent = `${base} · ${qty}pcs total`;
  }
  renderOrderSummary();
}

function renderOrderSummary() {
  const el = document.getElementById('orderSummary');
  if (!el) return;
  const items = getOrderItemsList(orderItems, orderCustomerId, orderSlot);
  if (items.length === 0) { el.style.display = 'none'; return; }
  const total = items.reduce((s,it) => s+it.amount, 0);
  el.style.display = 'block';
  el.innerHTML = `
    <div class="summary-row"><span>Items</span><span>${items.length}</span></div>
    <div class="summary-row"><span>Slot</span><span>${orderSlot==='morning'?'🌅 Morning':'🌆 Evening'}</span></div>
    <div class="summary-row total"><span>Order Total</span><span>₹${fmt(total)}</span></div>`;
}

function getOrderItemsList(itemsMap, customerId, slot) {
  const list = [];
  for (const [productId, qty] of Object.entries(itemsMap)) {
    if (!qty || qty <= 0) continue;
    const p = getProduct(productId);
    if (!p) continue;
    const rate   = getEffectiveRate(productId, customerId);
    const amount = rate * qty;
    list.push({ productId, pcs: qty, rate, amount, packType: p.packType, packQty: p.packQty });
  }
  return list;
}

function submitOrder() {
  const date = document.getElementById('orderDate').value;
  if (!date) { toast('Please select a date.', 'error'); return; }
  if (!orderCustomerId) { toast('Please select a customer.', 'error'); return; }
  const items = getOrderItemsList(orderItems, orderCustomerId, orderSlot);
  if (items.length === 0) { toast('Enter at least one product quantity.', 'error'); return; }
  const note = document.getElementById('orderNote').value.trim();
  DB.orders.push({
    id: uid(), date, slot: orderSlot, customerId: orderCustomerId,
    items, note, createdAt: new Date().toISOString()
  });
  persistDB();
  const c = getCustomer(orderCustomerId);
  toast(`✅ Order saved for ${c?c.name:'customer'}!`, 'success');
  orderItems = {};
  document.getElementById('orderNote').value = '';
  renderOrderProductList();
  renderOrderSummary();
  renderTodaysOrdersList();
}

function clearOrderForm() {
  orderItems = {};
  orderItemModes = {};
  if (document.getElementById('orderNote')) document.getElementById('orderNote').value = '';
  renderOrderProductList();
  renderOrderSummary();
}

function renderTodaysOrdersList() {
  const date = document.getElementById('orderDate')?.value || todayStr();
  const orders = DB.orders.filter(o => o.date === date)
    .sort((a,b) => (a.slot==='morning'?0:1)-(b.slot==='morning'?0:1));
  const el = document.getElementById('todaysOrdersList');
  if (!el) return;
  if (orders.length === 0) {
    el.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:14px;">No orders for this date.</div>';
    return;
  }
  el.innerHTML = orders.map(o => {
    const c = getCustomer(o.customerId);
    const total = calcOrderTotal(o);
    return `<div class="order-card">
      <div class="order-card-header">
        <div>
          <div class="order-card-title">${o.slot==='morning'?'🌅':'🌆'} ${c?c.name:'—'}</div>
          <div class="order-card-sub">${o.items.length} item(s)${o.note?' · '+o.note:''}</div>
        </div>
        <div class="order-card-total">₹${fmt(total)}</div>
      </div>
      <div class="order-card-actions">
        <button class="btn btn-secondary btn-sm" onclick="showOrderDetail('${o.id}')">👁️ View</button>
        <button class="btn btn-info btn-sm" onclick="openEditOrder('${o.id}')">✏️ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="confirmDeleteOrder('${o.id}')">🗑️ Del</button>
      </div>
    </div>`;
  }).join('');
}

// ==========================================================
//  ORDER DETAIL
// ==========================================================
function showOrderDetail(orderId) {
  const o = DB.orders.find(x => x.id === orderId);
  if (!o) return;
  const c = getCustomer(o.customerId);
  const total = calcOrderTotal(o);
  document.getElementById('orderDetailTitle').textContent = `${o.slot==='morning'?'🌅 Morning':'🌆 Evening'} – ${fmtDate(o.date)}`;
  document.getElementById('orderDetailContent').innerHTML = `
    ${c?`<div style="margin-bottom:10px;font-size:12px;">Customer: <strong>${c.name}</strong>${c.phone?' · '+c.phone:''}</div>`:''}
    ${o.note?`<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">Note: ${o.note}</div>`:''}
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Product</th><th class="right">Pcs</th><th class="right">Rate</th><th class="right">Amount</th></tr></thead>
        <tbody>${o.items.map(it => {
          const p = getProduct(it.productId) || { name: it.productId };
          return `<tr>
            <td><strong>${p.name}</strong></td>
            <td class="right mono">${it.pcs}</td>
            <td class="right mono" style="font-size:11px;">₹${it.rate.toFixed(3).replace(/\.?0+$/, '')}</td>
            <td class="right mono" style="font-weight:700;">₹${fmt(it.amount)}</td>
          </tr>`;
        }).join('')}</tbody>
        <tfoot><tr>
          <td colspan="3" style="text-align:right;font-weight:700;padding:9px 10px;border-top:2px solid var(--border);">TOTAL</td>
          <td class="right mono" style="font-weight:700;color:var(--red);font-size:14px;padding:9px 10px;border-top:2px solid var(--border);">₹${fmt(total)}</td>
        </tr></tfoot>
      </table>
    </div>`;
  document.getElementById('orderDetailPrintBtn').onclick = () => printSingleOrder(orderId);
  document.getElementById('orderDetailEditBtn').onclick = () => { closeModal('orderDetailModal'); openEditOrder(orderId); };
  document.getElementById('orderDetailWhatsappBtn').onclick = () => toggleWhatsappMsg(orderId);
  document.getElementById('whatsappCopyArea').style.display = 'none';
  openModal('orderDetailModal');
}

function toggleWhatsappMsg(orderId) {
  const area = document.getElementById('whatsappCopyArea');
  if (area.style.display !== 'none') { area.style.display = 'none'; return; }
  const o = DB.orders.find(x => x.id === orderId);
  if (!o) return;
  const c = getCustomer(o.customerId);
  const total = calcOrderTotal(o);
  const lines = [
    `*Amul Calc – Order Details*`,
    ``,
    `Date     : ${fmtDateLong(o.date)}`,
    `Slot     : ${o.slot==='morning'?'🌅 Morning':'🌆 Evening'}`,
    c ? `Customer : ${c.name}` : '',
    o.note ? `Note     : ${o.note}` : '',
    ``,
    '```',
    `Product                  Qty    Rate         Amount`,
    '-'.repeat(60),
    ...o.items.map(it => {
      const p = getProduct(it.productId)||{name:it.productId};
      const nm = p.name.substring(0,22).padEnd(22);
      const pcs = String(it.pcs).padStart(4);
      const rt  = ('₹'+it.rate.toFixed(2)+'/pc').padStart(12);
      const amt = ('₹'+fmt(it.amount)).padStart(10);
      return `${nm} ${pcs} ${rt} ${amt}`;
    }),
    '-'.repeat(60),
    `${'TOTAL'.padEnd(42)} ${('₹'+fmt(total)).padStart(10)}`,
    '```',
    ``,
    `*Total: ₹${fmt(total)}*`
  ].filter(l=>l!==null).join('\n');
  document.getElementById('whatsappMsgBox').value = lines;
  area.style.display = 'block';
}

function copyWhatsappMsg() {
  const box = document.getElementById('whatsappMsgBox');
  navigator.clipboard.writeText(box.value)
    .then(() => toast('Message copied! Paste in WhatsApp.', 'success'))
    .catch(() => { box.select(); document.execCommand('copy'); toast('Copied!', 'success'); });
}

// ==========================================================
//  EDIT ORDER
// ==========================================================
function openEditOrder(orderId) {
  const o = DB.orders.find(x => x.id === orderId);
  if (!o) return;
  editingOrderId = orderId;
  editOrderSlot  = o.slot || 'morning';
  editOrderItems = {};
  o.items.forEach(it => { editOrderItems[it.productId] = it.pcs; });
  document.getElementById('editOrderDate').value = o.date;
  document.getElementById('editOrderNote').value = o.note || '';
  const c = getCustomer(o.customerId);
  document.getElementById('editOrderCustomerName').textContent = c ? c.name : '—';
  setEditOrderSlot(editOrderSlot);
  openModal('editOrderModal');
}

function setEditOrderSlot(slot) {
  editOrderSlot = slot;
  document.getElementById('editbtn-morning').className = slot==='morning'?'active morning':'';
  document.getElementById('editbtn-evening').className = slot==='evening'?'active evening':'';
  document.getElementById('editOrderProductTitle').textContent = `Products – ${slot==='morning'?'Morning':'Evening'}`;
  renderEditOrderProductList();
  renderEditOrderSummary();
}

function renderEditOrderProductList() {
  const o = DB.orders.find(x => x.id === editingOrderId);
  const customerId = o ? o.customerId : null;
  const el = document.getElementById('editOrderProductList');
  el.innerHTML = DB.products.map(p => {
    const qty  = editOrderItems[p.id] || '';
    const rate = getEffectiveRate(p.id, customerId);
    const total = qty && parseFloat(qty) > 0 ? rate * parseFloat(qty) : 0;
    return `<div class="product-row ${total>0?'has-value':''}" id="editordrow-${p.id}">
      <div class="prod-info">
        <div class="prod-name">${p.name}</div>
        <div class="prod-price">₹${rate.toFixed(3).replace(/\.?0+$/,'')}/pc</div>
      </div>
      <div class="prod-controls">
        <input class="qty-input" type="number" min="0" step="1" placeholder="Qty (pcs)"
               value="${qty}" oninput="updateEditOrderQty('${p.id}', this.value)">
        <div class="row-total ${total>0?'active':''}" id="editordtotal-${p.id}">
          ${total>0?'₹'+fmt(total):'—'}
        </div>
      </div>
    </div>`;
  }).join('');
}

function updateEditOrderQty(productId, val) {
  if (!val || parseFloat(val) <= 0) { delete editOrderItems[productId]; }
  else { editOrderItems[productId] = parseFloat(val); }
  const o = DB.orders.find(x => x.id === editingOrderId);
  const rate  = getEffectiveRate(productId, o?.customerId);
  const qty   = editOrderItems[productId] || 0;
  const total = rate * qty;
  const totEl = document.getElementById('editordtotal-' + productId);
  if (totEl) { totEl.textContent = total>0?'₹'+fmt(total):'—'; totEl.className='row-total '+(total>0?'active':''); }
  const row = document.getElementById('editordrow-' + productId);
  if (row) row.className = 'product-row '+(total>0?'has-value':'');
  renderEditOrderSummary();
}

function renderEditOrderSummary() {
  const o = DB.orders.find(x => x.id === editingOrderId);
  const items = getOrderItemsList(editOrderItems, o?.customerId, editOrderSlot);
  const total = items.reduce((s,it) => s+it.amount, 0);
  const el = document.getElementById('editOrderSummary');
  if (!el) return;
  if (items.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="order-summary">
    <div class="summary-row total"><span>Order Total</span><span>₹${fmt(total)}</span></div>
  </div>`;
}

function saveEditedOrder() {
  const date = document.getElementById('editOrderDate').value;
  if (!date) { toast('Please select a date.', 'error'); return; }
  const o = DB.orders.find(x => x.id === editingOrderId);
  if (!o) { toast('Order not found.', 'error'); return; }
  const items = getOrderItemsList(editOrderItems, o.customerId, editOrderSlot);
  if (items.length === 0) { toast('Enter at least one product.', 'error'); return; }
  const note = document.getElementById('editOrderNote').value.trim();
  const idx = DB.orders.findIndex(x => x.id === editingOrderId);
  DB.orders[idx] = { ...o, date, slot: editOrderSlot, items, note };
  persistDB();
  toast('✅ Order updated!', 'success');
  closeModal('editOrderModal');
  editingOrderId = null; editOrderItems = {};
  if (activePage === 'order') renderTodaysOrdersList();
  if (activePage === 'ledger') renderLedger();
  if (activePage === 'dashboard') renderDashboard();
}

function confirmDeleteOrder(orderId) {
  pendingDelete = { type:'order', id: orderId };
  document.getElementById('deleteConfirmMsg').textContent = 'Delete this order? This cannot be undone.';
  openModal('deleteConfirmModal');
}

// ==========================================================
//  LEDGER
// ==========================================================
function setLedgerFilter(filter, btn) {
  currentLedgerFilter = filter;
  document.querySelectorAll('#page-ledger .filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('customDateRange').style.display = filter === 'custom' ? 'flex' : 'none';
  renderLedger();
}

function setLedgerCustomer(customerId) {
  currentLedgerCustomer = customerId;
  renderLedger();
}

function getLedgerDateRange() {
  const today = todayStr();
  if (currentLedgerFilter === 'this-week') {
    const d = new Date(); const dw = d.getDay() || 7;
    const mon = new Date(d); mon.setDate(d.getDate() - dw + 1);
    return { from: mon.toISOString().split('T')[0], to: today };
  }
  if (currentLedgerFilter === 'last-week') {
    const d = new Date(); const dw = d.getDay() || 7;
    const lastMon = new Date(d); lastMon.setDate(d.getDate() - dw - 6);
    const lastSun = new Date(lastMon); lastSun.setDate(lastMon.getDate() + 6);
    return { from: lastMon.toISOString().split('T')[0], to: lastSun.toISOString().split('T')[0] };
  }
  if (currentLedgerFilter === 'this-month') {
    return { from: today.substr(0,7) + '-01', to: today };
  }
  if (currentLedgerFilter === 'last-month') {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth()-1);
    const m = d.toISOString().substr(0,7);
    const lastDay = new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().split('T')[0];
    return { from: m+'-01', to: lastDay };
  }
  if (currentLedgerFilter === 'custom') {
    return { from: document.getElementById('ledgerFrom').value||'2000-01-01', to: document.getElementById('ledgerTo').value||today };
  }
  return { from: '2000-01-01', to: '2099-12-31' };
}

function buildLedgerRows(customerId) {
  const rows = [];
  const orders   = customerId && customerId!=='all' ? DB.orders.filter(o=>o.customerId===customerId)   : DB.orders;
  const payments = customerId && customerId!=='all' ? DB.payments.filter(p=>p.customerId===customerId) : DB.payments;
  orders.forEach(o => {
    const c = getCustomer(o.customerId);
    rows.push({ id:o.id, date:o.date, type:'order', slot:o.slot, customerId:o.customerId,
      customerName: c?c.name:'—', debit:calcOrderTotal(o), credit:0, items:o.items, note:o.note });
  });
  payments.forEach(p => {
    const c = getCustomer(p.customerId);
    rows.push({ id:p.id, date:p.date, type:'payment', slot:p.slot||'morning', customerId:p.customerId,
      customerName: c?c.name:'—', debit:0, credit:p.amount, note:p.note });
  });
  rows.sort((a,b) => a.date.localeCompare(b.date) || (a.slot==='morning'?0:1)-(b.slot==='morning'?0:1) || (a.type==='order'?0:1)-(b.type==='order'?0:1));
  return rows;
}

function renderLedger() {
  // Build customer tabs
  const tabContainer = document.getElementById('ledgerCustomerTabs');
  if (tabContainer) {
    tabContainer.innerHTML = `
      <button class="supplier-tab ${currentLedgerCustomer==='all'?'active':''}" onclick="setLedgerCustomer('all')">All</button>
      ${DB.customers.map(c => `
        <button class="supplier-tab ${currentLedgerCustomer===c.id?'active':''}" onclick="setLedgerCustomer('${c.id}')">
          ${c.name}
        </button>`).join('')}`;
  }

  const { from, to } = getLedgerDateRange();
  const allRows  = buildLedgerRows(currentLedgerCustomer);
  const rows     = allRows.filter(r => r.date >= from && r.date <= to);
  const beforeRows = allRows.filter(r => r.date < from);
  let bal = beforeRows.reduce((s,r) => s + r.debit - r.credit, 0);
  let totalDebit = 0, totalCredit = 0;

  const tbody = document.getElementById('ledgerBody');
  if (!tbody) return;

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="icon">📒</div><div class="text">No transactions in this period.</div></div></td></tr>`;
  } else {
    tbody.innerHTML = rows.map(r => {
      bal += r.debit - r.credit;
      totalDebit  += r.debit;
      totalCredit += r.credit;
      const isPay = r.type === 'payment';
      const detailId = 'det-' + r.id;
      const icon = r.slot === 'morning' ? '🌅' : '🌆';
      const cbCell = ledgerSelectMode
        ? `<td class="ledger-cb-cell"><input type="checkbox" class="ledger-row-cb" data-id="${r.id}" onchange="toggleLedgerRowSelect('${r.id}')"></td>`
        : '';

      let detailHTML = '';
      if (!isPay && r.items) {
        detailHTML = `
          <div class="ledger-row-actions">
            <button class="btn btn-secondary btn-sm" onclick="toggleDetail('${detailId}')">👁️</button>
            <button class="btn btn-info btn-sm" onclick="openEditOrder('${r.id}')">✏️</button>
            <button class="btn btn-danger btn-sm" onclick="confirmDeleteOrder('${r.id}')">🗑️</button>
          </div>
          <div class="ledger-detail" id="${detailId}">
            ${r.items.map(it => {
              const p = getProduct(it.productId)||{name:it.productId};
              return `<div class="detail-row"><span>${p.name} × ${it.pcs}pcs</span><span>₹${fmt(it.amount)}</span></div>`;
            }).join('')}
          </div>`;
      } else if (isPay) {
        detailHTML = `<div class="ledger-row-actions">
          <button class="btn btn-info btn-sm" onclick="openEditPayment('${r.id}')">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeletePayment('${r.id}')">🗑️</button>
        </div>`;
      }

      return `<tr class="${isPay?'payment-row':''}">
        ${cbCell}
        <td class="date-cell">${fmtDate(r.date)}<br><span style="font-size:12px;">${icon}</span></td>
        <td class="ledger-desc-cell">
          <div style="font-size:12px;font-weight:700;">${r.customerName}</div>
          <div style="font-size:11px;color:var(--text-muted);">${isPay?'💳 Payment':(r.slot==='morning'?'🌅 Morning Bill':'🌆 Evening Bill')}${r.note?' · '+r.note:''}</div>
        </td>
        <td class="right mono ledger-debit">${r.debit>0?'₹'+fmt(r.debit):'—'}</td>
        <td class="right mono credit-cell">${r.credit>0?'₹'+fmt(r.credit):'—'}</td>
        <td class="right balance-cell">₹${fmt(bal)}</td>
        <td class="ledger-action-cell">${detailHTML}</td>
      </tr>`;
    }).join('');
  }

  document.getElementById('ledgerSummaryBar').innerHTML = `
    <div class="ledger-summary-chip red-chip">Bills: ₹${fmt(totalDebit)}</div>
    <div class="ledger-summary-chip green-chip">Paid: ₹${fmt(totalCredit)}</div>
    <div class="ledger-summary-chip orange-chip">Balance: ₹${fmt(bal)}</div>`;
}

function toggleDetail(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

// Ledger select mode
function toggleLedgerSelectMode() {
  ledgerSelectMode = !ledgerSelectMode;
  selectedLedgerRows.clear();
  document.getElementById('ledgerSelectionToolbar').style.display = ledgerSelectMode ? 'flex' : 'none';
  document.getElementById('ledgerSelectModeBtn').textContent = ledgerSelectMode ? '✕ Cancel' : '☑️ Select';
  renderLedger();
}

function selectAllLedgerRows() {
  const cbs = document.querySelectorAll('.ledger-row-cb');
  const allChecked = [...cbs].every(cb => cb.checked);
  cbs.forEach(cb => { cb.checked = !allChecked; const id = cb.dataset.id; if (!allChecked) selectedLedgerRows.add(id); else selectedLedgerRows.delete(id); });
  updateSelectionCount();
}

function toggleLedgerRowSelect(rowId) {
  if (selectedLedgerRows.has(rowId)) selectedLedgerRows.delete(rowId);
  else selectedLedgerRows.add(rowId);
  updateSelectionCount();
}

function updateSelectionCount() {
  const n = selectedLedgerRows.size;
  document.getElementById('selectionCount').textContent = n > 0 ? `${n} row(s) selected` : 'Select rows to export';
  document.getElementById('selectionExportBtn').disabled = n === 0;
}

function exportSelectedRows() {
  const { from, to } = getLedgerDateRange();
  const allRows  = buildLedgerRows(currentLedgerCustomer);
  const rows     = allRows.filter(r => selectedLedgerRows.has(r.id));
  if (rows.length === 0) return;
  printLedgerRows('Selected Transactions', rows);
}

// ==========================================================
//  PAYMENTS
// ==========================================================
function openPaymentModal(customerId) {
  editingPaymentId = null;
  document.getElementById('payModalTitle').textContent = 'Record Payment';
  document.getElementById('payModalSaveBtn').textContent = '✅ Record Payment';
  document.getElementById('payModalDate').value = todayStr();
  document.getElementById('payModalAmount').value = '';
  document.getElementById('payModalNote').value = '';
  populateCustomerSelect('payModalCustomer', customerId || (currentLedgerCustomer !== 'all' ? currentLedgerCustomer : ''));
  setPayModalSlot('morning');
  openModal('paymentModal');
}

function openEditPayment(paymentId) {
  const p = DB.payments.find(x => x.id === paymentId);
  if (!p) return;
  editingPaymentId = paymentId;
  document.getElementById('payModalTitle').textContent = '✏️ Edit Payment';
  document.getElementById('payModalSaveBtn').textContent = '✅ Update';
  document.getElementById('payModalDate').value = p.date;
  document.getElementById('payModalAmount').value = p.amount;
  document.getElementById('payModalNote').value = p.note || '';
  populateCustomerSelect('payModalCustomer', p.customerId || '');
  setPayModalSlot(p.slot || 'morning');
  openModal('paymentModal');
}

function populateCustomerSelect(selectId, selectedId) {
  const el = document.getElementById(selectId);
  if (!el) return;
  el.innerHTML = `<option value="">— Select Customer —</option>` +
    DB.customers.map(c => `<option value="${c.id}" ${selectedId===c.id?'selected':''}>${c.name}</option>`).join('');
}

function setPayModalSlot(slot) {
  payModalSlotVal = slot;
  const inp = document.getElementById('payModalSlot');
  if (inp) inp.value = slot;
  const mBtn = document.getElementById('payModalSlotMorning');
  const eBtn = document.getElementById('payModalSlotEvening');
  if (mBtn) mBtn.className = slot==='morning'?'active morning':'';
  if (eBtn) eBtn.className = slot==='evening'?'active evening':'';
}

function recordPaymentFromModal() {
  const date       = document.getElementById('payModalDate').value;
  const amount     = parseFloat(document.getElementById('payModalAmount').value);
  const note       = document.getElementById('payModalNote').value.trim();
  const customerId = document.getElementById('payModalCustomer').value;
  const slot       = document.getElementById('payModalSlot')?.value || 'morning';
  if (!date || isNaN(amount) || amount <= 0) { toast('Enter valid date and amount.', 'error'); return; }
  if (!customerId) { toast('Please select a customer.', 'error'); return; }

  if (editingPaymentId) {
    const idx = DB.payments.findIndex(p => p.id === editingPaymentId);
    if (idx !== -1) DB.payments[idx] = { ...DB.payments[idx], date, amount, note, customerId, slot };
    toast('✅ Payment updated!', 'success');
    editingPaymentId = null;
  } else {
    DB.payments.push({ id: uid(), date, amount, note, customerId, slot, createdAt: new Date().toISOString() });
    const c = getCustomer(customerId);
    toast(`✅ Payment for ${c?c.name:'customer'} recorded!`, 'success');
  }
  persistDB();
  closeModal('paymentModal');
  if (activePage === 'ledger') renderLedger();
  if (activePage === 'dashboard') renderDashboard();
}

function confirmDeletePayment(paymentId) {
  pendingDelete = { type:'payment', id: paymentId };
  document.getElementById('deleteConfirmMsg').textContent = 'Delete this payment? This cannot be undone.';
  openModal('deleteConfirmModal');
}

// ==========================================================
//  CONFIRM DELETE
// ==========================================================
function confirmDelete() {
  if (!pendingDelete) return;
  const { type, id } = pendingDelete;
  if (type === 'order') {
    DB.orders = DB.orders.filter(o => o.id !== id);
    persistDB(); toast('Order deleted.', 'info');
    if (activePage === 'order') renderTodaysOrdersList();
    if (activePage === 'ledger') renderLedger();
    if (activePage === 'dashboard') renderDashboard();
  } else if (type === 'payment') {
    DB.payments = DB.payments.filter(p => p.id !== id);
    persistDB(); toast('Payment deleted.', 'info');
    if (activePage === 'ledger') renderLedger();
    if (activePage === 'dashboard') renderDashboard();
  } else if (type === 'customer') {
    DB.customers = DB.customers.filter(c => c.id !== id);
    persistDB(); toast('Customer deleted.', 'info');
    if (activePage === 'customers') renderCustomerList();
  } else if (type === 'product') {
    DB.products = DB.products.filter(p => p.id !== id);
    persistDB(); toast('Product deleted.', 'info');
    if (activePage === 'products') renderProductsPage();
  }
  pendingDelete = null;
  closeModal('deleteConfirmModal');
}

// ==========================================================
//  PRODUCTS PAGE
// ==========================================================
function renderProductsPage() {
  const el = document.getElementById('productsBody');
  el.innerHTML = DB.products.map((p, i) => {
    const packInfo = p.packQty ? `${p.packQty}pcs` : '—';
    const isDefault = DEFAULT_PRODUCTS.find(d => d.id === p.id);
    return `<tr>
      <td style="color:var(--text-muted);font-size:11px;">${i+1}</td>
      <td><strong>${p.name}</strong>${!isDefault?'<span class="badge badge-blue" style="font-size:9px;margin-left:4px;">Custom</span>':''}</td>
      <td>${p.packType||'—'}</td>
      <td class="right mono">${packInfo}</td>
      <td class="right mono">₹${getProductRate(p).toFixed(3).replace(/\.?0+$/,'')}</td>
      <td><button class="btn btn-info btn-sm" onclick="openEditProduct('${p.id}')">✏️</button></td>
    </tr>`;
  }).join('');
}

function updateProdPreview() {
  const r  = parseFloat(document.getElementById('prodRate').value);
  const pq = parseInt(document.getElementById('prodPackQty').value);
  const pt = document.getElementById('prodPackType').value;
  const el = document.getElementById('prodPreview');
  if (!isNaN(r) && r > 0) {
    let txt = `₹${r.toFixed(3).replace(/\.?0+$/,'')} per pc`;
    if (!isNaN(pq) && pq > 0 && pt) txt += ` · ${pt} of ${pq}pcs = ₹${fmt(r*pq)}`;
    el.textContent = txt;
  } else { el.textContent = ''; }
}

function openAddProduct() {
  document.getElementById('productModalTitle').textContent = 'Add Product';
  document.getElementById('editProductId').value = '';
  document.getElementById('editProductMode').value = 'add';
  document.getElementById('prodName').value = '';
  document.getElementById('prodPackType').value = 'Crate';
  document.getElementById('prodPackQty').value = '';
  document.getElementById('prodRate').value = '';
  document.getElementById('prodDeleteBtn').style.display = 'none';
  document.getElementById('prodPreview').textContent = '';
  openModal('productModal');
}

function openEditProduct(id) {
  const p = getProduct(id);
  if (!p) return;
  document.getElementById('productModalTitle').textContent = 'Edit: ' + p.name;
  document.getElementById('editProductId').value = id;
  document.getElementById('editProductMode').value = 'edit';
  document.getElementById('prodName').value = p.name;
  document.getElementById('prodPackType').value = p.packType || '';
  document.getElementById('prodPackQty').value = p.packQty || '';
  document.getElementById('prodRate').value = getProductRate(p);
  const isDefault = !!DEFAULT_PRODUCTS.find(d => d.id === p.id);
  const delBtn = document.getElementById('prodDeleteBtn');
  delBtn.style.display = isDefault ? 'none' : 'inline-flex';
  delBtn.onclick = () => { closeModal('productModal'); pendingDelete={type:'product',id}; document.getElementById('deleteConfirmMsg').textContent=`Delete "${p.name}"?`; openModal('deleteConfirmModal'); };
  updateProdPreview();
  openModal('productModal');
}

function saveProduct() {
  const id   = document.getElementById('editProductId').value;
  const mode = document.getElementById('editProductMode').value;
  const name = document.getElementById('prodName').value.trim();
  const r    = parseFloat(document.getElementById('prodRate').value);
  const pqVal= document.getElementById('prodPackQty').value.trim();
  const pq   = pqVal !== '' ? parseInt(pqVal) : null;
  const pt   = document.getElementById('prodPackType').value || null;

  if (!name) { toast('Product name required.', 'error'); return; }
  if (isNaN(r) || r <= 0) { toast('Enter a valid rate.', 'error'); return; }

  if (mode === 'add') {
    DB.products.push({ id:'c'+uid(), name, packType:pt, packQty:pq, rate:r });
    toast('✅ Product added!', 'success');
  } else {
    const p = getProduct(id);
    if (!p) return;
    p.name = name; p.packType = pt; p.packQty = pq; p.rate = r;
    toast('✅ Product updated!', 'success');
  }
  persistDB();
  closeModal('productModal');
  renderProductsPage();
}

// ==========================================================
//  AMUL ORDER
// ==========================================================
function initAmulOrderPage() {
  const dateEl = document.getElementById('amulOrderDate');
  if (!dateEl.value) dateEl.value = todayStr();
  setAmulSlot(amulSlot);
}

function setAmulOrderToday() {
  document.getElementById('amulOrderDate').value = todayStr();
  renderAmulOrder();
}

function setAmulSlot(slot) {
  amulSlot = slot;
  document.getElementById('amulSlotMorning').className = slot==='morning'?'active morning':'';
  document.getElementById('amulSlotEvening').className = slot==='evening'?'active evening':'';
  renderAmulOrder();
}

function renderAmulOrder() {
  const date = document.getElementById('amulOrderDate')?.value;
  if (!date) return;

  const orders = DB.orders.filter(o => o.date === date && o.slot === amulSlot);

  // Aggregate pcs per product
  const agg = {}; // productId → totalPcs
  orders.forEach(o => {
    o.items.forEach(it => {
      agg[it.productId] = (agg[it.productId]||0) + it.pcs;
    });
  });

  const tbody = document.getElementById('amulOrderBody');
  const footer = document.getElementById('amulOrderFooter');

  if (Object.keys(agg).length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="icon">📦</div><div class="text">No ${amulSlot} orders for ${fmtDate(date)}.</div></div></td></tr>`;
    footer.innerHTML = '';
    return;
  }

  let totalCrates = 0, totalBoxes = 0;
  tbody.innerHTML = DB.products
    .filter(p => agg[p.id])
    .map(p => {
      const pcs  = agg[p.id];
      const hasPackaging = p.packQty && p.packType;
      if (!hasPackaging) {
        return `<tr>
          <td><strong>${p.name}</strong></td>
          <td style="color:var(--text-muted);">Loose</td>
          <td class="right mono">—</td>
          <td class="right mono" style="font-weight:700;">${pcs}</td>
          <td class="right mono">—</td>
          <td class="right mono" style="font-weight:700;color:var(--green);">—</td>
          <td><button class="btn btn-secondary btn-sm" onclick="showAmulBreakdown('${p.id}','${date}')">👥</button></td>
        </tr>`;
      }
      const exact = pcs / p.packQty;
      const ceil  = Math.ceil(exact);
      const ok    = Number.isInteger(exact);
      if (p.packType === 'Crate') totalCrates += ceil;
      if (p.packType === 'Box')   totalBoxes  += ceil;
      return `<tr class="${ok?'':'amul-needs-adjust'}">
        <td><strong>${p.name}</strong></td>
        <td>${p.packType}</td>
        <td class="right mono">${p.packQty}</td>
        <td class="right mono" style="font-weight:700;">${pcs}</td>
        <td class="right mono" style="color:var(--text-muted);">${exact.toFixed(2).replace(/\.?0+$/,'')}</td>
        <td class="right" style="font-weight:700;">
          ${ok
            ? `<span style="color:var(--green);font-family:'IBM Plex Mono',monospace;">✅ ${ceil}</span>`
            : `<span style="color:var(--red);font-family:'IBM Plex Mono',monospace;">⚠️ ${ceil}</span>`}
        </td>
        <td><button class="btn btn-secondary btn-sm" onclick="showAmulBreakdown('${p.id}','${date}')">👥</button></td>
      </tr>`;
    }).join('');

  footer.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      ${totalCrates>0?`<div class="ledger-summary-chip red-chip">🧺 Total Crates: <strong>${totalCrates}</strong></div>`:''}
      ${totalBoxes>0?`<div class="ledger-summary-chip blue-chip">📦 Total Boxes: <strong>${totalBoxes}</strong></div>`:''}
      <div class="ledger-summary-chip gray-chip">📋 ${orders.length} order(s) · ${Object.keys(agg).length} product(s)</div>
    </div>`;
}

function showAmulBreakdown(productId, date) {
  const p = getProduct(productId);
  if (!p) return;
  const orders = DB.orders.filter(o => o.date === date && o.slot === amulSlot);
  const rows = [];
  orders.forEach(o => {
    const it = o.items.find(i => i.productId === productId);
    if (it && it.pcs > 0) {
      const c = getCustomer(o.customerId);
      rows.push({ name: c?c.name:'—', pcs: it.pcs });
    }
  });
  const card = document.getElementById('amulBreakdownCard');
  document.getElementById('amulBreakdownTitle').textContent = `${p.name} – Customer Breakdown`;
  document.getElementById('amulBreakdownContent').innerHTML = rows.length === 0
    ? '<div class="empty-state" style="padding:12px;"><div class="text">No orders.</div></div>'
    : `<div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Customer</th><th class="right">Pcs</th></tr></thead>
          <tbody>${rows.map(r=>`<tr><td>${r.name}</td><td class="right mono" style="font-weight:700;">${r.pcs}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td style="font-weight:700;padding:7px 10px;border-top:2px solid var(--border);">TOTAL</td><td class="right mono" style="font-weight:700;border-top:2px solid var(--border);">${rows.reduce((s,r)=>s+r.pcs,0)}</td></tr></tfoot>
        </table>
      </div>`;
  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeAmulBreakdown() {
  document.getElementById('amulBreakdownCard').style.display = 'none';
}

// ==========================================================
//  EXPORT PAGE
// ==========================================================
function initExportPage() {
  document.getElementById('exportDayDate').value = todayStr();
  document.getElementById('exportMonth').value = todayStr().substr(0,7);
  updateStorageInfo();
  updateDriveUI(!!_driveToken);
}

function updateStorageInfo() {
  const el = document.getElementById('storageInfoBar');
  if (!el) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { el.innerHTML = '📦 No data saved yet.'; return; }
    const sizeKB = (new Blob([raw]).size / 1024).toFixed(1);
    el.innerHTML = `💾 ${DB.customers.length} customers · ${DB.orders.length} orders · ${DB.payments.length} payments · ${sizeKB} KB`;
  } catch(e) { el.innerHTML = 'Storage info unavailable.'; }
}

function exportDailyPDF()        { printDayReport(todayStr()); }
function exportSpecificDayPDF()  { const d = document.getElementById('exportDayDate').value; if(d) printDayReport(d); else toast('Pick a date','error'); }
function exportWeeklyPDF() {
  const d = new Date(); const dw = d.getDay()||7;
  const mon = new Date(d); mon.setDate(d.getDate()-dw+1);
  printLedgerPeriod('Weekly Ledger', mon.toISOString().split('T')[0], todayStr(), null);
}
function exportMonthlyPDF() {
  const m = todayStr().substr(0,7);
  printLedgerPeriod('Monthly Ledger – '+new Date().toLocaleDateString('en-IN',{month:'long',year:'numeric'}), m+'-01', todayStr(), null);
}
function exportSpecificMonthPDF() {
  const m = document.getElementById('exportMonth').value;
  if (!m) { toast('Pick a month','error'); return; }
  const d = new Date(m+'-01');
  const lastDay = new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().split('T')[0];
  printLedgerPeriod('Ledger – '+d.toLocaleDateString('en-IN',{month:'long',year:'numeric'}), m+'-01', lastDay, null);
}
function exportYearlyPDF() {
  const y = new Date().getFullYear();
  printLedgerPeriod('Yearly Ledger – '+y, y+'-01-01', y+'-12-31', null);
}

function printCurrentLedger() {
  const { from, to } = getLedgerDateRange();
  const custName = currentLedgerCustomer!=='all' ? (getCustomer(currentLedgerCustomer)?.name||'') : 'All Customers';
  const title = `Ledger – ${custName} (${fmtDate(from)} – ${fmtDate(to)})`;
  printLedgerPeriod(title, from, to, currentLedgerCustomer!=='all'?currentLedgerCustomer:null);
}

function printAmulOrder() {
  const date = document.getElementById('amulOrderDate')?.value || todayStr();
  const orders = DB.orders.filter(o => o.date === date && o.slot === amulSlot);
  const agg = {};
  orders.forEach(o => o.items.forEach(it => { agg[it.productId] = (agg[it.productId]||0) + it.pcs; }));
  let html = `<div class="print-header"><h1>Amul Calc</h1><p style="font-weight:700;">Amul Order – ${amulSlot==='morning'?'🌅 Morning':'🌆 Evening'}</p><p>${fmtDateLong(date)}</p></div>`;
  html += `<table class="print-table"><thead><tr><th>Product</th><th>Pack</th><th class="right">Pcs/Pack</th><th class="right">Total Pcs</th><th class="right">Order (packs)</th></tr></thead><tbody>`;
  DB.products.filter(p => agg[p.id]).forEach(p => {
    const pcs = agg[p.id];
    const ceil = p.packQty ? Math.ceil(pcs/p.packQty) : null;
    const ok   = p.packQty ? Number.isInteger(pcs/p.packQty) : true;
    html += `<tr style="${ok?'':'background:#fff3f3;'}">
      <td>${p.name}</td><td>${p.packType||'Loose'}</td>
      <td class="right">${p.packQty||'—'}</td>
      <td class="right"><strong>${pcs}</strong></td>
      <td class="right" style="color:${ok?'green':'red'};font-weight:700;">${ceil?ceil+'':' —'} ${ok?'✅':'⚠️'}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  openPrintWindow(html);
}

function printDayReport(date) {
  const orders   = DB.orders.filter(o => o.date === date).sort((a,b)=>(a.slot==='morning'?0:1)-(b.slot==='morning'?0:1));
  const payments = DB.payments.filter(p => p.date === date);
  const totalOrders = orders.reduce((s,o)=>s+calcOrderTotal(o),0);
  const totalPay    = payments.reduce((s,p)=>s+p.amount,0);
  let html = `<div class="print-header"><h1>Amul Calc</h1><p style="font-weight:700;">Daily Report – ${fmtDateLong(date)}</p></div>`;
  if (orders.length === 0) html += '<p style="text-align:center;color:#666;padding:20px;">No orders on this date.</p>';
  else {
    orders.forEach(o => {
      const c = getCustomer(o.customerId);
      html += `<h3>${o.slot==='morning'?'🌅 Morning':'🌆 Evening'} – ${c?c.name:'—'}</h3>
        <table class="print-table"><thead><tr><th>Product</th><th class="right">Pcs</th><th class="right">Rate</th><th class="right">Amount</th></tr></thead>
        <tbody>${o.items.map(it=>{const p=getProduct(it.productId)||{name:it.productId};return`<tr><td>${p.name}</td><td class="right">${it.pcs}</td><td class="right">₹${it.rate.toFixed(3).replace(/\.?0+$/,'')}</td><td class="right">₹${fmt(it.amount)}</td></tr>`;}).join('')}</tbody>
        <tfoot><tr><td colspan="3" style="text-align:right;font-weight:700;padding:6px 8px;border-top:2px solid #ddd;">TOTAL</td><td class="right" style="font-weight:700;font-size:14px;border-top:2px solid #ddd;">₹${fmt(calcOrderTotal(o))}</td></tr></tfoot>
        </table>`;
    });
  }
  html += `<div class="print-summary">
    <div class="print-summary-box"><div class="label">Orders</div><div class="value">₹${fmt(totalOrders)}</div></div>
    <div class="print-summary-box"><div class="label">Payments</div><div class="value" style="color:#1e8449;">₹${fmt(totalPay)}</div></div>
    <div class="print-summary-box"><div class="label">Day Balance</div><div class="value" style="color:#d35400;">₹${fmt(totalOrders-totalPay)}</div></div>
  </div>`;
  openPrintWindow(html);
}

function printSingleOrder(orderId) {
  const o = DB.orders.find(x => x.id === orderId);
  if (!o) return;
  const c = getCustomer(o.customerId);
  const total = calcOrderTotal(o);
  const html = `<div class="print-header"><h1>Amul Calc</h1>
    <p style="font-weight:700;">${o.slot==='morning'?'🌅 Morning':'🌆 Evening'} Order – ${fmtDateLong(o.date)}</p>
    ${c?`<p>Customer: ${c.name}${c.phone?' · '+c.phone:''}</p>`:''}
  </div>
  <table class="print-table"><thead><tr><th>Product</th><th class="right">Pcs</th><th class="right">Rate</th><th class="right">Amount</th></tr></thead>
  <tbody>${o.items.map(it=>{const p=getProduct(it.productId)||{name:it.productId};return`<tr><td>${p.name}</td><td class="right">${it.pcs}</td><td class="right">₹${it.rate.toFixed(3).replace(/\.?0+$/,'')}</td><td class="right">₹${fmt(it.amount)}</td></tr>`;}).join('')}</tbody>
  <tfoot><tr><td colspan="3" style="text-align:right;font-weight:700;padding:7px 8px;border-top:2px solid #ddd;">TOTAL</td>
  <td class="right" style="font-weight:700;font-size:14px;border-top:2px solid #ddd;">₹${fmt(total)}</td></tr></tfoot></table>
  ${o.note?`<p style="margin-top:12px;color:#666;font-size:12px;">Note: ${o.note}</p>`:''}
  <div class="print-summary"><div class="print-summary-box"><div class="label">Order Total</div><div class="value">₹${fmt(total)}</div></div></div>`;
  openPrintWindow(html);
}

function printLedgerPeriod(title, from, to, customerId) {
  const allRows = buildLedgerRows(customerId);
  const rows    = allRows.filter(r => r.date >= from && r.date <= to);
  const before  = allRows.filter(r => r.date < from);
  let bal = before.reduce((s,r) => s+r.debit-r.credit, 0);
  let td = 0, tc = 0;
  const withBal = rows.map(r => { bal+=r.debit-r.credit; td+=r.debit; tc+=r.credit; return {...r, balance:bal}; });
  const html = `
    <div class="print-header"><h1>Amul Calc</h1><p style="font-size:14px;font-weight:700;">${title}</p><p>Printed: ${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})}</p></div>
    <table class="print-table">
      <thead><tr><th>Date</th><th>Slot</th><th>Customer</th><th>Description</th><th class="right">Debit</th><th class="right">Credit</th><th class="right">Balance</th></tr></thead>
      <tbody>${withBal.map(r=>`<tr class="${r.type==='payment'?'payment-row':''}">
        <td>${fmtDate(r.date)}</td>
        <td>${r.slot==='morning'?'🌅':'🌆'}</td>
        <td>${r.customerName}</td>
        <td>${r.type==='payment'?'💳 '+( r.note||'Payment'):(r.slot==='morning'?'🌅 Morning Bill':'🌆 Evening Bill')+(r.note?' · '+r.note:'')}</td>
        <td class="right">${r.debit>0?'₹'+fmt(r.debit):'—'}</td>
        <td class="right">${r.credit>0?'₹'+fmt(r.credit):'—'}</td>
        <td class="right balance-cell">₹${fmt(r.balance)}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr style="font-weight:700;background:#f8f8f8;">
        <td colspan="4" style="text-align:right;padding:8px;">TOTALS</td>
        <td class="right" style="color:#c0392b;">₹${fmt(td)}</td>
        <td class="right" style="color:#1e8449;">₹${fmt(tc)}</td>
        <td class="right balance-cell">₹${fmt(withBal.length?withBal[withBal.length-1].balance:0)}</td>
      </tr></tfoot>
    </table>
    <div class="print-summary">
      <div class="print-summary-box"><div class="label">Total Billed</div><div class="value">₹${fmt(td)}</div></div>
      <div class="print-summary-box"><div class="label">Total Paid</div><div class="value" style="color:#1e8449;">₹${fmt(tc)}</div></div>
      <div class="print-summary-box"><div class="label">Closing Balance</div><div class="value" style="color:#d35400;">₹${fmt(withBal.length?withBal[withBal.length-1].balance:0)}</div></div>
    </div>`;
  openPrintWindow(html);
}

function printLedgerRows(title, rows) {
  let bal = 0, td = 0, tc = 0;
  const withBal = rows.map(r => { bal+=r.debit-r.credit; td+=r.debit; tc+=r.credit; return {...r, balance:bal}; });
  const html = `
    <div class="print-header"><h1>Amul Calc</h1><p style="font-size:14px;font-weight:700;">${title}</p></div>
    <table class="print-table">
      <thead><tr><th>Date</th><th>Customer</th><th>Description</th><th class="right">Debit</th><th class="right">Credit</th><th class="right">Balance</th></tr></thead>
      <tbody>${withBal.map(r=>`<tr class="${r.type==='payment'?'payment-row':''}">
        <td>${fmtDate(r.date)}</td><td>${r.customerName}</td>
        <td>${r.type==='payment'?'💳 Payment':(r.slot==='morning'?'🌅 Morning':'🌆 Evening')+(r.note?' · '+r.note:'')}</td>
        <td class="right">${r.debit>0?'₹'+fmt(r.debit):'—'}</td>
        <td class="right">${r.credit>0?'₹'+fmt(r.credit):'—'}</td>
        <td class="right balance-cell">₹${fmt(r.balance)}</td>
      </tr>`).join('')}</tbody>
    </table>
    <div class="print-summary">
      <div class="print-summary-box"><div class="label">Total Billed</div><div class="value">₹${fmt(td)}</div></div>
      <div class="print-summary-box"><div class="label">Total Paid</div><div class="value" style="color:#1e8449;">₹${fmt(tc)}</div></div>
    </div>`;
  openPrintWindow(html);
}

function openPrintWindow(content) {
  const win = window.open('','_blank','width=900,height=700');
  win.document.write(`<!DOCTYPE html><html><head>
    <title>Amul Calc – Print</title>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
    <style>
      body{font-family:'IBM Plex Sans',sans-serif;padding:22px;color:#1a1a1a;max-width:860px;margin:0 auto;}
      .print-header{text-align:center;margin-bottom:18px;border-bottom:2px solid #c0392b;padding-bottom:10px;}
      .print-header h1{color:#c0392b;font-size:24px;margin-bottom:4px;}
      .print-header p{font-size:12px;color:#666;}
      .print-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:14px;}
      .print-table th{background:#f2f2f2;padding:6px 8px;font-weight:700;font-size:10px;text-transform:uppercase;border:1px solid #ddd;text-align:left;}
      .print-table td{padding:5px 8px;border:1px solid #eee;vertical-align:middle;}
      .print-table .right{text-align:right;}
      .print-table tr.payment-row td{background:#f0faf4;}
      .print-table tfoot td{font-weight:700;background:#f8f8f8;}
      .balance-cell{font-weight:700;color:#c0392b;font-family:'IBM Plex Mono',monospace;}
      .print-summary{margin-top:18px;display:flex;gap:14px;flex-wrap:wrap;}
      .print-summary-box{border:1px solid #ddd;border-radius:6px;padding:10px 14px;min-width:130px;}
      .print-summary-box .label{font-size:10px;text-transform:uppercase;font-weight:700;color:#666;}
      .print-summary-box .value{font-size:18px;font-weight:700;color:#c0392b;font-family:'IBM Plex Mono',monospace;margin-top:3px;}
      h3{color:#c0392b;font-size:12px;margin:14px 0 7px;}
      @media print{button{display:none;}}
    </style></head><body>
    ${content}
    <div style="margin-top:28px;text-align:center;">
      <button onclick="window.print()" style="padding:9px 22px;background:#c0392b;color:white;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;">🖨️ Print / Save PDF</button>
      <button onclick="window.close()" style="padding:9px 22px;background:#f2f2f2;border:1px solid #ddd;border-radius:6px;font-size:13px;cursor:pointer;margin-left:8px;">Close</button>
    </div></body></html>`);
  win.document.close();
}

// ==========================================================
//  GOOGLE DRIVE SYNC (same as RajMart, renamed constants)
// ==========================================================
const DRIVE_FILE_NAME   = 'amul_calc.json';
const DRIVE_FOLDER_NAME = 'AmulCalc';
const DRIVE_SCOPE       = 'https://www.googleapis.com/auth/drive.file';
const LS_DRIVE_TOKEN     = 'amulcalc_drive_token';
const LS_DRIVE_TOKEN_EXP = 'amulcalc_drive_token_exp';
const LS_DRIVE_FILE_ID   = 'amulcalc_drive_file_id';
const LS_DRIVE_FOLDER_ID = 'amulcalc_drive_folder_id';
const LS_DRIVE_CLIENT_ID = 'amulcalc_drive_client_id';

let DRIVE_CLIENT_ID  = localStorage.getItem(LS_DRIVE_CLIENT_ID) || '';
let _driveToken      = null;
let _driveTokenExp   = 0;
let _driveFolderId   = localStorage.getItem(LS_DRIVE_FOLDER_ID) || null;
let _driveFileId     = localStorage.getItem(LS_DRIVE_FILE_ID)   || null;
let _driveSaveTimer  = null;
let _driveRefreshTimer = null;
let _gapiReady       = false;

function onGapiLoad() {
  gapi.load('client', async () => {
    try {
      await gapi.client.init({});
      await gapi.client.load('https://www.googleapis.com/discovery/v1/apis/drive/v3/rest');
      _gapiReady = true;
      tryAutoReconnectDrive();
    } catch(e) { console.warn('[Drive] gapi init failed:', e); }
  });
}

async function tryAutoReconnectDrive() {
  if (!DRIVE_CLIENT_ID || !window.google?.accounts) return;
  const storedToken = localStorage.getItem(LS_DRIVE_TOKEN);
  const storedExp   = parseInt(localStorage.getItem(LS_DRIVE_TOKEN_EXP)||'0',10);
  const BUFFER_MS   = 5*60*1000;
  if (storedToken && storedExp && (storedExp - Date.now()) > BUFFER_MS) {
    _driveToken = storedToken; _driveTokenExp = storedExp;
    gapi.client.setToken({ access_token: _driveToken });
    updateDriveUI(true); updateDriveStatus('Auto-connected ✅'); scheduleTokenRefresh(); return;
  }
  updateDriveStatus('Reconnecting to Drive…');
  silentTokenRefresh().catch(() => { updateDriveStatus('Drive disconnected. Tap ☁️ to reconnect.'); updateDriveUI(false); });
}

function silentTokenRefresh() {
  return new Promise((resolve, reject) => {
    if (!DRIVE_CLIENT_ID) { reject(new Error('No client ID')); return; }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: DRIVE_CLIENT_ID, scope: DRIVE_SCOPE, prompt: 'none',
      callback: (resp) => { if (resp.error) { reject(new Error(resp.error)); return; } _onTokenReceived(resp, true); resolve(); }
    });
    client.requestAccessToken();
  });
}

function driveSignIn() {
  if (!DRIVE_CLIENT_ID) { toast('⚠️ Paste your Google Client ID first.', 'error'); showPage('export'); return; }
  if (!window.google?.accounts) { toast('⚠️ Google script not loaded.', 'error'); return; }
  const client = google.accounts.oauth2.initTokenClient({
    client_id: DRIVE_CLIENT_ID, scope: DRIVE_SCOPE,
    callback: (resp) => { if (resp.error) { toast('❌ Drive sign-in failed: '+resp.error,'error'); return; } _onTokenReceived(resp, false); }
  });
  client.requestAccessToken();
}

async function _onTokenReceived(resp, silent) {
  _driveToken = resp.access_token;
  const expiresIn = (resp.expires_in||3600)*1000;
  _driveTokenExp  = Date.now() + expiresIn;
  localStorage.setItem(LS_DRIVE_TOKEN,     _driveToken);
  localStorage.setItem(LS_DRIVE_TOKEN_EXP, String(_driveTokenExp));
  gapi.client.setToken({ access_token: _driveToken });
  updateDriveUI(true);
  if (!silent) toast('✅ Connected to Google Drive!', 'success');
  scheduleTokenRefresh();
  if (!_driveFolderId) await driveFindOrCreateFolder();
  if (!_driveFileId)   await driveFindFile();
  updateDriveStatus(_driveFileId ? 'Connected ✅ — file found.' : 'Connected ✅ — will create on first save.');
}

function scheduleTokenRefresh() {
  clearTimeout(_driveRefreshTimer);
  const refreshIn = Math.max(_driveTokenExp - Date.now() - 5*60*1000, 0);
  _driveRefreshTimer = setTimeout(() => { silentTokenRefresh().catch(()=>{}); }, refreshIn);
}

function driveSignOut() {
  if (_driveToken && window.google) google.accounts.oauth2.revoke(_driveToken, ()=>{});
  _driveToken=null; _driveTokenExp=0; _driveFolderId=null; _driveFileId=null;
  clearTimeout(_driveSaveTimer); clearTimeout(_driveRefreshTimer);
  [LS_DRIVE_TOKEN,LS_DRIVE_TOKEN_EXP,LS_DRIVE_FILE_ID,LS_DRIVE_FOLDER_ID].forEach(k=>localStorage.removeItem(k));
  updateDriveUI(false); toast('Disconnected from Google Drive.','info');
}

function saveDriveClientId() {
  const val = (document.getElementById('driveClientIdInput').value||'').trim();
  if (!val) { toast('Paste a Client ID first.','error'); return; }
  DRIVE_CLIENT_ID = val;
  localStorage.setItem(LS_DRIVE_CLIENT_ID, val);
  toast('✅ Client ID saved!', 'success');
  updateDriveUI(false);
}

function updateDriveUI(connected) {
  const topBtn = document.getElementById('driveTopBtn');
  if (topBtn) {
    topBtn.textContent = connected ? '☁️✅' : '☁️';
    topBtn.style.background  = connected ? 'rgba(30,132,73,0.3)' : 'rgba(255,255,255,0.15)';
    topBtn.style.borderColor = connected ? 'rgba(30,132,73,0.7)' : 'rgba(255,255,255,0.3)';
  }
  ['driveUploadBtn','driveDownloadBtn'].forEach(id => {
    const el = document.getElementById(id); if (el) el.disabled = !connected;
  });
  const si = document.getElementById('driveSignInBtn');  if (si)  si.style.display  = connected?'none':'inline-flex';
  const so = document.getElementById('driveSignOutBtn'); if (so)  so.style.display  = connected?'inline-flex':'none';
  const inp = document.getElementById('driveClientIdInput');
  if (inp && DRIVE_CLIENT_ID && !inp.value) inp.value = DRIVE_CLIENT_ID;
}

function updateDriveStatus(msg) { const el=document.getElementById('driveStatusText'); if(el) el.textContent=msg; }
function updateDriveLastSync() { const el=document.getElementById('driveLastSync'); if(el) el.textContent='Last synced: '+new Date().toLocaleTimeString('en-IN'); updateDriveStatus('Synced ✅'); }

async function ensureValidToken() {
  if (!_driveToken) return false;
  if (Date.now() < _driveTokenExp - 60000) return true;
  try { await silentTokenRefresh(); return true; } catch(e) { updateDriveStatus('Session expired. Tap ☁️ to reconnect.'); updateDriveUI(false); return false; }
}

async function driveFindOrCreateFolder() {
  if (!_driveToken) return;
  try {
    const res = await gapi.client.drive.files.list({ q:`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`, fields:'files(id)', spaces:'drive' });
    if (res.result.files.length>0) { _driveFolderId=res.result.files[0].id; }
    else {
      const f = await gapi.client.drive.files.create({ resource:{name:DRIVE_FOLDER_NAME,mimeType:'application/vnd.google-apps.folder'}, fields:'id' });
      _driveFolderId=f.result.id; toast('📁 Created "AmulCalc" folder in Drive.','info');
    }
    localStorage.setItem(LS_DRIVE_FOLDER_ID, _driveFolderId);
  } catch(e) { updateDriveStatus('Folder error: '+e.message); }
}

async function driveFindFile() {
  if (!_driveToken||!_driveFolderId) return;
  try {
    const res = await gapi.client.drive.files.list({ q:`name='${DRIVE_FILE_NAME}' and '${_driveFolderId}' in parents and trashed=false`, fields:'files(id)', spaces:'drive' });
    if (res.result.files.length>0) { _driveFileId=res.result.files[0].id; localStorage.setItem(LS_DRIVE_FILE_ID,_driveFileId); }
  } catch(e) { console.warn('[Drive] File search error:',e); }
}

async function driveUpload(silent=false) {
  if (!_driveToken) { if(!silent) toast('⚠️ Connect to Drive first.','error'); return; }
  const valid = await ensureValidToken();
  if (!valid) { if(!silent) toast('⚠️ Session expired. Reconnect.','error'); return; }
  if (!_driveFolderId) await driveFindOrCreateFolder();
  const content  = JSON.stringify(DB, null, 2);
  const metadata = { name: DRIVE_FILE_NAME, mimeType: 'application/json' };
  if (!_driveFileId) metadata.parents = [_driveFolderId];
  const boundary = 'amulcalc_mp';
  const body = [`--${boundary}`,'Content-Type: application/json; charset=UTF-8','',JSON.stringify(metadata),`--${boundary}`,'Content-Type: application/json','',content,`--${boundary}--`].join('\r\n');
  const method = _driveFileId ? 'PATCH' : 'POST';
  const url    = _driveFileId ? `https://www.googleapis.com/upload/drive/v3/files/${_driveFileId}?uploadType=multipart` : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  try {
    if (!silent) updateDriveStatus('Uploading…');
    const res = await fetch(url,{method,headers:{'Authorization':'Bearer '+_driveToken,'Content-Type':`multipart/related; boundary=${boundary}`},body});
    if (!res.ok) { const err=await res.json(); throw new Error(err.error?.message||'Upload failed'); }
    const data=await res.json(); _driveFileId=data.id; localStorage.setItem(LS_DRIVE_FILE_ID,_driveFileId);
    if (!silent) toast('☁️ Saved to Drive!','success'); updateDriveLastSync();
  } catch(e) { if(!silent) toast('❌ Upload failed: '+e.message,'error'); updateDriveStatus('Upload failed: '+e.message); }
}

async function driveDownload() {
  if (!_driveToken) { toast('⚠️ Connect to Drive first.','error'); return; }
  const valid = await ensureValidToken();
  if (!valid) { toast('⚠️ Session expired.','error'); return; }
  if (!_driveFolderId) await driveFindOrCreateFolder();
  if (!_driveFileId)   await driveFindFile();
  if (!_driveFileId)   { toast('No backup found in Drive.','info'); return; }
  try {
    updateDriveStatus('Downloading…');
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${_driveFileId}?alt=media`,{headers:{'Authorization':'Bearer '+_driveToken}});
    if (!res.ok) throw new Error('Download failed');
    const loaded = await res.json();
    if (!loaded.products)  loaded.products  = JSON.parse(JSON.stringify(DEFAULT_PRODUCTS));
    if (!loaded.customers) loaded.customers = [];
    if (!loaded.orders)    loaded.orders    = [];
    if (!loaded.payments)  loaded.payments  = [];
    DB = loaded; persistDB(); showPage(activePage);
    toast('✅ Data restored from Drive!','success'); updateDriveLastSync();
  } catch(e) { toast('❌ Download failed: '+e.message,'error'); updateDriveStatus('Download failed.'); }
}

function scheduleDriveUpload() {
  if (!_driveToken) return;
  clearTimeout(_driveSaveTimer);
  _driveSaveTimer = setTimeout(() => driveUpload(true), 8000);
}

// ==========================================================
//  FILE IMPORT / EXPORT
// ==========================================================
function triggerLoadFile() { document.getElementById('jsonFileInput').click(); }

function handleFileLoad(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const loaded = JSON.parse(e.target.result);
      if (!loaded.products)  loaded.products  = JSON.parse(JSON.stringify(DEFAULT_PRODUCTS));
      if (!loaded.customers) loaded.customers = [];
      if (!loaded.orders)    loaded.orders    = [];
      if (!loaded.payments)  loaded.payments  = [];
      DB = loaded; persistDB();
      toast('✅ Data imported from: ' + file.name, 'success');
      showPage(activePage);
    } catch(err) { toast('Error reading file: ' + err.message, 'error'); }
  };
  reader.readAsText(file);
  input.value = '';
}

function saveDataFile() {
  const blob = new Blob([JSON.stringify(DB, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'amulcalc_backup_' + todayStr() + '.json';
  a.click();
  toast('📤 Backup downloaded!', 'success');
}

// ==========================================================
//  KEYBOARD SHORTCUT
// ==========================================================
document.addEventListener('keydown', e => {
  if ((e.ctrlKey||e.metaKey) && e.key==='s') { e.preventDefault(); saveToLocalStorage(); }
});

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', function(e) { if (e.target===this) this.classList.remove('open'); });
});

// Close customer dropdown when clicking outside
document.addEventListener('click', function(e) {
  const wrap = document.getElementById('orderCustomerWrap');
  const dd   = document.getElementById('orderCustomerDropdown');
  if (dd && wrap && !wrap.contains(e.target)) dd.style.display = 'none';
});

// Product modal listeners
document.getElementById('prodRate')?.addEventListener('input', updateProdPreview);
document.getElementById('prodPackQty')?.addEventListener('input', updateProdPreview);
document.getElementById('prodPackType')?.addEventListener('change', updateProdPreview);

// ==========================================================
//  INIT
// ==========================================================
showPage('dashboard');
loadFromLocalStorage();
// Drive auto-reconnect fires from onGapiLoad() → tryAutoReconnectDrive()
