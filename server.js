const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
require('dotenv').config();
const { pool, initDb } = require('./db-sqlite');

const app = express();
app.use(cors({ origin: true, credentials: true })); // Allow all origins for Vercel compatibility
app.use(express.json({ limit: '10mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// AUTH
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const r = await pool.query('SELECT id, password_hash, clinic_name FROM clinics WHERE email = $1', [email]);
    if (!r.rows.length) return res.status(401).json({ message: 'Invalid credentials' });
    const clinic = r.rows[0];
    if (!await bcrypt.compare(password, clinic.password_hash)) return res.status(401).json({ message: 'Invalid credentials' });
    const token = jwt.sign({ clinicId: clinic.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, clinicId: clinic.id, clinicName: clinic.clinic_name || '' });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

app.post('/api/auth/register', async (req, res) => {
  const { clinicName, email, password } = req.body;
  if (!clinicName || !email || !password) return res.status(400).json({ message: 'All fields required' });
  try {
    const ex = await pool.query('SELECT id FROM clinics WHERE email = $1', [email]);
    if (ex.rows.length) return res.status(409).json({ message: 'Email already registered' });
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query('INSERT INTO clinics (clinic_name, email, password_hash) VALUES ($1, $2, $3) RETURNING *', [clinicName, email, hash]);
    const token = jwt.sign({ clinicId: r.rows[0].id }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, clinicId: r.rows[0].id, clinicName: r.rows[0].clinic_name });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token' });
  try { const d = jwt.verify(token, JWT_SECRET); req.clinicId = d.clinicId; next(); }
  catch { res.status(401).json({ message: 'Invalid token' }); }
};

// BRANCHES
app.get('/api/branches', authenticate, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM branches WHERE clinic_id = $1', [req.clinicId]); res.json(r.rows); }
  catch (err) { res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/branches', authenticate, async (req, res) => {
  try {
    const { name, address, phone, email, manager, staff_count, appointments_this_month, revenue, status } = req.body;
    const r = await pool.query('INSERT INTO branches (clinic_id,name,address,phone,email,manager,staff_count,appointments_this_month,revenue,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [req.clinicId, name, address, phone, email, manager, staff_count||0, appointments_this_month||0, revenue||0, status||'active']);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});
app.put('/api/branches/:id', authenticate, async (req, res) => {
  try {
    const { name, address, phone, email, manager, staff_count, appointments_this_month, revenue, status } = req.body;
    await pool.query('UPDATE branches SET name=$1,address=$2,phone=$3,email=$4,manager=$5,staff_count=$6,appointments_this_month=$7,revenue=$8,status=$9 WHERE id=$10 AND clinic_id=$11',
      [name, address, phone, email, manager, staff_count||0, appointments_this_month||0, revenue||0, status||'active', req.params.id, req.clinicId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});
app.delete('/api/branches/:id', authenticate, async (req, res) => {
  try { await pool.query('DELETE FROM branches WHERE id=$1 AND clinic_id=$2', [req.params.id, req.clinicId]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// STAFF
app.get('/api/staff', authenticate, async (req, res) => {
  try {
    const r = await pool.query('SELECT s.*, b.name as branch_name FROM staff s LEFT JOIN branches b ON s.branch_id = b.id WHERE s.clinic_id = $1', [req.clinicId]);
    res.json(r.rows);
  } catch (err) { console.error('staff err', err); res.status(500).json({ message: 'Server error' }); }
});
app.get('/api/staff/branch/:branchId', authenticate, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM staff WHERE clinic_id=$1 AND branch_id=$2 AND status=$3', [req.clinicId, req.params.branchId, 'Active']);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/staff', authenticate, async (req, res) => {
  try {
    const { name, email, role, dept, status, branch, branch_id, sessions, rating } = req.body;
    const r = await pool.query('INSERT INTO staff (clinic_id,name,email,role,dept,status,branch,branch_id,sessions,rating) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [req.clinicId, name, email||'', role, dept, status||'Active', branch||'', branch_id||null, sessions||0, rating||0]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});
app.put('/api/staff/:id', authenticate, async (req, res) => {
  try {
    const { name, email, role, dept, status, branch, branch_id, sessions, rating } = req.body;
    await pool.query('UPDATE staff SET name=$1,email=$2,role=$3,dept=$4,status=$5,branch=$6,branch_id=$7,sessions=$8,rating=$9 WHERE id=$10 AND clinic_id=$11',
      [name, email||'', role, dept, status||'Active', branch||'', branch_id||null, sessions||0, rating||0, req.params.id, req.clinicId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});
app.delete('/api/staff/:id', authenticate, async (req, res) => {
  try { await pool.query('DELETE FROM staff WHERE id=$1 AND clinic_id=$2', [req.params.id, req.clinicId]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// PATIENTS
app.get('/api/patients', authenticate, async (req, res) => {
  try {
    const r = await pool.query(`SELECT p.*, b.name as branch_name, s.name as staff_name FROM patients p LEFT JOIN branches b ON p.assigned_branch_id=b.id LEFT JOIN staff s ON p.assigned_staff_id=s.id WHERE p.clinic_id=$1 ORDER BY p.created_at DESC`, [req.clinicId]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/patients', authenticate, async (req, res) => {
  try {
    const { name, email, phone, age, gender, address, medical_notes, assigned_branch_id, assigned_staff_id, billing_frequency, base_rate_amount, status } = req.body;
    const patientId = await pool.getNextPatientId();

    const patient = await pool.transaction(async () => {
      const r = await pool.query(`INSERT INTO patients (clinic_id,patient_id,name,email,phone,age,gender,address,medical_notes,assigned_branch_id,assigned_staff_id,billing_frequency,base_rate_amount,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [req.clinicId, patientId, name, email||'', phone||'', age||null, gender||'', address||'', medical_notes||'', assigned_branch_id||null, assigned_staff_id||null, billing_frequency||'MONTHLY', base_rate_amount||0, status||'active']);
      if (assigned_staff_id) {
        await pool.query(`UPDATE staff SET sessions = COALESCE(sessions, 0) + 1 WHERE id=$1 AND clinic_id=$2`, [assigned_staff_id, req.clinicId]);
      }
      return r.rows[0];
    });

    res.json(patient);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});
app.put('/api/patients/:id', authenticate, async (req, res) => {
  try {
    const { name, email, phone, age, gender, address, medical_notes, assigned_branch_id, assigned_staff_id, billing_frequency, base_rate_amount, status } = req.body;
    await pool.transaction(async () => {
      const oldP = await pool.query('SELECT assigned_staff_id FROM patients WHERE id=$1 AND clinic_id=$2', [req.params.id, req.clinicId]);
      const oldStaff = oldP.rows[0]?.assigned_staff_id;
      
      await pool.query(`UPDATE patients SET name=$1,email=$2,phone=$3,age=$4,gender=$5,address=$6,medical_notes=$7,assigned_branch_id=$8,assigned_staff_id=$9,billing_frequency=$10,base_rate_amount=$11,status=$12 WHERE id=$13 AND clinic_id=$14`,
        [name, email||'', phone||'', age||null, gender||'', address||'', medical_notes||'', assigned_branch_id||null, assigned_staff_id||null, billing_frequency||'MONTHLY', base_rate_amount||0, status||'active', req.params.id, req.clinicId]);

      if (oldStaff != assigned_staff_id) {
        if (oldStaff) {
          await pool.query(`UPDATE staff SET sessions = MAX(0, COALESCE(sessions, 0) - 1) WHERE id=$1 AND clinic_id=$2`, [oldStaff, req.clinicId]);
        }
        if (assigned_staff_id) {
          await pool.query(`UPDATE staff SET sessions = COALESCE(sessions, 0) + 1 WHERE id=$1 AND clinic_id=$2`, [assigned_staff_id, req.clinicId]);
        }
      }
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});
app.delete('/api/patients/:id', authenticate, async (req, res) => {
  try { await pool.query('DELETE FROM patients WHERE id=$1 AND clinic_id=$2', [req.params.id, req.clinicId]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// APPOINTMENTS
app.get('/api/appointments', authenticate, async (req, res) => {
  try {
    const r = await pool.query(`SELECT a.*, COALESCE(p.name, a.patient) as patient_name, p.patient_id as patient_code, COALESCE(s.name, a.therapist) as staff_name, COALESCE(b.name, a.service) as branch_name FROM appointments a LEFT JOIN patients p ON a.patient_id=p.id LEFT JOIN staff s ON a.staff_id=s.id LEFT JOIN branches b ON a.branch_id=b.id WHERE a.clinic_id=$1 ORDER BY a.id DESC`, [req.clinicId]);
    res.json(r.rows);
  } catch (err) { console.error('appointments err', err); res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/appointments', authenticate, async (req, res) => {
  try {
    const { patient_id, staff_id, branch_id, date_time, duration_minutes, service, status, payment_status, notes } = req.body;
    // Double-booking check for staff and patient
    if (date_time && (staff_id || patient_id)) {
      const dur = duration_minutes || 60;
      const startDt = new Date(date_time);
      const endDt = new Date(startDt.getTime() + dur * 60000);
      
      if (staff_id) {
        const conflictStaff = await pool.query(`SELECT id FROM appointments WHERE clinic_id=$1 AND staff_id=$2 AND status NOT IN ('Cancelled') AND date_time IS NOT NULL AND datetime(date_time) < datetime('${endDt.toISOString()}') AND datetime(date_time, '+' || COALESCE(duration_minutes,60) || ' minutes') > datetime('${startDt.toISOString()}')`, [req.clinicId, staff_id]);
        if (conflictStaff.rows.length > 0) return res.status(409).json({ message: 'Staff member has an overlapping appointment at this time.' });
      }
      if (patient_id) {
        const conflictPatient = await pool.query(`SELECT id FROM appointments WHERE clinic_id=$1 AND patient_id=$2 AND status NOT IN ('Cancelled') AND date_time IS NOT NULL AND datetime(date_time) < datetime('${endDt.toISOString()}') AND datetime(date_time, '+' || COALESCE(duration_minutes,60) || ' minutes') > datetime('${startDt.toISOString()}')`, [req.clinicId, patient_id]);
        if (conflictPatient.rows.length > 0) return res.status(409).json({ message: 'Patient already has an overlapping appointment at this time.' });
      }
    }
    
    let invNum = null;
    let therapistName = '';
    let branchName = '';
    let pat = null;
    const todayStr = new Date().toISOString().split('T')[0];
    let shouldGenerateInvoice = false;

    if ((status || 'Confirmed') === 'Confirmed' && patient_id) {
       const pRes = await pool.query('SELECT * FROM patients WHERE id=$1', [patient_id]);
       pat = pRes.rows[0];
       if (pat) {
         const dup = await pool.query("SELECT id FROM invoices WHERE clinic_id=$1 AND patient_id=$2 AND date=$3 AND notes LIKE '%Auto-session%'", [req.clinicId, patient_id, todayStr]);
         if (!dup.rows.length) {
           shouldGenerateInvoice = true;
           invNum = await pool.getNextInvoiceNumber(req.clinicId);
           if (staff_id) {
             const stRes = await pool.query('SELECT name FROM staff WHERE id=$1', [staff_id]);
             therapistName = stRes.rows[0]?.name || '';
           }
           if (branch_id) {
             const brRes = await pool.query('SELECT name FROM branches WHERE id=$1', [branch_id]);
             branchName = brRes.rows[0]?.name || '';
           }
         }
       }
    }

    const apt = await pool.transaction(async () => {
      const r = await pool.query(`INSERT INTO appointments (clinic_id,patient_id,staff_id,branch_id,date_time,duration_minutes,service,status,payment_status,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.clinicId, patient_id||null, staff_id||null, branch_id||null, date_time||null, duration_minutes||60, service||'', status||'Confirmed', payment_status||'pending', notes||'']);
      const newApt = r.rows[0];

      if (newApt.status === 'Confirmed') {
        if (newApt.staff_id) {
          await pool.query('UPDATE staff SET sessions = COALESCE(sessions, 0) + 1 WHERE id=$1 AND clinic_id=$2', [newApt.staff_id, req.clinicId]);
        }
        if (shouldGenerateInvoice && invNum && pat) {
          const due = new Date(Date.now() + 7*86400000).toISOString().split('T')[0];
          await pool.query(`INSERT INTO invoices (clinic_id,invoice_number,patient_id,patient_name,patient_phone,service,amount,tax,total,billing_frequency,status,date,due_date,therapist,branch,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [req.clinicId, invNum, pat.id, pat.name||'', pat.phone||'', service||'Session',
             pat.base_rate_amount||0, 0, pat.base_rate_amount||0, pat.billing_frequency||'MONTHLY',
             'pending', todayStr, due, therapistName, branchName, 'Auto-session invoice']);
        }
      }
      return newApt;
    });

    res.json(apt);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});
app.put('/api/appointments/:id', authenticate, async (req, res) => {
  try {
    const cur = await pool.query('SELECT * FROM appointments WHERE id=$1 AND clinic_id=$2', [req.params.id, req.clinicId]);
    if (!cur.rows.length) return res.status(404).json({ message: 'Not found' });
    const ex = cur.rows[0];
    const { date_time, duration_minutes, service, status, payment_status, notes } = req.body;
    const pid = req.body.patient_id !== undefined ? req.body.patient_id : ex.patient_id;
    const sid = req.body.staff_id   !== undefined ? req.body.staff_id   : ex.staff_id;
    const bid = req.body.branch_id  !== undefined ? req.body.branch_id  : ex.branch_id;

    let shouldGenerateInvoice = false;
    let invNum = null;
    let therapistName = '';
    let branchName = '';
    let apt = null;
    let todayStr = new Date().toISOString().split('T')[0];

    if (status === 'Confirmed') {
      const aptRes = await pool.query('SELECT a.*, p.billing_frequency, p.base_rate_amount, p.name as pname, p.phone as pphone FROM appointments a LEFT JOIN patients p ON a.patient_id=p.id WHERE a.id=$1', [req.params.id]);
      apt = aptRes.rows[0];
      if (apt && apt.patient_id) {
        const dup = await pool.query("SELECT id FROM invoices WHERE clinic_id=$1 AND patient_id=$2 AND date=$3 AND notes LIKE '%Auto-session%'", [req.clinicId, apt.patient_id, todayStr]);
        if (!dup.rows.length) {
          shouldGenerateInvoice = true;
          if (sid || apt.staff_id) {
            const stRes = await pool.query('SELECT name FROM staff WHERE id=$1', [sid || apt.staff_id]);
            therapistName = stRes.rows[0]?.name || '';
          }
          if (bid || apt.branch_id) {
            const brRes = await pool.query('SELECT name FROM branches WHERE id=$1', [bid || apt.branch_id]);
            branchName = brRes.rows[0]?.name || '';
          }
          invNum = await pool.getNextInvoiceNumber(req.clinicId);
        }
      }
    }

    await pool.transaction(async () => {
      await pool.query(`UPDATE appointments SET patient_id=$1,staff_id=$2,branch_id=$3,date_time=$4,duration_minutes=$5,service=$6,status=$7,payment_status=$8,notes=$9 WHERE id=$10 AND clinic_id=$11`,
        [pid||null, sid||null, bid||null, date_time||ex.date_time, duration_minutes||ex.duration_minutes||60,
         service||ex.service||'', status||ex.status, payment_status||'pending', notes||ex.notes||'',
         req.params.id, req.clinicId]);

      // Handle session counting for staff assignments and status changes
      if (status === 'Confirmed') {
        if (ex.status !== 'Confirmed') {
           // Transitioned to Confirmed: increment session for the assigned staff
           if (sid || ex.staff_id) {
             await pool.query('UPDATE staff SET sessions = COALESCE(sessions, 0) + 1 WHERE id=$1 AND clinic_id=$2', [sid || ex.staff_id, req.clinicId]);
           }
        } else if (ex.status === 'Confirmed') {
           // Was already Confirmed, but check if the staff assignment changed
           if (sid !== undefined && sid !== ex.staff_id) {
             if (ex.staff_id) {
               await pool.query('UPDATE staff SET sessions = MAX(0, COALESCE(sessions, 0) - 1) WHERE id=$1 AND clinic_id=$2', [ex.staff_id, req.clinicId]);
             }
             if (sid) {
               await pool.query('UPDATE staff SET sessions = COALESCE(sessions, 0) + 1 WHERE id=$1 AND clinic_id=$2', [sid, req.clinicId]);
             }
           }
        }
      } else {
        // Changed from Confirmed to something else (e.g. Cancelled)
        if (ex.status === 'Confirmed') {
           if (ex.staff_id) {
             await pool.query('UPDATE staff SET sessions = MAX(0, COALESCE(sessions, 0) - 1) WHERE id=$1 AND clinic_id=$2', [ex.staff_id, req.clinicId]);
           }
        }
      }

      if (shouldGenerateInvoice && invNum) {
        const due = new Date(Date.now() + 7*86400000).toISOString().split('T')[0];
        await pool.query(`INSERT INTO invoices (clinic_id,invoice_number,patient_id,patient_name,patient_phone,service,amount,tax,total,billing_frequency,status,date,due_date,therapist,branch,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [req.clinicId, invNum, apt.patient_id, apt.pname||'', apt.pphone||'', apt.service||'Session',
           apt.base_rate_amount||0, 0, apt.base_rate_amount||0, apt.billing_frequency||'MONTHLY',
           'pending', todayStr, due, therapistName, branchName, 'Auto-session invoice']);
      }
    });

    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});
app.delete('/api/appointments/:id', authenticate, async (req, res) => {
  try { await pool.query('DELETE FROM appointments WHERE id=$1 AND clinic_id=$2', [req.params.id, req.clinicId]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// INVOICES
app.get('/api/invoices', authenticate, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM invoices WHERE clinic_id=$1 ORDER BY id DESC', [req.clinicId]); res.json(r.rows); }
  catch (err) { console.error('invoices err', err); res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/invoices', authenticate, async (req, res) => {
  try {
    const { patient_id, patient_name, patient_phone, service, amount, tax, total, billing_frequency, status, date, due_date, therapist, branch, notes } = req.body;
    const invNum = await pool.getNextInvoiceNumber(req.clinicId);
    const r = await pool.query(`INSERT INTO invoices (clinic_id,invoice_number,patient_id,patient_name,patient_phone,service,amount,tax,total,billing_frequency,status,date,due_date,therapist,branch,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [req.clinicId, invNum, patient_id||null, patient_name||'', patient_phone||'', service||'', amount||0, tax||0, total||amount||0, billing_frequency||'MONTHLY', status||'pending', date||new Date().toISOString().split('T')[0], due_date||'', therapist||'', branch||'', notes||'']);
    res.json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});
app.put('/api/invoices/:id', authenticate, async (req, res) => {
  try {
    const { patient_name, patient_phone, service, amount, tax, total, billing_frequency, status, date, due_date, therapist, branch, notes } = req.body;
    await pool.query(`UPDATE invoices SET patient_name=$1,patient_phone=$2,service=$3,amount=$4,tax=$5,total=$6,billing_frequency=$7,status=$8,date=$9,due_date=$10,therapist=$11,branch=$12,notes=$13 WHERE id=$14 AND clinic_id=$15`,
      [patient_name, patient_phone, service, amount, tax, total, billing_frequency||'MONTHLY', status, date, due_date, therapist, branch, notes||'', req.params.id, req.clinicId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});
app.delete('/api/invoices/:id', authenticate, async (req, res) => {
  try { await pool.query('DELETE FROM invoices WHERE id=$1 AND clinic_id=$2', [req.params.id, req.clinicId]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// LEADS
app.get('/api/leads', authenticate, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM leads WHERE clinic_id=$1 ORDER BY date DESC', [req.clinicId]); res.json(r.rows); }
  catch { res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/leads', authenticate, async (req, res) => {
  try {
    const { name, phone, email, service, source, stage, date } = req.body;
    const r = await pool.query('INSERT INTO leads (clinic_id,name,phone,email,service,source,stage,date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [req.clinicId, name, phone, email, service, source, stage, date]);
    res.json(r.rows[0]);
  } catch { res.status(500).json({ message: 'Server error' }); }
});
app.put('/api/leads/:id', authenticate, async (req, res) => {
  try {
    const { name, phone, email, service, source, stage, date } = req.body;
    await pool.query('UPDATE leads SET name=$1,phone=$2,email=$3,service=$4,source=$5,stage=$6,date=$7 WHERE id=$8 AND clinic_id=$9', [name, phone, email, service, source, stage, date, req.params.id, req.clinicId]);
    res.json({ success: true });
  } catch { res.status(500).json({ message: 'Server error' }); }
});
app.delete('/api/leads/:id', authenticate, async (req, res) => {
  try { await pool.query('DELETE FROM leads WHERE id=$1 AND clinic_id=$2', [req.params.id, req.clinicId]); res.json({ success: true }); }
  catch { res.status(500).json({ message: 'Server error' }); }
});

// PACKAGES
app.get('/api/packages', authenticate, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM packages WHERE clinic_id=$1', [req.clinicId]); res.json(r.rows); } catch { res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/packages', authenticate, async (req, res) => {
  try {
    const { name, sessions, price, discount, validity_days, description, is_active } = req.body;
    const r = await pool.query('INSERT INTO packages (clinic_id,name,sessions,price,discount,validity_days,description,is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [req.clinicId, name, sessions, price, discount, validity_days, description, is_active?1:0]);
    res.json(r.rows[0]);
  } catch { res.status(500).json({ message: 'Server error' }); }
});
app.put('/api/packages/:id', authenticate, async (req, res) => {
  try {
    const { name, sessions, price, discount, validity_days, description, is_active } = req.body;
    await pool.query('UPDATE packages SET name=$1,sessions=$2,price=$3,discount=$4,validity_days=$5,description=$6,is_active=$7 WHERE id=$8 AND clinic_id=$9', [name, sessions, price, discount, validity_days, description, is_active?1:0, req.params.id, req.clinicId]);
    res.json({ success: true });
  } catch { res.status(500).json({ message: 'Server error' }); }
});
app.delete('/api/packages/:id', authenticate, async (req, res) => {
  try { await pool.query('DELETE FROM packages WHERE id=$1 AND clinic_id=$2', [req.params.id, req.clinicId]); res.json({ success: true }); } catch { res.status(500).json({ message: 'Server error' }); }
});

// MEMBERSHIPS
app.get('/api/memberships', authenticate, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM memberships WHERE clinic_id=$1', [req.clinicId]); res.json(r.rows); } catch { res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/memberships', authenticate, async (req, res) => {
  try {
    const { name, price, duration_months, features, discount_on_services, is_active } = req.body;
    const r = await pool.query('INSERT INTO memberships (clinic_id,name,price,duration_months,features,discount_on_services,is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [req.clinicId, name, price, duration_months, JSON.stringify(features||[]), discount_on_services, is_active?1:0]);
    res.json(r.rows[0]);
  } catch { res.status(500).json({ message: 'Server error' }); }
});
app.put('/api/memberships/:id', authenticate, async (req, res) => {
  try {
    const { name, price, duration_months, features, discount_on_services, is_active } = req.body;
    await pool.query('UPDATE memberships SET name=$1,price=$2,duration_months=$3,features=$4,discount_on_services=$5,is_active=$6 WHERE id=$7 AND clinic_id=$8', [name, price, duration_months, JSON.stringify(features||[]), discount_on_services, is_active?1:0, req.params.id, req.clinicId]);
    res.json({ success: true });
  } catch { res.status(500).json({ message: 'Server error' }); }
});
app.delete('/api/memberships/:id', authenticate, async (req, res) => {
  try { await pool.query('DELETE FROM memberships WHERE id=$1 AND clinic_id=$2', [req.params.id, req.clinicId]); res.json({ success: true }); } catch { res.status(500).json({ message: 'Server error' }); }
});

// SETTINGS
app.get('/api/settings', authenticate, async (req, res) => {
  try {
    const r = await pool.query('SELECT settings_json FROM settings WHERE clinic_id=$1', [req.clinicId]);
    res.json(r.rows.length ? JSON.parse(r.rows[0].settings_json) : {});
  } catch { res.status(500).json({ message: 'Server error' }); }
});
app.put('/api/settings', authenticate, async (req, res) => {
  try {
    const sj = JSON.stringify(req.body);
    const ex = await pool.query('SELECT id FROM settings WHERE clinic_id=$1', [req.clinicId]);
    if (!ex.rows.length) await pool.query('INSERT INTO settings (clinic_id,settings_json) VALUES ($1,$2)', [req.clinicId, sj]);
    else await pool.query('UPDATE settings SET settings_json=$1 WHERE clinic_id=$2', [sj, req.clinicId]);
    res.json({ success: true });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

// GALLERY
app.get('/api/gallery', authenticate, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM gallery WHERE clinic_id=$1 ORDER BY "order" ASC', [req.clinicId]); res.json(r.rows); } catch { res.status(500).json({ message: 'Server error' }); }
});

// SUPER ADMIN
app.get('/api/super-admin/clinics', async (req, res) => {
  try {
    const clinicsRes = await pool.query('SELECT id,clinic_name,email,created_at FROM clinics ORDER BY created_at DESC');
    res.json(clinicsRes.rows);
  } catch { res.status(500).json({ message: 'Server error' }); }
});

// SEARCH
app.get('/api/search', authenticate, async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ patients: [], appointments: [], invoices: [] });
  const s = `%${q}%`;
  try {
    const [pts, apts, invs] = await Promise.all([
      pool.query('SELECT id,patient_id,name FROM patients WHERE clinic_id=$1 AND name LIKE $2 LIMIT 5', [req.clinicId, s]),
      pool.query('SELECT id,service,date_time FROM appointments WHERE clinic_id=$1 AND service LIKE $2 LIMIT 5', [req.clinicId, s]),
      pool.query('SELECT id,invoice_number,patient_name FROM invoices WHERE clinic_id=$1 AND patient_name LIKE $2 LIMIT 5', [req.clinicId, s])
    ]);
    res.json({ patients: pts.rows, appointments: apts.rows, invoices: invs.rows });
  } catch { res.status(500).json({ message: 'Search failed' }); }
});

// CRON JOB FOR RECURRING BILLING AND DAILY SESSION RESET
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily cron job for recurring invoices and session reset...');
  try {
    // 1. Reset staff daily sessions
    await pool.query("UPDATE staff SET sessions = 0");
    console.log('Staff sessions reset to 0.');

    // 2. Process recurring invoices
    const patients = await pool.query("SELECT * FROM patients WHERE status='active' AND billing_frequency IN ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY') AND base_rate_amount > 0");
    const todayStr = new Date().toISOString().split('T')[0];
    
    for (const p of patients.rows) {
      const lastInv = await pool.query("SELECT date FROM invoices WHERE patient_id=$1 AND notes='Auto-generated recurring invoice' ORDER BY date DESC LIMIT 1", [p.id]);
      
      let shouldGenerate = false;
      if (lastInv.rows.length === 0) {
         const regInv = await pool.query("SELECT date FROM invoices WHERE patient_id=$1 AND notes='Auto-generated on patient registration' ORDER BY date DESC LIMIT 1", [p.id]);
         if (regInv.rows.length > 0) {
             const regDate = new Date(regInv.rows[0].date);
             const today = new Date(todayStr);
             const diffTime = Math.abs(today - regDate);
             const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
             if (p.billing_frequency === 'DAILY' && diffDays >= 1) shouldGenerate = true;
             else if (p.billing_frequency === 'WEEKLY' && diffDays >= 7) shouldGenerate = true;
             else if (p.billing_frequency === 'MONTHLY' && diffDays >= 30) shouldGenerate = true;
             else if (p.billing_frequency === 'YEARLY' && diffDays >= 365) shouldGenerate = true;
         }
      } else {
         const lastDate = new Date(lastInv.rows[0].date);
         const today = new Date(todayStr);
         const diffTime = Math.abs(today - lastDate);
         const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
         if (p.billing_frequency === 'DAILY' && diffDays >= 1) shouldGenerate = true;
         else if (p.billing_frequency === 'WEEKLY' && diffDays >= 7) shouldGenerate = true;
         else if (p.billing_frequency === 'MONTHLY' && diffDays >= 30) shouldGenerate = true;
         else if (p.billing_frequency === 'YEARLY' && diffDays >= 365) shouldGenerate = true;
      }

      if (shouldGenerate) {
        const invNum = await pool.getNextInvoiceNumber(p.clinic_id);
        await pool.transaction(async () => {
           const due = new Date(Date.now() + 7*86400000).toISOString().split('T')[0];
           await pool.query(`INSERT INTO invoices (clinic_id,invoice_number,patient_id,patient_name,patient_phone,service,amount,tax,total,billing_frequency,status,date,due_date,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
             [p.clinic_id, invNum, p.id, p.name, p.phone||'', 'Recurring Base Package', p.base_rate_amount, 0, p.base_rate_amount, p.billing_frequency, 'pending', todayStr, due, 'Auto-generated recurring invoice']);
        });
      }
    }
  } catch(err) {
    console.error('Cron job error:', err);
  }
});

const PORT = process.env.PORT || 5000;
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health`);
    console.log(`   Login: POST http://localhost:${PORT}/api/auth/login`);
    console.log(`   Register: POST http://localhost:${PORT}/api/auth/register`);
  });
}).catch(err => {
  console.error('❌ Database init failed:', err);
  process.exit(1);
});
