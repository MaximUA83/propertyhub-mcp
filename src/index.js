import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const PROPERTYHUB_URL = process.env.PROPERTYHUB_URL || 'http://localhost:3000';
const PROPERTYHUB_PASSWORD = process.env.PROPERTYHUB_PASSWORD || 'admin';
const MCP_SECRET = process.env.MCP_SECRET || 'change-me';
const PORT = process.env.PORT || 3100;

let apiToken = null;

// Login to PropertyHub to get auth token
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

// API helper
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

// ═══ TOOLS ═══
const tools = [
  {
    name: 'list_properties',
    description: 'Отримати список всіх приміщень з орендарями, статусом, ставками. Використовувати коли користувач запитує про приміщення, орендарів, хто де живе.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_invoices',
    description: 'Отримати список рахунків. Можна фільтрувати за місяцем, роком, статусом (created/signing/signed/sent/paid) або приміщенням. Використовувати для "показати рахунки", "які рахунки за лютий", "хто не заплатив" (status!=paid).',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'number', description: 'Місяць 0-11 (0=Січень, 11=Грудень)' },
        year: { type: 'number', description: 'Рік (наприклад 2026)' },
        status: { type: 'string', description: 'Статус: created, signing, signed, sent, paid' },
        property_id: { type: 'number', description: 'ID приміщення' },
        unpaid_only: { type: 'boolean', description: 'Тільки несплачені (не paid)' },
      },
    },
  },
  {
    name: 'list_payments',
    description: 'Отримати список всіх отриманих оплат. Використовувати для "хто заплатив", "покажи оплати", "історія платежів".',
    inputSchema: {
      type: 'object',
      properties: {
        property_id: { type: 'number', description: 'Фільтр за приміщенням' },
      },
    },
  },
  {
    name: 'list_utilities',
    description: 'Отримати список записів про комунальні платежі постачальникам. Використовувати для "покажи комунальні", "скільки платили за електрику".',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'number' },
        year: { type: 'number' },
        property_id: { type: 'number' },
      },
    },
  },
  {
    name: 'add_utility',
    description: 'Додати новий запис про комунальний платіж постачальнику. Типи: electricity (електрика), water (вода), heating (опалення/газ), hcs (ЖКП). Використовувати коли користувач каже "додай електрику 2800 за квітень на Приміщення 1".',
    inputSchema: {
      type: 'object',
      properties: {
        property_id: { type: 'number', description: 'ID приміщення (обов\'язково)' },
        type: { type: 'string', description: 'Тип: electricity, water, heating, hcs' },
        month: { type: 'number', description: 'Місяць 0-11' },
        year: { type: 'number', description: 'Рік' },
        provider_amount: { type: 'number', description: 'Сума постачальнику в гривнях' },
        note: { type: 'string', description: 'Примітка (опціонально)' },
      },
      required: ['property_id', 'type', 'month', 'year', 'provider_amount'],
    },
  },
  {
    name: 'add_payment',
    description: 'Записати отриману оплату від орендаря. Використовувати коли "зарахуй оплату 15000 від Приміщення 2 сьогодні".',
    inputSchema: {
      type: 'object',
      properties: {
        property_id: { type: 'number' },
        amount: { type: 'number', description: 'Сума в гривнях' },
        date: { type: 'string', description: 'Дата YYYY-MM-DD (за замовчуванням сьогодні)' },
        note: { type: 'string', description: 'Примітка, напр. номер платіжки' },
      },
      required: ['property_id', 'amount'],
    },
  },
  {
    name: 'create_invoice',
    description: 'Створити рахунок для одного приміщення. Режими: full (оренда + комунальні), rent_only (тільки оренда), utilities_only (тільки комунальні). Використовувати для "вистав рахунок на Приміщення 1 за квітень".',
    inputSchema: {
      type: 'object',
      properties: {
        property_id: { type: 'number' },
        month: { type: 'number', description: 'Місяць 0-11' },
        year: { type: 'number' },
        mode: { type: 'string', description: 'full, rent_only, utilities_only (default: full)' },
        exchange_rate_usd: { type: 'number', description: 'Курс USD якщо валюта USD' },
        exchange_rate_eur: { type: 'number', description: 'Курс EUR якщо валюта EUR' },
      },
      required: ['property_id', 'month', 'year'],
    },
  },
  {
    name: 'create_invoices_bulk',
    description: 'Створити рахунки одразу для всіх орендарів або обраних. Використовувати для "вистав рахунки всім за квітень", "виставу всім окрім Петренка".',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'number' },
        year: { type: 'number' },
        mode: { type: 'string', description: 'full, rent_only, utilities_only (default: full)' },
        property_ids: { type: 'array', items: { type: 'number' }, description: 'Якщо порожньо — для всіх орендованих' },
        exchange_rate_usd: { type: 'number' },
        exchange_rate_eur: { type: 'number' },
      },
      required: ['month', 'year'],
    },
  },
  {
    name: 'send_invoice_email',
    description: 'Надіслати рахунок на email орендаря. Використовувати "надішли рахунок #5", "відправ усі створені рахунки за квітень".',
    inputSchema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'number' },
      },
      required: ['invoice_id'],
    },
  },
  {
    name: 'get_reconciliation',
    description: 'Сформувати акт звірки взаєморозрахунків для приміщення. Повертає всі нарахування і оплати, баланс. Використовувати "акт звірки з Петренко", "покажи баланс Приміщення 1".',
    inputSchema: {
      type: 'object',
      properties: {
        property_id: { type: 'number' },
        start_date: { type: 'string', description: 'YYYY-MM-DD (опціонально)' },
        end_date: { type: 'string', description: 'YYYY-MM-DD (опціонально)' },
      },
      required: ['property_id'],
    },
  },
  {
    name: 'get_company',
    description: 'Отримати реквізити вашої компанії (назва, ЄДРПОУ, IBAN).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'update_property',
    description: 'Оновити дані приміщення — ставку, коефіцієнт, курс, дані орендаря. Використовувати "зміни курс долара на 42", "постав оренду 25000 на Приміщення 2".',
    inputSchema: {
      type: 'object',
      properties: {
        property_id: { type: 'number' },
        rent_amount: { type: 'number' },
        currency: { type: 'string', description: 'UAH, USD, EUR' },
        exchange_rate: { type: 'number' },
        util_coefficient: { type: 'number', description: 'Напр. 1.07 для +7%' },
      },
      required: ['property_id'],
    },
  },
];

// ═══ TOOL HANDLERS ═══
async function handleTool(name, args) {
  switch (name) {
    case 'list_properties': {
      const props = await api('GET', '/properties');
      return props.map(p => ({
        id: p.id, name: p.name, address: p.address,
        status: p.status === 'rented' ? 'Здається' : 'Вакантне',
        currency: p.currency,
        rent_amount: p.rent_amount,
        exchange_rate: p.exchange_rate,
        util_coefficient: p.util_coefficient,
        tenant: p.tenant ? {
          name: p.tenant.name, company: p.tenant.company,
          email: p.tenant.email, phone: p.tenant.phone,
          edrpou: p.tenant.edrpou,
        } : null,
      }));
    }
    case 'list_invoices': {
      let invs = await api('GET', '/invoices');
      if (args.month !== undefined) invs = invs.filter(i => i.month === args.month);
      if (args.year !== undefined) invs = invs.filter(i => i.year === args.year);
      if (args.status) invs = invs.filter(i => i.status === args.status);
      if (args.property_id) invs = invs.filter(i => i.property_id === args.property_id);
      if (args.unpaid_only) invs = invs.filter(i => i.status !== 'paid');
      return invs.map(i => ({
        id: i.id, number: i.number, property: i.property_name,
        tenant: i.tenant_company || i.tenant_name,
        period: `${MO[i.month]} ${i.year}`,
        rent: Number(i.rent_uah), utilities: Number(i.util_total),
        total: Number(i.total), status: i.status, mode: i.mode,
        email: i.tenant_email, sent_to: i.email_sent_to,
      }));
    }
    case 'list_payments': {
      let pays = await api('GET', '/payments');
      if (args.property_id) pays = pays.filter(p => p.property_id === args.property_id);
      return pays.map(p => ({
        id: p.id, property_id: p.property_id,
        amount: Number(p.amount), date: p.date, note: p.note,
      }));
    }
    case 'list_utilities': {
      let utils = await api('GET', '/utilities');
      if (args.month !== undefined) utils = utils.filter(u => u.month === args.month);
      if (args.year !== undefined) utils = utils.filter(u => u.year === args.year);
      if (args.property_id) utils = utils.filter(u => u.property_id === args.property_id);
      return utils.map(u => ({
        id: u.id, property_id: u.property_id, type: u.type,
        period: `${MO[u.month]} ${u.year}`,
        provider_amount: Number(u.provider_amount), note: u.note,
      }));
    }
    case 'add_utility': {
      const r = await api('POST', '/utilities', {
        property_id: args.property_id,
        type: args.type,
        month: args.month,
        year: args.year,
        provider_amount: args.provider_amount,
        reading: 0,
        note: args.note || '',
      });
      return { success: true, id: r.id, message: `Додано ${args.type}: ${fm(args.provider_amount)} за ${MO[args.month]} ${args.year}` };
    }
    case 'add_payment': {
      const r = await api('POST', '/payments', {
        property_id: args.property_id,
        amount: args.amount,
        date: args.date || new Date().toISOString().slice(0,10),
        note: args.note || '',
      });
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
      const utilItems = mode === 'rent_only' ? [] : mu.map(u => ({
        type: u.type, provider_amount: Number(u.provider_amount),
        coefficient: coeff, client_amount: Number(u.provider_amount) * coeff,
      }));
      const utilTotal = utilItems.reduce((s, u) => s + u.client_amount, 0);
      const numR = await api('GET', `/invoices/next-number/${prop.id}`);
      const r = await api('POST', '/invoices', {
        number: numR.number, property_id: prop.id, property_name: prop.name,
        tenant_name: prop.tenant?.name || '', tenant_company: prop.tenant?.company || '',
        tenant_email: prop.tenant?.email || '',
        month: args.month, year: args.year,
        currency: prop.currency, rent_base: mode === 'utilities_only' ? 0 : Number(prop.rent_amount),
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
          const r = await handleTool('create_invoice', {
            property_id: prop.id, month: args.month, year: args.year,
            mode: args.mode, exchange_rate_usd: args.exchange_rate_usd, exchange_rate_eur: args.exchange_rate_eur,
          });
          results.push({ property: prop.name, ...r });
        } catch (e) {
          results.push({ property: prop.name, error: e.message });
        }
      }
      const total = results.reduce((s, r) => s + (r.success ? parseFloat(r.total) : 0), 0);
      return { count: results.filter(r => r.success).length, total: fm(total), results };
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
      return {
        property: r.property?.name,
        tenant: r.tenant?.company || r.tenant?.name,
        total_invoiced: fm(r.summary.totalInvoiced),
        total_paid: fm(r.summary.totalPaid),
        balance: fm(r.summary.balance),
        balance_note: r.summary.balance > 0 ? 'Переплата' : r.summary.balance < 0 ? 'Заборгованість' : 'Розрахунки закриті',
        invoices_count: r.invoices.length,
        payments_count: r.payments.length,
      };
    }
    case 'get_company': {
      return await api('GET', '/company');
    }
    case 'update_property': {
      const props = await api('GET', '/properties');
      const prop = props.find(p => p.id === args.property_id);
      if (!prop) throw new Error('Property not found');
      const payload = { ...prop, tenant: prop.tenant };
      if (args.rent_amount !== undefined) payload.rent_amount = args.rent_amount;
      if (args.currency) payload.currency = args.currency;
      if (args.exchange_rate !== undefined) payload.exchange_rate = args.exchange_rate;
      if (args.util_coefficient !== undefined) payload.util_coefficient = args.util_coefficient;
      await api('PUT', `/properties/${args.property_id}`, payload);
      return { success: true, message: `Оновлено ${prop.name}` };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ═══ MCP SERVER ═══
const server = new Server(
  { name: 'propertyhub-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const result = await handleTool(req.params.name, req.params.arguments || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Помилка: ${err.message}` }], isError: true };
  }
});

// ═══ HTTP TRANSPORT (SSE) ═══
const app = express();
app.use(express.json());

// Auth middleware
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const secret = req.headers['x-mcp-secret'] || req.query.secret;
  if (secret !== MCP_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok', propertyhub: PROPERTYHUB_URL }));

let sseTransport = null;
app.get('/sse', async (req, res) => {
  sseTransport = new SSEServerTransport('/messages', res);
  await server.connect(sseTransport);
});

app.post('/messages', async (req, res) => {
  if (!sseTransport) return res.status(400).send('No active SSE connection');
  await sseTransport.handlePostMessage(req, res);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PropertyHub MCP server running on port ${PORT}`);
  console.log(`Connected to: ${PROPERTYHUB_URL}`);
});
