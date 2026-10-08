require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const helmet = require('helmet');
const { pool } = require('./db');

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change-me') {
  console.error('SESSION_SECRET must be set in .env');
  process.exit(1);
}

const app = express();
const behindProxy = process.env.BEHIND_PROXY === '1';
if (behindProxy) app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.disable('x-powered-by');

app.use(helmet());
app.use(express.urlencoded({ extended: false }));
app.use('/static', express.static(path.join(__dirname, '..', 'public')));

// JSON API is token-authenticated and stateless; mount it before sessions/CSRF.
app.use('/api/v1', require('./routes/api'));

app.use(session({
  name: 'hoptone.sid',
  secret: process.env.SESSION_SECRET,
  store: new MySQLStore({ createDatabaseTable: true }, pool),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: behindProxy, maxAge: 8 * 60 * 60 * 1000 },
}));

// Flash messages + CSRF token for every form
app.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  req.flash = (type, text) => { req.session.flash = { type, text }; };
  if (req.method === 'POST') {
    const sent = req.body && req.body._csrf;
    const ok = typeof sent === 'string' && sent.length === req.session.csrf.length &&
      crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.session.csrf));
    if (!ok) return res.status(403).send('Invalid or expired form. Go back, reload the page and try again.');
  }
  next();
});

app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/customer'));

app.use((req, res) => res.status(404).render('message', { title: 'Not found', text: 'Page not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('message', { title: 'Error', text: 'Something went wrong.' });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, '127.0.0.1', () => console.log(`Hoptone portal listening on 127.0.0.1:${port}`));
