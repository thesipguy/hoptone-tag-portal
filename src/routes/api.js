// Read-only API for the call-blocking engine.
//   GET /api/v1/blocklist?device=<sip device>      -> blocked lists for the client owning that device
//   GET /api/v1/blocklist?customer_id=<customer id>
//   GET /api/v1/customers                          -> every active client with devices and blocked lists
// Auth: "Authorization: Bearer <API_KEY>"
const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use((req, res, next) => {
  const key = process.env.API_KEY || '';
  const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  const given = m ? m[1] : '';
  const ok = key && given.length === key.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
  if (!ok) return res.status(401).json({ error: 'unauthorized' });
  next();
});

const BASE = `
  SELECT cu.customer_id, cu.sip_devices,
         GROUP_CONCAT(c.slug ORDER BY c.sort_order, c.slug SEPARATOR ',') AS lists
    FROM customers cu
    LEFT JOIN customer_blocked_categories b ON b.customer_id = cu.id
    LEFT JOIN categories c ON c.id = b.category_id
   WHERE cu.is_active = 1`;

const shape = (r) => ({
  customer_id: r.customer_id,
  sip_devices: r.sip_devices ? r.sip_devices.split(',') : [],
  blocked_lists: r.lists ? r.lists.split(',') : [],
});

router.get('/blocklist', wrap(async (req, res) => {
  const { device, customer_id: customerId } = req.query;
  let rows;
  if (device) {
    [rows] = await pool.query(`${BASE} AND FIND_IN_SET(?, cu.sip_devices) GROUP BY cu.id`, [String(device)]);
  } else if (customerId) {
    [rows] = await pool.query(`${BASE} AND cu.customer_id = ? GROUP BY cu.id`, [String(customerId)]);
  } else {
    return res.status(400).json({ error: 'device or customer_id is required' });
  }
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows.length === 1 ? shape(rows[0]) : rows.map(shape));
}));

router.get('/customers', wrap(async (req, res) => {
  const [rows] = await pool.query(`${BASE} GROUP BY cu.id ORDER BY cu.customer_id`);
  res.json(rows.map(shape));
}));

router.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server error' });
});

module.exports = router;
