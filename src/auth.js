const rateLimit = require('express-rate-limit');

function requireAdmin(req, res, next) {
  if (req.session.adminId) return next();
  res.redirect('/admin/login');
}

function requireCustomer(req, res, next) {
  if (req.session.customerPk) return next();
  res.redirect('/login');
}

// 10 failed-or-not login POSTs per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: 'Too many login attempts. Try again in 15 minutes.',
});

// Regenerate the session on login to prevent fixation
function login(req, fields) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      Object.assign(req.session, fields);
      req.session.save((e) => (e ? reject(e) : resolve()));
    });
  });
}

module.exports = { requireAdmin, requireCustomer, loginLimiter, login };
