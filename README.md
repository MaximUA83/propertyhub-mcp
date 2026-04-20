# PropertyHub MCP Server

MCP (Model Context Protocol) server that connects Claude to PropertyHub.

## Environment Variables

- `PROPERTYHUB_URL` — URL of PropertyHub backend (e.g. `http://property-hub:3000`)
- `PROPERTYHUB_PASSWORD` — admin password to login to PropertyHub
- `MCP_SECRET` — shared secret for authenticating Claude client
- `PORT` — port to listen on (default 3100)

## Tools

- `list_properties` — all properties with tenants
- `list_invoices` — invoices with filters (month, year, status, property, unpaid_only)
- `list_payments` — received payments
- `list_utilities` — utility records
- `add_utility` — add utility record from provider
- `add_payment` — log received payment
- `create_invoice` — generate invoice for one property
- `create_invoices_bulk` — bulk invoicing for all or selected rented
- `send_invoice_email` — email invoice with public link
- `get_reconciliation` — reconciliation act for property
- `get_company` — company details
- `update_property` — update rent, currency, coefficient etc
