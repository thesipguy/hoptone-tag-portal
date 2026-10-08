const { pool, withTransaction } = require('./db');

async function listCategories() {
  const [rows] = await pool.query('SELECT id, slug, name, description FROM categories ORDER BY sort_order, name');
  return rows;
}

// All categories with a `blocked` flag for one customer
async function categoriesForCustomer(customerPk) {
  const [rows] = await pool.query(
    `SELECT c.id, c.slug, c.name, c.description, (b.category_id IS NOT NULL) AS blocked
       FROM categories c
       LEFT JOIN customer_blocked_categories b ON b.category_id = c.id AND b.customer_id = ?
      ORDER BY c.sort_order, c.name`,
    [customerPk]
  );
  return rows.map((r) => ({ ...r, blocked: !!r.blocked }));
}

// Replace the blocked set for a customer. categoryIds are validated against the table.
async function setBlockedCategories(customerPk, categoryIds, conn) {
  const ids = [...new Set((categoryIds || []).map(Number).filter(Number.isInteger))];
  const run = async (c) => {
    await c.query('DELETE FROM customer_blocked_categories WHERE customer_id = ?', [customerPk]);
    if (ids.length) {
      await c.query(
        `INSERT INTO customer_blocked_categories (customer_id, category_id)
         SELECT ?, id FROM categories WHERE id IN (?)`,
        [customerPk, ids]
      );
    }
  };
  return conn ? run(conn) : withTransaction(run);
}

// Normalise a form field that may be absent, a string, or an array
function asArray(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}

module.exports = { listCategories, categoriesForCustomer, setBlockedCategories, asArray };
