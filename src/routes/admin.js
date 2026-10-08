const express = require('express');
const { pool, withTransaction } = require('../db');
const { requireAdmin, loginLimiter, login } = require('../auth');
const { hashPassword, checkPassword, normalizeSipDevices, slugify, isEmail } = require('../util');
const { categoriesForCustomer, setBlockedCategories, asArray } = require('../models');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use((req, res, next) => { res.locals.area = 'admin'; res.locals.adminEmail = req.session.adminEmail; next(); });

// ---------- auth ----------
router.get('/login', (req, res) => res.render('admin/login', { title: 'Admin login' }));

router.post('/login', loginLimiter, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const [rows] = await pool.query('SELECT id, email, password_hash FROM admins WHERE email = ?', [email]);
  const admin = rows[0];
  if (!admin || !(await checkPassword(String(req.body.password || ''), admin.password_hash))) {
    req.flash('error', 'Invalid email or password.');
    return res.redirect('/admin/login');
  }
  await login(req, { adminId: admin.id, adminEmail: admin.email });
  res.redirect('/admin');
}));

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/admin/login')));

router.use(requireAdmin);

// ---------- clients ----------
router.get('/', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;
  const [customers] = await pool.query(
    `SELECT cu.id, cu.customer_id, cu.email, cu.sip_devices, cu.is_active, cu.created_at,
            (SELECT COUNT(*) FROM customer_blocked_categories b WHERE b.customer_id = cu.id) AS blocked_count
       FROM customers cu
      WHERE ? = '' OR cu.email LIKE ? OR cu.customer_id LIKE ? OR cu.sip_devices LIKE ?
      ORDER BY cu.created_at DESC`,
    [q, like, like, like]
  );
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM categories');
  res.render('admin/clients', { title: 'Clients', customers, q, totalCategories: total });
}));

router.get('/clients/new', (req, res) =>
  res.render('admin/client-form', { title: 'Add client', cust: {}, isNew: true }));

function validateClient(body, isNew) {
  const data = {
    email: String(body.email || '').trim().toLowerCase(),
    customer_id: String(body.customer_id || '').trim(),
    sip_devices: normalizeSipDevices(body.sip_devices),
    password: String(body.password || ''),
    is_active: body.is_active ? 1 : 0,
  };
  const errors = [];
  if (!isEmail(data.email)) errors.push('A valid email is required.');
  if (!data.customer_id || data.customer_id.length > 64) errors.push('Customer ID is required (max 64 characters).');
  if (!data.sip_devices) errors.push('At least one SIP device is required.');
  if ((isNew || data.password) && data.password.length < 8) errors.push('Password must be at least 8 characters.');
  return { data, errors };
}

const dupMessage = (err) =>
  err.code === 'ER_DUP_ENTRY'
    ? (/email/.test(err.sqlMessage) ? 'That email is already in use.' : 'That customer ID is already in use.')
    : null;

router.post('/clients', wrap(async (req, res) => {
  const { data, errors } = validateClient(req.body, true);
  if (errors.length) {
    return res.status(400).render('admin/client-form', { title: 'Add client', cust: { ...data, is_active: 1 }, isNew: true, errors });
  }
  const hash = await hashPassword(data.password);
  try {
    await withTransaction(async (conn) => {
      const [r] = await conn.query(
        'INSERT INTO customers (customer_id, email, password_hash, sip_devices) VALUES (?, ?, ?, ?)',
        [data.customer_id, data.email, hash, data.sip_devices]
      );
      // New clients start with every category blocked
      await conn.query(
        'INSERT INTO customer_blocked_categories (customer_id, category_id) SELECT ?, id FROM categories',
        [r.insertId]
      );
    });
  } catch (err) {
    const msg = dupMessage(err);
    if (!msg) throw err;
    return res.status(400).render('admin/client-form', { title: 'Add client', cust: data, isNew: true, errors: [msg] });
  }
  req.flash('success', `Client ${data.customer_id} added with all categories blocked.`);
  res.redirect('/admin');
}));

async function loadClient(id) {
  const [rows] = await pool.query('SELECT id, customer_id, email, sip_devices, is_active FROM customers WHERE id = ?', [id]);
  return rows[0];
}

router.get('/clients/:id', wrap(async (req, res, next) => {
  const client = await loadClient(req.params.id);
  if (!client) return next();
  const categories = await categoriesForCustomer(client.id);
  res.render('admin/client-form', { title: `Client ${client.customer_id}`, cust: client, categories, isNew: false });
}));

router.post('/clients/:id', wrap(async (req, res, next) => {
  const existing = await loadClient(req.params.id);
  if (!existing) return next();
  const { data, errors } = validateClient(req.body, false);
  if (errors.length) {
    const categories = await categoriesForCustomer(existing.id);
    return res.status(400).render('admin/client-form', { title: `Client ${existing.customer_id}`, cust: { ...data, id: existing.id }, categories, isNew: false, errors });
  }
  try {
    await withTransaction(async (conn) => {
      await conn.query(
        'UPDATE customers SET customer_id = ?, email = ?, sip_devices = ?, is_active = ? WHERE id = ?',
        [data.customer_id, data.email, data.sip_devices, data.is_active, existing.id]
      );
      if (data.password) {
        await conn.query('UPDATE customers SET password_hash = ? WHERE id = ?', [await hashPassword(data.password), existing.id]);
      }
      await setBlockedCategories(existing.id, asArray(req.body.blocked), conn);
    });
  } catch (err) {
    const msg = dupMessage(err);
    if (!msg) throw err;
    const categories = await categoriesForCustomer(existing.id);
    return res.status(400).render('admin/client-form', { title: `Client ${existing.customer_id}`, cust: { ...data, id: existing.id }, categories, isNew: false, errors: [msg] });
  }
  req.flash('success', 'Client saved.');
  res.redirect(`/admin/clients/${existing.id}`);
}));

router.post('/clients/:id/delete', wrap(async (req, res) => {
  await pool.query('DELETE FROM customers WHERE id = ?', [req.params.id]);
  req.flash('success', 'Client deleted.');
  res.redirect('/admin');
}));

// ---------- categories ----------
router.get('/categories', wrap(async (req, res) => {
  const [categories] = await pool.query(
    `SELECT c.*, (SELECT COUNT(*) FROM customer_blocked_categories b WHERE b.category_id = c.id) AS blocked_by
       FROM categories c ORDER BY c.sort_order, c.name`
  );
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM customers');
  res.render('admin/categories', { title: 'Categories', categories, totalCustomers: total });
}));

router.post('/categories', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const slug = slugify(req.body.slug || name);
  const description = String(req.body.description || '').trim() || null;
  const sortOrder = Number.parseInt(req.body.sort_order, 10) || 0;
  if (!name || !slug) {
    req.flash('error', 'Name is required.');
    return res.redirect('/admin/categories');
  }
  try {
    await withTransaction(async (conn) => {
      const [r] = await conn.query(
        'INSERT INTO categories (slug, name, description, sort_order) VALUES (?, ?, ?, ?)',
        [slug, name, description, sortOrder]
      );
      // Safe default: a new category is blocked for every existing client
      await conn.query(
        'INSERT INTO customer_blocked_categories (customer_id, category_id) SELECT id, ? FROM customers',
        [r.insertId]
      );
    });
  } catch (err) {
    if (err.code !== 'ER_DUP_ENTRY') throw err;
    req.flash('error', `A category with slug "${slug}" already exists.`);
    return res.redirect('/admin/categories');
  }
  req.flash('success', `Category "${name}" added and blocked for all existing clients.`);
  res.redirect('/admin/categories');
}));

router.post('/categories/:id', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) {
    req.flash('error', 'Name is required.');
    return res.redirect('/admin/categories');
  }
  await pool.query(
    'UPDATE categories SET name = ?, description = ?, sort_order = ? WHERE id = ?',
    [name, String(req.body.description || '').trim() || null, Number.parseInt(req.body.sort_order, 10) || 0, req.params.id]
  );
  req.flash('success', 'Category updated.');
  res.redirect('/admin/categories');
}));

router.post('/categories/:id/delete', wrap(async (req, res) => {
  await pool.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
  req.flash('success', 'Category deleted.');
  res.redirect('/admin/categories');
}));

// ---------- own password ----------
router.get('/account', (req, res) => res.render('admin/account', { title: 'My account' }));

router.post('/account', wrap(async (req, res) => {
  const [[admin]] = await pool.query('SELECT password_hash FROM admins WHERE id = ?', [req.session.adminId]);
  const next = String(req.body.new_password || '');
  if (!(await checkPassword(String(req.body.current_password || ''), admin.password_hash))) {
    req.flash('error', 'Current password is incorrect.');
  } else if (next.length < 8 || next !== req.body.confirm_password) {
    req.flash('error', 'New passwords must match and be at least 8 characters.');
  } else {
    await pool.query('UPDATE admins SET password_hash = ? WHERE id = ?', [await hashPassword(next), req.session.adminId]);
    req.flash('success', 'Password changed.');
  }
  res.redirect('/admin/account');
}));


module.exports = router;
