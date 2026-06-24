const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'));

// ---- Helper to run a SQL statement as a Promise ----
const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve({ lastID: this.lastID, changes: this.changes });
  });
});

const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

// ---- Migration helper: ignore "column already exists" errors ----
const migrate = (sql) => run(sql).catch(() => {});

// ---- Build schema & seed — returns a Promise that resolves when done ----
const initDb = async () => {
  await run('PRAGMA foreign_keys = ON');

  // CLINICS
  await run(`CREATE TABLE IF NOT EXISTS clinics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_name TEXT DEFAULT '',
    email TEXT UNIQUE,
    password_hash TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // BRANCHES
  await run(`CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    name TEXT,
    address TEXT,
    phone TEXT,
    email TEXT,
    manager TEXT,
    staff_count INTEGER DEFAULT 0,
    appointments_this_month INTEGER DEFAULT 0,
    revenue REAL DEFAULT 0,
    status TEXT DEFAULT 'active'
  )`);

  // STAFF
  await run(`CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    name TEXT,
    email TEXT DEFAULT '',
    role TEXT,
    dept TEXT,
    status TEXT DEFAULT 'Active',
    branch TEXT DEFAULT '',
    branch_id INTEGER,
    sessions INTEGER DEFAULT 0,
    rating REAL DEFAULT 0
  )`);

  // PATIENTS
  await run(`CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    patient_id TEXT UNIQUE,
    name TEXT,
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    age INTEGER,
    gender TEXT DEFAULT '',
    address TEXT DEFAULT '',
    medical_notes TEXT DEFAULT '',
    assigned_branch_id INTEGER,
    assigned_staff_id INTEGER,
    billing_frequency TEXT DEFAULT 'MONTHLY',
    base_rate_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // APPOINTMENTS
  await run(`CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    patient_id INTEGER,
    staff_id INTEGER,
    branch_id INTEGER,
    date_time TEXT,
    duration_minutes INTEGER DEFAULT 60,
    service TEXT DEFAULT '',
    status TEXT DEFAULT 'Scheduled',
    payment_status TEXT DEFAULT 'pending',
    notes TEXT DEFAULT '',
    patient TEXT,
    therapist TEXT,
    date TEXT,
    time TEXT
  )`);

  // INVOICE COUNTER
  await run(`CREATE TABLE IF NOT EXISTS invoice_counter (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_number INTEGER DEFAULT 0
  )`);
  await run(`INSERT OR IGNORE INTO invoice_counter (id, last_number) VALUES (1, 0)`);

  // INVOICES
  await run(`CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    invoice_number TEXT,
    patient_id INTEGER,
    patient_name TEXT DEFAULT '',
    patient_phone TEXT DEFAULT '',
    service TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    tax REAL DEFAULT 0,
    total REAL DEFAULT 0,
    billing_frequency TEXT DEFAULT 'MONTHLY',
    status TEXT DEFAULT 'pending',
    date TEXT,
    due_date TEXT,
    therapist TEXT DEFAULT '',
    branch TEXT DEFAULT '',
    generated_at TEXT DEFAULT (datetime('now')),
    period_start TEXT,
    period_end TEXT,
    notes TEXT DEFAULT ''
  )`);

  // LEADS
  await run(`CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    name TEXT, phone TEXT, email TEXT,
    service TEXT, source TEXT, stage TEXT, date TEXT
  )`);

  // TESTIMONIALS
  await run(`CREATE TABLE IF NOT EXISTS testimonials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    client_name TEXT, client_image TEXT,
    rating INTEGER DEFAULT 5, review TEXT,
    service TEXT, date TEXT, is_active INTEGER DEFAULT 1
  )`);

  // PACKAGES
  await run(`CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    name TEXT, sessions INTEGER DEFAULT 0,
    price REAL DEFAULT 0, discount INTEGER DEFAULT 0,
    validity_days INTEGER DEFAULT 30, description TEXT, is_active INTEGER DEFAULT 1
  )`);

  // MEMBERSHIPS
  await run(`CREATE TABLE IF NOT EXISTS memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    name TEXT, price REAL DEFAULT 0,
    duration_months INTEGER DEFAULT 1, features TEXT DEFAULT '[]',
    discount_on_services INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1
  )`);

  // GALLERY
  await run(`CREATE TABLE IF NOT EXISTS gallery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    url TEXT, title TEXT, category TEXT, date TEXT, "order" INTEGER DEFAULT 0
  )`);

  // SETTINGS
  await run(`CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER UNIQUE,
    settings_json TEXT DEFAULT '{}'
  )`);

  // ---- MIGRATIONS: add new columns to existing DBs ----
  await migrate(`ALTER TABLE clinics ADD COLUMN clinic_name TEXT DEFAULT ''`);
  await migrate(`ALTER TABLE staff ADD COLUMN email TEXT DEFAULT ''`);
  await migrate(`ALTER TABLE staff ADD COLUMN branch_id INTEGER`);
  await migrate(`ALTER TABLE invoices ADD COLUMN invoice_number TEXT`);
  await migrate(`ALTER TABLE invoices ADD COLUMN patient_id INTEGER`);
  await migrate(`ALTER TABLE invoices ADD COLUMN billing_frequency TEXT DEFAULT 'MONTHLY'`);
  await migrate(`ALTER TABLE invoices ADD COLUMN generated_at TEXT DEFAULT (datetime('now'))`);
  await migrate(`ALTER TABLE invoices ADD COLUMN period_start TEXT`);
  await migrate(`ALTER TABLE invoices ADD COLUMN period_end TEXT`);
  await migrate(`ALTER TABLE invoices ADD COLUMN notes TEXT DEFAULT ''`);
  await migrate(`ALTER TABLE appointments ADD COLUMN patient_id INTEGER`);
  await migrate(`ALTER TABLE appointments ADD COLUMN staff_id INTEGER`);
  await migrate(`ALTER TABLE appointments ADD COLUMN branch_id INTEGER`);
  await migrate(`ALTER TABLE appointments ADD COLUMN date_time TEXT`);
  await migrate(`ALTER TABLE appointments ADD COLUMN duration_minutes INTEGER DEFAULT 60`);
  await migrate(`ALTER TABLE appointments ADD COLUMN payment_status TEXT DEFAULT 'pending'`);
  await migrate(`ALTER TABLE appointments ADD COLUMN notes TEXT DEFAULT ''`);

  // ---- Seed demo clinic ----
  const demoEmail = 'demo@physiocare.com';
  const existing = await get('SELECT id FROM clinics WHERE email = ?', [demoEmail]);
  if (!existing) {
    const hash = bcrypt.hashSync('demo123', 10);
    await run('INSERT INTO clinics (email, password_hash, clinic_name) VALUES (?, ?, ?)', [demoEmail, hash, 'PhysioCare Demo Clinic']);
  }

  console.log('✅ Database ready');
};

// ---- Query helper (PostgreSQL $1/$2 → SQLite ?) ----
const pool = {
  query: (text, params) => {
    return new Promise((resolve, reject) => {
      let sqliteText = text.replace(/\$\d+/g, '?');
      const isSelect = sqliteText.trim().toUpperCase().startsWith('SELECT');
      const hasReturning = sqliteText.toUpperCase().includes('RETURNING');

      if (isSelect || hasReturning) {
        if (hasReturning && !isSelect) {
          const parts = sqliteText.split(/RETURNING\s+\*/i);
          const insertSql = parts[0].trim();
          const tableName = insertSql.match(/INTO\s+(\w+)/i)?.[1] || '';
          db.run(insertSql, params || [], function (err) {
            if (err) return reject(err);
            const lastId = this.lastID;
            db.all(`SELECT * FROM ${tableName} WHERE id = ?`, [lastId], (err2, rows) => {
              if (err2) return reject(err2);
              resolve({ rows });
            });
          });
        } else {
          db.all(sqliteText, params || [], (err, rows) => {
            if (err) reject(err);
            else resolve({ rows });
          });
        }
      } else {
        db.run(sqliteText, params || [], function (err) {
          if (err) reject(err);
          else resolve({ rows: [], changes: this.changes, lastID: this.lastID });
        });
      }
    });
  },

  getNextInvoiceNumber: () => {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN EXCLUSIVE TRANSACTION', (err) => {
          if (err) return reject(err);
          db.run('UPDATE invoice_counter SET last_number = last_number + 1 WHERE id = 1', [], function (err2) {
            if (err2) { db.run('ROLLBACK'); return reject(err2); }
            db.get('SELECT last_number FROM invoice_counter WHERE id = 1', [], (err3, row) => {
              if (err3) { db.run('ROLLBACK'); return reject(err3); }
              db.run('COMMIT', (err4) => {
                if (err4) return reject(err4);
                const year = new Date().getFullYear();
                const num = String(row.last_number).padStart(4, '0');
                resolve(`INV-${year}-${num}`);
              });
            });
          });
        });
      });
    });
  },

  getNextPatientId: () => new Promise((resolve, reject) => {
    const year = new Date().getFullYear();
    const prefix = `KP-${year}-`;
    db.get(`SELECT patient_id FROM patients WHERE patient_id LIKE ? ORDER BY patient_id DESC LIMIT 1`, [`${prefix}%`], (err, row) => {
      if (err) return reject(err);
      if (row && row.patient_id) {
        const lastSeq = parseInt(row.patient_id.split('-')[2], 10) || 0;
        const seq = String(lastSeq + 1).padStart(4, '0');
        resolve(`${prefix}${seq}`);
      } else {
        resolve(`${prefix}0001`);
      }
    });
  }),

  transaction: (callback) => {
    return new Promise((resolve, reject) => {
      db.serialize(async () => {
        db.run('BEGIN TRANSACTION', async (err) => {
          if (err) return reject(err);
          try {
            const result = await callback();
            db.run('COMMIT', (err2) => {
              if (err2) reject(err2);
              else resolve(result);
            });
          } catch (callbackErr) {
            db.run('ROLLBACK', () => reject(callbackErr));
          }
        });
      });
    });
  }
};

// Export init so server.js can await it before listening
module.exports = { pool, initDb };
