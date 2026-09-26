import axios from 'axios';

// In production (Railway), VITE_API_URL is set to the deployed bot URL.
// In local dev, BASE is '' so Vite's proxy handles /v1/* → localhost:8080.
const BASE = import.meta.env.VITE_API_URL || '';

const api = axios.create({ baseURL: BASE, timeout: 35000 });

export const healthz = () => api.get('/v1/healthz').then(r => r.data);
export const metadata = () => api.get('/v1/metadata').then(r => r.data);

export const pushContext = (scope, context_id, version, payload) =>
  api.post('/v1/context', {
    scope,
    context_id,
    version,
    payload,
    delivered_at: new Date().toISOString(),
  }).then(r => r.data);

export const tick = (available_triggers) =>
  api.post('/v1/tick', {
    now: new Date().toISOString(),
    available_triggers,
  }).then(r => r.data);

export const reply = (conversation_id, merchant_id, customer_id, from_role, message, turn_number) =>
  api.post('/v1/reply', {
    conversation_id,
    merchant_id,
    customer_id,
    from_role,
    message,
    received_at: new Date().toISOString(),
    turn_number,
  }).then(r => r.data);

export const teardown = () => api.post('/v1/teardown').then(r => r.data);

export default api;
