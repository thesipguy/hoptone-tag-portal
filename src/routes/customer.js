const express = require('express');
const { pool } = require('../db');
const { requireCustomer, loginLimiter, login } = require('../auth');
const { hashPassword, checkPassword } = require('../util');
const { categoriesForCustomer, setBlockedCategories, asArray } = require('../models');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use((req, res, next) => { res.locals.area = 'customer'; res.locals.customerEmail = req.session.customerEmail; next(); });

router.get('/login', (req, res) => res.render('customer/login', { title: 'Sign in' }));

router.post('/login', loginLimiter, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const [rows] = await pool.query('SELECT id, email, password_hash, is_active FROM customers WHERE email = ?', [email]);
  const c = rows[0];
  if (!c || !(await checkPassword(String(req.body.password || ''), c.password_hash))) {
    req.flash('error', 'Invalid email or password.');
    return res.redirect('/login');
  }
  if (!c.is_active) {
    req.flash('error', 'This account is disabled. Please contact support.');
    return res.redirect('/login');
  }
  await login(req, { customerPk: c.id, customerEmail: c.email });
  res.redirect('/');
}));

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

router.use(requireCustomer);

// Re-check the account on every request so disabling/deleting takes effect immediately
router.use(wrap(async (req, res, next) => {
  const [rows] = await pool.query('SELECT id, customer_id, email, sip_devices, is_active FROM customers WHERE id = ?', [req.session.customerPk]);
  if (!rows[0] || !rows[0].is_active) return req.session.destroy(() => res.redirect('/login'));
  req.customer = rows[0];
  next();
}));

router.get('/', wrap(async (req, res) => {
  const categories = await categoriesForCustomer(req.customer.id);
  res.render('customer/dashboard', { title: 'Call blocking', customer: req.customer, categories });
}));

router.post('/', wrap(async (req, res) => {
  await setBlockedCategories(req.customer.id, asArray(req.body.blocked));
  req.flash('success', 'Your blocking settings were saved.');
  res.redirect('/');
}));

router.get('/account', (req, res) => res.render('customer/account', { title: 'My account', customer: req.customer }));

router.post('/account', wrap(async (req, res) => {
  const [[row]] = await pool.query('SELECT password_hash FROM customers WHERE id = ?', [req.customer.id]);
  const next = String(req.body.new_password || '');
  if (!(await checkPassword(String(req.body.current_password || ''), row.password_hash))) {
    req.flash('error', 'Current password is incorrect.');
  } else if (next.length < 8 || next !== req.body.confirm_password) {
    req.flash('error', 'New passwords must match and be at least 8 characters.');
  } else {
    await pool.query('UPDATE customers SET password_hash = ? WHERE id = ?', [await hashPassword(next), req.customer.id]);
    req.flash('success', 'Password changed.');
  }
  res.redirect('/account');
}));

module.exports = router;
