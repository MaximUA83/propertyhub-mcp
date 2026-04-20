import express from 'express';
import crypto from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const PROPERTYHUB_URL = process.env.PROPERTYHUB_URL || 'http://localhost:3000';
const PROPERTYHUB_PUBLIC_URL = process.env.PROPERTYHUB_PUBLIC_URL || PROPERTYHUB_URL;
const PROPERTYHUB_PASSWORD = process.env.PROPERTYHUB_PASSWORD || 'admin';
const OAUTH_PASSWORD = process.env.OAUTH_PASSWORD || PROPERTYHUB_PASSWORD;
const PORT = process.env.PORT || 3100;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

let apiToken = null;

async function login() {
  if (apiToken) return apiToken;
  const r = await fetch(`${PROPERTYHUB_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PROPERTYHUB_PASSWORD }),
  });
  if (!r.ok) throw new Error('PropertyHub login failed');
  const d = await r.json();
  apiToken = d.token;
  return apiToken;
}

async function api(method, path, body) {
  const token = await login();
  const r = await fetch(`${PROPERTYHUB_URL}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) {
    apiToken = null;
    return api(method, path, body);
  }
  if (!r.ok) throw new Error(`API ${method} ${path}: ${r.status}`);
  return r.json();
}

const MO = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
const fm = n => (Number(n)||0).toLocaleString('uk-UA', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' ₴';

const tools = [
  { name: 'list_properties', description: 'Отримати список всіх приміщень з орендарями, статусом, ставками.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_invoices', description: 'Отримати список рахунків. Фільтри: month (0-11), year, status (created/signing/signed/sent/paid), property_id, unpaid_only.', inputSchema: { type: 'object', properties: { month: { type: 'number' }, year: { type: 'number' }, status: { type: 'string' }, property_id: { type: 'number' }, unpaid_only: { type: 'boolean' } } } },
  { name: 'list_payments', description: 'Отримати список всіх отриманих оплат.', inputSchema: { type: 'object', properties: { property_id: { type: 'number' } } } },
  { name: 'list_utilities', description: 'Отримати список записів про комунальні платежі постачальникам.', inputSchema: { type: 'object', properties: { month: { type: 'number' }, year: { type: 'number' }, property_id: { type: 'number' } } } },
  { name: 'add_utility', description: 'Додати комунальний платіж постачальнику. Типи: electricity, water, heating, hcs.', inputSchema: { type: 'object', properties: { property_id: { type: 'number' }, type: { type: 'string' }, month: { type: 'number' }, year: { type: 'number' }, provider_amount: { type: 'number' }, note: { type: 'string' } }, required: ['property_id', 'type', 'month', 'year', 'provider_amount'] } },
  { name: 'add_payment', description: 'Записати отриману оплату від орендаря.', inputSchema: { type: 'object', properties: { property_id: { type: 'number' }, amount: { type: 'number' }, date: { type: 'string' }, note: { type: 'string' } }, required: ['property_id', 'amount'] } },
  { name: 'create_invoice', description: 'Створити рахунок. Режими: full, rent_only, utilities_only.', inputSchema: { type: 'object', properties: { property_id: { type: 'number' }, month: { type: 'number' }, year: { type: 'number' }, mode: { type: 'string' }, exchange_rate_usd: { type: 'number' }, exchange_rate_eur: { type: 'number' } }, required: ['property_id', 'month', 'year'] } },
  { name: 'create_invoices_bulk', description: 'Створити рахунки всім орендарям або обраним.', inputSchema: { type: 'object', properties: { month: { type: 'number' }, year: { type: 'number' }, mode: { type: 'string' }, property_ids: { type: 'array', items: { type: 'number' } }, exchange_rate_usd: { type: 'number' }, exchange_rate_eur: { type: 'number' } }, required: ['month', 'year'] } },
  { name: 'send_invoice_email', description: 'Надіслати рахунок на email орендаря.', inputSchema: { type: 'object', properties: { invoice_id: { type: 'number' } }, required: ['invoice_id'] } },
  { name: 'get_reconciliation', description: 'Акт звірки для приміщення.', inputSchema: { type: 'object', properties: { property_id: { type: 'number' }, start_date: { type: 'string' }, end_date: { type: 'string' } }, required: ['property_id'] } },
  { name: 'get_company', description: 'Отримати реквізити вашої компанії.', inputSchema: { type: 'object', properties: {} } },
  { name: 'update_company', description: 'Оновити реквізити вашої компанії.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, edrpou: { type: 'string' }, iban: { type: 'string' }, address: { type: 'string' }, phone: { type: 'string' } } } },
  { name: 'update_property', description: 'Оновити дані приміщення: назву, адресу, площу, статус, ставку, валюту, курс, коефіцієнт, нумерацію, дані орендаря.', inputSchema: { type: 'object', properties: { property_id: { type: 'number' }, name: { type: 'string' }, address: { type: 'string' }, area: { type: 'number' }, status: { type: 'string' }, rent_amount: { type: 'number' }, currency: { type: 'string' }, exchange_rate: { type: 'number' }, util_coefficient: { type: 'number' }, billing_day: { type: 'number' }, invoice_prefix: { type: 'string' }, invoice_counter: { type: 'number' }, tenant_name: { type: 'string' }, tenant_company: { type: 'string' }, tenant_email: { type: 'string' }, tenant_phone: { type: 'string' }, tenant_edrpou: { type: 'string' } }, required: ['property_id'] } },
  { name: 'delete_invoice', description: 'Видалити рахунок за ID.', inputSchema: { type: 'object', properties: { invoice_id: { type: 'number' } }, required: ['invoice_id'] } },
  { name: 'delete_payment', description: 'Видалити запис про оплату за ID.', inputSchema: { type: 'object', properties: { payment_id: { type: 'number' } }, required: ['payment_id'] } },
  { name: 'delete_utility', description: 'Видалити запис про комунальний платіж за ID.', inputSchema: { type: 'object', properties: { utility_id: { type: 'number' } }, required: ['utility_id'] } },
  { name: 'update_invoice_status', description: 'Оновити статус рахунку: created, signing, signed, sent, paid.', inputSchema: { type: 'object', properties: { invoice_id: { type: 'number' }, status: { type: 'string' } }, required: ['invoice_id', 'status'] } },
  { name: 'get_income_report', description: 'Звіт про отримані доходи (оплати) за період. Параметри: year (обов\'язково), month (0-11 опціонально, якщо не вказано — весь рік), group_by (day/month/property — як групувати). Повертає суми у гривнях з групуванням.', inputSchema: { type: 'object', properties: { year: { type: 'number' }, month: { type: 'number' }, group_by: { type: 'string', description: 'day, month, property (default: month)' } }, required: ['year'] } },
  { name: 'get_lost_revenue', description: 'Розрахунок втрачених доходів від вакантних (не зданих) приміщень. Показує скільки можна було б заробити у UAH/USD/EUR якби всі приміщення здавались. Параметри: months_count (за скільки місяців рахувати, default 1), по кожному приміщенню і загалом. Використовує поточні ставки оренди з приміщень.', inputSchema: { type: 'object', properties: { months_count: { type: 'number', description: 'Кількість місяців для розрахунку (1 = місяць, 12 = рік)' } } } },
  { name: 'get_overdue_invoices', description: 'Список прострочених рахунків (не оплачених) з деталями — хто, скільки днів тому виставлений, яка сума боргу. Для нагадувань орендарям.', inputSchema: { type: 'object', properties: { days_overdue: { type: 'number', description: 'Скільки днів прострочення (default 0 — всі неоплачені)' } } } },
  { name: 'get_financial_summary', description: 'Загальний фінансовий підсумок: нараховано/сплачено/заборговано за період. Параметри: year, month (опціонально). Показує по кожному приміщенню і загалом.', inputSchema: { type: 'object', properties: { year: { type: 'number' }, month: { type: 'number' } }, required: ['year'] } },
  { name: 'get_invoice_details', description: 'Детальна інформація про один рахунок: повні реквізити, список послуг, посилання на PDF. Використовувати коли "покажи рахунок #5 повністю".', inputSchema: { type: 'object', properties: { invoice_id: { type: 'number' } }, required: ['invoice_id'] } },
  { name: 'get_tax_report', description: 'Податковий звіт про доходи для декларації ФОП. Обчислює отримані оплати за період (квартал/місяць/рік) та податки за ставками з налаштувань компанії (за замовчуванням для ФОП 3 групи: 5% єдиний + 1% військовий збір). Включає ручний внесений дохід і сплачені податки. Розбивка по місяцях і приміщеннях. Приклади: "дохід за 1 квартал 2026 для декларації", "податки за лютий", "річний звіт ФОП за 2026".', inputSchema: { type: 'object', properties: { year: { type: 'number', description: 'Рік (наприклад 2026)' }, quarter: { type: 'number', description: '1-4, номер кварталу. Якщо не вказано — береться весь рік або місяць' }, month: { type: 'number', description: '0-11, місяць. Якщо не вказано — береться квартал або весь рік' }, tax_rate: { type: 'number', description: 'Ставка єдиного податку у %, за замовчуванням з налаштувань компанії' }, military_rate: { type: 'number', description: 'Ставка військового збору у %, за замовчуванням з налаштувань компанії' } }, required: ['year'] } },
  { name: 'get_tax_settings', description: 'Отримати поточні податкові налаштування компанії (група ФОП, ставки єдиного податку і військового збору, налаштування ЄСВ).', inputSchema: { type: 'object', properties: {} } },
  { name: 'update_tax_settings', description: 'Оновити податкові налаштування компанії. Усі поля опціональні — вказуйте тільки ті що змінюєте. ЄСВ за замовчуванням вимкнений (сплачується через іншу систему), якщо потрібно включити — передайте tax_esv_enabled=true.', inputSchema: { type: 'object', properties: { tax_fop_group: { type: 'number', description: 'Група ФОП: 1, 2 або 3' }, tax_single_rate: { type: 'number', description: 'Ставка єдиного податку у % (для 3 групи зазвичай 5)' }, tax_military_rate: { type: 'number', description: 'Ставка військового збору у % (зазвичай 1)' }, tax_esv_enabled: { type: 'boolean', description: 'Чи включати ЄСВ у розрахунок' }, tax_esv_monthly: { type: 'number', description: 'Сума ЄСВ на місяць (2026 мінімум: 1902.34 ₴)' } } } },
  { name: 'add_manual_income', description: 'Додати ручне внесення доходу за минулий період (коли програма ще не використовувалась). Приклад: "додай дохід 180000 за Q1 2026" коли Q1 ми відпрацювали без програми. Для періоду передайте АБО quarter (1-4) АБО month (0-11), або нічого для всього року.', inputSchema: { type: 'object', properties: { year: { type: 'number' }, quarter: { type: 'number', description: '1-4 (опціонально)' }, month: { type: 'number', description: '0-11 (опціонально)' }, amount: { type: 'number', description: 'Сума у гривнях' }, note: { type: 'string' } }, required: ['year', 'amount'] } },
  { name: 'add_tax_payment', description: 'Записати факт сплати податку. Типи: single_tax (єдиний), military_tax (військовий), esv, other. Приклад: "запиши що 15 квітня заплатили єдиний за Q1 — 9000 грн, платіжка №123".', inputSchema: { type: 'object', properties: { year: { type: 'number' }, quarter: { type: 'number' }, month: { type: 'number' }, type: { type: 'string', description: 'single_tax, military_tax, esv, other' }, amount: { type: 'number' }, paid_date: { type: 'string', description: 'YYYY-MM-DD' }, note: { type: 'string' } }, required: ['year', 'type', 'amount'] } },
  { name: 'what_if_taxes', description: 'Прогноз податків: скільки платити якщо будуть здані усі вакантні або вибіркові приміщення. Приклад: "які суми податку платити якщо здамо Приміщення 3 і 5 на 6 місяців". Якщо property_ids порожній — береться всі вакантні приміщення.', inputSchema: { type: 'object', properties: { months: { type: 'number', description: 'За скільки місяців рахувати, default 3' }, property_ids: { type: 'array', items: { type: 'number' }, description: 'ID приміщень. Якщо не вказано — всі вакантні' } } } },
  { name: 'compare_tax_periods', description: 'Порівняти два періоди: скільки отримали, нарахували податків, сплатили. Приклад: "порівняй скільки податків заплатили за Q2 з Q1", "травень vs квітень", "2026 vs 2025". Період А — це той про який порівнюємо (останній/поточний), B — з чим порівнюємо.', inputSchema: { type: 'object', properties: { year1: { type: 'number', description: 'Рік періоду A' }, q1: { type: 'number', description: 'Квартал A 1-4 (опціонально)' }, m1: { type: 'number', description: 'Місяць A 0-11 (опціонально)' }, year2: { type: 'number', description: 'Рік періоду B' }, q2: { type: 'number', description: 'Квартал B 1-4 (опціонально)' }, m2: { type: 'number', description: 'Місяць B 0-11 (опціонально)' } }, required: ['year1', 'year2'] } },
];

async function handleTool(name, args) {
  switch (name) {
    case 'list_properties': {
      const props = await api('GET', '/properties');
      return props.map(p => ({ id: p.id, name: p.name, address: p.address, status: p.status === 'rented' ? 'Здається' : 'Вакантне', currency: p.currency, rent_amount: p.rent_amount, exchange_rate: p.exchange_rate, util_coefficient: p.util_coefficient, tenant: p.tenant || null }));
    }
    case 'list_invoices': {
      let invs = await api('GET', '/invoices');
      if (args.month !== undefined) invs = invs.filter(i => i.month === args.month);
      if (args.year !== undefined) invs = invs.filter(i => i.year === args.year);
      if (args.status) invs = invs.filter(i => i.status === args.status);
      if (args.property_id) invs = invs.filter(i => i.property_id === args.property_id);
      if (args.unpaid_only) invs = invs.filter(i => i.status !== 'paid');
      return invs.map(i => ({ id: i.id, number: i.number, property: i.property_name, tenant: i.tenant_company || i.tenant_name, period: `${MO[i.month]} ${i.year}`, rent: Number(i.rent_uah), utilities: Number(i.util_total), total: Number(i.total), status: i.status, mode: i.mode, email: i.tenant_email }));
    }
    case 'list_payments': {
      let pays = await api('GET', '/payments');
      if (args.property_id) pays = pays.filter(p => p.property_id === args.property_id);
      return pays.map(p => ({ id: p.id, property_id: p.property_id, amount: Number(p.amount), date: p.date, note: p.note }));
    }
    case 'list_utilities': {
      let utils = await api('GET', '/utilities');
      if (args.month !== undefined) utils = utils.filter(u => u.month === args.month);
      if (args.year !== undefined) utils = utils.filter(u => u.year === args.year);
      if (args.property_id) utils = utils.filter(u => u.property_id === args.property_id);
      return utils.map(u => ({ id: u.id, property_id: u.property_id, type: u.type, period: `${MO[u.month]} ${u.year}`, provider_amount: Number(u.provider_amount) }));
    }
    case 'add_utility': {
      const r = await api('POST', '/utilities', { property_id: args.property_id, type: args.type, month: args.month, year: args.year, provider_amount: args.provider_amount, reading: 0, note: args.note || '' });
      return { success: true, id: r.id, message: `Додано ${args.type}: ${fm(args.provider_amount)} за ${MO[args.month]} ${args.year}` };
    }
    case 'add_payment': {
      const r = await api('POST', '/payments', { property_id: args.property_id, amount: args.amount, date: args.date || new Date().toISOString().slice(0,10), note: args.note || '' });
      return { success: true, id: r.id, message: `Зараховано оплату: ${fm(args.amount)}` };
    }
    case 'create_invoice': {
      const props = await api('GET', '/properties');
      const prop = props.find(p => p.id === args.property_id);
      if (!prop) throw new Error('Property not found');
      const utils = await api('GET', '/utilities');
      const mu = utils.filter(u => u.property_id === prop.id && u.month === args.month && u.year === args.year);
      const coeff = Number(prop.util_coefficient) || 1;
      const mode = args.mode || 'full';
      const rates = { USD: args.exchange_rate_usd, EUR: args.exchange_rate_eur };
      const rate = rates[prop.currency] || Number(prop.exchange_rate) || 1;
      const rentUAH = mode === 'utilities_only' ? 0 : (prop.currency === 'UAH' ? Number(prop.rent_amount) : Number(prop.rent_amount) * rate);
      const utilItems = mode === 'rent_only' ? [] : mu.map(u => ({ type: u.type, provider_amount: Number(u.provider_amount), coefficient: coeff, client_amount: Number(u.provider_amount) * coeff }));
      const utilTotal = utilItems.reduce((s, u) => s + u.client_amount, 0);
      const numR = await api('GET', `/invoices/next-number/${prop.id}`);
      const r = await api('POST', '/invoices', {
        number: numR.number, property_id: prop.id, property_name: prop.name,
        tenant_name: prop.tenant?.name || '', tenant_company: prop.tenant?.company || '', tenant_email: prop.tenant?.email || '',
        month: args.month, year: args.year, currency: prop.currency,
        rent_base: mode === 'utilities_only' ? 0 : Number(prop.rent_amount),
        exchange_rate: prop.currency !== 'UAH' ? rate : 1,
        rent_uah: rentUAH,
        rent_note: prop.currency !== 'UAH' && mode !== 'utilities_only' ? `${prop.rent_amount} ${prop.currency} × ${rate}` : '',
        utilities: utilItems, util_total: utilTotal, total: rentUAH + utilTotal, mode,
      });
      return { success: true, invoice_id: r.id, number: r.number, total: fm(r.total), message: `Створено рахунок ${r.number} на ${fm(r.total)}` };
    }
    case 'create_invoices_bulk': {
      const props = await api('GET', '/properties');
      const rented = props.filter(p => p.status === 'rented');
      const targets = args.property_ids?.length ? rented.filter(p => args.property_ids.includes(p.id)) : rented;
      const results = [];
      for (const prop of targets) {
        try {
          const r = await handleTool('create_invoice', { property_id: prop.id, month: args.month, year: args.year, mode: args.mode, exchange_rate_usd: args.exchange_rate_usd, exchange_rate_eur: args.exchange_rate_eur });
          results.push({ property: prop.name, ...r });
        } catch (e) {
          results.push({ property: prop.name, error: e.message });
        }
      }
      return { count: results.filter(r => r.success).length, results };
    }
    case 'send_invoice_email': {
      const r = await api('POST', `/invoices/${args.invoice_id}/send-email`);
      return { success: r.ok, sent_to: r.sentTo, public_url: r.publicUrl, message: r.ok ? `Надіслано на ${r.sentTo}` : 'Помилка' };
    }
    case 'get_reconciliation': {
      const params = [];
      if (args.start_date) params.push(`startDate=${args.start_date}`);
      if (args.end_date) params.push(`endDate=${args.end_date}`);
      const r = await api('GET', `/reconciliation/${args.property_id}${params.length ? '?' + params.join('&') : ''}`);
      return { property: r.property?.name, tenant: r.tenant?.company || r.tenant?.name, total_invoiced: fm(r.summary.totalInvoiced), total_paid: fm(r.summary.totalPaid), balance: fm(r.summary.balance), balance_note: r.summary.balance > 0 ? 'Переплата' : r.summary.balance < 0 ? 'Заборгованість' : 'Закрито' };
    }
    case 'get_company': return await api('GET', '/company');
    case 'update_company': {
      const cur = await api('GET', '/company');
      const payload = {
        name: args.name !== undefined ? args.name : cur.name,
        edrpou: args.edrpou !== undefined ? args.edrpou : cur.edrpou,
        iban: args.iban !== undefined ? args.iban : cur.iban,
        address: args.address !== undefined ? args.address : cur.address,
        phone: args.phone !== undefined ? args.phone : cur.phone,
      };
      await api('PUT', '/company', payload);
      return { success: true, message: `Оновлено реквізити: ${payload.name}` };
    }
    case 'update_property': {
      const props = await api('GET', '/properties');
      const prop = props.find(p => p.id === args.property_id);
      if (!prop) throw new Error('Property not found');
      const payload = { ...prop, tenant: prop.tenant ? { ...prop.tenant } : { name:'', company:'', email:'', phone:'', edrpou:'' } };
      if (args.name !== undefined) payload.name = args.name;
      if (args.address !== undefined) payload.address = args.address;
      if (args.area !== undefined) payload.area = args.area;
      if (args.status) payload.status = args.status;
      if (args.rent_amount !== undefined) payload.rent_amount = args.rent_amount;
      if (args.currency) payload.currency = args.currency;
      if (args.exchange_rate !== undefined) payload.exchange_rate = args.exchange_rate;
      if (args.util_coefficient !== undefined) payload.util_coefficient = args.util_coefficient;
      if (args.billing_day !== undefined) payload.billing_day = args.billing_day;
      if (args.invoice_prefix !== undefined) payload.invoice_prefix = args.invoice_prefix;
      if (args.invoice_counter !== undefined) payload.invoice_counter = args.invoice_counter;
      if (args.tenant_name !== undefined) payload.tenant.name = args.tenant_name;
      if (args.tenant_company !== undefined) payload.tenant.company = args.tenant_company;
      if (args.tenant_email !== undefined) payload.tenant.email = args.tenant_email;
      if (args.tenant_phone !== undefined) payload.tenant.phone = args.tenant_phone;
      if (args.tenant_edrpou !== undefined) payload.tenant.edrpou = args.tenant_edrpou;
      await api('PUT', `/properties/${args.property_id}`, payload);
      return { success: true, message: `Оновлено ${payload.name}` };
    }
    case 'delete_invoice': { await api('DELETE', `/invoices/${args.invoice_id}`); return { success: true, message: `Рахунок #${args.invoice_id} видалено` }; }
    case 'delete_payment': { await api('DELETE', `/payments/${args.payment_id}`); return { success: true, message: `Оплату #${args.payment_id} видалено` }; }
    case 'delete_utility': { await api('DELETE', `/utilities/${args.utility_id}`); return { success: true, message: `Комунальний запис #${args.utility_id} видалено` }; }
    case 'update_invoice_status': { await api('PATCH', `/invoices/${args.invoice_id}/status`, { status: args.status }); return { success: true, message: `Рахунок #${args.invoice_id}: статус → ${args.status}` }; }
    
    case 'get_income_report': {
      const pays = await api('GET', '/payments');
      const props = await api('GET', '/properties');
      const year = args.year;
      const month = args.month;
      const groupBy = args.group_by || 'month';
      
      // Filter payments by date
      let filtered = pays.filter(p => {
        const d = new Date(p.date);
        if (d.getFullYear() !== year) return false;
        if (month !== undefined && d.getMonth() !== month) return false;
        return true;
      });
      
      const total = filtered.reduce((s, p) => s + Number(p.amount), 0);
      
      let groups = {};
      if (groupBy === 'month') {
        for (const p of filtered) {
          const d = new Date(p.date);
          const key = `${MO[d.getMonth()]} ${d.getFullYear()}`;
          groups[key] = (groups[key] || 0) + Number(p.amount);
        }
      } else if (groupBy === 'day') {
        for (const p of filtered) {
          const key = typeof p.date === 'string' ? p.date.slice(0, 10) : new Date(p.date).toISOString().slice(0, 10);
          groups[key] = (groups[key] || 0) + Number(p.amount);
        }
      } else if (groupBy === 'property') {
        for (const p of filtered) {
          const prop = props.find(x => x.id === p.property_id);
          const key = prop?.name || 'Невідоме';
          groups[key] = (groups[key] || 0) + Number(p.amount);
        }
      }
      
      const breakdown = Object.entries(groups).map(([k, v]) => ({ key: k, amount: fm(v) }));
      
      return {
        period: month !== undefined ? `${MO[month]} ${year}` : `весь ${year} рік`,
        group_by: groupBy,
        total: fm(total),
        payments_count: filtered.length,
        breakdown,
      };
    }
    
    case 'get_lost_revenue': {
      const props = await api('GET', '/properties');
      const vacant = props.filter(p => p.status === 'vacant');
      const monthsCount = Number(args.months_count) || 1;
      
      // Use default rates if not set on properties; fallback to NBU-ish
      const defaultRates = { USD: 42, EUR: 45, UAH: 1 };
      
      let totalUAH = 0, totalUSD = 0, totalEUR = 0;
      const perProperty = [];
      
      for (const p of vacant) {
        const amt = Number(p.rent_amount) || 0;
        const rate = Number(p.exchange_rate) || defaultRates[p.currency] || 1;
        const currency = p.currency || 'UAH';
        
        let uahPerMonth = 0, usdPerMonth = 0, eurPerMonth = 0;
        if (currency === 'UAH') {
          uahPerMonth = amt;
          usdPerMonth = amt / defaultRates.USD;
          eurPerMonth = amt / defaultRates.EUR;
        } else if (currency === 'USD') {
          usdPerMonth = amt;
          uahPerMonth = amt * rate;
          eurPerMonth = (amt * rate) / defaultRates.EUR;
        } else if (currency === 'EUR') {
          eurPerMonth = amt;
          uahPerMonth = amt * rate;
          usdPerMonth = (amt * rate) / defaultRates.USD;
        }
        
        const uahTotal = uahPerMonth * monthsCount;
        const usdTotal = usdPerMonth * monthsCount;
        const eurTotal = eurPerMonth * monthsCount;
        
        totalUAH += uahTotal;
        totalUSD += usdTotal;
        totalEUR += eurTotal;
        
        perProperty.push({
          property: p.name,
          rent_per_month: `${amt} ${currency}`,
          loss_per_month: amt > 0 ? {
            UAH: uahPerMonth.toLocaleString('uk-UA', {maximumFractionDigits: 0}) + ' ₴',
            USD: usdPerMonth.toFixed(2) + ' $',
            EUR: eurPerMonth.toFixed(2) + ' €',
          } : null,
          loss_for_period: amt > 0 ? {
            UAH: uahTotal.toLocaleString('uk-UA', {maximumFractionDigits: 0}) + ' ₴',
            USD: usdTotal.toFixed(2) + ' $',
            EUR: eurTotal.toFixed(2) + ' €',
          } : 'не встановлено ставку',
        });
      }
      
      return {
        vacant_count: vacant.length,
        total_properties: props.length,
        period_months: monthsCount,
        total_loss: {
          UAH: totalUAH.toLocaleString('uk-UA', {maximumFractionDigits: 0}) + ' ₴',
          USD: totalUSD.toFixed(2) + ' $',
          EUR: totalEUR.toFixed(2) + ' €',
        },
        rates_used: `USD=${defaultRates.USD}₴, EUR=${defaultRates.EUR}₴ (встановлені в приміщеннях або за замовчуванням)`,
        per_property: perProperty,
      };
    }
    
    case 'get_overdue_invoices': {
      const invs = await api('GET', '/invoices');
      const props = await api('GET', '/properties');
      const pays = await api('GET', '/payments');
      const daysOverdue = Number(args.days_overdue) || 0;
      
      const unpaid = invs.filter(i => i.status !== 'paid');
      const now = Date.now();
      
      const result = unpaid.map(i => {
        const created = new Date(i.created_at).getTime();
        const daysOld = Math.floor((now - created) / (1000 * 60 * 60 * 24));
        const prop = props.find(p => p.id === i.property_id);
        
        // Calculate partial payments (if any)
        const invPays = pays.filter(p => p.property_id === i.property_id && new Date(p.date).getTime() >= created);
        const paidForThisInvoice = 0; // simplified — we don't link payments to invoices
        
        return {
          id: i.id,
          number: i.number,
          property: i.property_name,
          tenant: i.tenant_company || i.tenant_name,
          tenant_email: i.tenant_email,
          tenant_phone: prop?.tenant?.phone,
          period: `${MO[i.month]} ${i.year}`,
          total: fm(i.total),
          status: i.status,
          days_old: daysOld,
          created_at: typeof i.created_at === 'string' ? i.created_at.slice(0, 10) : new Date(i.created_at).toISOString().slice(0, 10),
          email_sent: i.email_sent_to ? `так → ${i.email_sent_to}` : 'ні',
        };
      }).filter(r => r.days_old >= daysOverdue);
      
      result.sort((a, b) => b.days_old - a.days_old);
      
      const totalDebt = result.reduce((s, r) => s + parseFloat(r.total.replace(/[^\d,.-]/g, '').replace(',', '.')), 0);
      
      return {
        count: result.length,
        total_debt: fm(totalDebt),
        filter_days_overdue: daysOverdue,
        invoices: result,
      };
    }
    
    case 'get_financial_summary': {
      const invs = await api('GET', '/invoices');
      const pays = await api('GET', '/payments');
      const props = await api('GET', '/properties');
      const year = args.year;
      const month = args.month;
      
      const filteredInvs = invs.filter(i => {
        if (i.year !== year) return false;
        if (month !== undefined && i.month !== month) return false;
        return true;
      });
      
      const filteredPays = pays.filter(p => {
        const d = new Date(p.date);
        if (d.getFullYear() !== year) return false;
        if (month !== undefined && d.getMonth() !== month) return false;
        return true;
      });
      
      const totalInvoiced = filteredInvs.reduce((s, i) => s + Number(i.total), 0);
      const totalPaid = filteredPays.reduce((s, p) => s + Number(p.amount), 0);
      
      const byProperty = {};
      for (const prop of props) {
        const pInvs = filteredInvs.filter(i => i.property_id === prop.id);
        const pPays = filteredPays.filter(p => p.property_id === prop.id);
        const inv = pInvs.reduce((s, i) => s + Number(i.total), 0);
        const paid = pPays.reduce((s, p) => s + Number(p.amount), 0);
        if (inv > 0 || paid > 0) {
          byProperty[prop.name] = {
            invoiced: fm(inv),
            paid: fm(paid),
            balance: fm(paid - inv),
          };
        }
      }
      
      return {
        period: month !== undefined ? `${MO[month]} ${year}` : `весь ${year} рік`,
        total_invoiced: fm(totalInvoiced),
        total_paid: fm(totalPaid),
        balance: fm(totalPaid - totalInvoiced),
        by_property: byProperty,
      };
    }
    
    case 'get_invoice_details': {
      const invs = await api('GET', '/invoices');
      const inv = invs.find(i => i.id === args.invoice_id);
      if (!inv) throw new Error('Invoice not found');
      const props = await api('GET', '/properties');
      const prop = props.find(p => p.id === inv.property_id);
      const company = await api('GET', '/company');
      
      const publicUrl = inv.public_token ? `${PROPERTYHUB_PUBLIC_URL}/invoice/${inv.public_token}` : null;
      
      return {
        id: inv.id,
        number: inv.number,
        status: inv.status,
        property: inv.property_name,
        property_address: prop?.address,
        tenant: {
          name: inv.tenant_name,
          company: inv.tenant_company,
          email: inv.tenant_email,
          phone: prop?.tenant?.phone,
          edrpou: prop?.tenant?.edrpou,
        },
        period: `${MO[inv.month]} ${inv.year}`,
        mode: inv.mode,
        rent: fm(inv.rent_uah),
        rent_note: inv.rent_note,
        utilities_total: fm(inv.util_total),
        utilities_breakdown: inv.utilities?.map(u => ({ type: u.type, amount: fm(u.client_amount) })),
        total: fm(inv.total),
        created_at: inv.created_at,
        email_sent_to: inv.email_sent_to,
        email_sent_at: inv.email_sent_at,
        public_url: publicUrl,
        pdf_instruction: publicUrl ? `Для PDF: відкрийте ${publicUrl} і натисніть "Друк / Зберегти PDF"` : 'PDF недоступний (немає токена)',
      };
    }
    
    case 'get_tax_report': {
      const params = new URLSearchParams();
      params.set('year', args.year);
      if (args.quarter) params.set('quarter', args.quarter);
      if (args.month !== undefined) params.set('month', args.month);
      if (args.tax_rate) params.set('tax_rate', args.tax_rate);
      if (args.military_rate) params.set('military_rate', args.military_rate);
      const r = await api('GET', '/tax-report?' + params.toString());
      return {
        period: r.period,
        date_range: `${r.date_range.start} — ${r.date_range.end}`,
        total_income: fm(r.total_income),
        actual_income: fm(r.actual_income),
        manual_income: r.manual_income > 0 ? fm(r.manual_income) : null,
        total_invoiced: fm(r.total_invoiced),
        unpaid_balance: fm(r.unpaid_balance),
        payments_count: r.payments_count,
        tax_calculation: {
          single_tax: `${fm(r.tax.single_tax)} (${r.tax.rate_percent}%)`,
          military_tax: `${fm(r.tax.military_tax)} (${r.tax.military_tax_percent}%)`,
          esv: r.tax.esv_enabled ? `${fm(r.tax.esv_total)} (${r.months_in_period} міс × ${r.tax.esv_monthly})` : 'не включено (сплачується окремо)',
          total_to_pay: fm(r.tax.total_to_pay),
        },
        paid_taxes: r.paid_taxes.total > 0 ? {
          total: fm(r.paid_taxes.total),
          remaining: fm(r.paid_taxes.remaining),
          by_type: Object.fromEntries(Object.entries(r.paid_taxes.by_type).map(([k, v]) => [k, fm(v)])),
        } : null,
        by_month: r.by_month.map(m => ({ period: m.period, amount: fm(m.amount), count: m.count, source: m.source })),
        by_property: r.by_property.map(p => ({ property: p.property, amount: fm(p.amount), count: p.count })),
        note: 'Для подання декларації: скопіюйте total_income у Taxer/Вчасно/Дію або експортуйте CSV у вкладці Податкова в PropertyHub.',
      };
    }
    
    case 'get_tax_settings': {
      const company = await api('GET', '/company');
      return {
        fop_group: company.tax_fop_group ?? 3,
        single_tax_rate: `${company.tax_single_rate ?? 5}%`,
        military_tax_rate: `${company.tax_military_rate ?? 1}%`,
        esv_enabled: !!company.tax_esv_enabled,
        esv_monthly: company.tax_esv_enabled ? fm(company.tax_esv_monthly ?? 1902.34) : 'не включено (сплачується окремо)',
      };
    }
    
    case 'update_tax_settings': {
      const cur = await api('GET', '/company');
      const payload = {
        name: cur.name, edrpou: cur.edrpou, iban: cur.iban, address: cur.address, phone: cur.phone,
        tax_fop_group: args.tax_fop_group !== undefined ? args.tax_fop_group : cur.tax_fop_group,
        tax_single_rate: args.tax_single_rate !== undefined ? args.tax_single_rate : cur.tax_single_rate,
        tax_military_rate: args.tax_military_rate !== undefined ? args.tax_military_rate : cur.tax_military_rate,
        tax_esv_enabled: args.tax_esv_enabled !== undefined ? args.tax_esv_enabled : cur.tax_esv_enabled,
        tax_esv_monthly: args.tax_esv_monthly !== undefined ? args.tax_esv_monthly : cur.tax_esv_monthly,
      };
      await api('PUT', '/company', payload);
      return {
        success: true,
        message: 'Податкові налаштування оновлено',
        new_settings: {
          fop_group: payload.tax_fop_group,
          single_tax_rate: `${payload.tax_single_rate}%`,
          military_tax_rate: `${payload.tax_military_rate}%`,
          esv_enabled: payload.tax_esv_enabled,
          esv_monthly: payload.tax_esv_monthly,
        },
      };
    }
    
    case 'add_manual_income': {
      const r = await api('POST', '/tax-report/manual-income', {
        year: args.year,
        quarter: args.quarter || null,
        month: args.month !== undefined ? args.month : null,
        amount: args.amount,
        note: args.note || '',
      });
      const periodStr = args.quarter ? `Q${args.quarter} ${args.year}` : args.month !== undefined ? `${MO[args.month]} ${args.year}` : `${args.year} рік`;
      return {
        success: true,
        id: r.id,
        message: `Додано ручний дохід ${fm(args.amount)} за ${periodStr}`,
      };
    }
    
    case 'add_tax_payment': {
      const r = await api('POST', '/tax-report/paid-taxes', {
        year: args.year,
        quarter: args.quarter || null,
        month: args.month !== undefined ? args.month : null,
        type: args.type,
        amount: args.amount,
        paid_date: args.paid_date || new Date().toISOString().slice(0, 10),
        note: args.note || '',
      });
      const typeLabels = { single_tax: 'Єдиний податок', military_tax: 'Військовий збір', esv: 'ЄСВ', other: 'Інше' };
      const periodStr = args.quarter ? `Q${args.quarter} ${args.year}` : args.month !== undefined ? `${MO[args.month]} ${args.year}` : `${args.year} рік`;
      return {
        success: true,
        id: r.id,
        message: `Записано сплату: ${typeLabels[args.type] || args.type} ${fm(args.amount)} за ${periodStr}`,
      };
    }
    
    case 'what_if_taxes': {
      const params = new URLSearchParams();
      params.set('months', args.months || 3);
      if (args.property_ids && args.property_ids.length > 0) {
        params.set('property_ids', args.property_ids.join(','));
      }
      const r = await api('GET', '/tax-report/what-if?' + params.toString());
      return {
        scenario: r.scenario,
        period_months: r.months,
        monthly_income_uah: fm(r.total_monthly_income_uah),
        total_period_income: fm(r.total_period_income_uah),
        tax_breakdown: {
          single_tax: `${fm(r.tax.single_tax)} (${r.settings.single_rate}%)`,
          military_tax: `${fm(r.tax.military_tax)} (${r.settings.military_rate}%)`,
          esv: r.settings.esv_enabled ? `${fm(r.tax.esv_total)} (${r.months} міс)` : 'не включено',
          total_tax: fm(r.tax.total),
        },
        net_income_after_tax: fm(r.net_income_after_tax),
        per_property: r.per_property.map(p => ({
          name: p.name,
          status: p.status === 'vacant' ? 'вакантне' : 'здане',
          rent: `${p.rent_amount} ${p.currency}${p.currency !== 'UAH' ? ` × ${p.exchange_rate}` : ''}`,
          monthly_uah: fm(p.monthly_uah),
          period_total: fm(p.period_uah),
        })),
        note: 'Прогноз виконано за поточними ставками з приміщень (rent_amount і exchange_rate). Для коректних USD/EUR — переконайтесь що курси оновлені.',
      };
    }
    
    case 'compare_tax_periods': {
      const params = new URLSearchParams();
      params.set('year1', args.year1);
      params.set('year2', args.year2);
      if (args.q1) params.set('q1', args.q1);
      if (args.m1 !== undefined) params.set('m1', args.m1);
      if (args.q2) params.set('q2', args.q2);
      if (args.m2 !== undefined) params.set('m2', args.m2);
      const r = await api('GET', '/tax-report/compare?' + params.toString());
      const pct = r.diff.income_percent;
      const trend = r.diff.income > 0 ? '📈 зростання' : r.diff.income < 0 ? '📉 спад' : '➖ без змін';
      return {
        period_a: {
          label: r.a.label,
          income: fm(r.a.total_income),
          ...(r.a.manual_income > 0 ? { manual_income_included: fm(r.a.manual_income) } : {}),
          single_tax: fm(r.a.single_tax),
          military_tax: fm(r.a.military_tax),
          total_tax_calculated: fm(r.a.total_tax_calculated),
          total_tax_paid: fm(r.a.total_tax_paid),
        },
        period_b: {
          label: r.b.label,
          income: fm(r.b.total_income),
          ...(r.b.manual_income > 0 ? { manual_income_included: fm(r.b.manual_income) } : {}),
          single_tax: fm(r.b.single_tax),
          military_tax: fm(r.b.military_tax),
          total_tax_calculated: fm(r.b.total_tax_calculated),
          total_tax_paid: fm(r.b.total_tax_paid),
        },
        difference: {
          trend,
          income: `${r.diff.income >= 0 ? '+' : ''}${fm(r.diff.income)}${pct !== null ? ` (${pct >= 0 ? '+' : ''}${pct}%)` : ''}`,
          tax_calculated: `${r.diff.total_tax_calculated >= 0 ? '+' : ''}${fm(r.diff.total_tax_calculated)}`,
          tax_paid: `${r.diff.total_tax_paid >= 0 ? '+' : ''}${fm(r.diff.total_tax_paid)}`,
        },
      };
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ═══ OAuth 2.1 + DCR (in-memory storage) ═══
const clients = new Map(); // client_id -> { redirect_uris, client_name }
const authCodes = new Map(); // code -> { client_id, code_challenge, redirect_uri, expires }
const tokens = new Map(); // access_token -> { client_id, expires }
const CODE_TTL = 600_000; // 10 min
const TOKEN_TTL = 30 * 24 * 3600_000; // 30 days

function genId() { return crypto.randomBytes(16).toString('hex'); }
function genToken() { return crypto.randomBytes(32).toString('hex'); }

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of authCodes) if (v.expires < now) authCodes.delete(k);
  for (const [k, v] of tokens) if (v.expires < now) tokens.delete(k);
}, 60_000);

// ═══ Express ═══
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => res.json({ status: 'ok', propertyhub: PROPERTYHUB_URL }));

// ── OAuth Discovery (RFC 8414, RFC 9728) ──
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  res.json({
    resource: PUBLIC_URL,
    authorization_servers: [PUBLIC_URL],
    bearer_methods_supported: ['header'],
  });
});
app.get('/.well-known/oauth-protected-resource/mcp', (req, res) => {
  res.json({
    resource: `${PUBLIC_URL}/mcp`,
    authorization_servers: [PUBLIC_URL],
    bearer_methods_supported: ['header'],
  });
});

app.get('/.well-known/oauth-authorization-server', (req, res) => {
  res.json({
    issuer: PUBLIC_URL,
    authorization_endpoint: `${PUBLIC_URL}/oauth/authorize`,
    token_endpoint: `${PUBLIC_URL}/oauth/token`,
    registration_endpoint: `${PUBLIC_URL}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  });
});

// ── Dynamic Client Registration (RFC 7591) ──
app.post('/oauth/register', (req, res) => {
  const { redirect_uris, client_name } = req.body || {};
  if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return res.status(400).json({ error: 'invalid_redirect_uri' });
  }
  const client_id = genId();
  clients.set(client_id, { redirect_uris, client_name: client_name || 'MCP Client', created: Date.now() });
  res.json({
    client_id,
    redirect_uris,
    client_name: client_name || 'MCP Client',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });
});

// ── Authorization endpoint (shows login page) ──
app.get('/oauth/authorize', (req, res) => {
  const { client_id, redirect_uri, code_challenge, code_challenge_method, state, response_type, scope } = req.query;
  
  if (response_type !== 'code') return res.status(400).send('Unsupported response_type');
  if (!client_id || !clients.has(client_id)) return res.status(400).send('Invalid client_id');
  const client = clients.get(client_id);
  if (!redirect_uri || !client.redirect_uris.includes(redirect_uri)) return res.status(400).send('Invalid redirect_uri');
  if (!code_challenge || code_challenge_method !== 'S256') return res.status(400).send('PKCE required (S256)');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Вхід в PropertyHub MCP</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Satoshi', sans-serif; background: #f4f6f9; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .card { background: #fff; border-radius: 14px; padding: 36px 28px; max-width: 400px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,.06); border: 1px solid #dfe2e8; }
  h1 { font-size: 18px; margin-bottom: 4px; color: #1a1d26; text-align: center; }
  .sub { color: #8b90a0; font-size: 13px; text-align: center; margin-bottom: 18px; }
  .client { background: #f0f2f5; border-radius: 8px; padding: 12px; font-size: 12px; color: #5f6578; margin-bottom: 20px; text-align: center; }
  .client b { color: #1a1d26; }
  label { display: block; font-size: 11px; color: #8b90a0; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; margin-bottom: 6px; }
  input { width: 100%; padding: 11px 13px; border: 1.5px solid #dfe2e8; border-radius: 8px; font-size: 14px; background: #f0f2f5; outline: none; font-family: inherit; }
  button { width: 100%; padding: 12px; background: #a4d233; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 700; margin-top: 14px; cursor: pointer; font-family: inherit; }
  button:hover { background: #95c125; }
  .err { color: #dc3545; font-size: 12px; margin-top: 10px; text-align: center; }
</style>
</head>
<body>
<div class="card">
  <h1>🏢 PropertyHub</h1>
  <div class="sub">Авторизація через MCP</div>
  <div class="client">Додаток <b>${escapeHtml(client.client_name)}</b> запитує доступ до вашого PropertyHub</div>
  <form method="POST" action="/oauth/authorize">
    <input type="hidden" name="client_id" value="${escapeHtml(client_id)}">
    <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri)}">
    <input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge)}">
    <input type="hidden" name="state" value="${escapeHtml(state || '')}">
    <input type="hidden" name="scope" value="${escapeHtml(scope || '')}">
    <label>Пароль PropertyHub</label>
    <input type="password" name="password" autofocus required placeholder="••••••••">
    <button type="submit">Дозволити доступ</button>
    ${req.query.error ? '<div class="err">⚠️ Невірний пароль</div>' : ''}
  </form>
</div>
</body>
</html>`);
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

app.post('/oauth/authorize', (req, res) => {
  const { client_id, redirect_uri, code_challenge, state, password, scope } = req.body;
  
  if (!clients.has(client_id)) return res.status(400).send('Invalid client');
  if (password !== OAUTH_PASSWORD) {
    const q = new URLSearchParams({ client_id, redirect_uri, code_challenge, code_challenge_method: 'S256', response_type: 'code', state: state || '', scope: scope || '', error: '1' });
    return res.redirect('/oauth/authorize?' + q.toString());
  }

  const code = genToken();
  authCodes.set(code, { client_id, code_challenge, redirect_uri, expires: Date.now() + CODE_TTL });
  
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);
  res.redirect(redirectUrl.toString());
});

// ── Token endpoint ──
app.post('/oauth/token', (req, res) => {
  const { grant_type, code, code_verifier, client_id, redirect_uri, refresh_token } = req.body;

  if (grant_type === 'authorization_code') {
    const record = authCodes.get(code);
    if (!record) return res.status(400).json({ error: 'invalid_grant' });
    authCodes.delete(code);
    if (record.client_id !== client_id) return res.status(400).json({ error: 'invalid_grant' });
    if (record.redirect_uri !== redirect_uri) return res.status(400).json({ error: 'invalid_grant' });
    if (record.expires < Date.now()) return res.status(400).json({ error: 'expired' });
    
    // Verify PKCE
    if (!code_verifier) return res.status(400).json({ error: 'invalid_request' });
    const hash = crypto.createHash('sha256').update(code_verifier).digest('base64url');
    if (hash !== record.code_challenge) return res.status(400).json({ error: 'invalid_grant' });
    
    const access_token = genToken();
    const refresh_tok = genToken();
    tokens.set(access_token, { client_id, expires: Date.now() + TOKEN_TTL, refresh: refresh_tok });
    tokens.set('refresh:' + refresh_tok, { client_id, expires: Date.now() + TOKEN_TTL * 2 });
    
    res.json({
      access_token,
      token_type: 'Bearer',
      expires_in: Math.floor(TOKEN_TTL / 1000),
      refresh_token: refresh_tok,
      scope: 'mcp',
    });
  } else if (grant_type === 'refresh_token') {
    const record = tokens.get('refresh:' + refresh_token);
    if (!record) return res.status(400).json({ error: 'invalid_grant' });
    if (record.client_id !== client_id) return res.status(400).json({ error: 'invalid_grant' });
    if (record.expires < Date.now()) { tokens.delete('refresh:' + refresh_token); return res.status(400).json({ error: 'expired' }); }
    
    const access_token = genToken();
    tokens.set(access_token, { client_id, expires: Date.now() + TOKEN_TTL });
    res.json({
      access_token,
      token_type: 'Bearer',
      expires_in: Math.floor(TOKEN_TTL / 1000),
      scope: 'mcp',
    });
  } else {
    res.status(400).json({ error: 'unsupported_grant_type' });
  }
});

// ── MCP endpoint (protected) ──
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.setHeader('WWW-Authenticate', `Bearer realm="${PUBLIC_URL}", resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource"`);
    return res.status(401).json({ error: 'unauthorized' });
  }
  const token = auth.slice(7);
  const record = tokens.get(token);
  if (!record || record.expires < Date.now()) {
    res.setHeader('WWW-Authenticate', `Bearer realm="${PUBLIC_URL}", error="invalid_token"`);
    return res.status(401).json({ error: 'invalid_token' });
  }
  next();
}

app.post('/mcp', requireAuth, async (req, res) => {
  try {
    const server = new Server(
      { name: 'propertyhub-mcp', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    server.setRequestHandler(CallToolRequestSchema, async (r) => {
      try {
        const result = await handleTool(r.params.name, r.params.arguments || {});
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Помилка: ${err.message}` }], isError: true };
      }
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP request error:', err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  }
});

app.get('/mcp', (req, res) => {
  res.setHeader('WWW-Authenticate', `Bearer realm="${PUBLIC_URL}", resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource"`);
  res.status(401).json({ error: 'unauthorized' });
});
app.delete('/mcp', (req, res) => res.status(405).json({ error: 'method_not_allowed' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PropertyHub MCP server (OAuth) running on port ${PORT}`);
  console.log(`Public URL: ${PUBLIC_URL}`);
  console.log(`Connected to: ${PROPERTYHUB_URL}`);
});
